import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountStatus, ReportStatus, UserRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Executive Analytics (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const createdReportIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

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
    if (createdReportIds.length > 0) {
      await prisma.report.deleteMany({
        where: { id: { in: [...createdReportIds] } },
      });
      createdReportIds.length = 0;
    }
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

  async function createAnalyticsFixture() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const orgA = await prisma.organization.create({
      data: {
        name: `Executive Analytics Org A ${suffix}`,
        state: 'FCT',
        lga: 'Abuja Municipal',
        country: 'Nigeria',
      },
    });
    const orgB = await prisma.organization.create({
      data: {
        name: `Executive Analytics Org B ${suffix}`,
        state: 'Lagos',
        lga: 'Ikeja',
        country: 'Nigeria',
      },
    });
    createdOrgIds.push(orgA.id, orgB.id);

    const [superAdmin, orgAdmin, citizenA, providerA, citizenB, providerB] =
      await Promise.all([
        prisma.user.create({
          data: {
            email: `analytics-super-${suffix}@test.com`,
            fullName: 'Analytics Super Admin',
            role: UserRole.SUPER_ADMIN,
          },
        }),
        prisma.user.create({
          data: {
            email: `analytics-org-${suffix}@test.com`,
            fullName: 'Analytics Org Admin',
            role: UserRole.ORG_ADMIN,
            organizationId: orgA.id,
          },
        }),
        prisma.user.create({
          data: {
            email: `analytics-citizen-a-${suffix}@test.com`,
            fullName: 'Private Citizen A',
            role: UserRole.CITIZEN,
            organizationId: orgA.id,
          },
        }),
        prisma.user.create({
          data: {
            email: `analytics-provider-a-${suffix}@test.com`,
            fullName: 'Provider A',
            role: UserRole.PROVIDER,
            providerId: 'PRV-ANALYTICS-A',
            accountStatus: AccountStatus.ACTIVE,
            organizationId: orgA.id,
          },
        }),
        prisma.user.create({
          data: {
            email: `analytics-citizen-b-${suffix}@test.com`,
            fullName: 'Private Citizen B',
            role: UserRole.CITIZEN,
            organizationId: orgB.id,
          },
        }),
        prisma.user.create({
          data: {
            email: `analytics-provider-b-${suffix}@test.com`,
            fullName: 'Provider B',
            role: UserRole.PROVIDER,
            providerId: 'PRV-ANALYTICS-B',
            accountStatus: AccountStatus.ACTIVE,
            organizationId: orgB.id,
          },
        }),
      ]);
    createdUserIds.push(
      superAdmin.id,
      orgAdmin.id,
      citizenA.id,
      providerA.id,
      citizenB.id,
      providerB.id,
    );

    const reports = await Promise.all([
      prisma.report.create({
        data: {
          title: 'Private executive title must not leak',
          description: 'Private executive description must not leak',
          category: 'Road',
          location: 'Private exact street must not leak',
          latitude: 9.0765,
          longitude: 7.4938,
          status: ReportStatus.CLOSED,
          organizationId: orgA.id,
          citizenId: citizenA.id,
          assignedProviderId: providerA.id,
          assignedAt: new Date('2026-07-01T10:00:00.000Z'),
          completedByProviderAt: new Date('2026-07-02T10:00:00.000Z'),
          citizenRating: 5,
          createdAt: new Date('2026-07-01T08:00:00.000Z'),
          updatedAt: new Date('2026-07-02T12:00:00.000Z'),
        },
      }),
      prisma.report.create({
        data: {
          title: 'Private water title must not leak',
          description: 'Private water description must not leak',
          category: 'Water',
          location: 'Private water address',
          status: ReportStatus.ASSIGNED,
          organizationId: orgA.id,
          citizenId: citizenA.id,
          assignedProviderId: providerA.id,
          assignedAt: new Date('2026-07-03T10:00:00.000Z'),
          createdAt: new Date('2026-07-03T08:00:00.000Z'),
          updatedAt: new Date('2026-07-03T09:00:00.000Z'),
        },
      }),
      prisma.report.create({
        data: {
          title: 'Other tenant title must not leak',
          description: 'Other tenant description must not leak',
          category: 'Drainage',
          location: 'Other tenant address',
          status: ReportStatus.CLOSED,
          organizationId: orgB.id,
          citizenId: citizenB.id,
          assignedProviderId: providerB.id,
          assignedAt: new Date('2026-07-04T10:00:00.000Z'),
          completedByProviderAt: new Date('2026-07-04T18:00:00.000Z'),
          citizenRating: 4,
          createdAt: new Date('2026-07-04T08:00:00.000Z'),
          updatedAt: new Date('2026-07-04T20:00:00.000Z'),
        },
      }),
    ]);
    createdReportIds.push(...reports.map((report) => report.id));

    await prisma.reportActivity.create({
      data: {
        reportId: reports[1].id,
        organizationId: orgA.id,
        actorUserId: citizenA.id,
        actorRole: UserRole.CITIZEN,
        action: 'CITIZEN_MARKED_WORK_INCOMPLETE',
        createdAt: new Date('2026-07-05T00:00:00.000Z'),
      },
    });

    const superToken = await signToken(superAdmin);
    const orgToken = await signToken(orgAdmin);

    return { orgA, orgB, superToken, orgToken };
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

  it('returns tenant-scoped executive analytics without private report fields', async () => {
    const { orgA, superToken } = await createAnalyticsFixture();

    const [overview, trends, categories, statuses, providers, geography] =
      await Promise.all([
        request(app.getHttpServer())
          .get(`/api/analytics/executive/overview?organizationId=${orgA.id}`)
          .set('Authorization', `Bearer ${superToken}`),
        request(app.getHttpServer())
          .get(
            `/api/analytics/executive/trends?organizationId=${orgA.id}&interval=daily`,
          )
          .set('Authorization', `Bearer ${superToken}`),
        request(app.getHttpServer())
          .get(`/api/analytics/executive/categories?organizationId=${orgA.id}`)
          .set('Authorization', `Bearer ${superToken}`),
        request(app.getHttpServer())
          .get(`/api/analytics/executive/statuses?organizationId=${orgA.id}`)
          .set('Authorization', `Bearer ${superToken}`),
        request(app.getHttpServer())
          .get(
            `/api/analytics/executive/provider-performance?organizationId=${orgA.id}`,
          )
          .set('Authorization', `Bearer ${superToken}`),
        request(app.getHttpServer())
          .get(
            `/api/analytics/executive/geographic-summary?organizationId=${orgA.id}`,
          )
          .set('Authorization', `Bearer ${superToken}`),
      ]);

    for (const res of [
      overview,
      trends,
      categories,
      statuses,
      providers,
      geography,
    ]) {
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('Private executive title must not leak');
      expect(body).not.toContain('Private exact street must not leak');
      expect(body).not.toContain('Other tenant title must not leak');
      expect(body).not.toContain('9.0765');
      expect(body).not.toContain('7.4938');
    }

    expect(overview.body.totals.totalReports).toBe(2);
    expect(overview.body.quality.reworkEvents).toBe(1);
    expect(trends.body.points.length).toBeGreaterThan(0);
    expect(categories.body.categories).toEqual(
      expect.arrayContaining([expect.objectContaining({ category: 'Road' })]),
    );
    expect(statuses.body.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: ReportStatus.CLOSED }),
      ]),
    );
    expect(providers.body.providers[0]).toMatchObject({
      providerPublicId: 'PRV-ANALYTICS-A',
    });
    expect(geography.body.reportsByRegion).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ region: 'Abuja Municipal, FCT, Nigeria' }),
      ]),
    );
  });

  it('prevents organization admins from reading another tenant analytics scope', async () => {
    const { orgA, orgB, orgToken } = await createAnalyticsFixture();

    const allowed = await request(app.getHttpServer())
      .get('/api/analytics/executive/overview')
      .set('Authorization', `Bearer ${orgToken}`);
    const forbidden = await request(app.getHttpServer())
      .get(`/api/analytics/executive/overview?organizationId=${orgB.id}`)
      .set('Authorization', `Bearer ${orgToken}`);

    expect(allowed.status).toBe(200);
    expect(allowed.body.scope.organizationId).toBe(orgA.id);
    expect(allowed.body.totals.totalReports).toBe(2);
    expect(forbidden.status).toBe(403);
  });
});
