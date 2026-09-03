import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AccountStatus, UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

type TokenUser = {
  id: string;
  email: string | null;
  phone: string | null;
  fullName: string | null;
  role: UserRole;
  organizationId: string | null;
  providerId: string | null;
  accountStatus: AccountStatus;
  phoneVerifiedAt: Date | null;
  emailVerifiedAt: Date | null;
  secureZoneId: string | null;
};

describe('JWT account status enforcement (e2e)', () => {
  jest.setTimeout(30000);

  let app: INestApplication;
  let httpServer: App;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let organizationId: string;

  const fixtureEmails = [
    'jwt-citizen-status@test.com',
    'jwt-provider-status@test.com',
    'jwt-org-admin-status@test.com',
    'jwt-platform-admin-status@test.com',
    'jwt-reactivation-status@test.com',
  ];
  const fixtureProviderIds = ['PRV-AUTH-JWT-STATUS'];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    httpServer = app.getHttpServer() as App;
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);

    await cleanupFixtures();
    const organization = await prisma.organization.create({
      data: {
        name: `JWT Status Test Organization ${Date.now()}`,
      },
    });
    organizationId = organization.id;
  }, 30000);

  afterAll(async () => {
    if (prisma) {
      await cleanupFixtures();
      if (organizationId) {
        await prisma.organization.delete({ where: { id: organizationId } });
      }
      await prisma.$disconnect();
    }
    await app?.close();
  }, 30000);

  async function cleanupFixtures() {
    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: { in: fixtureEmails } },
          { providerId: { in: fixtureProviderIds } },
        ],
      },
    });
  }

  async function createUser(options: {
    role: UserRole;
    email: string;
    providerId?: string;
  }) {
    return prisma.user.create({
      data: {
        fullName: `JWT ${options.role} Status Probe`,
        email: options.email,
        passwordHash: await bcrypt.hash('Password123!', 10),
        role: options.role,
        providerId: options.providerId,
        organizationId:
          options.role === UserRole.CITIZEN ||
          options.role === UserRole.PLATFORM_SUPER_ADMIN
            ? null
            : organizationId,
        accountStatus: AccountStatus.ACTIVE,
      },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        role: true,
        organizationId: true,
        providerId: true,
        accountStatus: true,
        phoneVerifiedAt: true,
        emailVerifiedAt: true,
        secureZoneId: true,
      },
    });
  }

  async function issueAccessToken(user: TokenUser) {
    return jwtService.signAsync({
      id: user.id,
      sub: user.id,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
      providerId: user.providerId,
      accountStatus: user.accountStatus,
      phoneVerifiedAt: user.phoneVerifiedAt,
      emailVerifiedAt: user.emailVerifiedAt,
      secureZoneId: user.secureZoneId,
    });
  }

  it('rejects previously issued JWTs after authoritative account status changes', async () => {
    const roleFixtures = [
      {
        role: UserRole.CITIZEN,
        email: 'jwt-citizen-status@test.com',
        nextStatus: AccountStatus.SUSPENDED,
      },
      {
        role: UserRole.PROVIDER,
        email: 'jwt-provider-status@test.com',
        nextStatus: AccountStatus.DEACTIVATED,
        providerId: 'PRV-AUTH-JWT-STATUS',
      },
      {
        role: UserRole.ORG_ADMIN,
        email: 'jwt-org-admin-status@test.com',
        nextStatus: AccountStatus.PENDING_APPROVAL,
      },
      {
        role: UserRole.PLATFORM_SUPER_ADMIN,
        email: 'jwt-platform-admin-status@test.com',
        nextStatus: AccountStatus.PENDING_INVITE,
      },
    ];

    for (const fixture of roleFixtures) {
      const user = await createUser(fixture);
      const token = await issueAccessToken(user);

      const active = await request(httpServer)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
      const activeBody = active.body as Record<string, unknown>;

      expect(active.status).toBe(200);
      expect(activeBody).toMatchObject({
        id: user.id,
        role: fixture.role,
        accountStatus: AccountStatus.ACTIVE,
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { accountStatus: fixture.nextStatus },
      });

      const rejected = await request(httpServer)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
      const rejectedBody = rejected.body as Record<string, unknown>;
      const serializedRejectedBody = JSON.stringify(rejectedBody);

      expect(rejected.status).toBe(401);
      expect(rejectedBody.message).toBe('Unauthorized');
      expect(serializedRejectedBody).not.toContain(fixture.nextStatus);
      expect(serializedRejectedBody).not.toContain('Prisma');
      expect(serializedRejectedBody).not.toContain('SQL');
      expect(serializedRejectedBody).not.toContain('stack');
      expect(rejectedBody.user).toBeUndefined();
      expect(rejectedBody.accessToken).toBeUndefined();
    }
  });

  it('accepts a previously issued JWT again after account reactivation', async () => {
    const user = await createUser({
      role: UserRole.CITIZEN,
      email: 'jwt-reactivation-status@test.com',
    });
    const token = await issueAccessToken(user);

    await prisma.user.update({
      where: { id: user.id },
      data: { accountStatus: AccountStatus.SUSPENDED },
    });

    const suspended = await request(httpServer)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(suspended.status).toBe(401);

    await prisma.user.update({
      where: { id: user.id },
      data: { accountStatus: AccountStatus.ACTIVE },
    });

    const reactivated = await request(httpServer)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    const reactivatedBody = reactivated.body as Record<string, unknown>;

    expect(reactivated.status).toBe(200);
    expect(reactivatedBody).toMatchObject({
      id: user.id,
      role: UserRole.CITIZEN,
      accountStatus: AccountStatus.ACTIVE,
    });
  });
});
