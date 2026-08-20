import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AccountStatus,
  AssignmentOutcome,
  CompletionDecision,
  CompletionPolicy,
  Prisma,
  ReportStatus,
  UserRole,
} from '@prisma/client';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

type SupertestServer = Parameters<typeof request>[0];
type TestApplication = Omit<INestApplication, 'getHttpServer'> & {
  getHttpServer(): SupertestServer;
};
type ReportActivityRecord = {
  metadata?: unknown;
};
type PrismaWithReportActivity = PrismaService & {
  reportActivity: {
    findFirst(args: unknown): Promise<ReportActivityRecord | null>;
  };
};
type JsonResponseBody = Record<string, unknown> & {
  [index: number]: Record<string, unknown>;
  accessToken: string;
  assignedOrganizationId: string | null;
  assignedProviderId: string | null;
  awaitingOrganizationDecision: number;
  citizenCompletionDecision: string | null;
  citizenId: string;
  code: string;
  completionFinalizedAt: string | null;
  completionFinalizedByRole: string | null;
  completionImagePath: string;
  completionImageUrl: string;
  completion: { imagePath: string; imageUrl: string };
  completionLocationCapturedAt: string | null;
  completionPolicy: string;
  completionPolicySource: string;
  completionReviewState: string;
  evidenceImagePath: string;
  evidenceImageUrl: string;
  evidenceItems: Array<Record<string, unknown>>;
  id: string;
  length?: number;
  locationCapturedAt: string | null;
  locationName: string;
  latitude: number;
  map<T>(callback: (item: Record<string, unknown>) => T): T[];
  message: string;
  organizationCompletionDecision: string | null;
  organizationId: string;
  pending: number;
  providers: Array<{ id: string }>;
  responsibilityResolution: {
    candidateCount: number;
    candidates: Array<Record<string, unknown>>;
    eligibleCandidateCount: number;
    outcome: string;
    proposedOrganizationId?: string;
    reasonCode: string;
    report: {
      category: string;
      normalizedCategory: string;
      coordinates: { latitude: number; longitude: number };
      location: {
        text: string;
        name: string;
        landmark: string;
        source: string;
      };
    };
  };
  status: string;
  total: number;
  user: { id: string };
};
type NotificationJson = {
  reportId: string | null;
  type: string;
};

function json(response: request.Response): JsonResponseBody {
  return (response as unknown as { body: JsonResponseBody }).body;
}

function notifications(response: request.Response): NotificationJson[] {
  return (response as unknown as { body: NotificationJson[] }).body;
}

