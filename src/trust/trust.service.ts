import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DisputePriority,
  DisputeStatus,
  EvidenceRelatedEntityType,
  IdentityType,
  IdentityVerificationStatus,
  KycSubmissionStatus,
  PlatformEntitlementPlan,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { ReviewKycDto } from './dto/review-kyc.dto';
import { CreateEvidenceDto } from './dto/create-evidence.dto';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { CreateDisputeMessageDto } from './dto/create-dispute-message.dto';
import { UpdateDisputeStatusDto } from './dto/update-dispute-status.dto';
import { AssignDisputeDto } from './dto/assign-dispute.dto';
import { TrustEnforcementSettingsDto } from './dto/trust-enforcement-settings.dto';

export type TrustUser = {
  id: string;
  role: UserRole;
  organizationId?: string | null;
  email?: string | null;
  fullName?: string | null;
};

export type EntitlementRequirements = {
  requiredVerificationLevel?: number;
  requiredPlan?: PlatformEntitlementPlan;
  organizationId?: string | null;
};

type TrustEnforcementSettings = {
  requireVerifiedIdentityForDisputes: boolean;
  requireVerifiedIdentityForProviderJobAcceptance: boolean;
  requireVerifiedIdentityForEvidenceUpload: boolean;
  requireEntitlementPlanForPriorityWorkflows: boolean;
  requiredPriorityPlan: PlatformEntitlementPlan;
};

@Injectable()
export class TrustService {
  private readonly enforcementSettingPrefix = 'trust_enforcement';

  constructor(private readonly prisma: PrismaService) {}

  async getIdentityMe(user: TrustUser) {
    const identity = await this.ensureIdentity(user.id);
    const entitlement = await this.ensureEntitlement(user.id);
    const recentKyc = await this.prisma.kycSubmission.findMany({
      where: { userId: user.id },
      orderBy: { submittedAt: 'desc' },
      take: 5,
    });

    return {
      secureZoneId: identity.secureZoneId,
      fullName: identity.fullName,
      email: identity.email,
      phone: identity.phone,
      role: identity.role,
      organizationId: identity.organizationId,
      identityVerificationStatus: identity.identityVerificationStatus,
      identityVerificationLevel: identity.identityVerificationLevel,
      trustScore: identity.trustScore,
      identityType: identity.identityType,
      verificationEvents: {
        phoneVerifiedAt: identity.phoneVerifiedAt,
        emailVerifiedAt: identity.emailVerifiedAt,
        idVerifiedAt: identity.idVerifiedAt,
        faceVerifiedAt: identity.faceVerifiedAt,
        addressVerifiedAt: identity.addressVerifiedAt,
        businessVerifiedAt: identity.businessVerifiedAt,
        enterpriseVerifiedAt: identity.enterpriseVerifiedAt,
      },
      entitlement,
      recentKyc,
    };
  }

