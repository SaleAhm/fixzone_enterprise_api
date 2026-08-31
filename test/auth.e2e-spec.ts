import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { FirebaseAuthVerifierService } from '../src/auth/firebase-auth-verifier.service';

describe('Auth API (e2e)', () => {
  jest.setTimeout(30000);

  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let citizenToken: string;
  let providerToken: string;
  let adminOrganizationId: string;

  const authFixtureEmails = [
    'admin@test.com',
    'citizen@test.com',
    'provider@test.com',
    'provider1-auth@test.com',
    'provider2-auth@test.com',
    'provider2-suspended@test.com',
    'provider-new-auth@test.com',
    'provider-reset-auth@test.com',
    'provider-invited-reset-auth@test.com',
    'demo-provider-1-auth@test.com',
    'demo-provider-2-auth@test.com',
    'demo-provider-3-auth@test.com',
    'citizen.sync@test.com',
  ];

  const authFixturePhones = ['+2348000000001', '+2348000000999'];
  const authFixtureProviderIds = [
    'PRV-AUTH-MISMATCH-001',
    'PRV-AUTH-MISMATCH-002',
    'PRV-AUTH-SUSPENDED',
    'PRV-AUTH-001',
    'PRV-AUTH-002',
    'PRV-AUTH-003',
    'PRV-AUTH-DEMO-001',
    'PRV-AUTH-RESET',
  ];

  const firebaseAuthVerifierMock = {
    verifyIdToken: jest.fn((idToken: string) => {
      if (idToken === 'auth-firebase-sync-token') {
        return Promise.resolve({
          uid: 'firebase-sync-uid',
          phoneNumber: '+2348000000001',
          email: null,
          emailVerified: false,
          fullName: 'Citizen Sync',
        });
      }
      if (idToken === 'auth-firebase-sync-updated-token') {
        return Promise.resolve({
          uid: 'firebase-sync-uid',
          phoneNumber: '+2348000000001',
          email: 'citizen.sync@test.com',
          emailVerified: true,
          fullName: 'Citizen Sync Updated',
        });
      }
      return Promise.reject(
        new Error('Firebase ID token could not be verified'),
      );
    }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FirebaseAuthVerifierService)
      .useValue(firebaseAuthVerifierMock)
      .compile();

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
  }, 30000);

  afterAll(async () => {
    if (prisma) {
      await cleanupAuthUsers();

      if (adminOrganizationId) {
        await prisma.organization.delete({
          where: { id: adminOrganizationId },
        });
      }

      await prisma.$disconnect();
    }

    await app?.close();
  }, 30000);

  async function cleanupAuthUsers() {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: { in: authFixtureEmails } },
          { phone: { in: authFixturePhones } },
          { providerId: { in: authFixtureProviderIds } },
        ],
      },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);

    if (userIds.length > 0) {
      await prisma.invitation.deleteMany({
        where: {
          OR: [
            { invitedById: { in: userIds } },
            { acceptedUserId: { in: userIds } },
            { email: { in: authFixtureEmails } },
          ],
        },
      });
      await prisma.notification.deleteMany({
        where: {
          OR: [
            { userId: { in: userIds } },
            { report: { citizenId: { in: userIds } } },
            { report: { assignedProviderId: { in: userIds } } },
          ],
        },
      });
      await prisma.loginHistory.deleteMany({
        where: {
          OR: [
            { userId: { in: userIds } },
            { email: { in: authFixtureEmails } },
          ],
        },
      });
      await prisma.complianceAuditLog.deleteMany({
        where: {
          OR: [{ actorId: { in: userIds } }, { entityId: { in: userIds } }],
        },
      });
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
          { email: { in: authFixtureEmails } },
          { phone: { in: authFixturePhones } },
          { providerId: { in: authFixtureProviderIds } },
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

  it('Citizen can update own profile through /auth/me', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        fullName: 'Citizen User Updated',
        phone: '+2348000000999',
        address: '12 SecureZone Street',
        notificationPreferences: { email: true, sms: false, push: true },
      });

    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe('Citizen User Updated');
    expect(res.body.phone).toBe('+2348000000999');
    expect(res.body.profileData.address).toBe('12 SecureZone Street');
    expect(res.body.profileData.notificationPreferences.sms).toBe(false);
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
        providerId: 'PRV-AUTH-MISMATCH-002',
        organizationId: adminOrganizationId,
      },
    });

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'provider2-auth@test.com',
        password: 'Password123!',
        providerId: 'PRV-AUTH-MISMATCH-001',
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
          providerId: 'PRV-AUTH-MISMATCH-002',
          organizationId: adminOrganizationId,
        },
      });
    }

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'provider2-auth@test.com',
        password: 'Password123!',
        providerId: 'PRV-AUTH-MISMATCH-002',
      });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.providerId).toBe('PRV-AUTH-MISMATCH-002');
  });

  it('blocks suspended provider login', async () => {
    const passwordHash = await bcrypt.hash('Password123!', 10);
    await prisma.user.create({
      data: {
        fullName: 'Provider Suspended Auth',
        email: 'provider2-suspended@test.com',
        passwordHash,
        role: 'PROVIDER',
        providerId: 'PRV-AUTH-SUSPENDED',
        accountStatus: 'SUSPENDED',
        organizationId: adminOrganizationId,
      },
    });

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'provider2-suspended@test.com',
        password: 'Password123!',
        providerId: 'PRV-AUTH-SUSPENDED',
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

  it('allows seeded provider-style accounts to log in with Password123!', async () => {
    const passwordHash = await bcrypt.hash('Password123!', 10);
    const providers = [
      ['demo-provider-1-auth@test.com', 'PRV-AUTH-001'],
      ['demo-provider-2-auth@test.com', 'PRV-AUTH-002'],
      ['demo-provider-3-auth@test.com', 'PRV-AUTH-003'],
    ];

    for (const [email, providerId] of providers) {
      await prisma.user.upsert({
        where: { email },
        update: {
          passwordHash,
          role: 'PROVIDER',
          providerId,
          accountStatus: 'ACTIVE',
          organizationId: adminOrganizationId,
        },
        create: {
          fullName: `Demo Provider ${providerId}`,
          email,
          passwordHash,
          role: 'PROVIDER',
          providerId,
          accountStatus: 'ACTIVE',
          organizationId: adminOrganizationId,
        },
      });

      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email,
          password: 'Password123!',
          providerId,
        });

      expect(login.status).toBe(201);
      expect(login.body.accessToken).toBeDefined();
      expect(login.body.user.role).toBe('PROVIDER');
      expect(login.body.user.providerId).toBe(providerId);
    }
  });

  it('allows provider demo-style credentials by email or provider ID', async () => {
    const passwordHash = await bcrypt.hash('Password123!', 10);
    await prisma.user.upsert({
      where: { email: 'provider1-auth@test.com' },
      update: {
        passwordHash,
        role: 'PROVIDER',
        providerId: 'PRV-AUTH-DEMO-001',
        accountStatus: 'ACTIVE',
        organizationId: adminOrganizationId,
      },
      create: {
        fullName: 'Demo Provider One',
        email: 'provider1-auth@test.com',
        passwordHash,
        role: 'PROVIDER',
        providerId: 'PRV-AUTH-DEMO-001',
        accountStatus: 'ACTIVE',
        organizationId: adminOrganizationId,
      },
    });

    const emailLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'provider1-auth@test.com',
        password: 'Password123!',
      });

    expect(emailLogin.status).toBe(201);
    expect(emailLogin.body.user.role).toBe('PROVIDER');
    expect(emailLogin.body.user.providerId).toBe('PRV-AUTH-DEMO-001');

    const providerIdLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        providerId: 'PRV-AUTH-DEMO-001',
        password: 'Password123!',
      });

    expect(providerIdLogin.status).toBe(201);
    expect(providerIdLogin.body.user.email).toBe('provider1-auth@test.com');
    expect(providerIdLogin.body.user.providerId).toBe('PRV-AUTH-DEMO-001');
  });

  it('newly registered provider can log in and never stores plaintext password', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        fullName: 'New Provider Auth',
        email: 'provider-new-auth@test.com',
        password: 'Password123!',
        role: 'provider',
        organizationId: adminOrganizationId,
      });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('PROVIDER');

    const stored = await prisma.user.findUnique({
      where: { email: 'provider-new-auth@test.com' },
    });
    expect(stored?.passwordHash).toBeDefined();
    expect(stored?.passwordHash).not.toBe('Password123!');
    expect(await bcrypt.compare('Password123!', stored!.passwordHash!)).toBe(
      true,
    );

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'provider-new-auth@test.com',
        password: 'Password123!',
      });

    expect(login.status).toBe(201);
    expect(login.body.user.role).toBe('PROVIDER');
  });

  it('reset provider password hashes the new password and permits login', async () => {
    const originalHash = await bcrypt.hash('Password123!', 10);
    const provider = await prisma.user.create({
      data: {
        fullName: 'Provider Reset Auth',
        email: 'provider-reset-auth@test.com',
        passwordHash: originalHash,
        role: 'PROVIDER',
        providerId: 'PRV-AUTH-RESET',
        accountStatus: 'SUSPENDED',
        organizationId: adminOrganizationId,
      },
    });

    const reset = await request(app.getHttpServer())
      .post(`/api/users/admin/${provider.id}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: 'NewPassword123!' });

    expect(reset.status).toBe(201);
    expect(reset.body.user.accountStatus).toBe('ACTIVE');

    const stored = await prisma.user.findUnique({ where: { id: provider.id } });
    expect(stored?.passwordHash).toBeDefined();
    expect(stored?.passwordHash).not.toBe('NewPassword123!');
    expect(await bcrypt.compare('NewPassword123!', stored!.passwordHash!)).toBe(
      true,
    );

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'provider-reset-auth@test.com',
        password: 'NewPassword123!',
        providerId: 'PRV-AUTH-RESET',
      });

    expect(login.status).toBe(201);
    expect(login.body.user.accountStatus).toBe('ACTIVE');
    expect(login.body.user.role).toBe('PROVIDER');
  });

  it('invited provider can view and accept organization invitation', async () => {
    const inviteePasswordHash = await bcrypt.hash('InviteePassword123!', 10);
    const invitee = await prisma.user.create({
      data: {
        fullName: 'Provider Invited Reset Auth',
        email: 'provider-invited-reset-auth@test.com',
        passwordHash: inviteePasswordHash,
        role: 'CITIZEN',
        accountStatus: 'ACTIVE',
      },
    });

    const invite = await request(app.getHttpServer())
      .post('/api/users/admin/invitations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Provider Invited Reset Auth',
        email: 'provider-invited-reset-auth@test.com',
        role: 'PROVIDER',
        organizationId: adminOrganizationId,
      });

    expect(invite.status).toBe(201);
    expect(invite.body.invitation.status).toBe('PENDING');
    expect(invite.body.invitation.email).toBe(
      'provider-invited-reset-auth@test.com',
    );
    expect(invite.body.temporaryPassword).toBeUndefined();

    const inviteeLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'provider-invited-reset-auth@test.com',
        password: 'InviteePassword123!',
      });

    expect(inviteeLogin.status).toBe(201);

    const mine = await request(app.getHttpServer())
      .get('/api/users/invitations/mine')
      .set('Authorization', `Bearer ${inviteeLogin.body.accessToken}`);

    expect(mine.status).toBe(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].id).toBe(invite.body.invitation.id);

    const accept = await request(app.getHttpServer())
      .post(`/api/users/invitations/${invite.body.invitation.id}/accept`)
      .set('Authorization', `Bearer ${inviteeLogin.body.accessToken}`);

    expect(accept.status).toBe(201);
    expect(accept.body.status).toBe('ACCEPTED');

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'provider-invited-reset-auth@test.com',
        password: 'InviteePassword123!',
      });

    expect(login.status).toBe(201);
    expect(login.body.user.role).toBe('PROVIDER');
    expect(login.body.user.id).toBe(invitee.id);
    expect(login.body.user.organizationId).toBe(adminOrganizationId);
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
        idToken: 'auth-firebase-sync-token',
        fullName: 'Citizen Sync',
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
        idToken: 'auth-firebase-sync-updated-token',
        fullName: 'Citizen Sync Updated',
      });

    expect(secondLogin.status).toBe(201);
    expect(secondLogin.body.accessToken).toBeDefined();
    expect(secondLogin.body.user.email).toBe('citizen.sync@test.com');
    expect(secondLogin.body.user.fullName).toBe('Citizen Sync Updated');
  });
});
