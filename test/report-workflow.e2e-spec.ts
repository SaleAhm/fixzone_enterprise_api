import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AssignmentOutcome, ReportStatus, UserRole } from '@prisma/client';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Report Workflow (e2e)', () => {
  jest.setTimeout(30000);

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
      for (const folder of ['report-completion', 'report-evidence']) {
        const uploadDirectory = join(
          process.cwd(),
          'uploads',
          folder,
          reportId,
        );
        if (existsSync(uploadDirectory)) {
          rmSync(uploadDirectory, { recursive: true, force: true });
        }
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
    serviceCategories?: string[];
    coverageAreas?: string[];
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
    assignedOrganizationId?: string | null;
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
        assignedOrganizationId: data.assignedOrganizationId ?? null,
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

  function writeEvidenceFile(params: {
    reportId: string;
    folder: 'report-evidence' | 'report-completion';
    fileName: string;
  }) {
    const directory = join(
      process.cwd(),
      'uploads',
      params.folder,
      params.reportId,
    );
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, params.fileName),
      Buffer.from(onePixelPngBase64, 'base64'),
    );
    return `${params.folder}/${params.reportId}/${params.fileName}`;
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

  it('scopes report discussion messages to authorized report participants', async () => {
    const org = await createOrganization('Workflow Discussion Org');
    const otherOrg = await createOrganization('Workflow Discussion Other Org');
    const admin = await createUser({
      email: 'wf-admin-discussion@test.com',
      fullName: 'Workflow Discussion Admin',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const provider = await createUser({
      email: 'wf-provider-discussion@test.com',
      fullName: 'Workflow Discussion Provider',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-discussion@test.com',
      fullName: 'Workflow Discussion Citizen',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const otherAdmin = await createUser({
      email: 'wf-admin-discussion-other@test.com',
      fullName: 'Workflow Discussion Other Admin',
      role: UserRole.ORG_ADMIN,
      organizationId: otherOrg.id,
    });
    const report = await createReport({
      title: 'WF discussion report',
      organizationId: org.id,
      citizenId: citizen.id,
      assignedProviderId: provider.id,
    });

    const adminToken = await signToken(admin);
    const providerToken = await signToken(provider);
    const citizenToken = await signToken(citizen);
    const otherAdminToken = await signToken(otherAdmin);

    const createdMessage = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/messages`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ message: 'Provider has reached the site.' });

    expect(createdMessage.status).toBe(201);
    expect(createdMessage.body.message).toBe('Provider has reached the site.');
    expect(createdMessage.body.organizationId).toBe(org.id);

    const citizenMessages = await request(app.getHttpServer())
      .get(`/api/report/${report.id}/messages`)
      .set('Authorization', `Bearer ${citizenToken}`);

    expect(citizenMessages.status).toBe(200);
    expect(citizenMessages.body).toHaveLength(1);
    expect(citizenMessages.body[0].authorRole).toBe(UserRole.PROVIDER);

    const adminMessages = await request(app.getHttpServer())
      .get(`/api/report/${report.id}/messages`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(adminMessages.status).toBe(200);
    expect(adminMessages.body).toHaveLength(1);

    const forbiddenMessages = await request(app.getHttpServer())
      .get(`/api/report/${report.id}/messages`)
      .set('Authorization', `Bearer ${otherAdminToken}`);

    expect(forbiddenMessages.status).toBe(403);
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
        new RegExp(`^/api/report/${report.id}/completion-evidence/.+\\.png$`),
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
      completionImageUrl: expect.stringMatching(
        new RegExp(`^/api/report/${report.id}/completion-evidence/.+\\.png$`),
      ),
    });

    const storedReport = await prisma.report.findUniqueOrThrow({
      where: { id: report.id },
    });

    expect(storedReport.completionImagePath).toBe(
      uploadRes.body.completionImagePath,
    );
    expect(storedReport.completionImageUrl).toBe(
      `/uploads/${uploadRes.body.completionImagePath}`,
    );

    const reviewRes = await request(app.getHttpServer())
      .get(`/api/report/citizen/${report.id}/completion-review`)
      .set('Authorization', `Bearer ${citizenToken}`);

    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body).toMatchObject({
      completionImagePath: uploadRes.body.completionImagePath,
      completionImageUrl: expect.stringMatching(
        new RegExp(`^/api/report/${report.id}/completion-evidence/.+\\.png$`),
      ),
      completion: {
        imagePath: uploadRes.body.completionImagePath,
        imageUrl: expect.stringMatching(
          new RegExp(`^/api/report/${report.id}/completion-evidence/.+\\.png$`),
        ),
      },
    });
  });

  it('protects report evidence retrieval by role, tenant, pairing, path, and auth', async () => {
    const org = await createOrganization('Workflow Protected Evidence Org');
    const otherOrg = await createOrganization('Workflow Other Evidence Org');
    const admin = await createUser({
      email: 'wf-admin-evidence@test.com',
      fullName: 'Workflow Evidence Admin',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const otherAdmin = await createUser({
      email: 'wf-other-admin-evidence@test.com',
      fullName: 'Workflow Other Evidence Admin',
      role: UserRole.ORG_ADMIN,
      organizationId: otherOrg.id,
    });
    const provider = await createUser({
      email: 'wf-provider-evidence@test.com',
      fullName: 'Workflow Evidence Provider',
      role: UserRole.PROVIDER,
      organizationId: org.id,
      providerId: 'PRV-WF-EVID-1',
    });
    const otherProvider = await createUser({
      email: 'wf-other-provider-evidence@test.com',
      fullName: 'Workflow Other Evidence Provider',
      role: UserRole.PROVIDER,
      organizationId: org.id,
      providerId: 'PRV-WF-EVID-2',
    });
    const citizen = await createUser({
      email: 'wf-citizen-evidence@test.com',
      fullName: 'Workflow Evidence Citizen',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const otherCitizen = await createUser({
      email: 'wf-other-citizen-evidence@test.com',
      fullName: 'Workflow Other Evidence Citizen',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const superAdmin = await createUser({
      email: 'wf-super-evidence@test.com',
      fullName: 'Workflow Evidence Super',
      role: UserRole.SUPER_ADMIN,
      organizationId: null,
    });
    const report = await createReport({
      title: 'WF protected evidence',
      status: ReportStatus.IN_PROGRESS,
      organizationId: org.id,
      citizenId: citizen.id,
      assignedProviderId: provider.id,
    });
    const otherReport = await createReport({
      title: 'WF protected evidence pairing',
      status: ReportStatus.PENDING,
      organizationId: org.id,
      citizenId: citizen.id,
    });
    const evidencePath = writeEvidenceFile({
      reportId: report.id,
      folder: 'report-evidence',
      fileName: 'citizen-evidence.png',
    });
    const completionPath = writeEvidenceFile({
      reportId: report.id,
      folder: 'report-completion',
      fileName: 'completion-evidence.png',
    });
    await prisma.report.update({
      where: { id: report.id },
      data: {
        evidenceImagePath: evidencePath,
        evidenceImageUrl: `/uploads/${evidencePath}`,
        completionImagePath: completionPath,
        completionImageUrl: `/uploads/${completionPath}`,
      },
    });

    const citizenToken = await signToken(citizen);
    const otherCitizenToken = await signToken(otherCitizen);
    const providerToken = await signToken(provider);
    const otherProviderToken = await signToken(otherProvider);
    const adminToken = await signToken(admin);
    const otherAdminToken = await signToken(otherAdmin);
    const superAdminToken = await signToken(superAdmin);
    const evidenceUrl = `/api/report/${report.id}/evidence/citizen-evidence.png`;
    const completionUrl = `/api/report/${report.id}/completion-evidence/completion-evidence.png`;

    const ownerRes = await request(app.getHttpServer())
      .get(evidenceUrl)
      .set('Authorization', `Bearer ${citizenToken}`);
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.headers['content-type']).toContain('image/png');
    expect(ownerRes.headers['content-disposition']).toContain('inline');
    expect(ownerRes.headers['x-content-type-options']).toBe('nosniff');
    expect(ownerRes.headers['cache-control']).toContain('no-store');

    expect(
      await request(app.getHttpServer())
        .get(evidenceUrl)
        .set('Authorization', `Bearer ${otherCitizenToken}`),
    ).toHaveProperty('status', 403);
    expect(
      await request(app.getHttpServer())
        .get(evidenceUrl)
        .set('Authorization', `Bearer ${providerToken}`),
    ).toHaveProperty('status', 200);
    expect(
      await request(app.getHttpServer())
        .get(evidenceUrl)
        .set('Authorization', `Bearer ${otherProviderToken}`),
    ).toHaveProperty('status', 403);
    expect(
      await request(app.getHttpServer())
        .get(evidenceUrl)
        .set('Authorization', `Bearer ${adminToken}`),
    ).toHaveProperty('status', 200);
    expect(
      await request(app.getHttpServer())
        .get(evidenceUrl)
        .set('Authorization', `Bearer ${otherAdminToken}`),
    ).toHaveProperty('status', 403);
    expect(
      await request(app.getHttpServer())
        .get(evidenceUrl)
        .set('Authorization', `Bearer ${superAdminToken}`),
    ).toHaveProperty('status', 200);
    expect(await request(app.getHttpServer()).get(evidenceUrl)).toHaveProperty(
      'status',
      401,
    );
    expect(
      await request(app.getHttpServer())
        .get(`/api/report/${otherReport.id}/evidence/citizen-evidence.png`)
        .set('Authorization', `Bearer ${citizenToken}`),
    ).toHaveProperty('status', 404);
    expect(
      await request(app.getHttpServer())
        .get(`/api/report/${report.id}/evidence/..%2Fsecret.png`)
        .set('Authorization', `Bearer ${citizenToken}`),
    ).toHaveProperty('status', 404);
    expect(
      await request(app.getHttpServer())
        .get(`/api/report/${report.id}/evidence/missing.png`)
        .set('Authorization', `Bearer ${citizenToken}`),
    ).toHaveProperty('status', 404);
    expect(
      await request(app.getHttpServer()).get(
        '/uploads/report-evidence/guessed.png',
      ),
    ).toHaveProperty('status', 404);
    expect(
      await request(app.getHttpServer())
        .get(completionUrl)
        .set('Authorization', `Bearer ${citizenToken}`),
    ).toHaveProperty('status', 200);
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
    const silentBypassRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ providerId: provider.id });

    expect(silentBypassRes.status).toBe(403);
    expect(silentBypassRes.body.code).toBe(
      'ORGANIZATION_ROUTING_OVERRIDE_REQUIRED',
    );

    const assignRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        providerId: provider.id,
        overrideOrganizationRouting: true,
        overrideReason: 'Emergency specialist override',
      });

    expect(assignRes.status).toBe(200);
    expect(assignRes.body.status).toBe(ReportStatus.ASSIGNED);

    const providerToken = await signToken(provider);
    const assignedJobs = await request(app.getHttpServer())
      .get('/api/report/assigned')
      .set('Authorization', `Bearer ${providerToken}`);

    expect(assignedJobs.status).toBe(200);
    expect(assignedJobs.body.map((item: { id: string }) => item.id)).toContain(
      report.id,
    );

    const providerDetail = await request(app.getHttpServer())
      .get(`/api/report/${report.id}`)
      .set('Authorization', `Bearer ${providerToken}`);

    expect(providerDetail.status).toBe(200);
    expect(providerDetail.body.id).toBe(report.id);

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

  it('allows a directly assigned provider to act despite membership drift', async () => {
    const org = await createOrganization('Workflow Membership Drift Org');
    const driftedProvider = await createUser({
      email: 'wf-provider-membership-drift@test.com',
      fullName: 'Workflow Provider Membership Drift',
      role: UserRole.PROVIDER,
      organizationId: null,
    });
    const otherProvider = await createUser({
      email: 'wf-provider-membership-drift-other@test.com',
      fullName: 'Workflow Other Provider Membership Drift',
      role: UserRole.PROVIDER,
      organizationId: null,
    });
    const citizen = await createUser({
      email: 'wf-citizen-membership-drift@test.com',
      fullName: 'Workflow Citizen Membership Drift',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const acceptReport = await createReport({
      title: 'WF membership drift accept',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.ASSIGNED,
      assignedProviderId: driftedProvider.id,
    });
    const rejectReport = await createReport({
      title: 'WF membership drift reject',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.ASSIGNED,
      assignedProviderId: driftedProvider.id,
    });

    const otherProviderToken = await signToken(otherProvider);
    const otherAcceptRes = await request(app.getHttpServer())
      .patch(`/api/report/${acceptReport.id}/status`)
      .set('Authorization', `Bearer ${otherProviderToken}`)
      .send({ status: ReportStatus.IN_PROGRESS });
    expect(otherAcceptRes.status).toBe(403);

    const driftedProviderToken = await signToken(driftedProvider);
    const acceptRes = await request(app.getHttpServer())
      .patch(`/api/report/${acceptReport.id}/status`)
      .set('Authorization', `Bearer ${driftedProviderToken}`)
      .send({ status: ReportStatus.IN_PROGRESS });
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.status).toBe(ReportStatus.IN_PROGRESS);
    expect(acceptRes.body.assignedProviderId).toBe(driftedProvider.id);

    const rejectRes = await request(app.getHttpServer())
      .post(`/api/report/provider/${rejectReport.id}/reject`)
      .set('Authorization', `Bearer ${driftedProviderToken}`)
      .send({ reason: 'Outside current route' });
    expect(rejectRes.status).toBe(201);
    expect(rejectRes.body.status).toBe(ReportStatus.PENDING);
    expect(rejectRes.body.assignedProviderId).toBeNull();
    expect(rejectRes.body.lastAssignmentOutcome).toBe(
      AssignmentOutcome.REJECTED,
    );
  });

  it('routes report ownership to an organization and enforces tenant isolation', async () => {
    const sourceOrg = await createOrganization('Workflow Source Routing Org');
    const hunslowOrg = await prisma.organization.create({
      data: {
        name: 'Workflow Hunslow Routing Org',
        contactEmail: 'workflow-hunslow-routing@test.com',
        state: 'FCT',
        lga: 'Bwari',
        address: 'Kubwa Township',
      },
    });
    createdOrgIds.push(hunslowOrg.id);
    const otherOrg = await createOrganization('Workflow Other Routing Org');
    const superAdmin = await createUser({
      email: 'wf-super-routing@test.com',
      fullName: 'Workflow Super Routing',
      role: UserRole.SUPER_ADMIN,
      organizationId: null,
    });
    const sourceAdmin = await createUser({
      email: 'wf-source-admin-routing@test.com',
      fullName: 'Workflow Source Admin Routing',
      role: UserRole.ORG_ADMIN,
      organizationId: sourceOrg.id,
    });
    const hunslowAdmin = await createUser({
      email: 'wf-hunslow-admin-routing@test.com',
      fullName: 'Workflow Hunslow Admin Routing',
      role: UserRole.ORG_ADMIN,
      organizationId: hunslowOrg.id,
    });
    const otherAdmin = await createUser({
      email: 'wf-other-admin-routing@test.com',
      fullName: 'Workflow Other Admin Routing',
      role: UserRole.ORG_ADMIN,
      organizationId: otherOrg.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-routing@test.com',
      fullName: 'Workflow Citizen Routing',
      role: UserRole.CITIZEN,
      organizationId: sourceOrg.id,
    });
    const hunslowProvider = await createUser({
      email: 'wf-hunslow-provider-routing@test.com',
      fullName: 'Workflow Hunslow Provider Routing',
      role: UserRole.PROVIDER,
      organizationId: null,
      providerId: 'PRV-WF-HUNSLOW-ROUTE',
      serviceCategories: ['Road'],
      coverageAreas: ['Kubwa Township'],
    });
    await prisma.providerOrganization.create({
      data: {
        providerId: hunslowProvider.id,
        organizationId: hunslowOrg.id,
        active: true,
      },
    });

    const report = await createReport({
      title: 'WF tenant routing report',
      organizationId: sourceOrg.id,
      citizenId: citizen.id,
      status: ReportStatus.PENDING,
    });

    const sourceAdminToken = await signToken(sourceAdmin);
    const hunslowAdminToken = await signToken(hunslowAdmin);
    const otherAdminToken = await signToken(otherAdmin);
    const superAdminToken = await signToken(superAdmin);

    expect(
      await request(app.getHttpServer())
        .get(`/api/report/${report.id}`)
        .set('Authorization', `Bearer ${hunslowAdminToken}`),
    ).toHaveProperty('status', 403);

    const routeRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign-organization`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        organizationId: hunslowOrg.id,
        reason: 'Super admin routed report to Hunslow jurisdiction',
      });
    expect(routeRes.status).toBe(200);
    expect(routeRes.body.organizationId).toBe(hunslowOrg.id);
    expect(routeRes.body.assignedOrganizationId).toBe(hunslowOrg.id);
    expect(routeRes.body.status).toBe(ReportStatus.ORG_REVIEW);

    const stored = await prisma.report.findUniqueOrThrow({
      where: { id: report.id },
    });
    expect(stored.organizationId).toBe(hunslowOrg.id);
    expect(stored.assignedOrganizationId).toBe(hunslowOrg.id);

    const sourceReadAfterRoute = await request(app.getHttpServer())
      .get(`/api/report/${report.id}`)
      .set('Authorization', `Bearer ${sourceAdminToken}`);
    expect(sourceReadAfterRoute.status).toBe(403);

    const hunslowReadAfterRoute = await request(app.getHttpServer())
      .get(`/api/report/${report.id}`)
      .set('Authorization', `Bearer ${hunslowAdminToken}`);
    expect(hunslowReadAfterRoute.status).toBe(200);
    expect(hunslowReadAfterRoute.body.organizationId).toBe(hunslowOrg.id);
    expect(hunslowReadAfterRoute.body.status).toBe(ReportStatus.ORG_REVIEW);

    const hunslowSummary = await request(app.getHttpServer())
      .get('/api/report/admin/dashboard/summary')
      .set('Authorization', `Bearer ${hunslowAdminToken}`);
    expect(hunslowSummary.status).toBe(200);
    expect(hunslowSummary.body.total).toBeGreaterThanOrEqual(1);
    expect(hunslowSummary.body.pending).toBeGreaterThanOrEqual(1);
    expect(
      hunslowSummary.body.awaitingOrganizationDecision,
    ).toBeGreaterThanOrEqual(1);

    const earlyAssign = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${hunslowAdminToken}`)
      .send({ providerId: hunslowProvider.id });
    expect(earlyAssign.status).toBe(403);
    expect(earlyAssign.body.message).toContain(
      'Report cannot be assigned in its current status',
    );

    const acceptRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/organization-accept`)
      .set('Authorization', `Bearer ${hunslowAdminToken}`)
      .send({ note: 'Accepted for Hunslow dispatch' });
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.status).toBe(ReportStatus.PENDING);
    expect(acceptRes.body.organizationId).toBe(hunslowOrg.id);
    expect(acceptRes.body.assignedOrganizationId).toBe(hunslowOrg.id);

    const hunslowCandidates = await request(app.getHttpServer())
      .get(`/api/report/${report.id}/assignment-candidates`)
      .set('Authorization', `Bearer ${hunslowAdminToken}`);
    expect(hunslowCandidates.status).toBe(200);
    expect(
      hunslowCandidates.body.providers.map((item: { id: string }) => item.id),
    ).toContain(hunslowProvider.id);

    const assignRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${hunslowAdminToken}`)
      .send({ providerId: hunslowProvider.id });
    expect(assignRes.status).toBe(200);
    expect(assignRes.body.status).toBe(ReportStatus.ASSIGNED);

    const otherRouteAttempt = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign-organization`)
      .set('Authorization', `Bearer ${otherAdminToken}`)
      .send({ organizationId: otherOrg.id, reason: 'Cross tenant attempt' });
    expect(otherRouteAttempt.status).toBe(403);
  });

  it('automatically routes only one deterministic eligible organization match', async () => {
    const unique = Date.now().toString(36);
    const category = `Auto Intake ${unique}`;
    const sourceOrg = await createOrganization(
      `Workflow Auto Source ${unique}`,
    );
    const routedOrg = await prisma.organization.create({
      data: {
        name: `Workflow Auto Routed ${unique}`,
        contactEmail: `wf-auto-routed-${unique}@test.com`,
        state: 'FCT',
        lga: 'Bwari',
        address: 'Kubwa Township',
      },
    });
    createdOrgIds.push(routedOrg.id);
    const otherOrg = await createOrganization(`Workflow Auto Other ${unique}`);
    const citizen = await createUser({
      email: `wf-auto-citizen-${unique}@test.com`,
      fullName: 'Workflow Auto Citizen',
      role: UserRole.CITIZEN,
      organizationId: sourceOrg.id,
    });
    const routedAdmin = await createUser({
      email: `wf-auto-routed-admin-${unique}@test.com`,
      fullName: 'Workflow Auto Routed Admin',
      role: UserRole.ORG_ADMIN,
      organizationId: routedOrg.id,
    });
    const otherAdmin = await createUser({
      email: `wf-auto-other-admin-${unique}@test.com`,
      fullName: 'Workflow Auto Other Admin',
      role: UserRole.ORG_ADMIN,
      organizationId: otherOrg.id,
    });
    await createUser({
      email: `wf-auto-provider-${unique}@test.com`,
      fullName: 'Workflow Auto Provider',
      role: UserRole.PROVIDER,
      organizationId: routedOrg.id,
      serviceCategories: [category],
      coverageAreas: ['Kubwa'],
    });

    const citizenToken = await signToken(citizen);
    const createRes = await request(app.getHttpServer())
      .post('/api/report')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        title: 'WF automatic organization intake',
        description: 'Road issue around Kubwa',
        category,
        location: 'Kubwa Township',
      });
    expect(createRes.status).toBe(201);
    createdReportIds.push(createRes.body.id);
    expect(createRes.body.status).toBe(ReportStatus.ORG_REVIEW);
    expect(createRes.body.organizationId).toBe(routedOrg.id);
    expect(createRes.body.assignedOrganizationId).toBe(routedOrg.id);

    const routedAdminToken = await signToken(routedAdmin);
    const otherAdminToken = await signToken(otherAdmin);
    const routedRead = await request(app.getHttpServer())
      .get(`/api/report/${createRes.body.id}`)
      .set('Authorization', `Bearer ${routedAdminToken}`);
    expect(routedRead.status).toBe(200);

    const otherRead = await request(app.getHttpServer())
      .get(`/api/report/${createRes.body.id}`)
      .set('Authorization', `Bearer ${otherAdminToken}`);
    expect(otherRead.status).toBe(403);

    const ambiguousOrgA = await prisma.organization.create({
      data: {
        name: `Workflow Auto Ambiguous A ${unique}`,
        contactEmail: `wf-auto-amb-a-${unique}@test.com`,
        state: 'FCT',
        lga: 'Jabi',
        address: 'Jabi District',
      },
    });
    createdOrgIds.push(ambiguousOrgA.id);
    const ambiguousOrgB = await prisma.organization.create({
      data: {
        name: `Workflow Auto Ambiguous B ${unique}`,
        contactEmail: `wf-auto-amb-b-${unique}@test.com`,
        state: 'FCT',
        lga: 'Jabi',
        address: 'Jabi District',
      },
    });
    createdOrgIds.push(ambiguousOrgB.id);
    const ambiguousCategory = `Ambiguous Intake ${unique}`;
    await createUser({
      email: `wf-auto-amb-a-provider-${unique}@test.com`,
      fullName: 'Workflow Auto Ambiguous A Provider',
      role: UserRole.PROVIDER,
      organizationId: ambiguousOrgA.id,
      serviceCategories: [ambiguousCategory],
      coverageAreas: ['Jabi'],
    });
    await createUser({
      email: `wf-auto-amb-b-provider-${unique}@test.com`,
      fullName: 'Workflow Auto Ambiguous B Provider',
      role: UserRole.PROVIDER,
      organizationId: ambiguousOrgB.id,
      serviceCategories: [ambiguousCategory],
      coverageAreas: ['Jabi'],
    });

    const ambiguousRes = await request(app.getHttpServer())
      .post('/api/report')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        title: 'WF ambiguous organization intake',
        description: 'Issue around Jabi',
        category: ambiguousCategory,
        location: 'Jabi District',
      });
    expect(ambiguousRes.status).toBe(201);
    createdReportIds.push(ambiguousRes.body.id);
    expect(ambiguousRes.body.status).toBe(ReportStatus.TRIAGE);
    expect(ambiguousRes.body.assignedOrganizationId).toBeNull();

    const noMatchRes = await request(app.getHttpServer())
      .post('/api/report')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        title: 'WF no match organization intake',
        description: 'No matching category',
        category: `No Match Intake ${unique}`,
        location: 'Gwarinpa',
      });
    expect(noMatchRes.status).toBe(201);
    createdReportIds.push(noMatchRes.body.id);
    expect(noMatchRes.body.status).toBe(ReportStatus.TRIAGE);
    expect(noMatchRes.body.assignedOrganizationId).toBeNull();

    const superAdmin = await createUser({
      email: `wf-auto-super-admin-${unique}@test.com`,
      fullName: 'Workflow Auto Super Admin',
      role: UserRole.SUPER_ADMIN,
    });
    const superAdminToken = await signToken(superAdmin);
    const manualRouteRes = await request(app.getHttpServer())
      .patch(`/api/report/${ambiguousRes.body.id}/assign-organization`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        organizationId: ambiguousOrgA.id,
        reason: 'Manual triage routing',
      });
    expect(manualRouteRes.status).toBe(200);
    expect(manualRouteRes.body.status).toBe(ReportStatus.ORG_REVIEW);
    expect(manualRouteRes.body.organizationId).toBe(ambiguousOrgA.id);
    expect(manualRouteRes.body.assignedOrganizationId).toBe(ambiguousOrgA.id);
  });

  it('returns organization-rejected reports to platform triage', async () => {
    const org = await createOrganization('Workflow Org Intake Reject');
    const admin = await createUser({
      email: 'wf-org-intake-reject-admin@test.com',
      fullName: 'Workflow Org Intake Reject Admin',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const provider = await createUser({
      email: 'wf-org-intake-reject-provider@test.com',
      fullName: 'Workflow Org Intake Reject Provider',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-org-intake-reject-citizen@test.com',
      fullName: 'Workflow Org Intake Reject Citizen',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF org intake rejected',
      organizationId: org.id,
      citizenId: citizen.id,
      status: ReportStatus.ORG_REVIEW,
      assignedOrganizationId: org.id,
    });
    const adminToken = await signToken(admin);

    const noReason = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/organization-reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: '' });
    expect(noReason.status).toBe(400);

    const rejectRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/organization-reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Outside Hunslow jurisdiction' });
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.status).toBe(ReportStatus.TRIAGE);
    expect(rejectRes.body.assignedOrganizationId).toBeNull();
    expect(rejectRes.body.lastAssignmentReason).toBe(
      'Outside Hunslow jurisdiction',
    );

    const orgReports = await request(app.getHttpServer())
      .get('/api/report')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(orgReports.status).toBe(200);
    expect(
      orgReports.body.map((item: { id: string }) => item.id),
    ).not.toContain(report.id);

    const staleAssign = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ providerId: provider.id });
    expect(staleAssign.status).toBe(403);
  });
});