  async submitKyc(user: TrustUser, dto: SubmitKycDto) {
    await this.ensureIdentity(user.id);
    const submission = await this.prisma.kycSubmission.create({
      data: {
        userId: user.id,
        submissionType: dto.submissionType,
        status: KycSubmissionStatus.SUBMITTED,
        documentUrl: dto.documentUrl?.trim() || null,
        evidenceFileRef: dto.evidenceFileRef?.trim() || null,
        metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    await this.audit(user, 'KYC Submitted', 'KycSubmission', submission.id, {
      submissionType: submission.submissionType,
    });
    return submission;
  }

  getMyKycSubmissions(user: TrustUser) {
    return this.prisma.kycSubmission.findMany({
      where: { userId: user.id },
      orderBy: { submittedAt: 'desc' },
    });
  }

  async getAdminKycSubmissions(user: TrustUser) {
    return this.prisma.kycSubmission.findMany({
      where: await this.userScopeWhere(user),
      include: {
        user: {
          select: {
            id: true,
            secureZoneId: true,
            fullName: true,
            email: true,
            phone: true,
            role: true,
            organizationId: true,
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });
  }

  async reviewKyc(user: TrustUser, id: string, dto: ReviewKycDto) {
    const submission = await this.prisma.kycSubmission.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!submission) throw new NotFoundException('KYC submission not found');
    this.assertCanAccessUser(user, submission.user);

    return this.prisma.$transaction(async (tx) => {
      const reviewed = await tx.kycSubmission.update({
        where: { id },
        data: {
          status: dto.status,
          reviewedAt: new Date(),
          reviewedById: user.id,
          rejectionReason:
            dto.status === KycSubmissionStatus.REJECTED
              ? dto.rejectionReason?.trim() || 'Rejected during review'
              : null,
        },
      });

      if (dto.status === KycSubmissionStatus.APPROVED) {
        await this.applyVerificationFromKyc(
          submission.userId,
          submission.submissionType,
          tx,
        );
      }

      await this.auditWithClient(
        tx,
        user,
        'KYC Reviewed',
        'KycSubmission',
        id,
        {
          status: dto.status,
          submissionType: submission.submissionType,
          reviewedUserId: submission.userId,
          rejectionReason: reviewed.rejectionReason,
        },
      );

      return reviewed;
    });
  }

  async getLoginHistory(user: TrustUser) {
    const history = await this.prisma.loginHistory.findMany({
      where: { userId: user.id },
      orderBy: { loginAt: 'desc' },
      take: 50,
    });
    return history.map((item) => ({
      ...item,
      deviceLabel: this.describeUserAgent(item.userAgent),
      ipAddress: item.ipAddress || 'Unknown IP',
    }));
  }

  async recordLogin(data: {
    userId?: string | null;
    email?: string | null;
    success: boolean;
    failureReason?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) {
    return this.prisma.loginHistory.create({
      data: {
        userId: data.userId ?? null,
        email: data.email?.toLowerCase().trim() || null,
        success: data.success,
        failureReason: data.failureReason ?? null,
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
      },
    });
  }

  async createEvidence(user: TrustUser, dto: CreateEvidenceDto) {
    await this.assertEnforcementAllows(user, 'evidence_upload');
    const scope = await this.resolveEvidenceScope(user, dto);
    const record = await this.prisma.evidenceRecord.create({
      data: {
        ownerUserId: scope.ownerUserId,
        organizationId: scope.organizationId,
        relatedEntityType: dto.relatedEntityType,
        relatedEntityId: dto.relatedEntityId,
        fileUrl: dto.fileUrl.trim(),
        fileType: dto.fileType?.trim() || null,
        uploadedById: user.id,
        description: dto.description?.trim() || null,
        metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
    await this.audit(user, 'Evidence Uploaded', 'EvidenceRecord', record.id, {
      relatedEntityType: record.relatedEntityType,
      relatedEntityId: record.relatedEntityId,
    });
    return record;
  }

  async listEvidence(user: TrustUser) {
    const records = await this.prisma.evidenceRecord.findMany({
      where: this.evidenceScopeWhere(user),
      orderBy: { uploadedAt: 'desc' },
      take: 200,
    });
    const reportEvidence = await this.listReportEvidence(user);
    return [...records, ...reportEvidence].sort((a, b) => {
      const left = new Date((a as any).uploadedAt ?? 0).getTime();
      const right = new Date((b as any).uploadedAt ?? 0).getTime();
      return right - left;
    });
  }

  async getEvidence(user: TrustUser, id: string) {
    const record = await this.prisma.evidenceRecord.findUnique({
      where: { id },
    });
    if (!record) throw new NotFoundException('Evidence record not found');
    if (!this.canAccessEvidence(user, record)) {
      throw new ForbiddenException(
        'Evidence record is not available to this account',
      );
    }
    await this.audit(user, 'Evidence Viewed', 'EvidenceRecord', id);
    return record;
  }

  async createDispute(user: TrustUser, dto: CreateDisputeDto) {
    await this.assertEnforcementAllows(user, 'open_dispute');
    const entitlement = await this.ensureEntitlement(user.id);
    if (!entitlement.canOpenDispute) {
      throw new ForbiddenException(
        'Dispute access is not enabled for this account',
      );
    }

    const dispute = await this.prisma.disputeCase.create({
      data: {
        caseNumber: await this.nextCaseNumber(),
        openedById: user.id,
        againstUserId: dto.againstUserId?.trim() || null,
        organizationId: user.organizationId ?? null,
        relatedEntityType: dto.relatedEntityType.trim(),
        relatedEntityId: dto.relatedEntityId.trim(),
        title: dto.title.trim(),
        description: dto.description.trim(),
        priority: dto.priority ?? 'MEDIUM',
      },
    });

    await this.prisma.disputeMessage.create({
      data: {
        disputeId: dispute.id,
        authorId: user.id,
        message: dto.description.trim(),
        metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    await this.audit(user, 'Dispute Opened', 'DisputeCase', dispute.id, {
      caseNumber: dispute.caseNumber,
      relatedEntityType: dispute.relatedEntityType,
      relatedEntityId: dispute.relatedEntityId,
    });
    await this.notifyDisputeOpened(dispute.id, user);
    return this.getDispute(user, dispute.id);
  }

  getMyDisputes(user: TrustUser) {
    return this.prisma.disputeCase.findMany({
      where: {
        OR: [{ openedById: user.id }, { againstUserId: user.id }],
      },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  getAdminDisputes(
    user: TrustUser,
    query: Record<string, string | undefined> = {},
  ) {
    const scope =
      user.role === UserRole.SUPER_ADMIN
        ? {}
        : { organizationId: user.organizationId ?? '__none__' };
    const assigned = query.assigned?.trim().toLowerCase();
    return this.prisma.disputeCase.findMany({
      where: {
        ...scope,
        ...(query.status ? { status: query.status as DisputeStatus } : {}),
        ...(assigned === 'assigned'
          ? { assignedAdminId: { not: null } }
          : assigned === 'unassigned'
            ? { assignedAdminId: null }
            : {}),
        ...(query.assignedAdminId
          ? { assignedAdminId: query.assignedAdminId }
          : {}),
        ...(query.search
          ? {
              OR: [
                { title: { contains: query.search, mode: 'insensitive' } },
                {
                  caseNumber: { contains: query.search, mode: 'insensitive' },
                },
              ],
            }
          : {}),
      },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async getDispute(user: TrustUser, id: string) {
    const dispute = await this.prisma.disputeCase.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (!this.canAccessDispute(user, dispute)) {
      throw new ForbiddenException('Dispute is not available to this account');
    }
    return dispute;
  }

  async addDisputeMessage(
    user: TrustUser,
    id: string,
    dto: CreateDisputeMessageDto,
  ) {
    const dispute = await this.getDispute(user, id);
    const message = await this.prisma.disputeMessage.create({
      data: {
        disputeId: dispute.id,
        authorId: user.id,
        message: dto.message.trim(),
      },
    });
    await this.audit(user, 'Dispute Message Added', 'DisputeCase', id);
    await this.notifyDisputeUpdated(id, 'Dispute message added', dto.message);
    return message;
  }

  async updateDisputeStatus(
    user: TrustUser,
    id: string,
    dto: UpdateDisputeStatusDto,
  ) {
    const dispute = await this.prisma.disputeCase.findUnique({ where: { id } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (!this.canAdminAccessOrganization(user, dispute.organizationId)) {
      throw new ForbiddenException(
        'Dispute is outside your organization scope',
      );
    }

    const terminalStatuses: DisputeStatus[] = [
      DisputeStatus.RESOLVED,
      DisputeStatus.REJECTED,
      DisputeStatus.CLOSED,
    ];
    const isClosed = terminalStatuses.includes(dto.status);

    const updated = await this.prisma.disputeCase.update({
      where: { id },
      data: {
        status: dto.status,
        resolutionSummary: dto.resolutionSummary?.trim() || null,
        closedAt: isClosed ? new Date() : null,
        closedById: isClosed ? user.id : null,
      },
    });
    if (dto.resolutionSummary?.trim()) {
      await this.prisma.disputeMessage.create({
        data: {
          disputeId: id,
          authorId: user.id,
          message: dto.resolutionSummary.trim(),
          metadata: {
            systemType: 'STATUS_NOTE',
            status: dto.status,
          },
        },
      });
    }
    await this.audit(user, 'Dispute Status Changed', 'DisputeCase', id, {
      status: dto.status,
      note: dto.resolutionSummary?.trim() || null,
    });
    await this.notifyDisputeUpdated(
      id,
      `Dispute status changed to ${dto.status.replace(/_/g, ' ')}`,
      dto.resolutionSummary?.trim() || 'The dispute status was updated.',
    );
    return updated;
  }

  async assignDispute(user: TrustUser, id: string, dto: AssignDisputeDto) {
    const dispute = await this.prisma.disputeCase.findUnique({ where: { id } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (!this.canAdminAccessOrganization(user, dispute.organizationId)) {
      throw new ForbiddenException(
        'Dispute is outside your organization scope',
      );
    }

    const assignee = await this.prisma.user.findUnique({
      where: { id: dto.assignedAdminId },
      select: {
        id: true,
        role: true,
        organizationId: true,
        accountStatus: true,
        fullName: true,
      },
    });
    if (!assignee || !this.isAdminRole(assignee.role)) {
      throw new NotFoundException('Admin assignee not found');
    }
    if (assignee.accountStatus !== 'ACTIVE') {
      throw new ForbiddenException('Admin assignee is not active');
    }
    if (!this.canAdminAccessOrganization(user, assignee.organizationId)) {
      throw new ForbiddenException(
        'Assignee is outside your organization scope',
      );
    }

    const updated = await this.prisma.disputeCase.update({
      where: { id },
      data: { assignedAdminId: assignee.id },
    });
    if (dto.note?.trim()) {
      await this.prisma.disputeMessage.create({
        data: {
          disputeId: id,
          authorId: user.id,
          message: dto.note.trim(),
          metadata: {
            systemType: 'ASSIGNMENT_NOTE',
            assignedAdminId: assignee.id,
          },
        },
      });
    }
    await this.audit(user, 'Dispute Assigned', 'DisputeCase', id, {
      assignedAdminId: assignee.id,
      assignedAdminName: assignee.fullName,
      note: dto.note?.trim() || null,
    });
    await this.createNotification({
      userId: assignee.id,
      type: 'dispute_assigned',
      title: 'Dispute assigned',
      message: `You have been assigned dispute ${dispute.caseNumber}.`,
    });
    await this.notifyDisputeUpdated(
      id,
      'Dispute assigned',
      `${assignee.fullName} has been assigned to review this dispute.`,
    );
    return updated;
  }

  async escalateDispute(user: TrustUser, id: string) {
    const dispute = await this.prisma.disputeCase.findUnique({ where: { id } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (!this.canAdminAccessOrganization(user, dispute.organizationId)) {
      throw new ForbiddenException(
        'Dispute is outside your organization scope',
      );
    }
    const updated = await this.prisma.disputeCase.update({
      where: { id },
      data: { status: DisputeStatus.ESCALATED, escalatedAt: new Date() },
    });
    await this.prisma.disputeMessage.create({
      data: {
        disputeId: id,
        authorId: user.id,
        message: 'This dispute has been escalated for priority review.',
        metadata: { systemType: 'ESCALATION' },
      },
    });
    await this.audit(user, 'Dispute Escalated', 'DisputeCase', id, {
      priority: dispute.priority,
    });
    await this.notifyDisputeUpdated(
      id,
      'Dispute escalated',
      'This dispute has been escalated for priority review.',
    );
    return updated;
  }

  async escalateOverdueDisputes(user: TrustUser) {
    if (!this.isAdminRole(user.role)) {
      throw new ForbiddenException('Dispute escalation is admin-only');
    }
    const olderThan = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const scope =
      user.role === UserRole.SUPER_ADMIN
        ? {}
        : { organizationId: user.organizationId ?? '__none__' };
    const disputes = await this.prisma.disputeCase.findMany({
      where: {
        ...scope,
        status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
        OR: [
          { priority: { in: [DisputePriority.HIGH, DisputePriority.URGENT] } },
          { createdAt: { lt: olderThan } },
        ],
      },
      select: { id: true },
      take: 100,
    });
    for (const dispute of disputes) {
      await this.escalateDispute(user, dispute.id);
    }
    return { escalated: disputes.length };
  }

  async getEntitlementsMe(user: TrustUser) {
    const identity = await this.ensureIdentity(user.id);
    const entitlement = await this.ensureEntitlement(user.id);
    return {
      plan: entitlement.plan,
      canAccessServiceModule: entitlement.canAccessServiceModule,
      canUsePremiumProvider: entitlement.canUsePremiumProvider,
      canOpenDispute: entitlement.canOpenDispute,
      canUploadEvidence: entitlement.canUploadEvidence,
      canUsePrioritySupport: entitlement.canUsePrioritySupport,
      requiredVerificationLevel: entitlement.requiredVerificationLevel,
      currentVerificationLevel: identity.identityVerificationLevel,
      guardPreview: await this.checkAccessRequirements(user, {}),
      message:
        'Verification protects the SecureZone ecosystem. Paid plans will unlock convenience, priority, business, and enterprise capabilities as payment adapters are enabled.',
    };
  }

  async checkAccessRequirements(
    user: TrustUser,
    requirements: EntitlementRequirements,
  ) {
    const identity = await this.ensureIdentity(user.id);
    const entitlement = await this.ensureEntitlement(user.id);
    const requiredVerificationLevel =
      requirements.requiredVerificationLevel ??
      entitlement.requiredVerificationLevel;
    const requiredPlan = requirements.requiredPlan;
    const organizationAllowed =
      !requirements.organizationId ||
      user.role === UserRole.SUPER_ADMIN ||
      user.organizationId === requirements.organizationId;
    const verificationAllowed =
      identity.identityVerificationLevel >= requiredVerificationLevel;
    const planAllowed =
      !requiredPlan ||
      this.planRank(entitlement.plan) >= this.planRank(requiredPlan);

    return {
      allowed:
        entitlement.canAccessServiceModule &&
        organizationAllowed &&
        verificationAllowed &&
        planAllowed,
      canAccessServiceModule: entitlement.canAccessServiceModule,
      organizationAllowed,
      verificationAllowed,
      planAllowed,
      currentVerificationLevel: identity.identityVerificationLevel,
      requiredVerificationLevel,
      currentPlan: entitlement.plan,
      requiredPlan: requiredPlan ?? null,
    };
  }

  async assertProviderJobAcceptanceAllowed(user: TrustUser) {
    await this.assertEnforcementAllows(user, 'provider_job_acceptance');
  }

  async getAdminTrustSummary(user: TrustUser) {
    if (!this.isAdminRole(user.role)) {
      throw new ForbiddenException(
        'Trust operations are restricted to administrators',
      );
    }
    const orgScope =
      user.role === UserRole.SUPER_ADMIN
        ? {}
        : { organizationId: user.organizationId ?? '__none__' };
    const userKycScope = await this.userScopeWhere(user);
    const [
      pendingKyc,
      rejectedKyc,
      openDisputes,
      escalatedDisputes,
      unassignedDisputes,
      evidenceRecords,
      recentComplianceEvents,
    ] = await Promise.all([
      this.prisma.kycSubmission.count({
        where: {
          ...userKycScope,
          status: {
            in: [
              KycSubmissionStatus.SUBMITTED,
              KycSubmissionStatus.UNDER_REVIEW,
            ],
          },
        },
      }),
      this.prisma.kycSubmission.count({
        where: { ...userKycScope, status: KycSubmissionStatus.REJECTED },
      }),
      this.prisma.disputeCase.count({
        where: {
          ...orgScope,
          status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
        },
      }),
      this.prisma.disputeCase.count({
        where: { ...orgScope, status: DisputeStatus.ESCALATED },
      }),
      this.prisma.disputeCase.count({
        where: {
          ...orgScope,
          assignedAdminId: null,
          status: {
            in: [
              DisputeStatus.OPEN,
              DisputeStatus.UNDER_REVIEW,
              DisputeStatus.ESCALATED,
            ],
          },
        },
      }),
      this.prisma.evidenceRecord.count({ where: orgScope }),
      this.prisma.complianceAuditLog.count({ where: orgScope }),
    ]);
    return {
      pendingKyc,
      rejectedKyc,
      openDisputes,
      escalatedDisputes,
      unassignedDisputes,
      evidenceRecords,
      recentComplianceEvents,
    };
  }

  async getEnforcementSettings(user: TrustUser) {
    return {
      ...(await this.readEnforcementSettings(user.organizationId ?? null)),
      organizationId: user.organizationId ?? null,
      blockingMode: 'non_blocking_by_default',
    };
  }

  async updateEnforcementSettings(
    user: TrustUser,
    dto: TrustEnforcementSettingsDto,
  ) {
    const current = await this.readEnforcementSettings(
      user.organizationId ?? null,
    );
    const next: TrustEnforcementSettings = {
      ...current,
      ...Object.fromEntries(
        Object.entries(dto).filter(([, value]) => value !== undefined),
      ),
      requiredPriorityPlan: this.parsePlan(
        dto.requiredPriorityPlan ?? current.requiredPriorityPlan,
      ),
    };
    await this.prisma.platformSetting.upsert({
      where: { key: this.enforcementSettingKey(user.organizationId ?? null) },
      create: {
        key: this.enforcementSettingKey(user.organizationId ?? null),
        value: next as unknown as Prisma.InputJsonValue,
      },
      update: { value: next as unknown as Prisma.InputJsonValue },
    });
    await this.audit(
      user,
      'Trust Enforcement Settings Updated',
      'PlatformSetting',
      this.enforcementSettingKey(user.organizationId ?? null),
      next,
    );
    return {
      ...next,
      organizationId: user.organizationId ?? null,
      blockingMode: 'configured',
    };
  }

  async listAuditLogs(
    user: TrustUser,
    query: Record<string, string | undefined>,
  ) {
    if (!this.isAdminRole(user.role)) {
      throw new ForbiddenException(
        'Audit logs are restricted to administrators',
      );
    }
    const where: Prisma.ComplianceAuditLogWhereInput = {
      ...(user.role === UserRole.SUPER_ADMIN
        ? {}
        : { organizationId: user.organizationId ?? '__none__' }),
      ...(query.action
        ? { action: { contains: query.action, mode: 'insensitive' } }
        : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
    };
    return this.prisma.complianceAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(query.take ?? 100) || 100, 200),
    });
  }

  async ensureIdentity(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.secureZoneId) return user;

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        secureZoneId: await this.nextSecureZoneId(),
        identityType: this.identityTypeForRole(user.role),
      },
    });
  }

  async ensureEntitlement(userId: string) {
    const existing = await this.prisma.userEntitlement.findUnique({
      where: { userId },
    });
    if (existing) return existing;
    return this.prisma.userEntitlement.create({
      data: { userId, plan: PlatformEntitlementPlan.FREE },
    });
  }

  private async nextSecureZoneId() {
    const year = new Date().getFullYear();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const count = await this.prisma.user.count({
        where: { secureZoneId: { startsWith: `SZ-${year}-` } },
      });
      const candidate = `SZ-${year}-${(count + 1 + attempt)
        .toString()
        .padStart(6, '0')}`;
      const exists = await this.prisma.user.findUnique({
        where: { secureZoneId: candidate },
      });
      if (!exists) return candidate;
    }
    return `SZ-${year}-${Date.now().toString().slice(-6)}`;
  }

  private async nextCaseNumber() {
    const year = new Date().getFullYear();
    const count = await this.prisma.disputeCase.count({
      where: { caseNumber: { startsWith: `SZ-CASE-${year}-` } },
    });
    return `SZ-CASE-${year}-${(count + 1).toString().padStart(6, '0')}`;
  }

  private identityTypeForRole(role: UserRole): IdentityType {
    if (role === UserRole.PROVIDER || role === UserRole.PENDING_PROVIDER) {
      return IdentityType.PROVIDER_INDIVIDUAL;
    }
    if (role === UserRole.ORG_ADMIN || role === UserRole.DISPATCH_OFFICER) {
      return IdentityType.ORGANIZATION_REPRESENTATIVE;
    }
    if (role === UserRole.SUPER_ADMIN) {
      return IdentityType.GOVERNMENT_REPRESENTATIVE;
    }
    return IdentityType.INDIVIDUAL;
  }

  private async applyVerificationFromKyc(
    userId: string,
    submissionType: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const existing = await client.user.findUnique({
      where: { id: userId },
      select: { identityVerificationLevel: true, trustScore: true },
    });
    const currentLevel = existing?.identityVerificationLevel ?? 0;
    const data: Prisma.UserUpdateInput = {
      trustScore: Math.min((existing?.trustScore ?? 0) + 10, 100),
    };
    if (submissionType === 'GOVERNMENT_ID') {
      data.identityVerificationStatus = IdentityVerificationStatus.ID_VERIFIED;
      data.identityVerificationLevel = Math.max(currentLevel, 3);
      data.idVerifiedAt = new Date();
    } else if (submissionType === 'FACE_SELFIE') {
      data.identityVerificationStatus =
        IdentityVerificationStatus.FACE_VERIFIED;
      data.identityVerificationLevel = Math.max(currentLevel, 4);
      data.faceVerifiedAt = new Date();
    } else if (submissionType === 'ADDRESS_PROOF') {
      data.identityVerificationStatus =
        IdentityVerificationStatus.ADDRESS_VERIFIED;
      data.identityVerificationLevel = Math.max(currentLevel, 5);
      data.addressVerifiedAt = new Date();
    } else if (
      submissionType === 'BUSINESS_DOCUMENT' ||
      submissionType === 'PROFESSIONAL_LICENSE'
    ) {
      data.identityVerificationStatus =
        IdentityVerificationStatus.BUSINESS_VERIFIED;
      data.identityVerificationLevel = Math.max(currentLevel, 6);
      data.businessVerifiedAt = new Date();
    }
    await client.user.update({ where: { id: userId }, data });
  }

  private async userScopeWhere(
    user: TrustUser,
  ): Promise<Prisma.KycSubmissionWhereInput> {
    if (user.role === UserRole.SUPER_ADMIN) return {};
    if (!user.organizationId) return { id: '__none__' };
    return { user: { organizationId: user.organizationId } };
  }

  private assertCanAccessUser(
    user: TrustUser,
    target: { organizationId: string | null },
  ) {
    if (user.role === UserRole.SUPER_ADMIN) return;
    if (user.organizationId && target.organizationId === user.organizationId)
      return;
    throw new ForbiddenException('User is outside your organization scope');
  }

  private evidenceScopeWhere(user: TrustUser): Prisma.EvidenceRecordWhereInput {
    if (user.role === UserRole.SUPER_ADMIN) return {};
    if (this.isOrgScopedAdminRole(user.role)) {
      return { organizationId: user.organizationId ?? '__none__' };
    }
    return { OR: [{ ownerUserId: user.id }, { uploadedById: user.id }] };
  }

  private canAccessEvidence(
    user: TrustUser,
    record: {
      ownerUserId: string | null;
      uploadedById: string;
      organizationId: string | null;
    },
  ) {
    if (user.role === UserRole.SUPER_ADMIN) return true;
    if (this.isOrgScopedAdminRole(user.role)) {
      return (
        !!user.organizationId && record.organizationId === user.organizationId
      );
    }
    return record.ownerUserId === user.id || record.uploadedById === user.id;
  }

  private async resolveEvidenceScope(user: TrustUser, dto: CreateEvidenceDto) {
    if (dto.relatedEntityType === EvidenceRelatedEntityType.USER) {
      if (dto.relatedEntityId !== user.id && !this.isAdminRole(user.role)) {
        throw new ForbiddenException(
          'Cannot attach private evidence to another user',
        );
      }
      if (this.isAdminRole(user.role) && dto.relatedEntityId !== user.id) {
        const target = await this.prisma.user.findUnique({
          where: { id: dto.relatedEntityId },
          select: { organizationId: true },
        });
        if (!target) throw new NotFoundException('Evidence owner not found');
        this.assertCanAccessUser(user, target);
        return {
          ownerUserId: dto.relatedEntityId,
          organizationId: target.organizationId,
        };
      }
      return {
        ownerUserId: dto.relatedEntityId,
        organizationId: user.organizationId ?? null,
      };
    }

    if (dto.relatedEntityType === EvidenceRelatedEntityType.REPORT) {
      const report = await this.prisma.report.findUnique({
        where: { id: dto.relatedEntityId },
        select: {
          id: true,
          citizenId: true,
          assignedProviderId: true,
          organizationId: true,
        },
      });
      if (!report) throw new NotFoundException('Related report not found');
      if (!this.canAccessReport(user, report)) {
        throw new ForbiddenException('Report evidence is outside your scope');
      }
      return {
        ownerUserId: report.citizenId,
        organizationId: report.organizationId,
      };
    }
    return {
      ownerUserId: user.id,
      organizationId: user.organizationId ?? null,
    };
  }

  private async listReportEvidence(user: TrustUser) {
    const reports = await this.prisma.report.findMany({
      where: this.reportScopeWhere(user),
      select: {
        id: true,
        title: true,
        organizationId: true,
        citizenId: true,
        assignedProviderId: true,
        evidenceImageUrl: true,
        evidenceImagePath: true,
        completionImageUrl: true,
        completionImagePath: true,
        updatedAt: true,
        createdAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });

    return reports.flatMap((report) => {
      const items: Record<string, unknown>[] = [];
      if (report.evidenceImageUrl || report.evidenceImagePath) {
        items.push({
          id: `report-${report.id}-citizen-evidence`,
          ownerUserId: report.citizenId,
          organizationId: report.organizationId,
          relatedEntityType: EvidenceRelatedEntityType.REPORT,
          relatedEntityId: report.id,
          fileUrl: report.evidenceImageUrl ?? report.evidenceImagePath,
          fileType: 'report-evidence',
          uploadedById: report.citizenId,
          uploadedAt: report.createdAt,
          description: `Citizen evidence for ${report.title}`,
          metadata: { source: 'report.evidenceImageUrl', synthetic: true },
        });
      }
      if (report.completionImageUrl || report.completionImagePath) {
        items.push({
          id: `report-${report.id}-completion-evidence`,
          ownerUserId: report.citizenId,
          organizationId: report.organizationId,
          relatedEntityType: EvidenceRelatedEntityType.REPORT,
          relatedEntityId: report.id,
          fileUrl: report.completionImageUrl ?? report.completionImagePath,
          fileType: 'completion-evidence',
          uploadedById: report.assignedProviderId ?? report.citizenId,
          uploadedAt: report.updatedAt,
          description: `Provider completion evidence for ${report.title}`,
          metadata: { source: 'report.completionImageUrl', synthetic: true },
        });
      }
      return items;
    });
  }

  private reportScopeWhere(user: TrustUser): Prisma.ReportWhereInput {
    if (user.role === UserRole.SUPER_ADMIN) return {};
    if (this.isOrgScopedAdminRole(user.role)) {
      return { organizationId: user.organizationId ?? '__none__' };
    }
    return {
      OR: [{ citizenId: user.id }, { assignedProviderId: user.id }],
    };
  }

  private canAccessReport(
    user: TrustUser,
    report: {
      citizenId: string;
      assignedProviderId: string | null;
      organizationId: string;
    },
  ) {
    if (report.citizenId === user.id || report.assignedProviderId === user.id)
      return true;
    return this.canAdminAccessOrganization(user, report.organizationId);
  }

  private canAccessDispute(
    user: TrustUser,
    dispute: {
      openedById: string;
      againstUserId: string | null;
      organizationId: string | null;
    },
  ) {
    if (dispute.openedById === user.id || dispute.againstUserId === user.id)
      return true;
    return this.canAdminAccessOrganization(user, dispute.organizationId);
  }

  private canAdminAccessOrganization(
    user: TrustUser,
    organizationId: string | null,
  ) {
    if (user.role === UserRole.SUPER_ADMIN) return true;
    if (!this.isOrgScopedAdminRole(user.role)) return false;
    return !!user.organizationId && organizationId === user.organizationId;
  }

  private isAdminRole(role: UserRole) {
    return (
      role === UserRole.SUPER_ADMIN ||
      role === UserRole.ORG_ADMIN ||
      role === UserRole.DISPATCH_OFFICER
    );
  }

  private isOrgScopedAdminRole(role: UserRole) {
    return role === UserRole.ORG_ADMIN || role === UserRole.DISPATCH_OFFICER;
  }

  private enforcementSettingKey(organizationId?: string | null) {
    return `${this.enforcementSettingPrefix}:${organizationId ?? 'global'}`;
  }

  private defaultEnforcementSettings(): TrustEnforcementSettings {
    return {
      requireVerifiedIdentityForDisputes: false,
      requireVerifiedIdentityForProviderJobAcceptance: false,
      requireVerifiedIdentityForEvidenceUpload: false,
      requireEntitlementPlanForPriorityWorkflows: false,
      requiredPriorityPlan: PlatformEntitlementPlan.FREE,
    };
  }

  private async readEnforcementSettings(organizationId?: string | null) {
    const setting = await this.prisma.platformSetting.findUnique({
      where: { key: this.enforcementSettingKey(organizationId ?? null) },
    });
    const value =
      setting?.value &&
      typeof setting.value === 'object' &&
      !Array.isArray(setting.value)
        ? (setting.value as Record<string, unknown>)
        : {};
    const defaults = this.defaultEnforcementSettings();
    return {
      requireVerifiedIdentityForDisputes:
        value.requireVerifiedIdentityForDisputes === true,
      requireVerifiedIdentityForProviderJobAcceptance:
        value.requireVerifiedIdentityForProviderJobAcceptance === true,
      requireVerifiedIdentityForEvidenceUpload:
        value.requireVerifiedIdentityForEvidenceUpload === true,
      requireEntitlementPlanForPriorityWorkflows:
        value.requireEntitlementPlanForPriorityWorkflows === true,
      requiredPriorityPlan: this.parsePlan(
        value.requiredPriorityPlan?.toString() ?? defaults.requiredPriorityPlan,
      ),
    };
  }

  private parsePlan(value: string | PlatformEntitlementPlan) {
    const normalized = value.toString().trim().toUpperCase();
    if (
      Object.values(PlatformEntitlementPlan).includes(
        normalized as PlatformEntitlementPlan,
      )
    ) {
      return normalized as PlatformEntitlementPlan;
    }
    return PlatformEntitlementPlan.FREE;
  }

  private async assertEnforcementAllows(
    user: TrustUser,
    action: 'open_dispute' | 'evidence_upload' | 'provider_job_acceptance',
  ) {
    const settings = await this.readEnforcementSettings(
      user.organizationId ?? null,
    );
    const requiresVerified =
      (action === 'open_dispute' &&
        settings.requireVerifiedIdentityForDisputes) ||
      (action === 'evidence_upload' &&
        settings.requireVerifiedIdentityForEvidenceUpload) ||
      (action === 'provider_job_acceptance' &&
        settings.requireVerifiedIdentityForProviderJobAcceptance);
    const requiredVerificationLevel = requiresVerified ? 1 : 0;
    const requiredPlan = settings.requireEntitlementPlanForPriorityWorkflows
      ? settings.requiredPriorityPlan
      : undefined;
    const access = await this.checkAccessRequirements(user, {
      requiredVerificationLevel,
      requiredPlan,
      organizationId: user.organizationId ?? null,
    });
    if (!access.allowed) {
      await this.audit(
        user,
        'Trust Enforcement Blocked',
        'TrustPolicy',
        action,
        {
          action,
          access,
        },
      );
      throw new ForbiddenException(
        'SecureZone Trust policy requires additional verification or entitlement before this action can continue.',
      );
    }
  }

  private planRank(plan: PlatformEntitlementPlan) {
    const order = [
      PlatformEntitlementPlan.FREE,
      PlatformEntitlementPlan.VERIFIED,
      PlatformEntitlementPlan.PERSONAL_PLUS,
      PlatformEntitlementPlan.PROFESSIONAL,
      PlatformEntitlementPlan.BUSINESS,
      PlatformEntitlementPlan.ENTERPRISE,
      PlatformEntitlementPlan.GOVERNMENT,
    ];
    return order.indexOf(plan);
  }

  private describeUserAgent(userAgent?: string | null) {
    if (!userAgent) return 'Unknown device';
    const ua = userAgent.toLowerCase();
    const browser = ua.includes('edg/')
      ? 'Microsoft Edge'
      : ua.includes('chrome/')
        ? 'Chrome'
        : ua.includes('safari/')
          ? 'Safari'
          : ua.includes('firefox/')
            ? 'Firefox'
            : 'Browser';
    const device = ua.includes('android')
      ? 'Android'
      : ua.includes('iphone') || ua.includes('ipad')
        ? 'iOS'
        : ua.includes('windows')
          ? 'Windows'
          : ua.includes('mac os')
            ? 'macOS'
            : ua.includes('linux')
              ? 'Linux'
              : 'Device';
    return `${browser} on ${device}`;
  }

  private async notifyDisputeOpened(disputeId: string, actor: TrustUser) {
    const dispute = await this.prisma.disputeCase.findUnique({
      where: { id: disputeId },
      include: { messages: false },
    });
    if (!dispute) return;
    const recipients = await this.disputeNotificationRecipients(dispute);
    await Promise.all(
      [...recipients].map((userId) =>
        this.createNotification({
          userId,
          type: 'dispute_opened',
          title: 'Dispute opened',
          message: `${actor.fullName ?? 'A SecureZone user'} opened dispute ${dispute.caseNumber}: ${dispute.title}`,
          reportId:
            dispute.relatedEntityType === 'REPORT'
              ? dispute.relatedEntityId
              : undefined,
        }),
      ),
    );
    await this.audit(
      actor,
      'Dispute Notifications Sent',
      'DisputeCase',
      dispute.id,
      {
        event: 'opened',
        recipientCount: recipients.size,
      },
    );
  }

  private async notifyDisputeUpdated(
    disputeId: string,
    title: string,
    message: string,
  ) {
    const dispute = await this.prisma.disputeCase.findUnique({
      where: { id: disputeId },
    });
    if (!dispute) return;
    const recipients = await this.disputeNotificationRecipients(dispute);
    await Promise.all(
      [...recipients].map((userId) =>
        this.createNotification({
          userId,
          type: 'dispute_update',
          title,
          message: `${dispute.caseNumber}: ${message}`,
          reportId:
            dispute.relatedEntityType === 'REPORT'
              ? dispute.relatedEntityId
              : undefined,
        }),
      ),
    );
    await this.prisma.complianceAuditLog.create({
      data: {
        actorId: dispute.assignedAdminId ?? dispute.openedById,
        organizationId: dispute.organizationId,
        action: 'Dispute Notifications Sent',
        entityType: 'DisputeCase',
        entityId: dispute.id,
        metadata: {
          event: title,
          recipientCount: recipients.size,
        },
      },
    });
  }

  private async disputeNotificationRecipients(dispute: {
    openedById: string;
    againstUserId: string | null;
    assignedAdminId?: string | null;
    organizationId: string | null;
    relatedEntityType: string;
    relatedEntityId: string;
  }) {
    const recipients = new Set<string>([dispute.openedById]);
    if (dispute.againstUserId) recipients.add(dispute.againstUserId);
    if (dispute.assignedAdminId) recipients.add(dispute.assignedAdminId);
    if (dispute.relatedEntityType === 'REPORT') {
      const report = await this.prisma.report.findUnique({
        where: { id: dispute.relatedEntityId },
        select: { citizenId: true, assignedProviderId: true },
      });
      if (report?.citizenId) recipients.add(report.citizenId);
      if (report?.assignedProviderId) recipients.add(report.assignedProviderId);
    }
    if (dispute.organizationId) {
      const operators = await this.prisma.user.findMany({
        where: {
          organizationId: dispute.organizationId,
          role: { in: [UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER] },
          accountStatus: 'ACTIVE',
        },
        select: { id: true },
      });
      operators.forEach((operator) => recipients.add(operator.id));
    }
    return recipients;
  }

  private async createNotification(data: {
    userId: string;
    type: string;
    title: string;
    message: string;
    reportId?: string;
  }) {
    let reportId: string | undefined;
    if (data.reportId) {
      const report = await this.prisma.report.findUnique({
        where: { id: data.reportId },
        select: { id: true },
      });
      reportId = report?.id;
    }
    await this.prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        ...(reportId ? { reportId } : {}),
      },
    });
  }

  private async audit(
    user: TrustUser,
    action: string,
    entityType?: string,
    entityId?: string,
    metadata?: Record<string, unknown>,
  ) {
    await this.auditWithClient(
      this.prisma,
      user,
      action,
      entityType,
      entityId,
      metadata,
    );
  }

  private async auditWithClient(
    client: Prisma.TransactionClient | PrismaService,
    user: TrustUser,
    action: string,
    entityType?: string,
    entityId?: string,
    metadata?: Record<string, unknown>,
  ) {
    await client.complianceAuditLog.create({
      data: {
        actorId: user.id,
        actorRole: user.role,
        organizationId: user.organizationId ?? null,
        action,
        entityType,
        entityId,
        metadata: (metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
