import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Demo Environment Platform Tools (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

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
  });

  afterEach(async () => {
    await cleanupDemoData();

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
  });

  afterAll(async () => {
    await cleanupDemoData();
    await prisma.$disconnect();
    await app.close();
  });

  async function cleanupDemoData() {
    await prisma.notification.deleteMany({ where: { isDemo: true } });
    await prisma.report.deleteMany({ where: { isDemo: true } });
    await prisma.user.deleteMany({ where: { isDemo: true } });
    await prisma.organization.deleteMany({ where: { isDemo: true } });
    await prisma.demoAuditLog.deleteMany({
      where: {
        action: {
          contains: 'Demo',
        },
      },
    });
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
  }) {
    return jwtService.signAsync({
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
    });
  }

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
    expect(generateRes.body.demoBatchId).toMatch(/^demo-/);
    expect(generateRes.body.scenario).toBe('Rainy Season');
    expect(generateRes.body.intelligenceSummary.title).toBe(
      'Rainy Season Demo Generated',
    );
    expect(generateRes.body.intelligenceSummary.highlights).toContain(
      '5 reports created',
    );
    expect(generateRes.body.created).toMatchObject({
      organizations: 1,
      citizens: 3,
      providers: 2,
      reports: 5,
      notifications: 8,
    });

    const demoReport = await prisma.report.findFirstOrThrow({
      where: { demoBatchId: generateRes.body.demoBatchId },
    });
    expect(demoReport.isDemo).toBe(true);
    expect(demoReport.demoScenario).toBe('Rainy Season');
    expect(demoReport.demoGeneratedAt).toBeTruthy();
    expect(demoReport.evidenceImageUrl).toMatch(/^\/uploads\/demo\/.+\.svg$/);

    const statsRes = await request(app.getHttpServer())
      .get('/api/admin/platform-tools/demo-environment/statistics')
      .set('Authorization', `Bearer ${token}`);

    expect(statsRes.status).toBe(200);
    expect(statsRes.body.demoExists).toBe(true);
    expect(statsRes.body.currentDemoUsers).toBe(7);
    expect(statsRes.body.currentDemoReports).toBe(5);
    expect(statsRes.body.currentDemoOrganizations).toBe(1);
    expect(statsRes.body.scenario).toBe('Rainy Season');
    expect(statsRes.body.intelligenceSummary.title).toBe(
      'Rainy Season Demo Generated',
    );

    const purgeRes = await request(app.getHttpServer())
      .delete('/api/admin/platform-tools/demo-environment/purge')
      .set('Authorization', `Bearer ${token}`);

    expect(purgeRes.status).toBe(200);
    expect(purgeRes.body.deleted).toMatchObject({
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
