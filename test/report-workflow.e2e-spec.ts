import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AssignmentOutcome, ReportStatus, UserRole } from '@prisma/client';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Report Workflow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const onePixelPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

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

    await cleanupWorkflowArtifacts();
  });

  afterEach(async () => {
    await cleanupTrackedUploadArtifacts();

    if (createdReportIds.length > 0 || createdUserIds.length > 0) {
      await prisma.complianceAuditLog.deleteMany({
        where: {
          OR: [
            { actorId: { in: [...createdUserIds] } },
            { entityId: { in: [...createdReportIds, ...createdUserIds] } },
          ],
        },
      });
      await prisma.notification.deleteMany({
        where: {
          OR: [
            { reportId: { in: [...createdReportIds] } },
            { userId: { in: [...createdUserIds] } },
          ],
        },
      });
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
  });

  afterAll(async () => {
    await cleanupWorkflowArtifacts();
    await prisma.$disconnect();
    await app.close();
  });

  async function cleanupWorkflowArtifacts() {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: 'wf-' } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    const organizations = await prisma.organization.findMany({
      where: { name: { startsWith: 'Workflow ' } },
      select: { id: true },
    });
    const organizationIds = organizations.map(
      (organization) => organization.id,
    );
    const reports = await prisma.report.findMany({
      where: {
        OR: [
          { title: { startsWith: 'WF ' } },
          { citizenId: { in: userIds } },
          { assignedProviderId: { in: userIds } },
          { organizationId: { in: organizationIds } },
        ],
      },
      select: { id: true },
    });
    const reportIds = reports.map((report) => report.id);

    await cleanupUploadArtifacts(reportIds);

    await prisma.notification.deleteMany({
      where: {
        OR: [{ reportId: { in: reportIds } }, { userId: { in: userIds } }],
      },
    });
    await prisma.complianceAuditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: userIds } },
          { entityId: { in: [...reportIds, ...userIds, ...organizationIds] } },
          { organizationId: { in: organizationIds } },
        ],
      },
    });
    await prisma.report.deleteMany({
      where: { id: { in: reportIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: userIds } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });

    createdReportIds.length = 0;
    createdUserIds.length = 0;
    createdOrgIds.length = 0;
  }

  async function cleanupTrackedUploadArtifacts() {
    await cleanupUploadArtifacts([...createdReportIds]);
  }

  async function cleanupUploadArtifacts(reportIds: string[]) {
    for (const reportId of reportIds) {
      const uploadDirectory = join(
        process.cwd(),
        'uploads',
        'report-completion',
        reportId,
      );
      if (existsSync(uploadDirectory)) {
        rmSync(uploadDirectory, { recursive: true, force: true });
      }
    }
  }

  async function createOrganization(name: string) {
    const organization = await prisma.organization.create({
      data: { name },
    });

    createdOrgIds.push(organization.id);

    return organization;
  }

  async function createUser(data: {
    email: string;
    fullName: string;
    role: UserRole;
    organizationId?: string | null;
    providerId?: string | null;
  }) {
    const user = await prisma.user.create({
      data,
    });

    createdUserIds.push(user.id);

    return user;
  }

  async function createReport(data: {
    title: string;
    status?: ReportStatus;
    organizationId: string;
    citizenId: string;
    assignedProviderId?: string | null;
  }) {
    const report = await prisma.report.create({
      data: {
        title: data.title,
        description: 'Workflow test report',
        category: 'Road',
        location: 'Test Street',
        status: data.status ?? ReportStatus.PENDING,
        organizationId: data.organizationId,
        citizenId: data.citizenId,
        assignedProviderId: data.assignedProviderId ?? null,
      },
    });

    createdReportIds.push(report.id);

    return report;
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

  it('allows the strict happy path from PENDING to CLOSED', async () => {
    const org = await createOrganization('Workflow Org A');
    const admin = await createUser({
      email: 'wf-admin-happy@test.com',
      fullName: 'Workflow Admin',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const provider = await createUser({
      email: 'wf-provider-happy@test.com',
      fullName: 'Workflow Provider',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-happy@test.com',
      fullName: 'Workflow Citizen',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF happy path',
      organizationId: org.id,
      citizenId: citizen.id,
    });

    const adminToken = await signToken(admin);
    const providerToken = await signToken(provider);

    const assignRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ providerId: provider.id });

    expect(assignRes.status).toBe(200);
    expect(assignRes.body.status).toBe(ReportStatus.ASSIGNED);

    const inProgressRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: ReportStatus.IN_PROGRESS });

    expect(inProgressRes.status).toBe(200);
    expect(inProgressRes.body.status).toBe(ReportStatus.IN_PROGRESS);

    const completedRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: ReportStatus.COMPLETED_BY_PROVIDER });

    expect(completedRes.status).toBe(200);
    expect(completedRes.body.status).toBe(ReportStatus.COMPLETED_BY_PROVIDER);

    const closedRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: ReportStatus.CLOSED });

    expect(closedRes.status).toBe(200);
    expect(closedRes.body.status).toBe(ReportStatus.CLOSED);

    const timelineRes = await request(app.getHttpServer())
      .get(`/api/report/${report.id}/timeline`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(timelineRes.status).toBe(200);
    expect(
      timelineRes.body.map((item: { action: string }) => item.action),
    ).toEqual(
      expect.arrayContaining([
        'PROVIDER_ASSIGNED',
        'PROVIDER_STARTED_WORK',
        'PROVIDER_SUBMITTED_COMPLETION',
        'REPORT_CLOSED',
      ]),
    );
  });

  it('persists citizen location metadata and preserves backward compatibility', async () => {
    const org = await createOrganization('Workflow Geo Org');
    const citizen = await createUser({
      email: 'wf-citizen-geo@test.com',
      fullName: 'Workflow Citizen Geo',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const citizenToken = await signToken(citizen);

    const createdRes = await request(app.getHttpServer())
      .post('/api/report')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        title: 'WF geotagged report',
        description: 'Report with present-location metadata',
        category: 'Road',
        location: 'Pinned location (9.076500, 7.493800)',
        latitude: 9.0765,
        longitude: 7.4938,
        locationAccuracy: 18.4,
        locationCapturedAt: '2026-07-12T09:00:00.000Z',
        locationSource: 'DEVICE_GPS',
      });

    expect(createdRes.status).toBe(201);
    createdReportIds.push(createdRes.body.id);
    expect(createdRes.body).toMatchObject({
      latitude: 9.0765,
      longitude: 7.4938,
      locationAccuracy: 18.4,
      locationSource: 'DEVICE_GPS',
    });
    expect(createdRes.body.locationCapturedAt).toBe('2026-07-12T09:00:00.000Z');

    const legacyReport = await createReport({
      title: 'WF legacy location report',
      organizationId: org.id,
      citizenId: citizen.id,
    });

    const legacy = await prisma.report.findUniqueOrThrow({
      where: { id: legacyReport.id },
    });

    expect(legacy.latitude).toBeNull();
    expect(legacy.longitude).toBeNull();
    expect(legacy.locationAccuracy).toBeNull();
    expect(legacy.locationCapturedAt).toBeNull();
    expect(legacy.locationSource).toBeNull();
  });

  it('rejects invalid citizen coordinates before persistence', async () => {
    const org = await createOrganization('Workflow Invalid Geo Org');
    const citizen = await createUser({
      email: 'wf-citizen-invalid-geo@test.com',
      fullName: 'Workflow Invalid Geo Citizen',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const citizenToken = await signToken(citizen);

    const invalidRes = await request(app.getHttpServer())
      .post('/api/report')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        title: 'WF invalid geotagged report',
        description: 'Report with impossible latitude',
        category: 'Road',
        location: 'Invalid location',
        latitude: 123.45,
        longitude: 7.4938,
        locationSource: 'DEVICE_GPS',
      });

    expect(invalidRes.status).toBe(400);
    expect(
      await prisma.report.count({
        where: { title: 'WF invalid geotagged report' },
      }),
    ).toBe(0);
  });

  it('orchestrates provider completion, citizen review notification and rating', async () => {
    const org = await createOrganization('Workflow Orchestration Org');
    const admin = await createUser({
      email: 'wf-admin-orchestrator@test.com',
      fullName: 'Workflow Admin Orchestrator',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const provider = await createUser({
      email: 'wf-provider-orchestrator@test.com',
      fullName: 'Workflow Provider Orchestrator',
      role: UserRole.PROVIDER,
      organizationId: org.id,
      providerId: 'PRV-WF-001',
    });
    const citizen = await createUser({
      email: 'wf-citizen-orchestrator@test.com',
      fullName: 'Workflow Citizen Orchestrator',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF orchestrated completion',
      status: ReportStatus.IN_PROGRESS,
      organizationId: org.id,
      citizenId: citizen.id,
      assignedProviderId: provider.id,
    });

    const adminToken = await signToken(admin);
    const providerToken = await signToken(provider);
    const citizenToken = await signToken(citizen);

    const engineRes = await request(app.getHttpServer())
      .get('/api/business-logic/workflow-engine')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(engineRes.status).toBe(200);
    expect(engineRes.body).toMatchObject({
      activeProductionModule: 'maintenance',
      futureModulesOperational: false,
    });

    const completedRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        status: ReportStatus.COMPLETED_BY_PROVIDER,
        completionNote: 'Repairs completed and area cleaned.',
        completionLatitude: 9.081,
        completionLongitude: 7.492,
        completionAccuracy: 24,
        completionLocationCapturedAt: '2026-07-12T10:15:00.000Z',
        completionLocationSource: 'DEVICE_GPS',
      });

    expect(completedRes.status).toBe(200);
    expect(completedRes.body.status).toBe(ReportStatus.COMPLETED_BY_PROVIDER);
    expect(completedRes.body).toMatchObject({
      completionLatitude: 9.081,
      completionLongitude: 7.492,
      completionAccuracy: 24,
      completionLocationSource: 'DEVICE_GPS',
    });
    expect(completedRes.body.completionLocationCapturedAt).toBe(
      '2026-07-12T10:15:00.000Z',
    );

    const citizenNotifications = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${citizenToken}`);

    expect(citizenNotifications.status).toBe(200);
    expect(citizenNotifications.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reportId: report.id,
          type: 'completion_review',
          read: false,
        }),
      ]),
    );

    const confirmRes = await request(app.getHttpServer())
      .post(`/api/report/citizen/${report.id}/confirm-completion`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ rating: 5, feedback: 'Looks good.' });

    expect(confirmRes.status).toBe(201);
    expect(confirmRes.body).toMatchObject({
      status: ReportStatus.CLOSED,
      citizenRating: 5,
      citizenFeedback: 'Looks good.',
    });

    const providerNotifications = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${providerToken}`);

    expect(providerNotifications.status).toBe(200);
    expect(providerNotifications.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reportId: report.id,
          type: 'completion_confirmed',
        }),
      ]),
    );

    const audit = await prisma.complianceAuditLog.findMany({
      where: {
        entityId: report.id,
        action: { startsWith: 'Workflow' },
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((item) => item.action)).toEqual(
      expect.arrayContaining([
        'Workflow Provider Completed Report',
        'Workflow Citizen Confirmed Completion',
      ]),
    );
  });

  it('persists completion evidence with refresh-safe upload URL and path fields', async () => {
    const org = await createOrganization('Workflow Evidence Persistence Org');
    const provider = await createUser({
      email: 'wf-provider-evidence-persistence@test.com',
      fullName: 'Workflow Provider Evidence Persistence',
      role: UserRole.PROVIDER,
      organizationId: org.id,
      providerId: 'PRV-WF-004',
    });
    const citizen = await createUser({
      email: 'wf-citizen-evidence-persistence@test.com',
      fullName: 'Workflow Citizen Evidence Persistence',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF persisted completion evidence',
      status: ReportStatus.IN_PROGRESS,
      organizationId: org.id,
      citizenId: citizen.id,
      assignedProviderId: provider.id,
    });

    const providerToken = await signToken(provider);
    const citizenToken = await signToken(citizen);

    const uploadRes = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/completion-evidence`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        fileName: 'completion.png',
        contentType: 'image/png',
        imageBase64: onePixelPngBase64,
      });

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body).toMatchObject({
      completionImagePath: expect.stringMatching(
        new RegExp(`^report-completion/${report.id}/.+\\.png$`),
      ),
      completionImageUrl: expect.stringMatching(
        new RegExp(`^/uploads/report-completion/${report.id}/.+\\.png$`),
      ),
    });

    const completedRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        status: ReportStatus.COMPLETED_BY_PROVIDER,
        completionNote: 'Evidence should survive refresh.',
        completionImageUrl: `https://api.securezonegroup.com${uploadRes.body.completionImageUrl}`,
        completionImagePath: `https://api.securezonegroup.com/${uploadRes.body.completionImagePath}`,
      });

    expect(completedRes.status).toBe(200);
    expect(completedRes.body).toMatchObject({
      status: ReportStatus.COMPLETED_BY_PROVIDER,
      completionImagePath: uploadRes.body.completionImagePath,
      completionImageUrl: uploadRes.body.completionImageUrl,
    });

    const storedReport = await prisma.report.findUniqueOrThrow({
      where: { id: report.id },
    });

    expect(storedReport.completionImagePath).toBe(
      uploadRes.body.completionImagePath,
    );
    expect(storedReport.completionImageUrl).toBe(
      uploadRes.body.completionImageUrl,
    );

    const reviewRes = await request(app.getHttpServer())
      .get(`/api/report/citizen/${report.id}/completion-review`)
      .set('Authorization', `Bearer ${citizenToken}`);

    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body).toMatchObject({
      completionImagePath: uploadRes.body.completionImagePath,
      completionImageUrl: uploadRes.body.completionImageUrl,
      completion: {
        imagePath: uploadRes.body.completionImagePath,
        imageUrl: uploadRes.body.completionImageUrl,
      },
    });
  });

  it('enforces citizen completion review ownership and required rating', async () => {
    const org = await createOrganization('Workflow Completion Guard Org');
    const otherOrg = await createOrganization(
      'Workflow Completion Other Tenant Org',
    );
    const orgAdmin = await createUser({
      email: 'wf-admin-completion-guard@test.com',
      fullName: 'Workflow Admin Completion Guard',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const provider = await createUser({
      email: 'wf-provider-completion-guard@test.com',
      fullName: 'Workflow Provider Completion Guard',
      role: UserRole.PROVIDER,
      organizationId: org.id,
      providerId: 'PRV-WF-003',
    });
    const citizen = await createUser({
      email: 'wf-citizen-completion-owner@test.com',
      fullName: 'Workflow Citizen Completion Owner',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const otherCitizen = await createUser({
      email: 'wf-citizen-completion-other@test.com',
      fullName: 'Workflow Citizen Completion Other',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const otherTenantCitizen = await createUser({
      email: 'wf-citizen-completion-tenant@test.com',
      fullName: 'Workflow Citizen Completion Tenant',
      role: UserRole.CITIZEN,
      organizationId: otherOrg.id,
    });
    const report = await createReport({
      title: 'WF guarded completion review',
      status: ReportStatus.COMPLETED_BY_PROVIDER,
      organizationId: org.id,
      citizenId: citizen.id,
      assignedProviderId: provider.id,
    });
    const notReadyReport = await createReport({
      title: 'WF completion not ready',
      status: ReportStatus.ASSIGNED,
      organizationId: org.id,
      citizenId: citizen.id,
      assignedProviderId: provider.id,
    });

    const orgAdminToken = await signToken(orgAdmin);
    const citizenToken = await signToken(citizen);
    const otherCitizenToken = await signToken(otherCitizen);
    const otherTenantCitizenToken = await signToken(otherTenantCitizen);
    const providerToken = await signToken(provider);

    const reviewRes = await request(app.getHttpServer())
      .get(`/api/report/citizen/${report.id}/completion-review`)
      .set('Authorization', `Bearer ${citizenToken}`);

    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body).toMatchObject({
      id: report.id,
      status: ReportStatus.COMPLETED_BY_PROVIDER,
      availableActions: {
        confirm: true,
        markIncomplete: true,
      },
    });

    const missingRatingRes = await request(app.getHttpServer())
      .post(`/api/report/citizen/${report.id}/confirm-completion`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ feedback: 'Looks fine but no rating.' });

    expect(missingRatingRes.status).toBe(400);

    const lowRatingRes = await request(app.getHttpServer())
      .post(`/api/report/citizen/${report.id}/confirm-completion`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ rating: 0, feedback: 'Invalid low rating.' });

    expect(lowRatingRes.status).toBe(400);

    const highRatingRes = await request(app.getHttpServer())
      .post(`/api/report/citizen/${report.id}/confirm-completion`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ rating: 6, feedback: 'Invalid high rating.' });

    expect(highRatingRes.status).toBe(400);

    const notReadyRes = await request(app.getHttpServer())
      .post(`/api/report/citizen/${notReadyReport.id}/confirm-completion`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ rating: 5, feedback: 'Trying too early.' });

    expect(notReadyRes.status).toBe(403);

    const otherCitizenRes = await request(app.getHttpServer())
      .post(`/api/report/citizen/${report.id}/confirm-completion`)
      .set('Authorization', `Bearer ${otherCitizenToken}`)
      .send({ rating: 4, feedback: 'Not my report.' });

    expect(otherCitizenRes.status).toBe(403);

    const otherTenantRes = await request(app.getHttpServer())
      .post(`/api/report/citizen/${report.id}/confirm-completion`)
      .set('Authorization', `Bearer ${otherTenantCitizenToken}`)
      .send({ rating: 4, feedback: 'Different tenant cannot approve.' });

    expect(otherTenantRes.status).toBe(403);

    const providerRes = await request(app.getHttpServer())
      .post(`/api/report/citizen/${report.id}/confirm-completion`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ rating: 4, feedback: 'Provider cannot self-rate.' });

    expect(providerRes.status).toBe(403);

    const adminRes = await request(app.getHttpServer())
      .post(`/api/report/citizen/${report.id}/confirm-completion`)
      .set('Authorization', `Bearer ${orgAdminToken}`)
      .send({ rating: 4, feedback: 'Admin cannot approve as citizen.' });

    expect(adminRes.status).toBe(403);

    const confirmRes = await request(app.getHttpServer())
      .post(`/api/report/citizen/${report.id}/confirm-completion`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ rating: 5, feedback: 'Verified by citizen.' });

    expect(confirmRes.status).toBe(201);
    expect(confirmRes.body).toMatchObject({
      status: ReportStatus.CLOSED,
      citizenRating: 5,
      citizenFeedback: 'Verified by citizen.',
    });

    const duplicateRes = await request(app.getHttpServer())
      .post(`/api/report/citizen/${report.id}/confirm-completion`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ rating: 5, feedback: 'Duplicate approval.' });

    expect(duplicateRes.status).toBe(403);
  });

  it('orchestrates citizen rejection of provider-completed work', async () => {
    const org = await createOrganization('Workflow Rejection Org');
    const provider = await createUser({
      email: 'wf-provider-reject@test.com',
      fullName: 'Workflow Provider Reject',
      role: UserRole.PROVIDER,
      organizationId: org.id,
      providerId: 'PRV-WF-002',
    });
    const citizen = await createUser({
      email: 'wf-citizen-reject@test.com',
      fullName: 'Workflow Citizen Reject',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const admin = await createUser({
      email: 'wf-admin-reject@test.com',
      fullName: 'Workflow Admin Reject',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF rejected completion',
      status: ReportStatus.COMPLETED_BY_PROVIDER,
      organizationId: org.id,
      citizenId: citizen.id,
      assignedProviderId: provider.id,
    });

    const citizenToken = await signToken(citizen);
    const providerToken = await signToken(provider);
    const adminToken = await signToken(admin);

    const emptyReasonRes = await request(app.getHttpServer())
      .post(`/api/report/citizen/${report.id}/reject-completion`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ reason: '' });

    expect(emptyReasonRes.status).toBe(400);

    const rejectRes = await request(app.getHttpServer())
      .post(`/api/report/citizen/${report.id}/reject-completion`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ reason: 'Drainage is still blocked near the entrance.' });

    expect(rejectRes.status).toBe(201);
    expect(rejectRes.body).toMatchObject({
      status: ReportStatus.ASSIGNED,
      completionRejectionReason: 'Drainage is still blocked near the entrance.',
    });

    const providerNotifications = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${providerToken}`);

    expect(providerNotifications.status).toBe(200);
    expect(providerNotifications.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reportId: report.id,
          type: 'completion_rejected',
        }),
      ]),
    );

    const adminNotifications = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(adminNotifications.status).toBe(200);
    expect(adminNotifications.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reportId: report.id,
          type: 'completion_review_requested',
        }),
      ]),
    );
  });

  it('rejects direct ASSIGNED to COMPLETED_BY_PROVIDER transitions', async () => {
    const org = await createOrganization('Workflow Org B');
    const provider = await createUser({
      email: 'wf-provider-direct@test.com',
      fullName: 'Workflow Provider Direct',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-direct@test.com',
      fullName: 'Workflow Citizen Direct',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF direct completion',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.ASSIGNED,
      assignedProviderId: provider.id,
    });

    const providerToken = await signToken(provider);
    const res = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: ReportStatus.COMPLETED_BY_PROVIDER });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Invalid status transition');

    const storedReport = await prisma.report.findUnique({
      where: { id: report.id },
    });

    expect(storedReport?.status).toBe(ReportStatus.ASSIGNED);
  });

  it('rejects provider updates for reports not assigned to them', async () => {
    const org = await createOrganization('Workflow Org C');
    const assignedProvider = await createUser({
      email: 'wf-provider-owner@test.com',
      fullName: 'Assigned Provider',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const otherProvider = await createUser({
      email: 'wf-provider-other@test.com',
      fullName: 'Other Provider',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-owner@test.com',
      fullName: 'Workflow Citizen Owner',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF provider ownership',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.ASSIGNED,
      assignedProviderId: assignedProvider.id,
    });

    const otherProviderToken = await signToken(otherProvider);
    const res = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${otherProviderToken}`)
      .send({ status: ReportStatus.IN_PROGRESS });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Not your report');
  });

  it('rejects citizen status updates', async () => {
    const org = await createOrganization('Workflow Org H');
    const citizen = await createUser({
      email: 'wf-citizen-status@test.com',
      fullName: 'Workflow Citizen Status',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const provider = await createUser({
      email: 'wf-provider-status@test.com',
      fullName: 'Workflow Provider Status',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF citizen cannot update status',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.ASSIGNED,
      assignedProviderId: provider.id,
    });

    const citizenToken = await signToken(citizen);
    const res = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ status: ReportStatus.IN_PROGRESS });

    expect(res.status).toBe(403);
  });

  it('allows citizens to load their dashboard summary', async () => {
    const org = await createOrganization('Workflow Citizen Dashboard Org');
    const citizen = await createUser({
      email: 'wf-citizen-dashboard@test.com',
      fullName: 'Workflow Citizen Dashboard',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    await createReport({
      title: 'WF citizen dashboard pending',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.PENDING,
    });
    await createReport({
      title: 'WF citizen dashboard assigned',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.ASSIGNED,
    });

    const citizenToken = await signToken(citizen);
    const res = await request(app.getHttpServer())
      .get('/api/report/citizen/dashboard/summary')
      .set('Authorization', `Bearer ${citizenToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total: 2,
      pending: 1,
      assigned: 1,
      inProgress: 0,
      completed: 0,
      closed: 0,
    });
  });

  it('allows citizens to load their reports from the current citizen endpoint', async () => {
    const org = await createOrganization('Workflow Citizen Reports Org');
    const citizen = await createUser({
      email: 'wf-citizen-current-reports@test.com',
      fullName: 'Workflow Citizen Reports',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    await createReport({
      title: 'WF current citizen report',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.PENDING,
    });

    const citizenToken = await signToken(citizen);
    const res = await request(app.getHttpServer())
      .get('/api/report/citizen/my')
      .set('Authorization', `Bearer ${citizenToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('WF current citizen report');
  });

  it('uses the Prisma user id for Firebase citizen report creation and retrieval', async () => {
    const firebaseUid = `wf-firebase-citizen-${Date.now()}`;
    const phone = `+23480${Date.now().toString().slice(-8)}`;

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/firebase-login')
      .send({
        firebaseUid,
        phone,
        fullName: 'Workflow Firebase Citizen',
        role: 'citizen',
      });

    expect(loginRes.status).toBe(201);
    expect(loginRes.body.accessToken).toBeDefined();
    expect(loginRes.body.user.id).toBeDefined();
    expect(loginRes.body.user.id).not.toBe(firebaseUid);

    const citizen = await prisma.user.findUniqueOrThrow({
      where: { id: loginRes.body.user.id },
    });
    createdUserIds.push(citizen.id);

    const createRes = await request(app.getHttpServer())
      .post('/api/report')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .send({
        title: 'WF Firebase citizen report',
        description: 'Created through backend citizen report endpoint',
        category: 'Road',
        location: 'Firebase Citizen Street',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.citizenId).toBe(citizen.id);
    expect(createRes.body.citizenId).not.toBe(firebaseUid);
    createdReportIds.push(createRes.body.id);

    const reportsRes = await request(app.getHttpServer())
      .get('/api/report/citizen/my')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`);

    expect(reportsRes.status).toBe(200);
    expect(reportsRes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createRes.body.id,
          citizenId: citizen.id,
          title: 'WF Firebase citizen report',
        }),
      ]),
    );
  });

  it('rejects provider assignment attempts', async () => {
    const org = await createOrganization('Workflow Org I');
    const provider = await createUser({
      email: 'wf-provider-assign@test.com',
      fullName: 'Workflow Provider Assign',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-assign@test.com',
      fullName: 'Workflow Citizen Assign',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF provider cannot assign',
      organizationId: org.id,
      citizenId: citizen.id,
    });

    const providerToken = await signToken(provider);
    const res = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ providerId: provider.id });

    expect(res.status).toBe(403);
  });

  it('rejects assigning a report that is already assigned', async () => {
    const org = await createOrganization('Workflow Org D');
    const admin = await createUser({
      email: 'wf-admin-reassign@test.com',
      fullName: 'Workflow Admin Reassign',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const providerA = await createUser({
      email: 'wf-provider-reassign-a@test.com',
      fullName: 'Workflow Provider A',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const providerB = await createUser({
      email: 'wf-provider-reassign-b@test.com',
      fullName: 'Workflow Provider B',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-reassign@test.com',
      fullName: 'Workflow Citizen Reassign',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF already assigned',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.ASSIGNED,
      assignedProviderId: providerA.id,
    });

    const adminToken = await signToken(admin);
    const res = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ providerId: providerB.id });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(
      'Report cannot be assigned in its current status',
    );
  });

  it('rejects assigning non-provider users', async () => {
    const org = await createOrganization('Workflow Org J');
    const admin = await createUser({
      email: 'wf-admin-non-provider@test.com',
      fullName: 'Workflow Admin Non Provider',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-non-provider@test.com',
      fullName: 'Workflow Citizen Non Provider',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const reportCitizen = await createUser({
      email: 'wf-citizen-non-provider-owner@test.com',
      fullName: 'Workflow Citizen Report Owner',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF non-provider assignment',
      organizationId: org.id,
      citizenId: reportCitizen.id,
    });

    const adminToken = await signToken(admin);
    const res = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ providerId: citizen.id });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Invalid provider');
  });

  it('allows admins to assign only within their own organization', async () => {
    const orgA = await createOrganization('Workflow Org E1');
    const orgB = await createOrganization('Workflow Org E2');
    const admin = await createUser({
      email: 'wf-admin-cross-org@test.com',
      fullName: 'Workflow Admin Cross Org',
      role: UserRole.ORG_ADMIN,
      organizationId: orgA.id,
    });
    const provider = await createUser({
      email: 'wf-provider-cross-org@test.com',
      fullName: 'Workflow Provider Cross Org',
      role: UserRole.PROVIDER,
      organizationId: orgB.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-cross-org@test.com',
      fullName: 'Workflow Citizen Cross Org',
      role: UserRole.CITIZEN,
      organizationId: orgA.id,
    });
    const report = await createReport({
      title: 'WF cross org assignment',
      organizationId: orgA.id,
      citizenId: citizen.id,
    });

    const adminToken = await signToken(admin);
    const res = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ providerId: provider.id });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Provider must be same org');
  });

  it('allows super admins to assign across organizations while obeying the workflow', async () => {
    const orgA = await createOrganization('Workflow Org F1');
    const orgB = await createOrganization('Workflow Org F2');
    const superAdmin = await createUser({
      email: 'wf-super-cross-org@test.com',
      fullName: 'Workflow Super Admin',
      role: UserRole.SUPER_ADMIN,
      organizationId: null,
    });
    const provider = await createUser({
      email: 'wf-provider-super-cross@test.com',
      fullName: 'Workflow Provider Super Cross',
      role: UserRole.PROVIDER,
      organizationId: orgB.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-super-cross@test.com',
      fullName: 'Workflow Citizen Super Cross',
      role: UserRole.CITIZEN,
      organizationId: orgA.id,
    });
    const report = await createReport({
      title: 'WF super cross org assignment',
      organizationId: orgA.id,
      citizenId: citizen.id,
    });

    const superAdminToken = await signToken(superAdmin);
    const assignRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ providerId: provider.id });

    expect(assignRes.status).toBe(200);
    expect(assignRes.body.status).toBe(ReportStatus.ASSIGNED);

    const closeRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ status: ReportStatus.CLOSED });

    expect(closeRes.status).toBe(403);
    expect(closeRes.body.message).toContain('Invalid status transition');
  });

  it('rejects any change to closed reports', async () => {
    const org = await createOrganization('Workflow Org K');
    const admin = await createUser({
      email: 'wf-admin-closed@test.com',
      fullName: 'Workflow Admin Closed',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const provider = await createUser({
      email: 'wf-provider-closed@test.com',
      fullName: 'Workflow Provider Closed',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-closed@test.com',
      fullName: 'Workflow Citizen Closed',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF closed report',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.CLOSED,
      assignedProviderId: provider.id,
    });

    const adminToken = await signToken(admin);
    const providerToken = await signToken(provider);

    const adminRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: ReportStatus.CLOSED });

    expect(adminRes.status).toBe(403);

    const providerRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: ReportStatus.IN_PROGRESS });

    expect(providerRes.status).toBe(403);
  });

  it('reuses assignment validation for auto-assign', async () => {
    const org = await createOrganization('Workflow Org G');
    const dispatchOfficer = await createUser({
      email: 'wf-dispatch-auto@test.com',
      fullName: 'Workflow Dispatch Auto',
      role: UserRole.DISPATCH_OFFICER,
      organizationId: org.id,
    });
    const provider = await createUser({
      email: 'wf-provider-auto@test.com',
      fullName: 'Workflow Provider Auto',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-auto@test.com',
      fullName: 'Workflow Citizen Auto',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF auto assign',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.ASSIGNED,
      assignedProviderId: provider.id,
    });

    const dispatchToken = await signToken(dispatchOfficer);
    const res = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/auto-assign`)
      .set('Authorization', `Bearer ${dispatchToken}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(
      'Report cannot be assigned in its current status',
    );
  });

  it('allows assigned providers to reject jobs back to the dispatch queue', async () => {
    const org = await createOrganization('Workflow Org H');
    const dispatchOfficer = await createUser({
      email: 'wf-dispatch-reject@test.com',
      fullName: 'Workflow Dispatch Reject',
      role: UserRole.DISPATCH_OFFICER,
      organizationId: org.id,
    });
    const providerA = await createUser({
      email: 'wf-provider-reject-a@test.com',
      fullName: 'Workflow Provider Reject A',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const providerB = await createUser({
      email: 'wf-provider-reject-b@test.com',
      fullName: 'Workflow Provider Reject B',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-reject@test.com',
      fullName: 'Workflow Citizen Reject',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF provider reject',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.ASSIGNED,
      assignedProviderId: providerA.id,
    });

    const providerToken = await signToken(providerA);
    const rejectRes = await request(app.getHttpServer())
      .post(`/api/report/provider/${report.id}/reject`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ reason: 'Crew unavailable today' });

    expect(rejectRes.status).toBe(201);
    expect(rejectRes.body.status).toBe(ReportStatus.PENDING);
    expect(rejectRes.body.assignedProviderId).toBeNull();
    expect(rejectRes.body.lastAssignmentOutcome).toBe(
      AssignmentOutcome.REJECTED,
    );
    expect(rejectRes.body.lastAssignmentReason).toBe('Crew unavailable today');

    const dispatchToken = await signToken(dispatchOfficer);
    const reassignRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${dispatchToken}`)
      .send({ providerId: providerB.id });

    expect(reassignRes.status).toBe(200);
    expect(reassignRes.body.status).toBe(ReportStatus.ASSIGNED);
    expect(reassignRes.body.assignedProviderId).toBe(providerB.id);
  });

  it('expires overdue provider offers when acceptance is attempted after the deadline', async () => {
    const org = await createOrganization('Workflow Expired Offer Org');
    const provider = await createUser({
      email: 'wf-provider-expired-offer@test.com',
      fullName: 'Workflow Provider Expired Offer',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-expired-offer@test.com',
      fullName: 'Workflow Citizen Expired Offer',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF expired assignment offer',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.ASSIGNED,
      assignedProviderId: provider.id,
    });
    await prisma.report.update({
      where: { id: report.id },
      data: {
        assignedAt: new Date(Date.now() - 90 * 60 * 1000),
        assignmentDeadlineAt: new Date(Date.now() - 60 * 1000),
      },
    });

    const providerToken = await signToken(provider);
    const acceptRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: ReportStatus.IN_PROGRESS });

    expect(acceptRes.status).toBe(409);
    expect(acceptRes.body.message).toBe('Assignment acceptance window expired');

    const stored = await prisma.report.findUniqueOrThrow({
      where: { id: report.id },
    });
    expect(stored.status).toBe(ReportStatus.PENDING);
    expect(stored.assignedProviderId).toBeNull();
    expect(stored.assignmentDeadlineAt).toBeNull();
    expect(stored.lastAssignmentOutcome).toBe(AssignmentOutcome.TIMED_OUT);
    expect(stored.lastAssignmentProviderId).toBe(provider.id);

    await expect(
      prisma.notification.count({
        where: {
          reportId: report.id,
          type: 'assignment_timeout',
        },
      }),
    ).resolves.toBeGreaterThanOrEqual(2);
  });

  it('prevents superseded providers from accepting after reassignment', async () => {
    const org = await createOrganization('Workflow Superseded Offer Org');
    const dispatchOfficer = await createUser({
      email: 'wf-dispatch-superseded@test.com',
      fullName: 'Workflow Dispatch Superseded',
      role: UserRole.DISPATCH_OFFICER,
      organizationId: org.id,
    });
    const providerA = await createUser({
      email: 'wf-provider-superseded-a@test.com',
      fullName: 'Workflow Provider Superseded A',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const providerB = await createUser({
      email: 'wf-provider-superseded-b@test.com',
      fullName: 'Workflow Provider Superseded B',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-superseded@test.com',
      fullName: 'Workflow Citizen Superseded',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF superseded assignment offer',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.ASSIGNED,
      assignedProviderId: providerA.id,
    });

    const dispatchToken = await signToken(dispatchOfficer);
    const reassignRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/reassign`)
      .set('Authorization', `Bearer ${dispatchToken}`)
      .send({
        providerId: providerB.id,
        reason: 'Provider did not respond before dispatch review',
      });
    expect(reassignRes.status).toBe(200);
    expect(reassignRes.body.assignedProviderId).toBe(providerB.id);

    const oldProviderToken = await signToken(providerA);
    const oldAcceptRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${oldProviderToken}`)
      .send({ status: ReportStatus.IN_PROGRESS });
    expect(oldAcceptRes.status).toBe(403);
    expect(oldAcceptRes.body.message).toBe('Not your report');

    const newProviderToken = await signToken(providerB);
    const newAcceptRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${newProviderToken}`)
      .send({ status: ReportStatus.IN_PROGRESS });
    expect(newAcceptRes.status).toBe(200);
    expect(newAcceptRes.body.status).toBe(ReportStatus.IN_PROGRESS);
    expect(newAcceptRes.body.assignedProviderId).toBe(providerB.id);
  });
});
