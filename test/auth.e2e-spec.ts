import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let citizenToken: string;
  let providerToken: string;
  let adminOrganizationId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);

    await cleanupAuthUsers();
    const adminOrganization = await prisma.organization.create({
      data: {
        name: `Auth Test Organization ${Date.now()}`,
      },
    });
    adminOrganizationId = adminOrganization.id;
  });

  afterAll(async () => {
    await cleanupAuthUsers();

    await prisma.organization.delete({
      where: { id: adminOrganizationId },
    });

    await prisma.$disconnect();
    await app.close();
  });

  async function cleanupAuthUsers() {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: 'admin@test.com' },
          { email: 'citizen@test.com' },
          { email: 'provider@test.com' },
          { email: 'provider2-auth@test.com' },
          { email: 'provider2-suspended@test.com' },
          { email: 'citizen.sync@test.com' },
          { phone: '+2348000000001' },
        ],
      },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);

    if (userIds.length > 0) {
      await prisma.report.deleteMany({
        where: {
          OR: [
            { citizenId: { in: userIds } },
            { assignedProviderId: { in: userIds } },
          ],
        },
      });
    }

    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: 'admin@test.com' },
          { email: 'citizen@test.com' },
          { email: 'provider@test.com' },
          { email: 'provider2-auth@test.com' },
          { email: 'provider2-suspended@test.com' },
          { email: 'citizen.sync@test.com' },
          { phone: '+2348000000001' },
        ],
      },
    });
  }

  it('Register Admin', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        fullName: 'Admin User',
        email: 'admin@test.com',
        password: '123456',
        role: 'admin',
        organizationId: adminOrganizationId,
      });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.role).toBe('ORG_ADMIN');
    expect(res.body.user.organizationId).toBe(adminOrganizationId);
  });

  it('Login Admin', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'admin@test.com',
        password: '123456',
      });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();

    adminToken = res.body.accessToken;
  });

  it('Admin can access /me', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('ORG_ADMIN');
  });

  it('Admin can access admin-only route', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/admin-only')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });

  it('Register Citizen', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        fullName: 'Citizen User',
        email: 'citizen@test.com',
        password: '123456',
        role: 'citizen',
      });

    expect(res.status).toBe(201);
  });

  it('Login Citizen', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'citizen@test.com',
        password: '123456',
      });

    expect(res.status).toBe(201);
    citizenToken = res.body.accessToken;
  });

  it('Citizen cannot access admin-only route', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/admin-only')
      .set('Authorization', `Bearer ${citizenToken}`);

    expect(res.status).toBe(403);
  });

  it('Register Provider', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        fullName: 'Provider User',
        email: 'provider@test.com',
        password: '123456',
        role: 'provider',
      });

    expect(res.status).toBe(201);
  });

  it('Login Provider', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'provider@test.com',
        password: '123456',
      });

    expect(res.status).toBe(201);
    providerToken = res.body.accessToken;
  });

  it('rejects provider login when Provider ID belongs to another provider', async () => {
    const passwordHash = await bcrypt.hash('Password123!', 10);
    await prisma.user.create({
      data: {
        fullName: 'Provider Two Auth',
        email: 'provider2-auth@test.com',
        passwordHash,
        role: 'PROVIDER',
        providerId: 'PRV-2024-002',
        organizationId: adminOrganizationId,
      },
    });

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'provider2-auth@test.com',
        password: 'Password123!',
        providerId: 'PRV-2024-001',
      });

    expect(res.status).toBe(401);
  });

  it('allows provider login when Provider ID matches the backend account', async () => {
    const existing = await prisma.user.findUnique({
      where: { email: 'provider2-auth@test.com' },
    });
    if (!existing) {
      const passwordHash = await bcrypt.hash('Password123!', 10);
      await prisma.user.create({
        data: {
          fullName: 'Provider Two Auth',
          email: 'provider2-auth@test.com',
          passwordHash,
          role: 'PROVIDER',
          providerId: 'PRV-2024-002',
          organizationId: adminOrganizationId,
        },
      });
    }

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'provider2-auth@test.com',
        password: 'Password123!',
        providerId: 'PRV-2024-002',
      });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.providerId).toBe('PRV-2024-002');
  });

  it('blocks suspended provider login', async () => {
    const passwordHash = await bcrypt.hash('Password123!', 10);
    await prisma.user.create({
      data: {
        fullName: 'Provider Suspended Auth',
        email: 'provider2-suspended@test.com',
        passwordHash,
        role: 'PROVIDER',
        providerId: 'PRV-2024-099',
        accountStatus: 'SUSPENDED',
        organizationId: adminOrganizationId,
      },
    });

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'provider2-suspended@test.com',
        password: 'Password123!',
        providerId: 'PRV-2024-099',
      });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Account is suspended');
  });

  it('Provider can access provider-or-admin route', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/provider-or-admin')
      .set('Authorization', `Bearer ${providerToken}`);

    expect(res.status).toBe(200);
  });

  it('Citizen cannot access provider-or-admin route', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/provider-or-admin')
      .set('Authorization', `Bearer ${citizenToken}`);

    expect(res.status).toBe(403);
  });

  it('syncs Firebase citizen profile fields by phone', async () => {
    const firstLogin = await request(app.getHttpServer())
      .post('/api/auth/firebase-login')
      .send({
        firebaseUid: 'firebase-sync-uid',
        phone: '+2348000000001',
        email: '',
        fullName: 'Citizen Sync',
        role: 'citizen',
      });

    expect(firstLogin.status).toBe(201);
    expect(firstLogin.body.accessToken).toBeDefined();
    expect(firstLogin.body.user.phone).toBe('+2348000000001');
    expect(firstLogin.body.user.email).toBeNull();

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${firstLogin.body.accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body.role).toBe('CITIZEN');

    const secondLogin = await request(app.getHttpServer())
      .post('/api/auth/firebase-login')
      .send({
        firebaseUid: 'firebase-sync-uid',
        phone: '+2348000000001',
        email: 'citizen.sync@test.com',
        fullName: 'Citizen Sync Updated',
        role: 'citizen',
      });

    expect(secondLogin.status).toBe(201);
    expect(secondLogin.body.accessToken).toBeDefined();
    expect(secondLogin.body.user.email).toBe('citizen.sync@test.com');
    expect(secondLogin.body.user.fullName).toBe('Citizen Sync Updated');
  });
});
