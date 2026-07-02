import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Organization Management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const createdOrgIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);
  });

  afterEach(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: [...createdUserIds] } },
      });
      createdUserIds.length = 0;
    }
    if (createdOrgIds.length > 0) {
      await prisma.organization.deleteMany({
        where: { id: { in: [...createdOrgIds] } },
      });
      createdOrgIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function createOrganization(name: string) {
    const organization = await prisma.organization.create({ data: { name } });
    createdOrgIds.push(organization.id);
    return organization;
  }

  async function createUser(data: {
    email: string;
    fullName: string;
    role: UserRole;
    organizationId?: string | null;
  }) {
    const user = await prisma.user.create({ data });
    createdUserIds.push(user.id);
    return user;
  }

  function signToken(user: {
    id: string;
    email: string | null;
    fullName: string;
    role: UserRole;
    organizationId: string | null;
  }) {
    return jwtService.signAsync({
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
    });
  }

  it('allows Super Admin to manage organizations and billing controls', async () => {
    const platformOrg = await createOrganization('Org Mgmt Platform');
    const superAdmin = await createUser({
      email: 'org-super@test.com',
      fullName: 'Org Super Admin',
      role: UserRole.SUPER_ADMIN,
      organizationId: platformOrg.id,
    });
    const token = await signToken(superAdmin);

    const createRes = await request(app.getHttpServer())
      .post('/api/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Enterprise University',
        type: 'UNIVERSITY',
        subscriptionPlan: 'PROFESSIONAL',
        billingStatus: 'ACTIVE',
        allowedUsers: 100,
        allowedProviders: 25,
        allowedReportsPerMonth: 5000,
      });

    expect(createRes.status).toBe(201);
    createdOrgIds.push(createRes.body.id);
    expect(createRes.body.subscriptionPlan).toBe('PROFESSIONAL');
    expect(createRes.body.quotas.users).toBe(100);
    expect(createRes.body.enabledModules).toEqual(['maintenance']);
    expect(createRes.body.moduleSummary.maintenanceActive).toBe(true);

    const updateRes = await request(app.getHttpServer())
      .patch(`/api/organizations/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ billingStatus: 'PAST_DUE', allowedUsers: 120 });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.billingStatus).toBe('PAST_DUE');
    expect(updateRes.body.quotas.users).toBe(120);

    const suspendRes = await request(app.getHttpServer())
      .post(`/api/organizations/${createRes.body.id}/suspend`)
      .set('Authorization', `Bearer ${token}`);

    expect(suspendRes.status).toBe(201);
    expect(suspendRes.body.status).toBe('SUSPENDED');

    const billingRes = await request(app.getHttpServer())
      .get('/api/organizations/billing/overview')
      .set('Authorization', `Bearer ${token}`);

    expect(billingRes.status).toBe(200);
    expect(billingRes.body.planCatalog.length).toBeGreaterThan(0);
  });

  it('exposes the platform module registry as read-only metadata', async () => {
    const platformOrg = await createOrganization('Module Registry Platform');
    const superAdmin = await createUser({
      email: 'module-registry-super@test.com',
      fullName: 'Module Registry Super Admin',
      role: UserRole.SUPER_ADMIN,
      organizationId: platformOrg.id,
    });
    const token = await signToken(superAdmin);

    const registryRes = await request(app.getHttpServer())
      .get('/api/platform-modules')
      .set('Authorization', `Bearer ${token}`);

    expect(registryRes.status).toBe(200);
    expect(registryRes.body.platformName).toBe('SecureZone Platform');
    expect(registryRes.body.activeProductionModuleKey).toBe('maintenance');
    expect(registryRes.body.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'maintenance',
          moduleName: 'FixZone',
          activeProduction: true,
          metadataOnly: false,
        }),
        expect.objectContaining({
          key: 'healthcare',
          activeProduction: false,
          metadataOnly: true,
        }),
      ]),
    );
  });

  it('evaluates module access without enforcing future workflows', async () => {
    const platformOrg = await createOrganization('Module Access Platform');
    const superAdmin = await createUser({
      email: 'module-access-super@test.com',
      fullName: 'Module Access Super Admin',
      role: UserRole.SUPER_ADMIN,
      organizationId: platformOrg.id,
    });
    const token = await signToken(superAdmin);

    const maintenanceRes = await request(app.getHttpServer())
      .get('/api/platform-modules/access/maintenance')
      .set('Authorization', `Bearer ${token}`);

    expect(maintenanceRes.status).toBe(200);
    expect(maintenanceRes.body).toMatchObject({
      moduleKey: 'maintenance',
      state: 'allowed',
      allowed: true,
      visible: true,
    });

    const futureRes = await request(app.getHttpServer())
      .get('/api/platform-modules/access/healthcare')
      .set('Authorization', `Bearer ${token}`);

    expect(futureRes.status).toBe(200);
    expect(futureRes.body).toMatchObject({
      moduleKey: 'healthcare',
      state: 'locked',
      allowed: false,
      visible: true,
    });
    expect(futureRes.body.reason).toContain('metadata-only');

    const missingRes = await request(app.getHttpServer())
      .get('/api/platform-modules/access/not_a_module')
      .set('Authorization', `Bearer ${token}`);

    expect(missingRes.status).toBe(200);
    expect(missingRes.body).toMatchObject({
      moduleKey: 'not_a_module',
      state: 'hidden',
      allowed: false,
      visible: false,
    });
  });

  it('normalizes organization module enablement without enabling future workflows', async () => {
    const platformOrg = await createOrganization('Module Enablement Platform');
    const superAdmin = await createUser({
      email: 'module-enable-super@test.com',
      fullName: 'Module Enablement Super Admin',
      role: UserRole.SUPER_ADMIN,
      organizationId: platformOrg.id,
    });
    const token = await signToken(superAdmin);

    const createRes = await request(app.getHttpServer())
      .post('/api/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Phase 4A Tenant',
        enabledModules: ['healthcare', 'unknown_future_module'],
      });

    expect(createRes.status).toBe(201);
    createdOrgIds.push(createRes.body.id);
    expect(createRes.body.enabledModules).toEqual([
      'maintenance',
      'healthcare',
    ]);
    expect(createRes.body.moduleSummary.maintenanceActive).toBe(true);
    expect(createRes.body.moduleSummary.activeProductionModuleKeys).toEqual([
      'maintenance',
    ]);
    expect(createRes.body.moduleSummary.metadataOnlyModuleKeys).toEqual([
      'healthcare',
    ]);

    const updateRes = await request(app.getHttpServer())
      .patch(`/api/organizations/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabledModules: ['legal'] });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.enabledModules).toEqual(['maintenance', 'legal']);
    expect(updateRes.body.moduleSummary.activeProductionModuleKeys).toEqual([
      'maintenance',
    ]);
    expect(updateRes.body.moduleSummary.metadataOnlyModuleKeys).toEqual([
      'legal',
    ]);
  });

  it('scopes organization reads for Org Admins', async () => {
    const orgA = await createOrganization('Org Mgmt A');
    const orgB = await createOrganization('Org Mgmt B');
    const orgAdmin = await createUser({
      email: 'org-admin@test.com',
      fullName: 'Org Admin',
      role: UserRole.ORG_ADMIN,
      organizationId: orgA.id,
    });
    const token = await signToken(orgAdmin);

    const listRes = await request(app.getHttpServer())
      .get('/api/organizations')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.map((org: { id: string }) => org.id)).toEqual([
      orgA.id,
    ]);

    const deniedRes = await request(app.getHttpServer())
      .get(`/api/organizations/${orgB.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(deniedRes.status).toBe(403);
  });
});