describe('Report Workflow (e2e)', () => {
  jest.setTimeout(60000);

  let app: TestApplication;
  let prisma: PrismaService;
  let prismaWithActivity: PrismaWithReportActivity;
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

    app = moduleFixture.createNestApplication({
      bodyParser: false,
    });
    configureApp(app);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    prismaWithActivity = prisma as unknown as PrismaWithReportActivity;
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

    cleanupUploadArtifacts(reportIds);

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
    await Promise.resolve();
    cleanupUploadArtifacts([...createdReportIds]);
  }

  function cleanupUploadArtifacts(reportIds: string[]) {
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
    accountStatus?: AccountStatus;
    providerId?: string | null;
    serviceCategories?: string[];
    coverageAreas?: string[];
    profileData?: Record<string, unknown>;
  }) {
    const user = await prisma.user.create({
      data: data as Prisma.UserUncheckedCreateInput,
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
    organizationAssignedAt?: Date | null;
    category?: string;
    location?: string;
  }) {
    const report = await prisma.report.create({
      data: {
        title: data.title,
        description: 'Workflow test report',
        category: data.category ?? 'Road',
        location: data.location ?? 'Test Street',
        status: data.status ?? ReportStatus.PENDING,
        organizationId: data.organizationId,
        citizenId: data.citizenId,
        assignedProviderId: data.assignedProviderId ?? null,
        assignedOrganizationId: data.assignedOrganizationId ?? null,
        organizationAssignedAt: data.organizationAssignedAt ?? null,
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
    expect(json(assignRes).status).toBe(ReportStatus.ASSIGNED);

    const inProgressRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: ReportStatus.IN_PROGRESS });

    expect(inProgressRes.status).toBe(200);
    expect(json(inProgressRes).status).toBe(ReportStatus.IN_PROGRESS);

    const uploadRes = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/completion-evidence`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        fileName: 'happy-completion.png',
        contentType: 'image/png',
        imageBase64: onePixelPngBase64,
      });

    expect(uploadRes.status).toBe(201);

    const completedRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: ReportStatus.COMPLETED_BY_PROVIDER });

    expect(completedRes.status).toBe(200);
    expect(json(completedRes).status).toBe(ReportStatus.COMPLETED_BY_PROVIDER);

    const closedRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: ReportStatus.CLOSED });

    expect(closedRes.status).toBe(200);
    expect(json(closedRes).status).toBe(ReportStatus.CLOSED);

    const timelineRes = await request(app.getHttpServer())
      .get(`/api/report/${report.id}/timeline`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(timelineRes.status).toBe(200);
    expect(
      json(timelineRes).map((item: { action: string }) => item.action),
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
    expect(json(createdMessage).message).toBe('Provider has reached the site.');
    expect(json(createdMessage).organizationId).toBe(org.id);

    const citizenMessages = await request(app.getHttpServer())
      .get(`/api/report/${report.id}/messages`)
      .set('Authorization', `Bearer ${citizenToken}`);

    expect(citizenMessages.status).toBe(200);
    expect(json(citizenMessages)).toHaveLength(1);
    expect(json(citizenMessages)[0].authorRole).toBe(UserRole.PROVIDER);

    const adminMessages = await request(app.getHttpServer())
      .get(`/api/report/${report.id}/messages`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(adminMessages.status).toBe(200);
    expect(json(adminMessages)).toHaveLength(1);

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
    createdReportIds.push(json(createdRes).id);
    expect(json(createdRes)).toMatchObject({
      latitude: 9.0765,
      longitude: 7.4938,
      locationAccuracy: 18.4,
      locationSource: 'DEVICE_GPS',
    });
    expect(json(createdRes).locationCapturedAt).toBe(
      '2026-07-12T09:00:00.000Z',
    );

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
      category: 'General Maintenance',
    });

    const adminToken = await signToken(admin);
    const providerToken = await signToken(provider);
    const citizenToken = await signToken(citizen);

    const engineRes = await request(app.getHttpServer())
      .get('/api/business-logic/workflow-engine')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(engineRes.status).toBe(200);
    expect(json(engineRes)).toMatchObject({
      activeProductionModule: 'maintenance',
      futureModulesOperational: false,
    });

    const uploadRes = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/completion-evidence`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        fileName: 'orchestrated-completion.png',
        contentType: 'image/png',
        imageBase64: onePixelPngBase64,
      });

    expect(uploadRes.status).toBe(201);

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
    expect(json(completedRes).status).toBe(ReportStatus.COMPLETED_BY_PROVIDER);
    expect(json(completedRes)).toMatchObject({
      completionLatitude: 9.081,
      completionLongitude: 7.492,
      completionAccuracy: 24,
      completionLocationSource: 'DEVICE_GPS',
    });
    expect(json(completedRes).completionLocationCapturedAt).toBe(
      '2026-07-12T10:15:00.000Z',
    );

    const citizenNotifications = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${citizenToken}`);

    expect(citizenNotifications.status).toBe(200);
    const citizenReviewNotifications = notifications(
      citizenNotifications,
    ).filter(
      (item) =>
        item.reportId === report.id && item.type === 'completion_review',
    );
    expect(citizenReviewNotifications).toHaveLength(1);
    expect(json(citizenNotifications)).toEqual(
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
    expect(json(confirmRes)).toMatchObject({
      status: ReportStatus.CLOSED,
      citizenRating: 5,
      citizenFeedback: 'Looks good.',
    });

    const providerNotifications = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${providerToken}`);

    expect(providerNotifications.status).toBe(200);
    const providerCompletionNotifications = notifications(
      providerNotifications,
    ).filter(
      (item) =>
        item.reportId === report.id && item.type === 'completion_confirmed',
    );
    expect(providerCompletionNotifications).toHaveLength(1);
    expect(json(providerNotifications)).toEqual(
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

  it('keeps organization-confirmation policy open after citizen approval until organization verification', async () => {
    const org = await createOrganization('Workflow Completion Org Policy');
    await prisma.organization.update({
      where: { id: org.id },
      data: {
        profileData: {
          completionPolicy: CompletionPolicy.ORGANIZATION_CONFIRMATION_REQUIRED,
        },
      },
    });
    const admin = await createUser({
      email: 'wf-admin-org-completion@test.com',
      fullName: 'Workflow Completion Admin',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const provider = await createUser({
      email: 'wf-provider-org-completion@test.com',
      fullName: 'Workflow Completion Provider',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-org-completion@test.com',
      fullName: 'Workflow Completion Citizen',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF organization completion policy',
      status: ReportStatus.IN_PROGRESS,
      organizationId: org.id,
      citizenId: citizen.id,
      assignedProviderId: provider.id,
    });
    const providerToken = await signToken(provider);
    const citizenToken = await signToken(citizen);
    const adminToken = await signToken(admin);

    const uploadRes = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/completion-evidence`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        fileName: 'org-policy-completion.png',
        contentType: 'image/png',
        imageBase64: onePixelPngBase64,
      });
    expect(uploadRes.status).toBe(201);

    const completedRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: ReportStatus.COMPLETED_BY_PROVIDER });
    expect(completedRes.status).toBe(200);
    expect(json(completedRes).completionPolicy).toBe(
      CompletionPolicy.ORGANIZATION_CONFIRMATION_REQUIRED,
    );
    expect(json(completedRes).completionReviewState).toBe(
      'AWAITING_ORGANIZATION_VERIFICATION',
    );

    const citizenConfirmRes = await request(app.getHttpServer())
      .post(`/api/report/citizen/${report.id}/confirm-completion`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ rating: 4, feedback: 'Looks acceptable.' });
    expect(citizenConfirmRes.status).toBe(201);
    expect(json(citizenConfirmRes).status).toBe(
      ReportStatus.COMPLETED_BY_PROVIDER,
    );
    expect(json(citizenConfirmRes).citizenCompletionDecision).toBe('CONFIRMED');
    expect(json(citizenConfirmRes).completionFinalizedAt).toBeNull();

    const verifyRes = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/organization-completion/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Evidence and site checks passed.' });
    expect(verifyRes.status).toBe(201);
    expect(json(verifyRes).status).toBe(ReportStatus.CLOSED);
    expect(json(verifyRes).organizationCompletionDecision).toBe('VERIFIED');
    expect(json(verifyRes).completionFinalizedByRole).toBe(UserRole.ORG_ADMIN);
  });

  it('requires both citizen and organization approvals when policy is BOTH_REQUIRED', async () => {
    const org = await createOrganization('Workflow Completion Both Org');
    await prisma.organization.update({
      where: { id: org.id },
      data: {
        profileData: { completionPolicy: CompletionPolicy.BOTH_REQUIRED },
      },
    });
    const admin = await createUser({
      email: 'wf-admin-both-completion@test.com',
      fullName: 'Workflow Both Completion Admin',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const provider = await createUser({
      email: 'wf-provider-both-completion@test.com',
      fullName: 'Workflow Both Completion Provider',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-both-completion@test.com',
      fullName: 'Workflow Both Completion Citizen',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF both completion policy',
      status: ReportStatus.IN_PROGRESS,
      organizationId: org.id,
      citizenId: citizen.id,
      assignedProviderId: provider.id,
    });
    const providerToken = await signToken(provider);
    const citizenToken = await signToken(citizen);
    const adminToken = await signToken(admin);

    const uploadRes = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/completion-evidence`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        fileName: 'both-policy-completion.png',
        contentType: 'image/png',
        imageBase64: onePixelPngBase64,
      });
    expect(uploadRes.status).toBe(201);

    const completedRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: ReportStatus.COMPLETED_BY_PROVIDER });
    expect(completedRes.status).toBe(200);
    expect(json(completedRes).completionReviewState).toBe('AWAITING_BOTH');

    const verifyRes = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/organization-completion/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Organization verified first.' });
    expect(verifyRes.status).toBe(201);
    expect(json(verifyRes).status).toBe(ReportStatus.COMPLETED_BY_PROVIDER);
    expect(json(verifyRes).completionReviewState).toBe(
      'AWAITING_CITIZEN_REVIEW',
    );

    const duplicateVerifyRes = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/organization-completion/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Duplicate organization verification.' });
    expect(duplicateVerifyRes.status).toBe(201);
    expect(json(duplicateVerifyRes).status).toBe(
      ReportStatus.COMPLETED_BY_PROVIDER,
    );

    const citizenConfirmRes = await request(app.getHttpServer())
      .post(`/api/report/citizen/${report.id}/confirm-completion`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ rating: 5, feedback: 'Verified and satisfactory.' });
    expect(citizenConfirmRes.status).toBe(201);
    expect(json(citizenConfirmRes).status).toBe(ReportStatus.CLOSED);
    expect(json(citizenConfirmRes).completionFinalizedByRole).toBe(
      UserRole.CITIZEN,
    );
  });

  it('defaults Road work to dual completion governance without explicit configuration', async () => {
    const org = await createOrganization(
      'Workflow Road Default Governance Org',
    );
    const admin = await createUser({
      email: 'wf-admin-road-default@test.com',
      fullName: 'Workflow Road Default Admin',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const provider = await createUser({
      email: 'wf-provider-road-default@test.com',
      fullName: 'Workflow Road Default Provider',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-road-default@test.com',
      fullName: 'Workflow Road Default Citizen',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF road default dual confirmation',
      status: ReportStatus.IN_PROGRESS,
      organizationId: org.id,
      citizenId: citizen.id,
      assignedProviderId: provider.id,
      category: 'Road & Infrastructure',
    });
    const providerToken = await signToken(provider);
    const citizenToken = await signToken(citizen);
    const adminToken = await signToken(admin);

    const uploadRes = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/completion-evidence`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        images: [0, 1, 2].map((index) => ({
          fileName: `road-completion-${index}.png`,
          contentType: 'image/png',
          imageBase64: onePixelPngBase64,
          classification: 'after',
          order: index,
        })),
      });
    expect(uploadRes.status).toBe(201);
    expect(json(uploadRes).evidenceItems).toHaveLength(3);

    const completedRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: ReportStatus.COMPLETED_BY_PROVIDER });
    expect(completedRes.status).toBe(200);
    expect(json(completedRes).completionPolicy).toBe(
      CompletionPolicy.BOTH_REQUIRED,
    );
    expect(json(completedRes).completionPolicySource).toBe(
      'BUILT_IN_OPERATIONAL_CATEGORY_DEFAULT',
    );
    expect(json(completedRes).completionReviewState).toBe('AWAITING_BOTH');

    const citizenConfirmRes = await request(app.getHttpServer())
      .post(`/api/report/citizen/${report.id}/confirm-completion`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ rating: 5, feedback: 'Looks complete from my side.' });
    expect(citizenConfirmRes.status).toBe(201);
    expect(json(citizenConfirmRes).status).toBe(
      ReportStatus.COMPLETED_BY_PROVIDER,
    );
    expect(json(citizenConfirmRes).completionReviewState).toBe(
      'AWAITING_ORGANIZATION_VERIFICATION',
    );
    expect(json(citizenConfirmRes).completionFinalizedAt).toBeNull();

    const duplicateCitizenConfirmRes = await request(app.getHttpServer())
      .post(`/api/report/citizen/${report.id}/confirm-completion`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ rating: 5, feedback: 'Duplicate citizen approval.' });
    expect(duplicateCitizenConfirmRes.status).toBe(201);
    expect(json(duplicateCitizenConfirmRes).status).toBe(
      ReportStatus.COMPLETED_BY_PROVIDER,
    );
    expect(json(duplicateCitizenConfirmRes).citizenFeedback).toBe(
      'Looks complete from my side.',
    );

    const providerBeforeClosureNotifications = await request(
      app.getHttpServer(),
    )
      .get('/api/notifications')
      .set('Authorization', `Bearer ${providerToken}`);
    expect(providerBeforeClosureNotifications.status).toBe(200);
    expect(
      notifications(providerBeforeClosureNotifications).filter(
        (item) =>
          item.reportId === report.id && item.type === 'completion_confirmed',
      ),
    ).toHaveLength(0);

    const verifyRes = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/organization-completion/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Road evidence verified by organization.' });
    expect(verifyRes.status).toBe(201);
    expect(json(verifyRes).status).toBe(ReportStatus.CLOSED);
    expect(json(verifyRes).organizationCompletionDecision).toBe('VERIFIED');

    const providerAfterClosureNotifications = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${providerToken}`);
    expect(providerAfterClosureNotifications.status).toBe(200);
    expect(
      notifications(providerAfterClosureNotifications).filter(
        (item) =>
          item.reportId === report.id && item.type === 'completion_confirmed',
      ),
    ).toHaveLength(1);
  });

  it('enforces rework, dispute, override reason, tenant isolation and immutable completion evidence', async () => {
    const org = await createOrganization('Workflow Governance Rework Org');
    await prisma.organization.update({
      where: { id: org.id },
      data: {
        profileData: { completionPolicy: CompletionPolicy.BOTH_REQUIRED },
      },
    });
    const otherOrg = await createOrganization('Workflow Governance Other Org');
    const admin = await createUser({
      email: 'wf-admin-governance-rework@test.com',
      fullName: 'Workflow Governance Admin',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const otherAdmin = await createUser({
      email: 'wf-admin-governance-other@test.com',
      fullName: 'Workflow Governance Other Admin',
      role: UserRole.ORG_ADMIN,
      organizationId: otherOrg.id,
    });
    const superAdmin = await createUser({
      email: 'wf-admin-governance-super@test.com',
      fullName: 'Workflow Governance Super',
      role: UserRole.SUPER_ADMIN,
    });
    const provider = await createUser({
      email: 'wf-provider-governance-rework@test.com',
      fullName: 'Workflow Governance Provider',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-governance-rework@test.com',
      fullName: 'Workflow Governance Citizen',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF governance rework lifecycle',
      status: ReportStatus.IN_PROGRESS,
      organizationId: org.id,
      citizenId: citizen.id,
      assignedProviderId: provider.id,
      category: 'Road & Infrastructure',
    });
    const adminToken = await signToken(admin);
    const otherAdminToken = await signToken(otherAdmin);
    const providerToken = await signToken(provider);
    const citizenToken = await signToken(citizen);
    const superAdminToken = await signToken(superAdmin);

    const firstUpload = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/completion-evidence`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        fileName: 'first-attempt.png',
        contentType: 'image/png',
        imageBase64: onePixelPngBase64,
        classification: 'after',
      });
    expect(firstUpload.status).toBe(201);

    const firstSubmit = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: ReportStatus.COMPLETED_BY_PROVIDER });
    expect(firstSubmit.status).toBe(200);
    expect(json(firstSubmit).completionReviewState).toBe('AWAITING_BOTH');

    const otherOrgVerify = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/organization-completion/verify`)
      .set('Authorization', `Bearer ${otherAdminToken}`)
      .send({ reason: 'Cross-tenant verification attempt.' });
    expect(otherOrgVerify.status).toBe(403);

    const missingOrgReworkReason = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/organization-completion/rework`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: '   ' });
    expect(missingOrgReworkReason.status).toBe(400);

    const orgRework = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/organization-completion/rework`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Repair edges before closure.' });
    expect(orgRework.status).toBe(201);
    expect(json(orgRework).status).toBe(ReportStatus.ASSIGNED);
    expect(json(orgRework).organizationCompletionDecision).toBe(
      CompletionDecision.REWORK_REQUESTED,
    );

    const resumeWork = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: ReportStatus.IN_PROGRESS });
    expect(resumeWork.status).toBe(200);

    const secondUpload = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/completion-evidence`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        fileName: 'second-attempt.png',
        contentType: 'image/png',
        imageBase64: onePixelPngBase64,
        classification: 'after',
      });
    expect(secondUpload.status).toBe(201);

    const secondSubmit = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: ReportStatus.COMPLETED_BY_PROVIDER });
    expect(secondSubmit.status).toBe(200);
    expect(json(secondSubmit).organizationCompletionDecision).toBe(
      CompletionDecision.PENDING,
    );
    expect(json(secondSubmit).citizenCompletionDecision).toBe(
      CompletionDecision.PENDING,
    );

    const evidenceRecords = await prisma.evidenceRecord.findMany({
      where: {
        relatedEntityId: report.id,
        fileUrl: { contains: 'report-completion' },
      },
      orderBy: { uploadedAt: 'asc' },
    });
    expect(evidenceRecords.length).toBeGreaterThanOrEqual(2);

    await prisma.report.update({
      where: { id: report.id },
      data: {
        completionReviewState: 'DISPUTED',
        citizenCompletionDecision: CompletionDecision.DISPUTED,
        completionDisputeReason: 'Citizen opened active dispute.',
      },
    });
    const blockedByDispute = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/organization-completion/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Trying to close disputed report.' });
    expect(blockedByDispute.status).toBe(409);

    const adminOverrideWithoutReason = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/admin-completion/resolve-close`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ reason: '   ' });
    expect(adminOverrideWithoutReason.status).toBe(400);

    await prisma.report.update({
      where: { id: report.id },
      data: {
        completionReviewState: 'AWAITING_BOTH',
        citizenCompletionDecision: CompletionDecision.PENDING,
        completionDisputeReason: null,
      },
    });

    const citizenReworkReport = await createReport({
      title: 'WF citizen rework lifecycle',
      status: ReportStatus.COMPLETED_BY_PROVIDER,
      organizationId: org.id,
      citizenId: citizen.id,
      assignedProviderId: provider.id,
      category: 'Road & Infrastructure',
    });
    await prisma.report.update({
      where: { id: citizenReworkReport.id },
      data: {
        completionPolicy: CompletionPolicy.BOTH_REQUIRED,
        completionReviewState: 'AWAITING_BOTH',
        citizenCompletionDecision: CompletionDecision.PENDING,
        organizationCompletionDecision: CompletionDecision.PENDING,
      },
    });

    const missingCitizenReworkReason = await request(app.getHttpServer())
      .post(`/api/report/citizen/${citizenReworkReport.id}/reject-completion`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ reason: '   ' });
    expect(missingCitizenReworkReason.status).toBe(400);

    const citizenRework = await request(app.getHttpServer())
      .post(`/api/report/citizen/${citizenReworkReport.id}/reject-completion`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ reason: 'Surface still fails at the shoulder.' });
    expect(citizenRework.status).toBe(201);
    expect(json(citizenRework).status).toBe(ReportStatus.ASSIGNED);
    expect(json(citizenRework).citizenCompletionDecision).toBe(
      CompletionDecision.REWORK_REQUESTED,
    );
  });

  it('enforces multi-image evidence limits for citizen and provider uploads', async () => {
    const org = await createOrganization('Workflow Multi Evidence Limit Org');
    const provider = await createUser({
      email: 'wf-provider-multi-evidence@test.com',
      fullName: 'Workflow Multi Evidence Provider',
      role: UserRole.PROVIDER,
      organizationId: org.id,
    });
    const citizen = await createUser({
      email: 'wf-citizen-multi-evidence@test.com',
      fullName: 'Workflow Multi Evidence Citizen',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF multi evidence limit',
      status: ReportStatus.IN_PROGRESS,
      organizationId: org.id,
      citizenId: citizen.id,
      assignedProviderId: provider.id,
    });
    const citizenToken = await signToken(citizen);
    const providerToken = await signToken(provider);

    const citizenFive = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/evidence`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        images: [0, 1, 2, 3, 4].map((index) => ({
          fileName: `report-${index}.png`,
          contentType: 'image/png',
          imageBase64: onePixelPngBase64,
          order: index,
        })),
      });
    expect(citizenFive.status).toBe(201);
    expect(json(citizenFive).evidenceItems).toHaveLength(5);

    const citizenSixth = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/evidence`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        fileName: 'report-six.png',
        contentType: 'image/png',
        imageBase64: onePixelPngBase64,
      });
    expect(citizenSixth.status).toBe(400);
    expect(json(citizenSixth).code).toBe('EVIDENCE_LIMIT_EXCEEDED');

    const providerTen = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/completion-evidence`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        images: Array.from({ length: 10 }, (_, index) => ({
          fileName: `completion-${index}.png`,
          contentType: 'image/png',
          imageBase64: onePixelPngBase64,
          classification: 'after',
          order: index,
        })),
      });
    expect(providerTen.status).toBe(201);
    expect(json(providerTen).evidenceItems).toHaveLength(10);

    const providerEleventh = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/completion-evidence`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        fileName: 'completion-eleven.png',
        contentType: 'image/png',
        imageBase64: onePixelPngBase64,
        classification: 'after',
      });
    expect(providerEleventh.status).toBe(400);
    expect(json(providerEleventh).code).toBe('EVIDENCE_LIMIT_EXCEEDED');
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
    expect(json(uploadRes).completionImagePath).toMatch(
      new RegExp(`^report-completion/${report.id}/.+\\.png$`),
    );
    expect(json(uploadRes).completionImageUrl).toMatch(
      new RegExp(`^/api/report/${report.id}/completion-evidence/.+\\.png$`),
    );

    const completedRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        status: ReportStatus.COMPLETED_BY_PROVIDER,
        completionNote: 'Evidence should survive refresh.',
        completionImageUrl: `https://api.securezonegroup.com${json(uploadRes).completionImageUrl}`,
        completionImagePath: `https://api.securezonegroup.com/${json(uploadRes).completionImagePath}`,
      });

    expect(completedRes.status).toBe(200);
    expect(json(completedRes).status).toBe(ReportStatus.COMPLETED_BY_PROVIDER);
    expect(json(completedRes).completionImagePath).toBe(
      json(uploadRes).completionImagePath,
    );
    expect(json(completedRes).completionImageUrl).toMatch(
      new RegExp(`^/api/report/${report.id}/completion-evidence/.+\\.png$`),
    );

    const storedReport = await prisma.report.findUniqueOrThrow({
      where: { id: report.id },
    });

    expect(storedReport.completionImagePath).toBe(
      json(uploadRes).completionImagePath,
    );
    expect(storedReport.completionImageUrl).toBe(
      `/uploads/${json(uploadRes).completionImagePath}`,
    );

    const reviewRes = await request(app.getHttpServer())
      .get(`/api/report/citizen/${report.id}/completion-review`)
      .set('Authorization', `Bearer ${citizenToken}`);

    expect(reviewRes.status).toBe(200);
    expect(json(reviewRes).completionImagePath).toBe(
      json(uploadRes).completionImagePath,
    );
    expect(json(reviewRes).completionImageUrl).toMatch(
      new RegExp(`^/api/report/${report.id}/completion-evidence/.+\\.png$`),
    );
    expect(json(reviewRes).completion.imagePath).toBe(
      json(uploadRes).completionImagePath,
    );
    expect(json(reviewRes).completion.imageUrl).toMatch(
      new RegExp(`^/api/report/${report.id}/completion-evidence/.+\\.png$`),
    );
  });

  it('persists citizen report evidence and returns canonical detail metadata', async () => {
    const org = await createOrganization(
      'Workflow Citizen Evidence Upload Org',
    );
    const citizen = await createUser({
      email: 'wf-citizen-evidence-upload@test.com',
      fullName: 'Workflow Citizen Evidence Upload',
      role: UserRole.CITIZEN,
      organizationId: org.id,
    });
    const report = await createReport({
      title: 'WF citizen evidence upload',
      status: ReportStatus.TRIAGE,
      organizationId: org.id,
      citizenId: citizen.id,
    });
    const citizenToken = await signToken(citizen);

    const uploadRes = await request(app.getHttpServer())
      .post(`/api/report/${report.id}/evidence`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        fileName: 'report.png',
        contentType: 'image/png',
        imageBase64: onePixelPngBase64,
      });

    expect(uploadRes.status).toBe(201);
    expect(json(uploadRes).evidenceImagePath).toMatch(
      new RegExp(`^report-evidence/${report.id}/.+\\.png$`),
    );
    expect(json(uploadRes).evidenceImageUrl).toMatch(
      new RegExp(`^/api/report/${report.id}/evidence/.+\\.png$`),
    );

    const stored = await prisma.report.findUniqueOrThrow({
      where: { id: report.id },
    });
    expect(stored.evidenceImagePath).toBe(json(uploadRes).evidenceImagePath);
    expect(stored.evidenceImageUrl).toBe(
      `/uploads/${json(uploadRes).evidenceImagePath}`,
    );

    const detailRes = await request(app.getHttpServer())
      .get(`/api/report/${report.id}`)
      .set('Authorization', `Bearer ${citizenToken}`);
    expect(detailRes.status).toBe(200);
    expect(json(detailRes).evidenceItems).toHaveLength(1);
    expect(json(detailRes).evidenceItems[0]).toMatchObject({
      kind: 'report-evidence',
      source: 'CITIZEN_REPORT',
      imagePath: json(uploadRes).evidenceImagePath,
      imageUrl: json(uploadRes).evidenceImageUrl,
      mimeType: 'image/png',
      uploadedByRole: UserRole.CITIZEN,
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
    const legacyUrlOnlyReport = await createReport({
      title: 'WF legacy URL-only citizen evidence',
      status: ReportStatus.CLOSED,
      organizationId: org.id,
      citizenId: citizen.id,
      assignedProviderId: provider.id,
    });
    const evidencePath = writeEvidenceFile({
      reportId: report.id,
      folder: 'report-evidence',
      fileName: 'citizen-evidence.png',
    });
    const legacyEvidencePath = writeEvidenceFile({
      reportId: legacyUrlOnlyReport.id,
      folder: 'report-evidence',
      fileName: 'legacy-citizen-evidence.png',
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
    await prisma.report.update({
      where: { id: legacyUrlOnlyReport.id },
      data: {
        evidenceImagePath: null,
        evidenceImageUrl: `/uploads/${legacyEvidencePath}`,
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

    const legacyEvidenceUrl = `/api/report/${legacyUrlOnlyReport.id}/evidence/legacy-citizen-evidence.png`;
    const legacyOwnerRes = await request(app.getHttpServer())
      .get(legacyEvidenceUrl)
      .set('Authorization', `Bearer ${citizenToken}`);
    expect(legacyOwnerRes.status).toBe(200);
    expect(legacyOwnerRes.headers['content-type']).toContain('image/png');

    const legacyDetailRes = await request(app.getHttpServer())
      .get(`/api/report/${legacyUrlOnlyReport.id}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(legacyDetailRes.status).toBe(200);
    expect(json(legacyDetailRes).evidenceItems).toHaveLength(1);
    expect(json(legacyDetailRes).evidenceItems[0]).toMatchObject({
      kind: 'report-evidence',
      source: 'CITIZEN_REPORT',
      imagePath: legacyEvidencePath,
      url: legacyEvidenceUrl,
      imageUrl: legacyEvidenceUrl,
      mimeType: 'image/png',
      uploadedByRole: UserRole.CITIZEN,
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
    expect(json(reviewRes)).toMatchObject({
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
    expect(json(confirmRes)).toMatchObject({
      status: ReportStatus.CLOSED,
      citizenRating: 5,
      citizenFeedback: 'Verified by citizen.',
    });

    const duplicateRes = await request(app.getHttpServer())
      .post(`/api/report/citizen/${report.id}/confirm-completion`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ rating: 5, feedback: 'Duplicate approval.' });

    expect(duplicateRes.status).toBe(201);
    expect(json(duplicateRes)).toMatchObject({
      status: ReportStatus.CLOSED,
      citizenRating: 5,
      citizenFeedback: 'Verified by citizen.',
      citizenCompletionDecision: CompletionDecision.CONFIRMED,
    });
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
    expect(json(rejectRes)).toMatchObject({
      status: ReportStatus.ASSIGNED,
      completionRejectionReason: 'Drainage is still blocked near the entrance.',
    });

    const providerNotifications = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${providerToken}`);

    expect(providerNotifications.status).toBe(200);
    expect(json(providerNotifications)).toEqual(
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
    expect(json(adminNotifications)).toEqual(
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
    expect(json(res).message).toContain('Invalid status transition');

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
    expect(json(res).message).toBe('Not your report');
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
    expect(json(res)).toMatchObject({
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
    expect(json(res)).toHaveLength(1);
    expect(json(res)[0].title).toBe('WF current citizen report');
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
    expect(json(loginRes).accessToken).toBeDefined();
    expect(json(loginRes).user.id).toBeDefined();
    expect(json(loginRes).user.id).not.toBe(firebaseUid);

    const citizen = await prisma.user.findUniqueOrThrow({
      where: { id: json(loginRes).user.id },
    });
    createdUserIds.push(citizen.id);

    const createRes = await request(app.getHttpServer())
      .post('/api/report')
      .set('Authorization', `Bearer ${json(loginRes).accessToken}`)
      .send({
        title: 'WF Firebase citizen report',
        description: 'Created through backend citizen report endpoint',
        category: 'Road',
        location: 'Firebase Citizen Street',
      });

    expect(createRes.status).toBe(201);
    expect(json(createRes).citizenId).toBe(citizen.id);
    expect(json(createRes).citizenId).not.toBe(firebaseUid);
    createdReportIds.push(json(createRes).id);

    const reportsRes = await request(app.getHttpServer())
      .get('/api/report/citizen/my')
      .set('Authorization', `Bearer ${json(loginRes).accessToken}`);

    expect(reportsRes.status).toBe(200);
    expect(json(reportsRes)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: json(createRes).id,
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
    expect(json(res).message).toBe(
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
    expect(json(res).message).toBe('Invalid provider');
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
    expect(json(res).message).toBe('Provider must be same org');
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
    expect(json(silentBypassRes).code).toBe(
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
    expect(json(assignRes).status).toBe(ReportStatus.ASSIGNED);

    const providerToken = await signToken(provider);
    const assignedJobs = await request(app.getHttpServer())
      .get('/api/report/assigned')
      .set('Authorization', `Bearer ${providerToken}`);

    expect(assignedJobs.status).toBe(200);
    expect(json(assignedJobs).map((item: { id: string }) => item.id)).toContain(
      report.id,
    );

    const providerDetail = await request(app.getHttpServer())
      .get(`/api/report/${report.id}`)
      .set('Authorization', `Bearer ${providerToken}`);

    expect(providerDetail.status).toBe(200);
    expect(json(providerDetail).id).toBe(report.id);

    const closeRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ status: ReportStatus.CLOSED });

    expect(closeRes.status).toBe(403);
    expect(json(closeRes).message).toContain('Invalid status transition');
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
    expect(json(res).message).toBe(
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
    expect(json(rejectRes).status).toBe(ReportStatus.PENDING);
    expect(json(rejectRes).assignedProviderId).toBeNull();
    expect(json(rejectRes).lastAssignmentOutcome).toBe(
      AssignmentOutcome.REJECTED,
    );
    expect(json(rejectRes).lastAssignmentReason).toBe('Crew unavailable today');

    const dispatchToken = await signToken(dispatchOfficer);
    const reassignRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${dispatchToken}`)
      .send({ providerId: providerB.id });

    expect(reassignRes.status).toBe(200);
    expect(json(reassignRes).status).toBe(ReportStatus.ASSIGNED);
    expect(json(reassignRes).assignedProviderId).toBe(providerB.id);
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
    expect(json(acceptRes).message).toBe(
      'Assignment acceptance window expired',
    );

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
    expect(json(reassignRes).assignedProviderId).toBe(providerB.id);

    const oldProviderToken = await signToken(providerA);
    const oldAcceptRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${oldProviderToken}`)
      .send({ status: ReportStatus.IN_PROGRESS });
    expect(oldAcceptRes.status).toBe(403);
    expect(json(oldAcceptRes).message).toBe('Not your report');

    const newProviderToken = await signToken(providerB);
    const newAcceptRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${newProviderToken}`)
      .send({ status: ReportStatus.IN_PROGRESS });
    expect(newAcceptRes.status).toBe(200);
    expect(json(newAcceptRes).status).toBe(ReportStatus.IN_PROGRESS);
    expect(json(newAcceptRes).assignedProviderId).toBe(providerB.id);
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
    expect(json(acceptRes).status).toBe(ReportStatus.IN_PROGRESS);
    expect(json(acceptRes).assignedProviderId).toBe(driftedProvider.id);

    const rejectRes = await request(app.getHttpServer())
      .post(`/api/report/provider/${rejectReport.id}/reject`)
      .set('Authorization', `Bearer ${driftedProviderToken}`)
      .send({ reason: 'Outside current route' });
    expect(rejectRes.status).toBe(201);
    expect(json(rejectRes).status).toBe(ReportStatus.PENDING);
    expect(json(rejectRes).assignedProviderId).toBeNull();
    expect(json(rejectRes).lastAssignmentOutcome).toBe(
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
    const hunslowDispatch = await createUser({
      email: 'wf-hunslow-dispatch-routing@test.com',
      fullName: 'Workflow Hunslow Dispatch Routing',
      role: UserRole.DISPATCH_OFFICER,
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
    const inactiveProvider = await createUser({
      email: 'wf-inactive-provider-routing@test.com',
      fullName: 'Workflow Inactive Provider Routing',
      role: UserRole.PROVIDER,
      organizationId: hunslowOrg.id,
      accountStatus: AccountStatus.SUSPENDED,
      providerId: 'PRV-WF-INACTIVE-ROUTE',
      serviceCategories: ['Road'],
      coverageAreas: ['Kubwa Township'],
    });
    const otherOrgProvider = await createUser({
      email: 'wf-other-provider-routing@test.com',
      fullName: 'Workflow Other Provider Routing',
      role: UserRole.PROVIDER,
      organizationId: otherOrg.id,
      providerId: 'PRV-WF-OTHER-ROUTE',
      serviceCategories: ['Road'],
      coverageAreas: ['Kubwa Township'],
    });
    const revokedLinkedProvider = await createUser({
      email: 'wf-revoked-provider-routing@test.com',
      fullName: 'Workflow Revoked Provider Routing',
      role: UserRole.PROVIDER,
      organizationId: null,
      providerId: 'PRV-WF-REVOKED-ROUTE',
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
    await prisma.providerOrganization.create({
      data: {
        providerId: revokedLinkedProvider.id,
        organizationId: hunslowOrg.id,
        active: false,
      },
    });

    const report = await createReport({
      title: 'WF tenant routing report',
      organizationId: sourceOrg.id,
      citizenId: citizen.id,
      status: ReportStatus.PENDING,
      location: 'Kubwa Township',
    });

    const sourceAdminToken = await signToken(sourceAdmin);
    const hunslowAdminToken = await signToken(hunslowAdmin);
    const hunslowDispatchToken = await signToken(hunslowDispatch);
    const otherAdminToken = await signToken(otherAdmin);
    const superAdminToken = await signToken(superAdmin);

    expect(
      await request(app.getHttpServer())
        .get(`/api/report/${report.id}`)
        .set('Authorization', `Bearer ${hunslowAdminToken}`),
    ).toHaveProperty('status', 403);

    const sourceAdminManualRouteAttempt = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign-organization`)
      .set('Authorization', `Bearer ${sourceAdminToken}`)
      .send({
        organizationId: sourceOrg.id,
        reason: 'Organization self-routing attempt',
      });
    expect(sourceAdminManualRouteAttempt.status).toBe(403);

    const routeRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign-organization`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        organizationId: hunslowOrg.id,
        reason: 'Super admin routed report to Hunslow jurisdiction',
      });
    expect(routeRes.status).toBe(200);
    expect(json(routeRes).organizationId).toBe(sourceOrg.id);
    expect(json(routeRes).assignedOrganizationId).toBe(hunslowOrg.id);
    expect(json(routeRes).status).toBe(ReportStatus.ORG_REVIEW);

    const stored = await prisma.report.findUniqueOrThrow({
      where: { id: report.id },
    });
    expect(stored.organizationId).toBe(sourceOrg.id);
    expect(stored.assignedOrganizationId).toBe(hunslowOrg.id);

    const sourceReadAfterRoute = await request(app.getHttpServer())
      .get(`/api/report/${report.id}`)
      .set('Authorization', `Bearer ${sourceAdminToken}`);
    expect(sourceReadAfterRoute.status).toBe(200);

    const hunslowReadAfterRoute = await request(app.getHttpServer())
      .get(`/api/report/${report.id}`)
      .set('Authorization', `Bearer ${hunslowAdminToken}`);
    expect(hunslowReadAfterRoute.status).toBe(200);
    expect(json(hunslowReadAfterRoute).organizationId).toBe(sourceOrg.id);
    expect(json(hunslowReadAfterRoute).status).toBe(ReportStatus.ORG_REVIEW);

    const hunslowReviewQueue = await request(app.getHttpServer())
      .get('/api/report/organization/responsibility-review')
      .set('Authorization', `Bearer ${hunslowAdminToken}`);
    expect(hunslowReviewQueue.status).toBe(200);
    expect(
      json(hunslowReviewQueue).map((item: { id: string }) => item.id),
    ).toContain(report.id);

    const hunslowSummary = await request(app.getHttpServer())
      .get('/api/report/admin/dashboard/summary')
      .set('Authorization', `Bearer ${hunslowAdminToken}`);
    expect(hunslowSummary.status).toBe(200);
    expect(json(hunslowSummary).total).toBeGreaterThanOrEqual(1);
    expect(json(hunslowSummary).pending).toBeGreaterThanOrEqual(1);
    expect(
      json(hunslowSummary).awaitingOrganizationDecision,
    ).toBeGreaterThanOrEqual(1);

    const earlyAssign = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${hunslowAdminToken}`)
      .send({ providerId: hunslowProvider.id });
    expect(earlyAssign.status).toBe(403);
    expect(json(earlyAssign).message).toContain(
      'Report cannot be assigned in its current status',
    );

    const acceptRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/organization-accept`)
      .set('Authorization', `Bearer ${hunslowAdminToken}`)
      .send({ note: 'Accepted for Hunslow dispatch' });
    expect(acceptRes.status).toBe(200);
    expect(json(acceptRes).status).toBe(ReportStatus.PENDING);
    expect(json(acceptRes).organizationId).toBe(hunslowOrg.id);
    expect(json(acceptRes).assignedOrganizationId).toBe(hunslowOrg.id);

    const hunslowCandidates = await request(app.getHttpServer())
      .get(`/api/report/${report.id}/assignment-candidates`)
      .set('Authorization', `Bearer ${hunslowAdminToken}`);
    expect(hunslowCandidates.status).toBe(200);
    expect(
      json(hunslowCandidates).providers.map((item: { id: string }) => item.id),
    ).toContain(hunslowProvider.id);
    expect(
      json(hunslowCandidates).providers.map((item: { id: string }) => item.id),
    ).not.toContain(inactiveProvider.id);
    expect(
      json(hunslowCandidates).providers.map((item: { id: string }) => item.id),
    ).not.toContain(otherOrgProvider.id);
    expect(
      json(hunslowCandidates).providers.map((item: { id: string }) => item.id),
    ).not.toContain(revokedLinkedProvider.id);

    const inactiveAssign = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${hunslowAdminToken}`)
      .send({ providerId: inactiveProvider.id });
    expect(inactiveAssign.status).toBe(403);

    const revokedAssign = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${hunslowAdminToken}`)
      .send({ providerId: revokedLinkedProvider.id });
    expect(revokedAssign.status).toBe(403);

    const otherProviderAssign = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${hunslowAdminToken}`)
      .send({ providerId: otherOrgProvider.id });
    expect(otherProviderAssign.status).toBe(403);

    const assignRes = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${hunslowDispatchToken}`)
      .send({ providerId: hunslowProvider.id });
    expect(assignRes.status).toBe(200);
    expect(json(assignRes).status).toBe(ReportStatus.ASSIGNED);
    expect(json(assignRes).assignedProviderId).toBe(hunslowProvider.id);

    const duplicateAssign = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${hunslowAdminToken}`)
      .send({ providerId: hunslowProvider.id });
    expect(duplicateAssign.status).toBe(403);

    const providerToken = await signToken(hunslowProvider);
    const providerAccept = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: ReportStatus.IN_PROGRESS });
    expect(providerAccept.status).toBe(200);
    expect(json(providerAccept).status).toBe(ReportStatus.IN_PROGRESS);

    const assignedNotification = await prisma.notification.findFirst({
      where: {
        reportId: report.id,
        userId: hunslowProvider.id,
        type: 'assignment',
      },
    });
    expect(assignedNotification).toBeTruthy();

    const assignmentActivity =
      await prismaWithActivity.reportActivity.findFirst({
        where: {
          reportId: report.id,
          action: 'PROVIDER_ASSIGNED',
          providerId: hunslowProvider.id,
        },
      });
    expect(assignmentActivity).toBeTruthy();

    const otherRouteAttempt = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign-organization`)
      .set('Authorization', `Bearer ${otherAdminToken}`)
      .send({ organizationId: otherOrg.id, reason: 'Cross tenant attempt' });
    expect(otherRouteAttempt.status).toBe(403);

    const overrideReport = await createReport({
      title: 'WF ownership override report',
      organizationId: sourceOrg.id,
      citizenId: citizen.id,
      status: ReportStatus.TRIAGE,
    });
    const overrideRes = await request(app.getHttpServer())
      .patch(`/api/report/${overrideReport.id}/assign-organization`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        organizationId: hunslowOrg.id,
        reason: 'Governed platform ownership override',
        establishAuthoritativeOwnership: true,
      });
    expect(overrideRes.status).toBe(200);
    expect(json(overrideRes).status).toBe(ReportStatus.PENDING);
    expect(json(overrideRes).organizationId).toBe(hunslowOrg.id);
    expect(json(overrideRes).assignedOrganizationId).toBe(hunslowOrg.id);
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
      profileData: {
        secureZoneProviderCapabilities: [
          { id: 'civil_works', status: 'ACTIVE' },
        ],
      },
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
    createdReportIds.push(json(createRes).id);
    expect(json(createRes).status).toBe(ReportStatus.ORG_REVIEW);
    expect(json(createRes).organizationId).toBe(sourceOrg.id);
    expect(json(createRes).assignedOrganizationId).toBe(routedOrg.id);

    const routedAdminToken = await signToken(routedAdmin);
    const otherAdminToken = await signToken(otherAdmin);
    const routedRead = await request(app.getHttpServer())
      .get(`/api/report/${json(createRes).id}`)
      .set('Authorization', `Bearer ${routedAdminToken}`);
    expect(routedRead.status).toBe(200);

    const otherRead = await request(app.getHttpServer())
      .get(`/api/report/${json(createRes).id}`)
      .set('Authorization', `Bearer ${otherAdminToken}`);
    expect(otherRead.status).toBe(403);

    const routedQueue = await request(app.getHttpServer())
      .get('/api/report/organization/responsibility-review')
      .set('Authorization', `Bearer ${routedAdminToken}`);
    expect(routedQueue.status).toBe(200);
    expect(json(routedQueue).map((item: { id: string }) => item.id)).toContain(
      json(createRes).id,
    );

    const unrelatedQueue = await request(app.getHttpServer())
      .get('/api/report/organization/responsibility-review')
      .set('Authorization', `Bearer ${otherAdminToken}`);
    expect(unrelatedQueue.status).toBe(200);
    expect(
      json(unrelatedQueue).map((item: { id: string }) => item.id),
    ).not.toContain(json(createRes).id);

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
      profileData: {
        secureZoneProviderCapabilities: [
          { id: 'civil_works', status: 'ACTIVE' },
        ],
      },
    });
    await createUser({
      email: `wf-auto-amb-b-provider-${unique}@test.com`,
      fullName: 'Workflow Auto Ambiguous B Provider',
      role: UserRole.PROVIDER,
      organizationId: ambiguousOrgB.id,
      serviceCategories: [ambiguousCategory],
      coverageAreas: ['Jabi'],
      profileData: {
        secureZoneProviderCapabilities: [
          { id: 'civil_works', status: 'ACTIVE' },
        ],
      },
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
    createdReportIds.push(json(ambiguousRes).id);
    expect(json(ambiguousRes).status).toBe(ReportStatus.TRIAGE);
    expect(json(ambiguousRes).assignedOrganizationId).toBeNull();
    expect(json(ambiguousRes).responsibilityResolution).toMatchObject({
      outcome: 'AMBIGUOUS',
      reasonCode: 'MULTIPLE_ELIGIBLE_CANDIDATES',
    });
    expect(
      json(ambiguousRes).responsibilityResolution.proposedOrganizationId,
    ).toBeUndefined();

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
    createdReportIds.push(json(noMatchRes).id);
    expect(json(noMatchRes).status).toBe(ReportStatus.TRIAGE);
    expect(json(noMatchRes).assignedOrganizationId).toBeNull();
    expect(json(noMatchRes).responsibilityResolution).toMatchObject({
      outcome: 'UNMATCHED',
    });
    expect(
      json(noMatchRes).responsibilityResolution.proposedOrganizationId,
    ).toBeUndefined();

    const queueAfterUnresolved = await request(app.getHttpServer())
      .get('/api/report/organization/responsibility-review')
      .set('Authorization', `Bearer ${routedAdminToken}`);
    expect(queueAfterUnresolved.status).toBe(200);
    const unresolvedQueueIds = json(queueAfterUnresolved).map(
      (item: { id: string }) => item.id,
    );
    expect(unresolvedQueueIds).not.toContain(json(ambiguousRes).id);
    expect(unresolvedQueueIds).not.toContain(json(noMatchRes).id);

    const superAdmin = await createUser({
      email: `wf-auto-super-admin-${unique}@test.com`,
      fullName: 'Workflow Auto Super Admin',
      role: UserRole.SUPER_ADMIN,
    });
    const superAdminToken = await signToken(superAdmin);
    const manualRouteRes = await request(app.getHttpServer())
      .patch(`/api/report/${json(ambiguousRes).id}/assign-organization`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        organizationId: ambiguousOrgA.id,
        reason: 'Manual triage routing',
      });
    expect(manualRouteRes.status).toBe(200);
    expect(json(manualRouteRes).status).toBe(ReportStatus.ORG_REVIEW);
    expect(json(manualRouteRes).organizationId).toBe(sourceOrg.id);
    expect(json(manualRouteRes).assignedOrganizationId).toBe(ambiguousOrgA.id);

    const manualOverrideRes = await request(app.getHttpServer())
      .patch(`/api/report/${json(noMatchRes).id}/assign-organization`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        organizationId: ambiguousOrgA.id,
        reason: 'Emergency platform ownership override',
        overrideReadiness: true,
        establishAuthoritativeOwnership: true,
      });
    expect(manualOverrideRes.status).toBe(200);
    expect(json(manualOverrideRes).status).toBe(ReportStatus.PENDING);
    expect(json(manualOverrideRes).organizationId).toBe(ambiguousOrgA.id);
    expect(json(manualOverrideRes).assignedOrganizationId).toBe(
      ambiguousOrgA.id,
    );
  });

  it('routes a real citizen submission into organization review without Super Admin assignment', async () => {
    const unique = Date.now().toString(36);
    const category = `Road Infrastructure ${unique}`;
    const sourceOrg = await createOrganization(
      `Workflow Real Intake Source ${unique}`,
    );
    const routedOrg = await prisma.organization.create({
      data: {
        name: `Workflow Hunslow Intake ${unique}`,
        contactEmail: `wf-real-routed-${unique}@test.com`,
        state: 'Katsina',
        lga: 'Katsina',
        address: 'Katsina Township Road',
      },
    });
    createdOrgIds.push(routedOrg.id);
    const citizen = await createUser({
      email: `wf-real-citizen-${unique}@test.com`,
      fullName: 'Workflow Real Citizen',
      role: UserRole.CITIZEN,
      organizationId: sourceOrg.id,
    });
    const routedAdmin = await createUser({
      email: `wf-real-admin-${unique}@test.com`,
      fullName: 'Workflow Real Routed Admin',
      role: UserRole.ORG_ADMIN,
      organizationId: routedOrg.id,
    });
    const provider = await createUser({
      email: `wf-real-provider-${unique}@test.com`,
      fullName: 'Workflow Real Routed Provider',
      role: UserRole.PROVIDER,
      organizationId: routedOrg.id,
      serviceCategories: [category],
      coverageAreas: ['Katsina Township Road'],
      profileData: {
        secureZoneProviderCapabilities: [
          { id: 'civil_works', status: 'ACTIVE' },
        ],
      },
    });
    const superAdmin = await createUser({
      email: `wf-real-super-admin-${unique}@test.com`,
      fullName: 'Workflow Real Super Admin',
      role: UserRole.SUPER_ADMIN,
    });

    const citizenToken = await signToken(citizen);
    const routedAdminToken = await signToken(routedAdmin);
    const superAdminToken = await signToken(superAdmin);
    const createRes = await request(app.getHttpServer())
      .post('/api/report')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        title: 'WF Katsina Township Road Project',
        description: 'Road surface failure near township junction',
        category,
        location: 'Katsina Township Road',
        locationName: 'Katsina Township Road',
        locationLandmark: 'Township junction',
        latitude: 12.9891,
        longitude: 7.6006,
        locationAccuracy: 18,
        locationSource: 'DEVICE_GPS',
      });

    expect(createRes.status).toBe(201);
    createdReportIds.push(json(createRes).id);
    expect(json(createRes).status).toBe(ReportStatus.ORG_REVIEW);
    expect(json(createRes).organizationId).toBe(sourceOrg.id);
    expect(json(createRes).assignedOrganizationId).toBe(routedOrg.id);
    expect(json(createRes).locationName).toBe('Katsina Township Road');
    expect(json(createRes).latitude).toBe(12.9891);
    expect(json(createRes).responsibilityResolution).toMatchObject({
      outcome: 'MATCHED',
      eligibleCandidateCount: 1,
      proposedOrganizationId: routedOrg.id,
      reasonCode: 'MATCHED_DETERMINISTIC',
      report: {
        category,
        coordinates: { latitude: 12.9891, longitude: 7.6006 },
      },
    });
    expect(typeof json(createRes).responsibilityResolution.candidateCount).toBe(
      'number',
    );
    expect(
      typeof json(createRes).responsibilityResolution.report.normalizedCategory,
    ).toBe('string');
    expect(
      json(createRes).responsibilityResolution.report.location,
    ).toMatchObject({
      text: 'Katsina Township Road',
      name: 'Katsina Township Road',
      landmark: 'Township junction',
      source: 'DEVICE_GPS',
    });
    expect(
      json(createRes).responsibilityResolution.candidateCount,
    ).toBeGreaterThan(0);
    expect(json(createRes).responsibilityResolution.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: routedOrg.id,
          organizationStatus: 'ACTIVE',
          coverageAreas: ['Katsina Township Road'],
          eligible: true,
          reasons: [],
        }),
      ]),
    );

    const evidenceRes = await request(app.getHttpServer())
      .post(`/api/report/${json(createRes).id}/evidence`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        images: [0, 1, 2].map((index) => ({
          fileName: `citizen-${index}.png`,
          contentType: 'image/png',
          imageBase64: onePixelPngBase64,
          order: index,
        })),
      });
    expect(evidenceRes.status).toBe(201);
    expect(json(evidenceRes).evidenceItems).toHaveLength(3);

    const routeActivity = await prismaWithActivity.reportActivity.findFirst({
      where: {
        reportId: json(createRes).id,
        action: 'RESPONSIBILITY_RESOLUTION_ATTEMPTED',
      },
    });
    expect(routeActivity).toBeTruthy();
    if (!routeActivity) throw new Error('Expected route activity');
    expect(routeActivity.metadata).toMatchObject({
      responsibilityResolution: {
        outcome: 'MATCHED',
        proposedOrganizationId: routedOrg.id,
        reasonCode: 'MATCHED_DETERMINISTIC',
      },
    });

    const earlyAssign = await request(app.getHttpServer())
      .patch(`/api/report/${json(createRes).id}/assign`)
      .set('Authorization', `Bearer ${routedAdminToken}`)
      .send({ providerId: provider.id });
    expect(earlyAssign.status).toBe(403);

    const queueRes = await request(app.getHttpServer())
      .get('/api/report/organization/responsibility-review')
      .set('Authorization', `Bearer ${routedAdminToken}`);
    expect(queueRes.status).toBe(200);
    expect(json(queueRes).map((item: { id: string }) => item.id)).toContain(
      json(createRes).id,
    );
    const queuedReports = json(queueRes) as unknown as Array<
      Record<string, unknown>
    >;
    const queuedReport = queuedReports.find(
      (item) => item.id === json(createRes).id,
    );
    expect(queuedReport).toMatchObject({
      evidenceCount: 3,
      resolverConfidence: 'HIGH',
      responsibilityReason: 'MATCHED_DETERMINISTIC',
      diagnosticsAvailable: true,
      eligibleForResponsibilityReview: true,
      eligibilityReason: 'MATCHED_PROPOSED_ORGANIZATION',
      queueOrganizationId: routedOrg.id,
      dispatchAllowed: false,
      responsibilityResolution: {
        outcome: 'MATCHED',
        proposedOrganizationId: routedOrg.id,
        reasonCode: 'MATCHED_DETERMINISTIC',
        report: {
          coordinates: { latitude: 12.9891, longitude: 7.6006 },
          location: { source: 'DEVICE_GPS' },
        },
      },
    });

    const diagnosticsRes = await request(app.getHttpServer())
      .get(`/api/report/admin/responsibility-diagnostics/${json(createRes).id}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(diagnosticsRes.status).toBe(200);
    const diagnosticsBody = json(diagnosticsRes) as Record<string, unknown>;
    expect(typeof diagnosticsBody.candidateCount).toBe('number');
    expect(json(diagnosticsRes)).toMatchObject({
      reportId: json(createRes).id,
      status: ReportStatus.ORG_REVIEW,
      organizationId: sourceOrg.id,
      assignedOrganizationId: routedOrg.id,
      resolverOutcome: 'MATCHED',
      resolverReasonCode: 'MATCHED_DETERMINISTIC',
      eligibleCandidateCount: 1,
      proposedOrganizationId: routedOrg.id,
      eligibleForResponsibilityReview: true,
      eligibilityReason: 'MATCHED_PROPOSED_ORGANIZATION',
      queueOrganizationId: routedOrg.id,
      dispatchAllowed: false,
      manualOverrideOccurred: false,
      diagnosticsAvailable: true,
    });

    const acceptRes = await request(app.getHttpServer())
      .patch(`/api/report/${json(createRes).id}/organization-accept`)
      .set('Authorization', `Bearer ${routedAdminToken}`)
      .send({ note: 'Accepted by responsible road authority.' });
    expect(acceptRes.status).toBe(200);
    expect(json(acceptRes).status).toBe(ReportStatus.PENDING);
    expect(json(acceptRes).organizationId).toBe(routedOrg.id);
    expect(json(acceptRes).assignedOrganizationId).toBe(routedOrg.id);

    const acceptedDiagnostics = await request(app.getHttpServer())
      .get(`/api/report/admin/responsibility-diagnostics/${json(createRes).id}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(acceptedDiagnostics.status).toBe(200);
    expect(json(acceptedDiagnostics)).toMatchObject({
      eligibleForResponsibilityReview: false,
      eligibilityReason: 'ACCEPTED_ALREADY',
      dispatchAllowed: true,
      manualOverrideOccurred: false,
    });

    const acceptedActivity = await prismaWithActivity.reportActivity.findFirst({
      where: {
        reportId: json(createRes).id,
        action: 'ORGANIZATION_ACCEPTED_REPORT',
      },
    });
    expect(acceptedActivity).toBeTruthy();
    expect(
      await prisma.notification.findFirst({
        where: {
          reportId: json(createRes).id,
          userId: citizen.id,
          type: 'organization_report_accepted',
        },
      }),
    ).toBeTruthy();
    expect(
      await prisma.notification.findFirst({
        where: {
          reportId: json(createRes).id,
          userId: routedAdmin.id,
          type: 'organization_report_accepted',
        },
      }),
    ).toBeTruthy();

    const assignRes = await request(app.getHttpServer())
      .patch(`/api/report/${json(createRes).id}/assign`)
      .set('Authorization', `Bearer ${routedAdminToken}`)
      .send({ providerId: provider.id });
    expect(assignRes.status).toBe(200);
    expect(json(assignRes).status).toBe(ReportStatus.ASSIGNED);
  });

  it('returns legacy responsibility queue items with truthful diagnostic fallback and stable pagination', async () => {
    const unique = Date.now().toString(36);
    const org = await createOrganization(`Workflow Legacy Review ${unique}`);
    const otherOrg = await createOrganization(
      `Workflow Legacy Other ${unique}`,
    );
    const admin = await createUser({
      email: `wf-legacy-admin-${unique}@test.com`,
      fullName: 'Workflow Legacy Admin',
      role: UserRole.ORG_ADMIN,
      organizationId: org.id,
    });
    const otherAdmin = await createUser({
      email: `wf-legacy-other-admin-${unique}@test.com`,
      fullName: 'Workflow Legacy Other Admin',
      role: UserRole.ORG_ADMIN,
      organizationId: otherOrg.id,
    });
    const citizen = await createUser({
      email: `wf-legacy-citizen-${unique}@test.com`,
      fullName: 'Workflow Legacy Citizen',
      role: UserRole.CITIZEN,
      organizationId: otherOrg.id,
    });

    const older = await createReport({
      title: `WF legacy older ${unique}`,
      organizationId: otherOrg.id,
      citizenId: citizen.id,
      status: ReportStatus.ORG_REVIEW,
      assignedOrganizationId: org.id,
      organizationAssignedAt: new Date(Date.now() - 60_000),
    });
    const newer = await createReport({
      title: `WF legacy newer ${unique}`,
      organizationId: otherOrg.id,
      citizenId: citizen.id,
      status: ReportStatus.ORG_REVIEW,
      assignedOrganizationId: org.id,
      organizationAssignedAt: new Date(),
    });
    createdReportIds.push(older.id, newer.id);

    const adminToken = await signToken(admin);
    const queueRes = await request(app.getHttpServer())
      .get('/api/report/organization/responsibility-review?limit=1&offset=0')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(queueRes.status).toBe(200);
    expect(json(queueRes)).toHaveLength(1);
    expect(json(queueRes)[0]).toMatchObject({
      id: newer.id,
      diagnosticsAvailable: false,
      eligibleForResponsibilityReview: true,
      eligibilityReason: 'MATCHED_PROPOSED_ORGANIZATION',
      queueOrganizationId: org.id,
    });

    const secondPage = await request(app.getHttpServer())
      .get('/api/report/organization/responsibility-review?limit=1&offset=1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(secondPage.status).toBe(200);
    expect(json(secondPage).map((item: { id: string }) => item.id)).toContain(
      older.id,
    );

    const otherQueue = await request(app.getHttpServer())
      .get('/api/report/organization/responsibility-review')
      .set('Authorization', `Bearer ${await signToken(otherAdmin)}`);
    expect(otherQueue.status).toBe(200);
    expect(
      json(otherQueue).map((item: { id: string }) => item.id),
    ).not.toContain(newer.id);
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
    expect(json(rejectRes).status).toBe(ReportStatus.TRIAGE);
    expect(json(rejectRes).assignedOrganizationId).toBeNull();
    expect(json(rejectRes).lastAssignmentReason).toBe(
      'Outside Hunslow jurisdiction',
    );

    const orgReports = await request(app.getHttpServer())
      .get('/api/report')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(orgReports.status).toBe(200);
    expect(
      json(orgReports).map((item: { id: string }) => item.id),
    ).not.toContain(report.id);

    const staleAssign = await request(app.getHttpServer())
      .patch(`/api/report/${report.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ providerId: provider.id });
    expect(staleAssign.status).toBe(403);
  });
});
