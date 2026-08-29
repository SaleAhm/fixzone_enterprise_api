import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { PlatformEntitlementPlan, UserRole } from '@prisma/client';
import { TrustService } from '../src/trust/trust.service';

type LoginResponse = { accessToken: string };
type IdentityResponse = {
  secureZoneId: string;
  identityVerificationStatus: string;
  identityVerificationLevel?: number;
  trustScore?: number;
  entitlement: { plan: string };
};
type KycResponse = {
  id: string;
  status: string;
  rejectionReason?: string;
};
type AuditItem = { action: string };
type EvidenceItem = {
  relatedEntityId: string;
  metadata?: { source?: string };
};
type EntitlementsResponse = {
  canOpenDispute: boolean;
  guardPreview: { allowed: boolean };
};
type DisputeResponse = {
  id: string;
  caseNumber: string;
  status: string;
  assignedAdminId?: string | null;
  messages?: { message: string }[];
};
type NotificationItem = { type: string };
type LoginHistoryItem = { success: boolean; deviceLabel?: string | null };
type EnforcementSettingsResponse = {
  requireVerifiedIdentityForDisputes: boolean;
};
type TrustSummaryResponse = {
  pendingKyc: number;
  rejectedKyc: number;
  recentComplianceEvents: number;
};

describe('Trust & Identity Foundation (e2e)', () => {
  jest.setTimeout(30000);

  let app: INestApplication;
  let prisma: PrismaService;
  let trustService: TrustService;
  let organizationId: string;
  let otherOrganizationId: string;
  let citizenToken: string;
  let adminToken: string;
  let otherAdminToken: string;
  let providerToken: string;
  let citizenId: string;
  let adminId: string;
  let providerId: string;
  let previousEnterpriseFoundations: string | undefined;
  let previousInvestigation: string | undefined;
  let previousEvidenceExport: string | undefined;

  beforeAll(async () => {
    previousEnterpriseFoundations =
      process.env.SECUREZONE_ENTERPRISE_FOUNDATIONS_ENABLED;
    previousInvestigation = process.env.SECUREZONE_INVESTIGATION_ENABLED;
    previousEvidenceExport =
      process.env.SECUREZONE_EVIDENCE_EXPORT_WORKFLOWS_ENABLED;
    process.env.SECUREZONE_ENTERPRISE_FOUNDATIONS_ENABLED = 'true';
    process.env.SECUREZONE_INVESTIGATION_ENABLED = 'true';
    process.env.SECUREZONE_EVIDENCE_EXPORT_WORKFLOWS_ENABLED = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    trustService = moduleFixture.get(TrustService);

    await cleanup();
    const org = await prisma.organization.create({
      data: {
        name: 'Trust Test Organization',
        enabledModules: ['maintenance', 'investigation', 'evidence_export'],
      },
    });
    const otherOrg = await prisma.organization.create({
      data: {
        name: 'Trust Other Organization',
        enabledModules: ['maintenance', 'investigation', 'evidence_export'],
      },
    });
    organizationId = org.id;
    otherOrganizationId = otherOrg.id;

    const citizen = await createUser({
      email: 'trust-citizen@test.com',
      fullName: 'Trust Citizen',
      role: UserRole.CITIZEN,
      organizationId,
    });
    citizenId = citizen.id;

    const admin = await createUser({
      email: 'trust-admin@test.com',
      fullName: 'Trust Admin',
      role: UserRole.ORG_ADMIN,
      organizationId,
    });
    adminId = admin.id;
    const provider = await createUser({
      email: 'trust-provider@test.com',
      fullName: 'Trust Provider',
      role: UserRole.PROVIDER,
      organizationId,
    });
    providerId = provider.id;
    await createUser({
      email: 'trust-other-admin@test.com',
      fullName: 'Trust Other Admin',
      role: UserRole.ORG_ADMIN,
      organizationId: otherOrganizationId,
    });

    citizenToken = await login('trust-citizen@test.com');
    adminToken = await login('trust-admin@test.com');
    otherAdminToken = await login('trust-other-admin@test.com');
    providerToken = await login('trust-provider@test.com');
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
    restoreEnv(
      'SECUREZONE_ENTERPRISE_FOUNDATIONS_ENABLED',
      previousEnterpriseFoundations,
    );
    restoreEnv('SECUREZONE_INVESTIGATION_ENABLED', previousInvestigation);
    restoreEnv(
      'SECUREZONE_EVIDENCE_EXPORT_WORKFLOWS_ENABLED',
      previousEvidenceExport,
    );
  });

  async function createUser(data: {
    email: string;
    fullName: string;
    role: UserRole;
    organizationId?: string | null;
  }) {
    return prisma.user.create({
      data: {
        ...data,
        passwordHash: await bcrypt.hash('Password123!', 10),
      },
    });
  }

  async function login(email: string) {
    const res = await request(httpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Password123!' });
    expect(res.status).toBe(201);
    return responseBody<LoginResponse>(res).accessToken;
  }

  async function cleanup() {
    const users = await prisma.user.findMany({
      where: {
        email: {
          in: [
            'trust-citizen@test.com',
            'trust-admin@test.com',
            'trust-other-admin@test.com',
            'trust-provider@test.com',
          ],
        },
      },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);

    if (userIds.length) {
      await prisma.notification.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.complianceAuditLog.deleteMany({
        where: {
          OR: [{ actorId: { in: userIds } }, { entityId: { in: userIds } }],
        },
      });
      await prisma.loginHistory.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.disputeMessage.deleteMany({
        where: {
          OR: [
            { authorId: { in: userIds } },
            { dispute: { openedById: { in: userIds } } },
          ],
        },
      });
      await prisma.disputeCase.deleteMany({
        where: {
          OR: [
            { openedById: { in: userIds } },
            { againstUserId: { in: userIds } },
          ],
        },
      });
      await prisma.evidenceRecord.deleteMany({
        where: {
          OR: [
            { ownerUserId: { in: userIds } },
            { uploadedById: { in: userIds } },
          ],
        },
      });
      await prisma.reportActivity.deleteMany({
        where: { actorUserId: { in: userIds } },
      });
      await prisma.report.deleteMany({
        where: {
          OR: [
            { citizenId: { in: userIds } },
            { assignedProviderId: { in: userIds } },
          ],
        },
      });
      await prisma.kycSubmission.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.userEntitlement.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.platformSetting.deleteMany({
      where: { key: { startsWith: 'trust_enforcement:' } },
    });
    await prisma.organization.deleteMany({
      where: {
        name: { in: ['Trust Test Organization', 'Trust Other Organization'] },
      },
    });
  }

  function restoreEnv(name: string, value: string | undefined) {
    if (value === undefined) {
      delete process.env[name];
      return;
    }
    process.env[name] = value;
  }

  function httpServer(): Parameters<typeof request>[0] {
    return app.getHttpServer() as Parameters<typeof request>[0];
  }

  function responseBody<T>(res: request.Response): T {
    return res.body as T;
  }

  it('returns and backfills SecureZone identity for the current user', async () => {
    const res = await request(httpServer())
      .get('/api/identity/me')
      .set('Authorization', `Bearer ${citizenToken}`);

    const body = responseBody<IdentityResponse>(res);
    expect(res.status).toBe(200);
    expect(body.secureZoneId).toMatch(/^SZ-\d{4}-\d{6}$/);
    expect(body.identityVerificationStatus).toBe('UNVERIFIED');
    expect(body.entitlement.plan).toBe('FREE');
  });

  it('submits KYC and allows same-organization admin review', async () => {
    const submit = await request(httpServer())
      .post('/api/identity/kyc/submit')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        submissionType: 'GOVERNMENT_ID',
        documentUrl: 'https://records.securezone.test/id.png',
      });
    const submitBody = responseBody<KycResponse>(submit);

    expect(submit.status).toBe(201);
    expect(submitBody.status).toBe('SUBMITTED');

    const blocked = await request(httpServer())
      .post(`/api/admin/identity/kyc-submissions/${submitBody.id}/review`)
      .set('Authorization', `Bearer ${otherAdminToken}`)
      .send({ status: 'APPROVED' });
    expect(blocked.status).toBe(403);

    const approved = await request(httpServer())
      .post(`/api/admin/identity/kyc-submissions/${submitBody.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APPROVED' });
    const approvedBody = responseBody<KycResponse>(approved);
    expect(approved.status).toBe(201);
    expect(approvedBody.status).toBe('APPROVED');

    const identity = await prisma.user.findUnique({ where: { id: citizenId } });
    expect(identity?.identityVerificationStatus).toBe('ID_VERIFIED');
    expect(identity?.identityVerificationLevel).toBeGreaterThanOrEqual(3);
    expect(identity?.trustScore).toBeGreaterThanOrEqual(10);

    const audit = await request(httpServer())
      .get('/api/admin/audit/compliance?action=KYC')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(audit.status).toBe(200);
    expect(
      responseBody<AuditItem[]>(audit).some(
        (item) => item.action === 'KYC Reviewed',
      ),
    ).toBe(true);
  });

  it('shows KYC rejection reason to the submitting user', async () => {
    const submit = await request(httpServer())
      .post('/api/identity/kyc/submit')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        submissionType: 'ADDRESS_PROOF',
        documentUrl: 'https://records.securezone.test/address.png',
      });
    expect(submit.status).toBe(201);
    const submitBody = responseBody<KycResponse>(submit);

    const rejected = await request(httpServer())
      .post(`/api/admin/identity/kyc-submissions/${submitBody.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        status: 'REJECTED',
        rejectionReason: 'Address document is unreadable.',
      });
    const rejectedBody = responseBody<KycResponse>(rejected);
    expect(rejected.status).toBe(201);
    expect(rejectedBody.rejectionReason).toBe(
      'Address document is unreadable.',
    );

    const mine = await request(httpServer())
      .get('/api/identity/kyc/my-submissions')
      .set('Authorization', `Bearer ${citizenToken}`);
    expect(mine.status).toBe(200);
    expect(
      responseBody<KycResponse[]>(mine).some(
        (item) =>
          item.status === 'REJECTED' &&
          item.rejectionReason === 'Address document is unreadable.',
      ),
    ).toBe(true);
  });

  it('creates scoped evidence records and entitlements', async () => {
    const evidence = await request(httpServer())
      .post('/api/records/evidence')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        relatedEntityType: 'USER',
        relatedEntityId: citizenId,
        fileUrl: 'https://records.securezone.test/evidence.pdf',
        fileType: 'application/pdf',
        description: 'Identity evidence',
      });
    expect(evidence.status).toBe(201);

    const list = await request(httpServer())
      .get('/api/records/evidence')
      .set('Authorization', `Bearer ${citizenToken}`);
    expect(list.status).toBe(200);
    expect(responseBody<EvidenceItem[]>(list).length).toBeGreaterThanOrEqual(1);

    const entitlements = await request(httpServer())
      .get('/api/entitlements/me')
      .set('Authorization', `Bearer ${citizenToken}`);
    const entitlementsBody = responseBody<EntitlementsResponse>(entitlements);
    expect(entitlements.status).toBe(200);
    expect(entitlementsBody.canOpenDispute).toBe(true);
    expect(entitlementsBody.guardPreview.allowed).toBe(true);
  });

  it('connects report evidence to the Records Vault and protects private records', async () => {
    const report = await prisma.report.create({
      data: {
        title: 'Trust evidence report',
        description: 'Report with citizen and provider evidence',
        category: 'Road',
        location: 'Trust Street',
        organizationId,
        citizenId,
        assignedProviderId: providerId,
        evidenceImageUrl: 'https://records.securezone.test/report-before.jpg',
        completionImageUrl: 'https://records.securezone.test/report-after.jpg',
      },
    });

    const linkedEvidence = await request(httpServer())
      .get('/api/records/evidence')
      .set('Authorization', `Bearer ${citizenToken}`);
    expect(linkedEvidence.status).toBe(200);
    expect(
      responseBody<EvidenceItem[]>(linkedEvidence).some(
        (item) =>
          item.relatedEntityId === report.id &&
          item.metadata?.source === 'report.evidenceImageUrl',
      ),
    ).toBe(true);

    const blocked = await request(httpServer())
      .post('/api/records/evidence')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        relatedEntityType: 'USER',
        relatedEntityId: providerId,
        fileUrl: 'https://records.securezone.test/private.pdf',
      });
    expect(blocked.status).toBe(403);
  });

  it('opens disputes, supports messages, and records login history', async () => {
    const dispute = await request(httpServer())
      .post('/api/disputes')
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({
        relatedEntityType: 'REPORT',
        relatedEntityId: 'trust-report-1',
        title: 'Service quality review',
        description:
          'The completed work requires additional administrative review.',
      });

    const disputeBody = responseBody<DisputeResponse>(dispute);
    expect(dispute.status).toBe(201);
    expect(disputeBody.caseNumber).toMatch(/^SZ-CASE-/);

    const citizenNotifications = await request(httpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${citizenToken}`);
    expect(citizenNotifications.status).toBe(200);
    expect(
      responseBody<NotificationItem[]>(citizenNotifications).some(
        (item) => item.type === 'dispute_opened',
      ),
    ).toBe(true);

    const message = await request(httpServer())
      .post(`/api/disputes/${disputeBody.id}/message`)
      .set('Authorization', `Bearer ${citizenToken}`)
      .send({ message: 'Adding supporting context for the review.' });
    expect(message.status).toBe(201);

    const history = await request(httpServer())
      .get('/api/security/me/login-history')
      .set('Authorization', `Bearer ${citizenToken}`);
    const historyBody = responseBody<LoginHistoryItem[]>(history);
    expect(history.status).toBe(200);
    expect(historyBody.some((item) => item.success === true)).toBe(true);
    expect(historyBody[0].deviceLabel).toBeDefined();

    const update = await request(httpServer())
      .post(`/api/admin/disputes/${disputeBody.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        status: 'UNDER_REVIEW',
        resolutionSummary: 'Admin has started formal review.',
      });
    expect(update.status).toBe(201);

    const assignBlocked = await request(httpServer())
      .post(`/api/admin/disputes/${disputeBody.id}/assign`)
      .set('Authorization', `Bearer ${otherAdminToken}`)
      .send({ assignedAdminId: adminId });
    expect(assignBlocked.status).toBe(403);

    const assigned = await request(httpServer())
      .post(`/api/admin/disputes/${disputeBody.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        assignedAdminId: adminId,
        note: 'Assigned to Trust Admin for review.',
      });
    const assignedBody = responseBody<DisputeResponse>(assigned);
    expect(assigned.status).toBe(201);
    expect(assignedBody.assignedAdminId).toBe(adminId);

    const escalated = await request(httpServer())
      .post(`/api/admin/disputes/${disputeBody.id}/escalate`)
      .set('Authorization', `Bearer ${adminToken}`);
    const escalatedBody = responseBody<DisputeResponse>(escalated);
    expect(escalated.status).toBe(201);
    expect(escalatedBody.status).toBe('ESCALATED');

    const assignedFilter = await request(httpServer())
      .get('/api/admin/disputes?assigned=assigned&search=Service')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(assignedFilter.status).toBe(200);
    expect(
      responseBody<DisputeResponse[]>(assignedFilter).some(
        (item) => item.id === disputeBody.id,
      ),
    ).toBe(true);

    const detail = await request(httpServer())
      .get(`/api/disputes/${disputeBody.id}`)
      .set('Authorization', `Bearer ${citizenToken}`);
    expect(
      responseBody<DisputeResponse>(detail).messages?.some(
        (item) => item.message === 'Admin has started formal review.',
      ),
    ).toBe(true);

    const adminNotifications = await request(httpServer())
      .get('/api/notifications')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(
      responseBody<NotificationItem[]>(adminNotifications).some(
        (item) =>
          item.type === 'dispute_assigned' || item.type === 'dispute_update',
      ),
    ).toBe(true);
  });

  it('applies enforcement toggles without breaking default workflows', async () => {
    const defaults = await request(httpServer())
      .get('/api/admin/trust/enforcement-settings')
      .set('Authorization', `Bearer ${adminToken}`);
    const defaultsBody = responseBody<EnforcementSettingsResponse>(defaults);
    expect(defaults.status).toBe(200);
    expect(defaultsBody.requireVerifiedIdentityForDisputes).toBe(false);

    const updated = await request(httpServer())
      .post('/api/admin/trust/enforcement-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        requireVerifiedIdentityForDisputes: true,
        requireVerifiedIdentityForEvidenceUpload: true,
        requireVerifiedIdentityForProviderJobAcceptance: true,
        requireEntitlementPlanForPriorityWorkflows: true,
        requiredPriorityPlan: 'ENTERPRISE',
      });
    const updatedBody = responseBody<EnforcementSettingsResponse>(updated);
    expect(updated.status).toBe(201);
    expect(updatedBody.requireVerifiedIdentityForDisputes).toBe(true);

    const blockedDispute = await request(httpServer())
      .post('/api/disputes')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        relatedEntityType: 'USER',
        relatedEntityId: providerId,
        title: 'Provider blocked dispute',
        description:
          'This should be blocked while strict Trust enforcement is enabled.',
      });
    expect(blockedDispute.status).toBe(403);

    const blockedEvidence = await request(httpServer())
      .post('/api/records/evidence')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        relatedEntityType: 'USER',
        relatedEntityId: providerId,
        fileUrl: 'https://records.securezone.test/provider-evidence.pdf',
      });
    expect(blockedEvidence.status).toBe(403);

    await request(httpServer())
      .post('/api/admin/trust/enforcement-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        requireVerifiedIdentityForDisputes: false,
        requireVerifiedIdentityForEvidenceUpload: false,
        requireVerifiedIdentityForProviderJobAcceptance: false,
        requireEntitlementPlanForPriorityWorkflows: false,
        requiredPriorityPlan: 'FREE',
      })
      .expect(201);
  });

  it('summarizes admin trust operations and prepares entitlement checks', async () => {
    await request(httpServer())
      .post('/api/auth/login')
      .set('User-Agent', 'Mozilla/5.0 Windows Chrome/120')
      .send({ email: 'trust-citizen@test.com', password: 'bad-password' })
      .expect(401);

    const summary = await request(httpServer())
      .get('/api/admin/trust/summary')
      .set('Authorization', `Bearer ${adminToken}`);
    const summaryBody = responseBody<TrustSummaryResponse>(summary);
    expect(summary.status).toBe(200);
    expect(summaryBody.pendingKyc).toBeGreaterThanOrEqual(0);
    expect(summaryBody.rejectedKyc).toBeGreaterThanOrEqual(1);
    expect(summaryBody.recentComplianceEvents).toBeGreaterThanOrEqual(1);

    const allowed = await trustService.checkAccessRequirements(
      {
        id: citizenId,
        role: UserRole.CITIZEN,
        organizationId,
      },
      {
        requiredVerificationLevel: 3,
        requiredPlan: PlatformEntitlementPlan.FREE,
        organizationId,
      },
    );
    expect(allowed.allowed).toBe(true);

    const blocked = await trustService.checkAccessRequirements(
      {
        id: citizenId,
        role: UserRole.CITIZEN,
        organizationId,
      },
      {
        requiredVerificationLevel: 7,
        requiredPlan: PlatformEntitlementPlan.ENTERPRISE,
        organizationId: otherOrganizationId,
      },
    );
    expect(blocked.allowed).toBe(false);
    expect(blocked.organizationAllowed).toBe(false);
    expect(blocked.verificationAllowed).toBe(false);
  });
});
