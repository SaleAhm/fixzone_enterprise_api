import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountStatus, ReportStatus, UserRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Public Metrics (e2e)', () => {
  jest.setTimeout(30000);

  let app: INestApplication;
  let prisma: PrismaService;
  const createdReportIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];
  const createdStoryIds: string[] = [];
  const visitorSettingKeys: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
  });

  afterEach(async () => {
    if (createdStoryIds.length > 0) {
      await prisma.publicSuccessStory.deleteMany({
        where: { id: { in: [...createdStoryIds] } },
      });
      createdStoryIds.length = 0;
    }
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
    if (visitorSettingKeys.length > 0) {
      await prisma.platformSetting.deleteMany({
        where: { key: { in: [...visitorSettingKeys] } },
      });
      visitorSettingKeys.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function seedPublicData() {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const citizenEmail = `private-citizen-public-${suffix}@test.com`;
    const providerEmail = `private-provider-public-${suffix}@test.com`;
    const orgName = `Public Metrics Org ${suffix}`;

    await prisma.user.deleteMany({
      where: {
        email: {
          in: [citizenEmail, providerEmail],
        },
      },
    });
    await prisma.organization.deleteMany({
      where: { name: orgName },
    });

    const org = await prisma.organization.create({
      data: {
        name: orgName,
        state: 'FCT',
        country: 'Nigeria',
      },
    });
    createdOrgIds.push(org.id);

    const citizen = await prisma.user.create({
      data: {
        fullName: 'Private Citizen',
        email: citizenEmail,
        phone: `+234${Date.now().toString().slice(-10)}`,
        role: UserRole.CITIZEN,
        organizationId: org.id,
      },
    });
    const provider = await prisma.user.create({
      data: {
        fullName: 'Verified Provider',
        email: providerEmail,
        role: UserRole.PROVIDER,
        accountStatus: AccountStatus.ACTIVE,
        organizationId: org.id,
      },
    });
    createdUserIds.push(citizen.id, provider.id);

    const reports = await Promise.all([
      prisma.report.create({
        data: {
          title: 'Private report title must not leak',
          description: 'Private report description must not leak',
          category: 'Road',
          location: 'Exact private address must not leak',
          latitude: 9.0765,
          longitude: 7.4938,
          status: ReportStatus.PENDING,
          organizationId: org.id,
          citizenId: citizen.id,
        },
      }),
      prisma.report.create({
        data: {
          title: 'Closed private report must not leak',
          description: 'Closed report description must not leak',
          category: 'Water',
          location: 'Another exact address must not leak',
          status: ReportStatus.CLOSED,
          organizationId: org.id,
          citizenId: citizen.id,
          assignedProviderId: provider.id,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-03T00:00:00.000Z'),
        },
      }),
    ]);
    createdReportIds.push(...reports.map((report) => report.id));

    const approved = await prisma.publicSuccessStory.create({
      data: {
        title: 'Road access restored',
        summary: 'A broad, approved summary without personal data.',
        category: 'Road',
        broadLocation: 'FCT, Nigeria',
        organizationName: orgName,
        outcome: 'Access improved for the community.',
        resolvedAt: new Date('2026-07-03T00:00:00.000Z'),
        approvedForPublic: true,
        approvedBy: 'admin-user-id',
        approvedAt: new Date('2026-07-04T00:00:00.000Z'),
        displayOrder: 1,
      },
    });
    const hidden = await prisma.publicSuccessStory.create({
      data: {
        title: 'Hidden unapproved story',
        summary: 'Should not be public.',
        category: 'Water',
        broadLocation: 'Private area',
        outcome: 'Hidden outcome',
        approvedForPublic: false,
      },
    });
    createdStoryIds.push(approved.id, hidden.id);
  }

  it('returns aggregate public metrics without authentication', async () => {
    await seedPublicData();

    const res = await request(app.getHttpServer()).get('/api/public/metrics');

    expect(res.status).toBe(200);
    expect(res.body.totalReports).toBeGreaterThanOrEqual(2);
    expect(res.body.activeReports).toBeGreaterThanOrEqual(1);
    expect(res.body.closedReports).toBeGreaterThanOrEqual(1);
    expect(res.body.resolutionRate).not.toBeNull();
    expect(res.body.averageResolutionTime).not.toBeNull();
    expect(res.body.participatingOrganizations).toBeGreaterThanOrEqual(1);
    expect(res.body.verifiedProviders).toBeGreaterThanOrEqual(1);
    expect(res.body.lastUpdatedAt).toBeDefined();
  });

  it('returns aggregate trends without private report fields or exact coordinates', async () => {
    await seedPublicData();

    const res = await request(app.getHttpServer()).get('/api/public/trends');
    const body = JSON.stringify(res.body);

    expect(res.status).toBe(200);
    expect(res.body.reportsOverTime.length).toBeGreaterThan(0);
    expect(
      res.body.categories.some((item: { category?: string }) =>
        item.category?.toLowerCase().includes('road'),
      ),
    ).toBe(true);
    expect(res.body.broadGeography).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ region: 'FCT, Nigeria' }),
      ]),
    );
    expect(body).not.toContain('Private report title must not leak');
    expect(body).not.toContain('Private Citizen');
    expect(body).not.toContain('private-citizen-public');
    expect(body).not.toContain('Exact private address must not leak');
    expect(body).not.toContain('9.0765');
    expect(body).not.toContain('7.4938');
  });

  it('returns public impact, category, and geographic summaries without private fields', async () => {
    await seedPublicData();

    const [impact, categories, geography] = await Promise.all([
      request(app.getHttpServer()).get('/api/public/impact-summary'),
      request(app.getHttpServer()).get('/api/public/category-summary'),
      request(app.getHttpServer()).get('/api/public/geographic-summary'),
    ]);

    expect(impact.status).toBe(200);
    expect(categories.status).toBe(200);
    expect(geography.status).toBe(200);
    expect(impact.body.headline.totalReports).toBeGreaterThanOrEqual(2);
    expect(
      categories.body.categories.some((item: { category?: string }) =>
        item.category?.toLowerCase().includes('road'),
      ),
    ).toBe(true);
    expect(geography.body.precision).toBe('state_country_only');

    const body = JSON.stringify({
      impact: impact.body,
      categories: categories.body,
      geography: geography.body,
    });
    expect(body).not.toContain('Private report title must not leak');
    expect(body).not.toContain('Private Citizen');
    expect(body).not.toContain('private-citizen-public');
    expect(body).not.toContain('Exact private address must not leak');
    expect(body).not.toContain('9.0765');
    expect(body).not.toContain('7.4938');
  });

  it('returns only manually approved success stories', async () => {
    await seedPublicData();

    const res = await request(app.getHttpServer()).get(
      '/api/public/success-stories',
    );
    const body = JSON.stringify(res.body);

    expect(res.status).toBe(200);
    expect(body).toContain('Road access restored');
    expect(body).not.toContain('Hidden unapproved story');
    expect(body).not.toContain('private-citizen-public');
    expect(res.body.publicationPolicy).toContain(
      'never published automatically',
    );
  });

  it('handles empty public data with explicit null availability metrics', async () => {
    const res = await request(app.getHttpServer()).get('/api/public/metrics');

    expect(res.status).toBe(200);
    expect(res.body.totalReports).toBeGreaterThanOrEqual(0);
    if (res.body.totalReports === 0) {
      expect(res.body.resolutionRate).toBeNull();
      expect(res.body.availability.resolutionRate).toBe(false);
    }
    if (res.body.closedReports === 0) {
      expect(res.body.averageResolutionTime).toBeNull();
      expect(res.body.availability.averageResolutionTime).toBe(false);
    }
  });

  it('records aggregate visitor page views without storing personal data', async () => {
    visitorSettingKeys.push('public.visitorAnalytics.v1');
    await prisma.platformSetting.deleteMany({
      where: { key: 'public.visitorAnalytics.v1' },
    });

    const first = await request(app.getHttpServer())
      .post('/api/public/visitor-event')
      .send({ sessionId: 'session-public-test-12345', path: '/#platform' });
    const second = await request(app.getHttpServer())
      .post('/api/public/visitor-event')
      .send({ sessionId: 'session-public-test-12345', path: '/#metrics' });
    const summary = await request(app.getHttpServer()).get(
      '/api/public/visitor-summary',
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(summary.status).toBe(200);
    expect(summary.body.totalPageViews).toBe(2);
    expect(summary.body.todayPageViews).toBe(2);
    expect(summary.body.todaySessions).toBe(1);
    expect(summary.body.privacy).toContain('Raw IP addresses');
    expect(JSON.stringify(summary.body)).not.toContain('userAgent');
    expect(JSON.stringify(summary.body)).not.toContain('referrer');
  });
});
