import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Enterprise Rate Limiting (e2e)', () => {
  jest.setTimeout(30000);

  let app: INestApplication;
  let prisma: PrismaService;
  let organizationId: string;
  let adminToken: string;
  let citizenToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);

    await cleanup();
    const organization = await prisma.organization.create({
      data: { name: 'Rate Limit Test Organization' },
    });
    organizationId = organization.id;

    await createUser({
      email: 'rate-limit-admin@test.com',
      fullName: 'Rate Limit Admin',
      role: UserRole.SUPER_ADMIN,
      organizationId,
    });
    await createUser({
      email: 'rate-limit-citizen@test.com',
      fullName: 'Rate Limit Citizen',
      role: UserRole.CITIZEN,
      organizationId,
    });
    await createUser({
      email: 'rate-limit-login@test.com',
      fullName: 'Rate Limit Login',
      role: UserRole.CITIZEN,
      organizationId,
    });

    adminToken = await login('rate-limit-admin@test.com');
    citizenToken = await login('rate-limit-citizen@test.com');
  });

  afterAll(async () => {
    await cleanup();
    await app?.close();
  });

  async function createUser(data: {
    email: string;
    fullName: string;
    role: UserRole;
    organizationId: string;
  }) {
    return prisma.user.create({
      data: {
        ...data,
        passwordHash: await bcrypt.hash('Password123!', 10),
      },
    });
  }

  async function login(email: string) {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Password123!' });
    expect(res.status).toBe(201);
    return res.body.accessToken as string;
  }

  async function cleanup() {
    const emails = [
      'rate-limit-admin@test.com',
      'rate-limit-citizen@test.com',
      'rate-limit-login@test.com',
    ];
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);

    if (userIds.length > 0) {
      await prisma.notification.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.loginHistory.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.complianceAuditLog.deleteMany({
        where: { actorId: { in: userIds } },
      });
      await prisma.report.deleteMany({
        where: {
          OR: [
            { citizenId: { in: userIds } },
            { assignedProviderId: { in: userIds } },
          ],
        },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }

    await prisma.organization.deleteMany({
      where: { name: 'Rate Limit Test Organization' },
    });
  }

  it('allows normal authenticated requests below the global limit', async () => {
    const first = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${citizenToken}`);
    const second = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${citizenToken}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('preserves role-sensitive authorization under rate limiting', async () => {
    const blocked = await request(app.getHttpServer())
      .get('/api/auth/admin-only')
      .set('Authorization', `Bearer ${citizenToken}`);
    const allowed = await request(app.getHttpServer())
      .get('/api/auth/admin-only')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(blocked.status).toBe(403);
    expect(allowed.status).toBe(200);
  });

  it('throttles repeated unauthenticated login attempts with HTTP 429', async () => {
    let lastStatus = 0;
    let lastBody: Record<string, unknown> = {};

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'rate-limit-login@test.com',
          password: 'Password123!',
        });
      lastStatus = res.status;
      lastBody = res.body;
    }

    expect(lastStatus).toBe(429);
    expect(lastBody).toMatchObject({
      statusCode: 429,
      message: 'Too many requests',
    });
  });

  it('throttles authenticated evidence upload attempts by bearer token', async () => {
    let lastStatus = 0;

    for (let attempt = 0; attempt < 7; attempt += 1) {
      const res = await request(app.getHttpServer())
        .post('/api/report/rate-limit-missing-report/evidence')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          contentType: 'image/jpeg',
          imageBase64: 'aGVsbG8=',
        });
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });

  it('applies stricter throttling to heavy administrative tools', async () => {
    let lastStatus = 0;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await request(app.getHttpServer())
        .post('/api/platform-tools/cache/clear')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ scope: 'api' });
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });
});
