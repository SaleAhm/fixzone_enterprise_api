import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { InternalScopeType, UserRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

type SupertestServer = Parameters<typeof request>[0];
type TestApplication = Omit<INestApplication, 'getHttpServer'> & {
  getHttpServer(): SupertestServer;
};
type DemoGenerateBody = {
  demoBatchId: string;
  scenario: string;
  intelligenceSummary: {
    title: string;
    highlights: string[];
  };
  created: {
    organizations: number;
    citizens: number;
    providers: number;
    reports: number;
    notifications: number;
  };
};
type DemoStatsBody = {
  demoExists: boolean;
  currentDemoUsers: number;
  currentDemoReports: number;
  currentDemoOrganizations: number;
  scenario: string;
  intelligenceSummary: {
    title: string;
  };
};
type DemoPreviewBody = {
  deleteCounts: {
    organizations: number;
    reports: number;
    providers: number;
  };
};
type DemoPurgeBody = {
  deleted: {
    organizations: number;
    reports: number;
    users: number;
  };
};
type RetainedFixtureCounts = {
  users: number;
  assignments: number;
};

function body<T>(response: request.Response): T {
  return response.body as T;
}

describe('Demo Environment Platform Tools (e2e)', () => {
  const demoBatchPrefix = 'demo-';
  const retainedInternalAdminUatBatch = 'internal-admin-uat-20260829-v1';

  let app: TestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let retainedFixtureCounts: RetainedFixtureCounts;

  const createdProductionOrgIds: string[] = [];
  const createdProductionUserIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);
    retainedFixtureCounts = await countRetainedInternalAdminFixtures();
  });

  beforeEach(async () => {
    await cleanupDemoData();
  }, 15000);

  afterEach(async () => {
    await cleanupDemoData();
    await expectRetainedInternalAdminFixturesUnchanged();

    if (createdProductionUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: [...createdProductionUserIds] } },
      });
      createdProductionUserIds.length = 0;
    }

    if (createdProductionOrgIds.length > 0) {
      await prisma.organization.deleteMany({
        where: { id: { in: [...createdProductionOrgIds] } },
      });
      createdProductionOrgIds.length = 0;
    }
  }, 15000);

  afterAll(async () => {
    await cleanupDemoData();
    await expectRetainedInternalAdminFixturesUnchanged();
    await prisma.$disconnect();
    await app.close();
  }, 15000);

  async function cleanupDemoData() {
    const demoWhere = {
      isDemo: true,
      demoBatchId: { startsWith: demoBatchPrefix },
    };
    await prisma.$transaction(async (tx) => {
      const [demoUsers, demoOrganizations] = await Promise.all([
        tx.user.findMany({ where: demoWhere, select: { id: true } }),
        tx.organization.findMany({ where: demoWhere, select: { id: true } }),
      ]);
      const demoUserIds = demoUsers.map((user) => user.id);
      const demoOrganizationIds = demoOrganizations.map(
        (organization) => organization.id,
      );

      await tx.notification.deleteMany({ where: demoWhere });
      await tx.report.deleteMany({ where: demoWhere });
      if (demoUserIds.length > 0) {
        await tx.internalRoleAssignment.deleteMany({
          where: {
            OR: [
              { userId: { in: demoUserIds } },
              { assignedById: { in: demoUserIds } },
            ],
          },
        });
      }
      await tx.user.deleteMany({ where: { id: { in: demoUserIds } } });
      await tx.organization.deleteMany({
        where: { id: { in: demoOrganizationIds } },
      });
      await tx.demoAuditLog.deleteMany({
        where: { demoBatchId: { startsWith: demoBatchPrefix } },
      });
    });
  }

  async function countRetainedInternalAdminFixtures() {
    const users = await prisma.user.findMany({
      where: { demoBatchId: retainedInternalAdminUatBatch },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    const assignments = userIds.length
      ? await prisma.internalRoleAssignment.count({
          where: {
            OR: [
              { userId: { in: userIds } },
              { assignedById: { in: userIds } },
            ],
          },
        })
      : 0;

    return { users: users.length, assignments };
  }

  async function expectRetainedInternalAdminFixturesUnchanged() {
    if (retainedFixtureCounts.users === 0) return;
    await expect(countRetainedInternalAdminFixtures()).resolves.toEqual(
      retainedFixtureCounts,
    );
  }

  async function createUser(role: UserRole) {
    const user = await prisma.user.create({
      data: {
        email: `demo-env-${role.toLowerCase()}-${Date.now()}@test.com`,
        fullName: `Demo Env ${role}`,
        role,
      },
    });
    createdProductionUserIds.push(user.id);
    return user;
  }

  async function signToken(user: {
    id: string;
    email: string | null;
    fullName: string;
    role: UserRole;
    organizationId: string | null;
    tokenVersion: number;
  }) {
    return jwtService.signAsync({
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
      tokenVersion: user.tokenVersion,
    });
  }

  it('cleans demo-environment role assignments before demo users', async () => {
    const batchId = `${demoBatchPrefix}cleanup-regression`;
    const demoAssigner = await prisma.user.create({
      data: {
        email: 'demo.cleanup.assigner@test.com',
        fullName: 'Demo Cleanup Assigner',
        role: UserRole.SUPER_ADMIN,
        isDemo: true,
        demoBatchId: batchId,
      },
    });
    const demoSubject = await prisma.user.create({
      data: {
        email: 'demo.cleanup.subject@test.com',
        fullName: 'Demo Cleanup Subject',
        role: UserRole.SUPPORT_ADMIN,
        isDemo: true,
        demoBatchId: batchId,
      },
    });
    const productionSubject = await createUser(UserRole.SUPPORT_ADMIN);

    await prisma.internalRoleAssignment.createMany({
      data: [
        {
          userId: demoSubject.id,
          assignedById: demoAssigner.id,
          role: UserRole.SUPPORT_ADMIN,
          scopeType: InternalScopeType.PLATFORM,
          permissionsSnapshot: ['internal_admin.read'],
        },
        {
          userId: productionSubject.id,
          assignedById: demoAssigner.id,
          role: UserRole.SUPPORT_ADMIN,
          scopeType: InternalScopeType.PLATFORM,
          permissionsSnapshot: ['internal_admin.read'],
        },
      ],
    });

    await cleanupDemoData();

    await expect(
      prisma.user.count({
        where: { id: { in: [demoAssigner.id, demoSubject.id] } },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: productionSubject.id } }),
    ).resolves.toBeTruthy();
    await expect(
      prisma.internalRoleAssignment.count({
        where: {
          OR: [
            { userId: { in: [demoAssigner.id, demoSubject.id] } },
            { assignedById: { in: [demoAssigner.id, demoSubject.id] } },
          ],
        },
      }),
    ).resolves.toBe(0);
    await expectRetainedInternalAdminFixturesUnchanged();
  });

  it('generates, reports statistics, and purges only tagged demo data', async () => {
    const superAdmin = await createUser(UserRole.SUPER_ADMIN);
    const token = await signToken(superAdmin);
    const productionOrg = await prisma.organization.create({
      data: { name: `Production Org ${Date.now()}` },
    });
    createdProductionOrgIds.push(productionOrg.id);

    const generateRes = await request(app.getHttpServer())
      .post('/api/admin/platform-tools/demo-environment/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        scenario: 'Rainy Season',
        citizens: 3,
        providers: 2,
        organizations: 1,
        reports: 5,
        notifications: 8,
        includeEvidenceImages: true,
      });

    expect(generateRes.status).toBe(201);
    const generateBody = body<DemoGenerateBody>(generateRes);
    expect(generateBody.demoBatchId).toMatch(/^demo-/);
    expect(generateBody.scenario).toBe('Rainy Season');
    expect(generateBody.intelligenceSummary.title).toBe(
      'Rainy Season Demo Generated',
    );
    expect(generateBody.intelligenceSummary.highlights).toContain(
      '5 reports created',
    );
    expect(generateBody.created).toMatchObject({
      organizations: 1,
      citizens: 3,
      providers: 2,
      reports: 5,
      notifications: 8,
    });

    const demoReport = await prisma.report.findFirstOrThrow({
      where: { demoBatchId: generateBody.demoBatchId },
    });
    expect(demoReport.isDemo).toBe(true);
    expect(demoReport.demoScenario).toBe('Rainy Season');
    expect(demoReport.demoGeneratedAt).toBeTruthy();
    expect(demoReport.evidenceImageUrl).toMatch(/^\/uploads\/demo\/.+\.svg$/);

    const statsRes = await request(app.getHttpServer())
      .get('/api/admin/platform-tools/demo-environment/statistics')
      .set('Authorization', `Bearer ${token}`);

    expect(statsRes.status).toBe(200);
    const statsBody = body<DemoStatsBody>(statsRes);
    expect(statsBody.demoExists).toBe(true);
    expect(statsBody.currentDemoUsers).toBe(7);
    expect(statsBody.currentDemoReports).toBe(5);
    expect(statsBody.currentDemoOrganizations).toBe(1);
    expect(statsBody.scenario).toBe('Rainy Season');
    expect(statsBody.intelligenceSummary.title).toBe(
      'Rainy Season Demo Generated',
    );

    const unsafePurgeRes = await request(app.getHttpServer())
      .delete('/api/admin/platform-tools/demo-environment/purge')
      .set('Authorization', `Bearer ${token}`);

    expect(unsafePurgeRes.status).toBe(400);

    const previewRes = await request(app.getHttpServer())
      .get('/api/admin/platform-tools/demo-environment/purge/preview')
      .set('Authorization', `Bearer ${token}`);

    expect(previewRes.status).toBe(200);
    expect(body<DemoPreviewBody>(previewRes).deleteCounts).toMatchObject({
      organizations: 1,
      reports: 5,
      providers: 2,
    });

    const purgeRes = await request(app.getHttpServer())
      .post('/api/admin/platform-tools/demo-environment/purge/execute')
      .set('Authorization', `Bearer ${token}`)
      .send({
        typedPhrase: 'PURGE DEMO DATA',
        preservedSuperAdminId: superAdmin.id,
        backupReference: 'uat-backup-reference',
        reauthenticationToken: 'fresh-reauth-evidence',
        reason: 'Final UAT cleanup of tagged demo records',
      });

    expect([200, 201]).toContain(purgeRes.status);
    expect(body<DemoPurgeBody>(purgeRes).deleted).toMatchObject({
      organizations: 1,
      reports: 5,
      users: 7,
    });

    await expect(
      prisma.organization.findUniqueOrThrow({
        where: { id: productionOrg.id },
      }),
    ).resolves.toBeTruthy();
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: superAdmin.id } }),
    ).resolves.toBeTruthy();
    await expect(
      prisma.report.count({ where: { isDemo: true } }),
    ).resolves.toBe(0);
  });

  it('supports repeated demo generation without unique fixture collisions', async () => {
    const superAdmin = await createUser(UserRole.SUPER_ADMIN);
    const token = await signToken(superAdmin);

    const payload = {
      scenario: 'Rainy Season',
      citizens: 1,
      providers: 1,
      organizations: 1,
      reports: 1,
      notifications: 1,
      includeEvidenceImages: true,
    };

    const first = await request(app.getHttpServer())
      .post('/api/admin/platform-tools/demo-environment/generate')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
    const second = await request(app.getHttpServer())
      .post('/api/admin/platform-tools/demo-environment/generate')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(body<DemoGenerateBody>(first).demoBatchId).not.toBe(
      body<DemoGenerateBody>(second).demoBatchId,
    );

    const phones = await prisma.user.findMany({
      where: {
        isDemo: true,
        demoBatchId: { startsWith: demoBatchPrefix },
      },
      select: { phone: true },
    });
    expect(new Set(phones.map((user) => user.phone)).size).toBe(phones.length);

    const purgeRes = await request(app.getHttpServer())
      .post('/api/admin/platform-tools/demo-environment/purge/execute')
      .set('Authorization', `Bearer ${token}`)
      .send({
        typedPhrase: 'PURGE DEMO DATA',
        preservedSuperAdminId: superAdmin.id,
        backupReference: 'uat-backup-reference',
        reauthenticationToken: 'fresh-reauth-evidence',
        reason: 'Clean repeated demo generation fixtures',
      });
    expect([200, 201]).toContain(purgeRes.status);
    await expect(
      prisma.user.count({
        where: {
          isDemo: true,
          demoBatchId: { startsWith: demoBatchPrefix },
        },
      }),
    ).resolves.toBe(0);
  });

  it('rejects non-super-admin access', async () => {
    const orgAdmin = await createUser(UserRole.ORG_ADMIN);
    const token = await signToken(orgAdmin);

    const res = await request(app.getHttpServer())
      .post('/api/admin/platform-tools/demo-environment/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ scenario: 'Rainy Season' });

    expect(res.status).toBe(403);
  });
});
