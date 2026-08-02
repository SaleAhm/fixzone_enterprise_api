import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AssignmentOutcome,
  BillingStatus,
  AccountStatus,
  OrganizationStatus,
  ReportStatus,
  UserRole,
} from '@prisma/client';
import { createReadStream } from 'fs';
import { access } from 'fs/promises';
import { basename, extname, posix, resolve, relative, sep } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { UploadSecurityService } from '../security/upload-security.service';
import { TrustService } from '../trust/trust.service';
import { WorkflowOrchestratorService } from '../business-logic/workflow-orchestrator.service';
import { AssignProviderDto } from './dto/assign-provider.dto';
import { AssignOrganizationDto } from './dto/assign-organization.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import { UploadCompletionEvidenceDto } from './dto/upload-completion-evidence.dto';
import { UploadReportEvidenceDto } from './dto/upload-report-evidence.dto';
import { AdminDashboardQueryDto } from './dto/admin-dashboard-query.dto';
import { RejectAssignmentDto } from './dto/reject-assignment.dto';
import { CitizenConfirmCompletionDto } from './dto/citizen-confirm-completion.dto';
import { CitizenRejectCompletionDto } from './dto/citizen-reject-completion.dto';
import {
  OrganizationAcceptReportDto,
  OrganizationRejectReportDto,
} from './dto/organization-intake-decision.dto';
import {
  canTransitionReportStatus,
  normalizeReportStatus,
} from './report-workflow';

type JwtUser = {
  id?: string;
  userId?: string;
  sub?: string;
  firebaseUid?: string | null;
  email?: string | null;
  fullName?: string | null;
  role: UserRole;
  organizationId?: string | null;
};

type EvidenceKind = 'report-evidence' | 'report-completion';

type ReportWithEvidence = {
  id: string;
  description?: string | null;
  createdAt?: Date | string | null;
  organizationId: string;
  citizenId: string;
  assignedProviderId: string | null;
  lastAssignmentProviderId?: string | null;
  status?: ReportStatus;
  priority?: string | null;
  evidenceImageUrl?: string | null;
  evidenceImagePath?: string | null;
  completionImageUrl?: string | null;
  completionImagePath?: string | null;
};

type EnterpriseReportWithEvidence = ReportWithEvidence & {
  completionNote?: string | null;
  completedByProviderAt?: Date | string | null;
  completionLatitude?: number | null;
  completionLongitude?: number | null;
  completionAccuracy?: number | null;
  completionLocationCapturedAt?: Date | string | null;
  completionLocationSource?: string | null;
  citizenRating?: number | null;
  citizenFeedback?: string | null;
  completionRejectionReason?: string | null;
  assignedAt?: Date | string | null;
  assignmentDeadlineAt?: Date | string | null;
  lastAssignmentOutcome?: AssignmentOutcome | null;
  lastAssignmentReason?: string | null;
  assignedProvider?: unknown;
};

const SUPER_ADMIN_TRIAGE_SOURCE = 'Super Admin triage';
const AUTOMATIC_ORGANIZATION_REVIEW_SOURCE = 'Automatic intake match';
const ORGANIZATION_ACCEPTED_SOURCE = 'Organization accepted report';
const ORGANIZATION_REJECTED_SOURCE = 'Organization rejected report';
const PROVIDER_CAPABILITIES_KEY = 'secureZoneProviderCapabilities';
const ACTIVE_MAINTENANCE_CAPABILITIES = new Set([
  'electrical',
  'plumbing',
  'mechanical',
  'civil_works',
]);

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);
  private readonly assignmentTimeoutMinutes = Number(
    process.env.ASSIGNMENT_TIMEOUT_MINUTES || 30,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly trustService?: TrustService,
    private readonly workflowOrchestrator?: WorkflowOrchestratorService,
    @Optional()
    @Inject(UploadSecurityService)
    private readonly uploadSecurity?: UploadSecurityService,
  ) {}

  // ===================== CREATE =====================

  async createReport(user: JwtUser, dto: CreateReportDto) {
    const userId = this.getUserId(user);

    if (user.role !== UserRole.CITIZEN) {
      throw new ForbiddenException('Only citizens can create reports');
    }

    if (!user.organizationId) {
      throw new ForbiddenException('Citizen must belong to an organization');
    }

    const intakeRoute = await this.findEligibleIntakeOrganization(dto);
    const intakeOrganization = intakeRoute.organization;
    const organizationId = intakeOrganization?.id ?? user.organizationId;
    const routedToOrganization = Boolean(intakeOrganization);

    await this.enforceMonthlyReportQuota(organizationId);

    const report = await this.prisma.report.create({
      data: {
        ...dto,
        locationCapturedAt: dto.locationCapturedAt
          ? new Date(dto.locationCapturedAt)
          : undefined,
        locationSource: dto.locationSource ?? this.locationSourceFor(dto),
        status: routedToOrganization
          ? ReportStatus.ORG_REVIEW
          : ReportStatus.TRIAGE,
        citizenId: userId,
        organizationId,
        assignedOrganizationId: routedToOrganization ? organizationId : null,
        organizationAssignedAt: routedToOrganization ? new Date() : null,
        organizationAssignmentSource: routedToOrganization
          ? AUTOMATIC_ORGANIZATION_REVIEW_SOURCE
          : intakeRoute.matchCount > 1
            ? 'Ambiguous organization intake match'
            : SUPER_ADMIN_TRIAGE_SOURCE,
      },
      include: this.includeRelations(),
    });

    await this.createNotification({
      userId,
      reportId: report.id,
      type: 'acknowledged',
      title: 'Report received',
      message: `Your report "${report.title}" has been received and is under review.`,
    });

    this.logger.debug({
      message: 'Citizen report created',
      reportId: report.id,
      citizenId: report.citizenId,
      firebaseUid: user.firebaseUid,
      organizationId: report.organizationId,
      assignedOrganizationId: report.assignedOrganizationId,
    });

    await this.audit('Report Created', user, {
      targetType: 'Report',
      targetId: report.id,
      organizationId: report.organizationId,
      category: report.category,
    });
    await this.recordReportActivity(report.id, 'REPORT_CREATED', user, {
      organizationId: report.organizationId,
      toStatus: report.status,
      metadata: {
        category: report.category,
        assignedOrganizationId: report.assignedOrganizationId,
        routingSource: report.organizationAssignmentSource,
      },
    });
    if (routedToOrganization) {
      await this.notifyOrganizationOperators(report.organizationId, {
        reportId: report.id,
        type: 'organization_report_offered',
        title: 'Incoming report for review',
        message: `"${report.title}" is awaiting your organization intake decision.`,
      });
    }

    return this.withProtectedEvidenceUrls(report);
  }

  // ===================== CITIZEN =====================

  async getMyReports(user: JwtUser) {
    const userId = this.getUserId(user);

    try {
      const reports = await this.prisma.report.findMany({
        where: { citizenId: userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: this.includeRelations(),
      });

      if (reports.length === 0) {
        this.logger.warn({
          message: 'Citizen report query returned no rows',
          userId,
          firebaseUid: user.firebaseUid,
          organizationId: user.organizationId,
        });
      }

      return reports.map((report) => this.withProtectedEvidenceUrls(report));
    } catch (error) {
      const prismaError = error as {
        code?: string;
        message?: string;
        meta?: unknown;
        stack?: string;
      };

      this.logger.error(
        {
          message: 'Failed to fetch citizen reports',
          userId,
          prismaCode: prismaError.code,
          prismaMessage: prismaError.message,
          prismaMeta: prismaError.meta,
        },
        prismaError.stack,
      );

      throw error;
    }
  }

  async getCitizenDashboardSummary(user: JwtUser) {
    const userId = this.getUserId(user);
    const where = { citizenId: userId };

    const [
      total,
      pending,
      assigned,
      inProgress,
      completed,
      closed,
      rejectedAssignments,
      citizenRejectedCompletions,
      organizationMetrics,
    ] = await Promise.all([
      this.prisma.report.count({ where }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.PENDING },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.ASSIGNED },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.IN_PROGRESS },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.COMPLETED_BY_PROVIDER },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.CLOSED },
      }),
      this.prisma.report.count({
        where: { ...where, lastAssignmentOutcome: AssignmentOutcome.REJECTED },
      }),
      this.prisma.report.count({
        where: { ...where, completionRejectionReason: { not: null } },
      }),
      this.getDashboardOrganizationMetrics(user),
    ]);

    return {
      total,
      pending,
      assigned,
      inProgress,
      completed,
      closed,
      rejectedAssignments,
      citizenRejectedCompletions,
      organizations: organizationMetrics,
    };
  }

  // ===================== PROVIDER =====================

  async getAssignedReports(user: JwtUser) {
    const userId = this.getUserId(user);

    if (!this.isProvider(user)) {
      throw new ForbiddenException('Only providers allowed');
    }

    await this.expireOverdueAssignments({ providerId: userId });

    const reports = await this.prisma.report.findMany({
      where: {
        assignedProviderId: userId,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: this.includeRelations(),
    });
    return reports.map((report) => this.withProtectedEvidenceUrls(report));
  }

  // ===================== ORGANIZATION =====================

  async getOrganizationReports(user: JwtUser) {
    const where = this.buildOrgScope(user);
    await this.expireOverdueAssignments({
      organizationId: where.organizationId,
    });

    const reports = await this.prisma.report.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: this.includeRelations(),
    });
    return reports.map((report) => this.withProtectedEvidenceUrls(report));
  }

  // ===================== SINGLE REPORT =====================

  async getReportById(reportId: string, user: JwtUser) {
    const userId = this.getUserId(user);

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: this.includeRelations(),
    });

    if (!report) throw new NotFoundException('Report not found');

    if (this.isSuperAdmin(user))
      return this.withEnterpriseReportDetails(report);

    const sameOrg =
      user.organizationId && report.organizationId === user.organizationId;

    if (report.citizenId === userId) {
      return this.withEnterpriseReportDetails(report);
    }

    if (report.assignedProviderId === userId && this.isProvider(user)) {
      return this.withEnterpriseReportDetails(report);
    }

    if (
      (this.isAdmin(user) || this.isDispatch(user)) &&
      sameOrg &&
      report.status !== ReportStatus.TRIAGE
    ) {
      return this.withEnterpriseReportDetails(report);
    }

    throw new ForbiddenException('Access denied');
  }

  async getReportTimeline(reportId: string, user: JwtUser) {
    await this.getReportById(reportId, user);
    const activity = (this.prisma as any).reportActivity;
    if (!activity?.findMany) return [];
    return activity.findMany({
      where: { reportId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getReportMessages(reportId: string, user: JwtUser) {
    await this.getReportById(reportId, user);
    return this.prisma.reportMessage.findMany({
      where: { reportId },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        id: true,
        reportId: true,
        organizationId: true,
        authorId: true,
        authorRole: true,
        authorName: true,
        message: true,
        createdAt: true,
      },
    });
  }

  async createReportMessage(
    reportId: string,
    dto: { message?: unknown },
    user: JwtUser,
  ) {
    const userId = this.getUserId(user);
    const text = typeof dto.message === 'string' ? dto.message.trim() : '';
    if (!text) throw new BadRequestException('Message is required');
    if (text.length > 1200) {
      throw new BadRequestException('Message must be 1200 characters or less');
    }
    const report = await this.getReportById(reportId, user);
    if (report.status === ReportStatus.CLOSED) {
      throw new ForbiddenException('Discussion is read-only for this report');
    }
    // eslint-disable-next-line no-control-regex
    const safeMessage = text.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
    const message = await this.prisma.reportMessage.create({
      data: {
        reportId,
        organizationId: report.organizationId,
        authorId: userId,
        authorRole: user.role,
        authorName: user.fullName ?? null,
        message: safeMessage,
      },
      select: {
        id: true,
        reportId: true,
        organizationId: true,
        authorId: true,
        authorRole: true,
        authorName: true,
        message: true,
        createdAt: true,
      },
    });
    await this.recordReportActivity(
      reportId,
      'REPORT_DISCUSSION_MESSAGE',
      user,
      {
        organizationId: report.organizationId,
        note: safeMessage.slice(0, 240),
        metadata: { messageId: message.id },
      },
    );
    await this.notifyReportMessageParticipants(report, userId, safeMessage);
    return message;
  }

  // ===================== ASSIGN =====================

  async assignProvider(
    reportId: string,
    dto: AssignProviderDto,
    user: JwtUser,
  ) {
    return this.assignProviderById(reportId, dto.providerId, user, dto);
  }

  async openEvidenceFile(
    reportId: string,
    kind: EvidenceKind,
    fileName: string,
    user: JwtUser,
  ) {
    this.assertSafeEvidenceFileName(fileName);
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        organizationId: true,
        citizenId: true,
        assignedProviderId: true,
        lastAssignmentProviderId: true,
        status: true,
        evidenceImagePath: true,
        completionImagePath: true,
      },
    });

    if (!report) throw new NotFoundException('Evidence not found');
    await this.assertCanAccessEvidence(report, kind, user);

    const storedPath =
      kind === 'report-evidence'
        ? report.evidenceImagePath
        : report.completionImagePath;
    const normalizedStoredPath = this.extractLocalUploadPath(storedPath);
    const expectedPath = posix.join(kind, reportId, fileName);

    if (normalizedStoredPath !== expectedPath) {
      throw new NotFoundException('Evidence not found');
    }

    const uploadRoot = resolve(process.cwd(), 'uploads');
    const absolutePath = resolve(uploadRoot, kind, reportId, fileName);
    this.assertInsideUploadRoot(uploadRoot, absolutePath);

    try {
      await access(absolutePath);
    } catch {
      throw new NotFoundException('Evidence not found');
    }

    return {
      stream: createReadStream(absolutePath),
      fileName,
      contentType: this.contentTypeForEvidenceFile(fileName),
    };
  }

  async getAssignmentCandidates(reportId: string, user: JwtUser) {
    if (
      !this.isAdmin(user) &&
      !this.isDispatch(user) &&
      !this.isSuperAdmin(user)
    ) {
      throw new ForbiddenException('Not allowed');
    }
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: this.includeRelations(),
    });
    if (!report) throw new NotFoundException('Report not found');
    if (
      !this.isSuperAdmin(user) &&
      report.organizationId !== user.organizationId
    ) {
      throw new ForbiddenException('Cross-org not allowed');
    }

    const scopedOrganizationWhere = this.isSuperAdmin(user)
      ? { status: { not: OrganizationStatus.ARCHIVED } }
      : { id: user.organizationId ?? '' };
    const [providers, organizations] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          role: UserRole.PROVIDER,
          accountStatus: 'ACTIVE',
          OR: [
            { organizationId: report.organizationId },
            {
              providerOrganizations: {
                some: { organizationId: report.organizationId, active: true },
              },
            },
          ],
        },
        orderBy: { fullName: 'asc' },
        select: {
          id: true,
          fullName: true,
          providerId: true,
          serviceCategories: true,
          coverageAreas: true,
          organizationId: true,
        },
      }),
      this.prisma.organization.findMany({
        where: scopedOrganizationWhere,
        orderBy: { name: 'asc' },
        include: {
          providerLinks: {
            where: { active: true },
            include: {
              provider: {
              select: {
                id: true,
                accountStatus: true,
                serviceCategories: true,
                coverageAreas: true,
                profileData: true,
              },
            },
          },
        },
        users: {
          where: { role: UserRole.PROVIDER, accountStatus: 'ACTIVE' },
          select: {
            id: true,
            accountStatus: true,
            serviceCategories: true,
            coverageAreas: true,
            profileData: true,
          },
        },
        },
      }),
    ]);

    const organizationCandidates = organizations.map((organization) =>
      this.serializeOrganizationCandidate(organization, report.category, report),
    );

    return {
      reportId,
      reportCategory: report.category,
      assignedOrganization: (report as any).assignedOrganization ?? null,
      assignedProvider: report.assignedProvider ?? null,
      routing: this.routingDiagnostics(report, organizationCandidates),
      providers: providers.map((provider) => ({
        type: 'PROVIDER',
        id: provider.id,
        name: provider.fullName,
        providerId: provider.providerId,
        eligible: this.providerMatchesCategory(provider, report.category),
        serviceCategories: this.jsonStringList(provider.serviceCategories),
        coverageAreas: this.jsonStringList(provider.coverageAreas),
      })),
      organizations: organizationCandidates,
    };
  }

  async assignOrganization(
    reportId: string,
    dto: AssignOrganizationDto,
    user: JwtUser,
  ) {
    if (
      !this.isAdmin(user) &&
      !this.isDispatch(user) &&
      !this.isSuperAdmin(user)
    ) {
      throw new ForbiddenException('Not allowed');
    }
    const actorId = user.id ?? user.userId ?? user.sub;
    if (!actorId) throw new ForbiddenException('Actor missing');
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: this.includeRelations(),
    });
    if (!report) throw new NotFoundException('Report not found');
    if (
      !this.isSuperAdmin(user) &&
      report.organizationId !== user.organizationId
    ) {
      throw new ForbiddenException('Cross-org not allowed');
    }
    const currentStatus = normalizeReportStatus(report.status);
    const routableStatuses: ReportStatus[] = [
      ReportStatus.PENDING,
      ReportStatus.TRIAGE,
    ];
    if (!routableStatuses.includes(currentStatus as ReportStatus)) {
      throw new ForbiddenException(
        'Report cannot be assigned in its current status',
      );
    }
    if (report.assignedProviderId) {
      throw new ForbiddenException('Report already has an assigned provider');
    }
    if (
      !this.isSuperAdmin(user) &&
      dto.organizationId !== user.organizationId
    ) {
      throw new ForbiddenException('Organization assignment scope denied');
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: dto.organizationId },
      include: {
        providerLinks: {
          where: { active: true },
          include: {
            provider: {
              select: {
                id: true,
                accountStatus: true,
                serviceCategories: true,
                coverageAreas: true,
                profileData: true,
              },
            },
          },
        },
        users: {
          where: { role: UserRole.PROVIDER, accountStatus: 'ACTIVE' },
          select: {
            id: true,
            accountStatus: true,
            serviceCategories: true,
            coverageAreas: true,
            profileData: true,
          },
        },
      },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    const candidate = this.serializeOrganizationCandidate(
      organization,
      report.category,
      report,
    );
    const overrideReadiness = dto.overrideReadiness === true;
    if (!candidate.eligible && !(this.isSuperAdmin(user) && overrideReadiness)) {
      throw new ForbiddenException({
        code: 'ORGANIZATION_NOT_READY',
        message: 'Organization is not eligible for this assignment.',
        reasons: candidate.reasons,
      });
    }

    const routeReason = dto.reason?.trim() || 'Manual organization assignment';
    const routeSource = overrideReadiness
      ? `Super Admin override: ${routeReason}`
      : routeReason;
    const updated = await this.prisma.$transaction(async (tx) => {
      const routed = await tx.report.update({
        where: { id: reportId },
        data: {
          organizationId: organization.id,
          assignedOrganizationId: organization.id,
          organizationAssignedById: actorId,
          organizationAssignedAt: new Date(),
          organizationAssignmentSource: routeSource,
          status: ReportStatus.ORG_REVIEW,
          lastAssignmentOutcome: null,
          lastAssignmentReason: null,
          lastAssignmentAt: new Date(),
          lastAssignmentProviderId: null,
        } as any,
        include: this.includeRelations(),
      });

      const audit = (tx as any).demoAuditLog;
      if (audit?.create) {
        await audit.create({
          data: {
            action: 'Report Assigned To Organization',
            actorUserId: actorId,
            metadata: {
              targetType: 'Report',
              targetId: reportId,
              previousOrganizationId: report.organizationId,
              assignedOrganizationId: organization.id,
              organizationId: routed.organizationId,
              reason: dto.reason?.trim() || null,
              overrideReadiness,
              readinessReasons: candidate.reasons,
              readinessSummary: candidate.readiness,
            },
          },
        });
      }

      const activity = (tx as any).reportActivity;
      if (activity?.create) {
        await activity.create({
          data: {
            reportId,
            organizationId: routed.organizationId,
            actorUserId: actorId,
            actorRole: user.role ?? null,
            actorName: user.fullName ?? user.email ?? null,
            action: 'ORGANIZATION_ASSIGNED',
            fromStatus: report.status,
            toStatus: routed.status,
            reason: dto.reason?.trim() || null,
            metadata: {
              previousOrganizationId: report.organizationId,
              assignedOrganizationId: organization.id,
              assignedOrganizationName: organization.name,
              overrideReadiness,
              readinessReasons: candidate.reasons,
              readinessSummary: candidate.readiness,
            },
          },
        });
      }

      return routed;
    });
    await this.notifyOrganizationOperators(organization.id, {
      reportId,
      type: 'organization_assignment',
      title: 'Report assigned to organization',
      message: `"${updated.title}" was assigned to ${organization.name}.`,
    });
    return this.withProtectedEvidenceUrls(updated);
  }

  async acceptOrganizationReport(
    reportId: string,
    dto: OrganizationAcceptReportDto,
    user: JwtUser,
  ) {
    const actorId = this.getUserId(user);
    const organizationId = this.requireUserOrganizationId(user);
    if (!this.isAdmin(user) && !this.isDispatch(user)) {
      throw new ForbiddenException(
        'Only organization operators can accept reports',
      );
    }

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: this.includeRelations(),
    });
    if (!report) throw new NotFoundException('Report not found');
    if (
      report.organizationId !== organizationId ||
      report.assignedOrganizationId !== organizationId
    ) {
      throw new ForbiddenException('Report is not routed to your organization');
    }
    if (report.status === ReportStatus.PENDING) {
      return this.withProtectedEvidenceUrls(report);
    }
    if (report.status !== ReportStatus.ORG_REVIEW) {
      throw new ConflictException(
        'Report is not awaiting organization decision',
      );
    }

    const note = dto.note?.trim();
    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: ReportStatus.PENDING,
        organizationAssignmentSource: ORGANIZATION_ACCEPTED_SOURCE,
        lastAssignmentOutcome: null,
        lastAssignmentReason: null,
        lastAssignmentAt: new Date(),
      } as any,
      include: this.includeRelations(),
    });

    await this.audit('Organization Report Accepted', user, {
      targetType: 'Report',
      targetId: reportId,
      organizationId,
      previousStatus: report.status,
      note: note ?? null,
    });
    await this.recordReportActivity(
      reportId,
      'ORGANIZATION_ACCEPTED_REPORT',
      user,
      {
        organizationId,
        fromStatus: report.status,
        toStatus: updated.status,
        note: note || undefined,
        metadata: {
          assignedOrganizationId: updated.assignedOrganizationId,
          previousStatus: report.status,
        },
      },
    );
    await this.createNotification({
      userId: updated.citizenId,
      reportId,
      type: 'organization_report_accepted',
      title: 'Report accepted for dispatch',
      message: `"${updated.title}" was accepted by the responsible organization and is awaiting provider assignment.`,
    });
    await this.notifyOrganizationOperators(organizationId, {
      reportId,
      type: 'organization_report_accepted',
      title: 'Report accepted',
      message: `"${updated.title}" is now in your dispatch queue.`,
    });
    return this.withProtectedEvidenceUrls(updated);
  }

  async rejectOrganizationReport(
    reportId: string,
    dto: OrganizationRejectReportDto,
    user: JwtUser,
  ) {
    const organizationId = this.requireUserOrganizationId(user);
    if (!this.isAdmin(user) && !this.isDispatch(user)) {
      throw new ForbiddenException(
        'Only organization operators can reject reports',
      );
    }
    const reason = dto.reason?.trim();
    if (!reason) throw new BadRequestException('Rejection reason is required');

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: this.includeRelations(),
    });
    if (!report) throw new NotFoundException('Report not found');
    if (
      report.organizationId !== organizationId ||
      report.assignedOrganizationId !== organizationId
    ) {
      throw new ForbiddenException('Report is not routed to your organization');
    }
    if (report.status === ReportStatus.TRIAGE) {
      return this.withProtectedEvidenceUrls(report);
    }
    if (report.status !== ReportStatus.ORG_REVIEW) {
      throw new ConflictException(
        'Report is not awaiting organization decision',
      );
    }

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: ReportStatus.TRIAGE,
        assignedOrganizationId: null,
        organizationAssignedById: null,
        organizationAssignedAt: null,
        organizationAssignmentSource: ORGANIZATION_REJECTED_SOURCE,
        assignedProviderId: null,
        assignedAt: null,
        assignmentDeadlineAt: null,
        lastAssignmentOutcome: AssignmentOutcome.REJECTED,
        lastAssignmentReason: reason,
        lastAssignmentAt: new Date(),
      } as any,
      include: this.includeRelations(),
    });

    await this.audit('Organization Report Rejected', user, {
      targetType: 'Report',
      targetId: reportId,
      organizationId,
      previousStatus: report.status,
      reason,
    });
    await this.recordReportActivity(
      reportId,
      'ORGANIZATION_REJECTED_REPORT',
      user,
      {
        organizationId,
        fromStatus: report.status,
        toStatus: updated.status,
        reason,
        metadata: {
          returnedToSuperAdminTriage: true,
          previousAssignedOrganizationId: organizationId,
        },
      },
    );
    await this.createNotification({
      userId: updated.citizenId,
      reportId,
      type: 'organization_report_rejected',
      title: 'Report returned for platform review',
      message: `"${updated.title}" was returned for SecureZone platform triage.`,
    });
    return this.withProtectedEvidenceUrls(updated);
  }

  async processOverdueAssignments(user: JwtUser) {
    if (
      !this.isAdmin(user) &&
      !this.isDispatch(user) &&
      !this.isSuperAdmin(user)
    ) {
      throw new ForbiddenException('Not allowed');
    }
    const result = await this.expireOverdueAssignments({
      organizationId: this.isSuperAdmin(user)
        ? undefined
        : (user.organizationId ?? undefined),
      actor: user,
    });
    return {
      expired: result.length,
      reports: result,
      timeoutMinutes: this.assignmentTimeoutMinutes,
    };
  }

  async cancelAssignment(
    reportId: string,
    reason: string | undefined,
    user: JwtUser,
  ) {
    if (
      !this.isAdmin(user) &&
      !this.isDispatch(user) &&
      !this.isSuperAdmin(user)
    ) {
      throw new ForbiddenException('Not allowed');
    }

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (
      !this.isSuperAdmin(user) &&
      report.organizationId !== user.organizationId
    ) {
      throw new ForbiddenException('Wrong org');
    }
    if (!report.assignedProviderId || report.status === ReportStatus.PENDING) {
      throw new ForbiddenException('Report has no active assignment');
    }

    const previousProviderId = report.assignedProviderId;
    const cleanReason =
      reason?.trim() || 'Assignment cancelled by administrator';
    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: ReportStatus.PENDING,
        assignedProviderId: null,
        assignedAt: null,
        assignmentDeadlineAt: null,
        lastAssignmentOutcome: AssignmentOutcome.REJECTED,
        lastAssignmentReason: cleanReason,
        lastAssignmentAt: new Date(),
        lastAssignmentProviderId: previousProviderId,
      },
      include: this.includeRelations(),
    });

    await this.audit('Assignment Cancelled', user, {
      targetType: 'Report',
      targetId: reportId,
      reason: cleanReason,
      previousProviderId,
      organizationId: updated.organizationId,
    });
    await this.recordReportActivity(reportId, 'ASSIGNMENT_CANCELLED', user, {
      organizationId: updated.organizationId,
      fromStatus: report.status,
      toStatus: updated.status,
      providerId: previousProviderId,
      reason: cleanReason,
      metadata: { returnedToDispatchQueue: true },
    });
    await this.createNotification({
      userId: previousProviderId,
      reportId,
      type: 'assignment_cancelled',
      title: 'Assignment cancelled',
      message: `Your assignment for "${updated.title}" was cancelled. Reason: ${cleanReason}`,
    });
    await this.notifyOrganizationOperators(updated.organizationId, {
      reportId,
      type: 'assignment_cancelled',
      title: 'Assignment returned to dispatch',
      message: `"${updated.title}" was returned to the dispatch queue.`,
    });
    return this.withProtectedEvidenceUrls(updated);
  }

  async reassignProvider(
    reportId: string,
    providerId: string,
    reason: string | undefined,
    user: JwtUser,
  ) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });
    if (!report) throw new NotFoundException('Report not found');

    const previousProviderId = report.assignedProviderId;
    if (previousProviderId) {
      await this.cancelAssignment(
        reportId,
        reason?.trim() || 'Reassigned by administrator',
        user,
      );
    }
    const updated = await this.assignProviderById(reportId, providerId, user);
    await this.audit('Report Reassigned', user, {
      targetType: 'Report',
      targetId: reportId,
      previousProviderId,
      newProviderId: providerId,
      reason: reason?.trim() || null,
      organizationId: updated.organizationId,
    });
    await this.recordReportActivity(reportId, 'PROVIDER_REASSIGNED', user, {
      organizationId: updated.organizationId,
      fromStatus: ReportStatus.PENDING,
      toStatus: updated.status,
      providerId,
      reason: reason?.trim() || undefined,
      metadata: { previousProviderId },
    });
    if (previousProviderId) {
      await this.createNotification({
        userId: previousProviderId,
        reportId,
        type: 'assignment_reassigned',
        title: 'Assignment reassigned',
        message: `"${updated.title}" was reassigned to another provider.`,
      });
    }
    await this.createNotification({
      userId: providerId,
      reportId,
      type: 'assignment',
      title: 'New assignment',
      message: `You have been assigned "${updated.title}".`,
    });
    return updated;
  }

  async assignProviderById(
    reportId: string,
    providerId: string,
    user: JwtUser,
    options: Pick<
      AssignProviderDto,
      'overrideOrganizationRouting' | 'overrideReason'
    > = {},
  ) {
    if (
      !this.isAdmin(user) &&
      !this.isDispatch(user) &&
      !this.isSuperAdmin(user)
    ) {
      throw new ForbiddenException('Not allowed');
    }

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) throw new NotFoundException('Report not found');

    const provider = await this.prisma.user.findUnique({
      where: { id: providerId },
      include: { providerOrganizations: true },
    });

    if (!provider || provider.role !== UserRole.PROVIDER) {
      throw new ForbiddenException('Invalid provider');
    }
    if (provider.accountStatus === 'SUSPENDED') {
      throw new ForbiddenException('Provider account is suspended');
    }

    const providerLinkedToReportOrg = provider.providerOrganizations.some(
      (link) => link.organizationId === report.organizationId && link.active,
    );
    const providerPrimaryInReportOrg =
      provider.organizationId === report.organizationId;
    const requiresSuperAdminOverride =
      this.isSuperAdmin(user) &&
      !providerPrimaryInReportOrg &&
      !providerLinkedToReportOrg;
    const overrideReason = options.overrideReason?.trim();
    if (requiresSuperAdminOverride) {
      if (!options.overrideOrganizationRouting || !overrideReason) {
        throw new ForbiddenException({
          code: 'ORGANIZATION_ROUTING_OVERRIDE_REQUIRED',
          message:
            'Direct provider assignment bypasses the owning organization and requires an override reason.',
        });
      }
    }

    this.assertAssignmentAllowed(
      report,
      provider.organizationId,
      providerLinkedToReportOrg,
      user,
      providerId,
    );

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        assignedProviderId: providerId,
        status: ReportStatus.ASSIGNED,
        assignedAt: new Date(),
        assignmentDeadlineAt: new Date(
          Date.now() + this.assignmentTimeoutMinutes * 60 * 1000,
        ),
        lastAssignmentOutcome: null,
        lastAssignmentReason: null,
        lastAssignmentAt: null,
        lastAssignmentProviderId: null,
      },
      include: this.includeRelations(),
    });

    await this.notifyStatusChange(updated);
    await this.notifyOrganizationOperators(updated.organizationId, {
      reportId,
      type: 'assignment',
      title: 'Provider assigned',
      message: `A provider was assigned to "${updated.title}".`,
    });
    await this.createNotification({
      userId: providerId,
      reportId,
      type: 'assignment',
      title: 'New assignment',
      message: `You have been assigned "${updated.title}". Accept before ${
        updated.assignmentDeadlineAt?.toISOString() ??
        'the timeout window expires'
      }.`,
    });
    await this.audit('Report Assigned', user, {
      targetType: 'Report',
      targetId: reportId,
      providerId,
      organizationId: updated.organizationId,
      override: requiresSuperAdminOverride,
      overrideReason: overrideReason ?? null,
    });
    await this.recordReportActivity(reportId, 'PROVIDER_ASSIGNED', user, {
      organizationId: updated.organizationId,
      fromStatus: report.status,
      toStatus: updated.status,
      providerId,
      reason: overrideReason,
      metadata: { override: requiresSuperAdminOverride },
    });
    return updated;
  }

  // ===================== STATUS =====================

  async rejectAssignment(
    reportId: string,
    dto: RejectAssignmentDto,
    user: JwtUser,
  ) {
    const userId = this.getUserId(user);
    const reason = dto.reason.trim();

    if (!this.isProvider(user)) {
      throw new ForbiddenException('Only providers can reject assignments');
    }
    await this.assertActiveProvider(userId);

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) throw new NotFoundException('Report not found');
    if (report.assignedProviderId !== userId) {
      throw new ForbiddenException('Not your report');
    }
    await this.assertProviderCanAccessReport(
      user,
      report.organizationId,
      report.assignedProviderId,
    );
    await this.assertAssignmentStillAcceptable(report, user, userId);
    if (report.status !== ReportStatus.ASSIGNED) {
      throw new ForbiddenException('Only new assignments can be rejected');
    }

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: ReportStatus.PENDING,
        assignedProviderId: null,
        assignedAt: null,
        assignmentDeadlineAt: null,
        lastAssignmentOutcome: AssignmentOutcome.REJECTED,
        lastAssignmentReason: reason,
        lastAssignmentAt: new Date(),
        lastAssignmentProviderId: userId,
      },
      include: this.includeRelations(),
    });
    await this.audit('Provider Rejected Assignment', user, {
      targetType: 'Report',
      targetId: reportId,
      reason,
    });
    await this.recordReportActivity(reportId, 'PROVIDER_REJECTED', user, {
      organizationId: updated.organizationId,
      fromStatus: report.status,
      toStatus: updated.status,
      providerId: userId,
      reason,
      metadata: { returnedToQueue: true },
    });
    await this.notifyOrganizationOperators(updated.organizationId, {
      reportId,
      type: 'assignment_rejected',
      title: 'Assignment rejected',
      message: `Provider rejected "${updated.title}". Reason: ${reason}`,
    });
    return updated;
  }

  async updateStatus(
    reportId: string,
    dto: UpdateReportStatusDto,
    user: JwtUser,
  ) {
    const userId = this.getUserId(user);

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) throw new NotFoundException('Report not found');
    if (this.isProvider(user)) await this.assertActiveProvider(userId);
    if (this.isProvider(user)) {
      await this.assertProviderCanAccessReport(
        user,
        report.organizationId,
        report.assignedProviderId,
      );
    }
    if (
      this.isProvider(user) &&
      report.status === ReportStatus.ASSIGNED &&
      dto.status === ReportStatus.IN_PROGRESS
    ) {
      await this.assertAssignmentStillAcceptable(report, user, userId);
    }
    if (
      this.isProvider(user) &&
      dto.status === ReportStatus.IN_PROGRESS &&
      this.trustService
    ) {
      await this.trustService.assertProviderJobAcceptanceAllowed({
        id: userId,
        role: user.role,
        organizationId: user.organizationId,
        email: user.email,
        fullName: user.fullName,
      });
    }

    this.assertStatusTransitionAllowed(report, dto.status, user, userId);

    const data: any = { status: dto.status };

    if (dto.status === ReportStatus.COMPLETED_BY_PROVIDER) {
      const completionEvidence = this.normalizeCompletionEvidenceFields({
        imageUrl: dto.completionImageUrl,
        imagePath: dto.completionImagePath,
      });
      data.completionNote = dto.completionNote?.trim() || null;
      data.completionImageUrl = completionEvidence.imageUrl;
      data.completionImagePath = completionEvidence.imagePath;
      data.completionLatitude = dto.completionLatitude ?? null;
      data.completionLongitude = dto.completionLongitude ?? null;
      data.completionAccuracy = dto.completionAccuracy ?? null;
      data.completionLocationCapturedAt = dto.completionLocationCapturedAt
        ? new Date(dto.completionLocationCapturedAt)
        : null;
      data.completionLocationSource =
        dto.completionLocationSource ?? this.completionLocationSourceFor(dto);
      data.completedByProviderAt = new Date();
    }

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data,
      include: this.includeRelations(),
    });

    if (dto.status === ReportStatus.COMPLETED_BY_PROVIDER) {
      await this.workflowOrchestrator?.providerCompletedReport({
        reportId,
        organizationId: updated.organizationId,
        actorId: userId,
        actorRole: user.role,
        fromStatus: report.status,
        toStatus: updated.status,
        providerId: updated.assignedProviderId ?? null,
        citizenId: updated.citizenId,
        metadata: {
          completionNote: dto.completionNote?.trim() || null,
          completionImagePath: updated.completionImagePath,
          completionLocation: this.completionLocationMetadata(updated),
        },
      });
    } else {
      await this.notifyStatusChange(updated);
    }
    await this.audit('Report Status Changed', user, {
      targetType: 'Report',
      targetId: reportId,
      status: dto.status,
      organizationId: updated.organizationId,
    });
    await this.recordReportActivity(
      reportId,
      this.activityActionForStatus(dto.status),
      user,
      {
        organizationId: updated.organizationId,
        fromStatus: report.status,
        toStatus: updated.status,
        providerId: updated.assignedProviderId ?? undefined,
        note: dto.completionNote?.trim() || undefined,
        metadata: {
          completionImagePath: updated.completionImagePath ?? undefined,
          completionLocation: this.completionLocationMetadata(updated),
        },
      },
    );
    return this.withProtectedEvidenceUrls(updated);
  }

  async uploadCompletionEvidence(
    reportId: string,
    dto: UploadCompletionEvidenceDto,
    user: JwtUser,
  ) {
    const userId = this.getUserId(user);

    if (!this.isProvider(user)) {
      throw new ForbiddenException('Only providers allowed');
    }
    await this.assertActiveProvider(userId);

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) throw new NotFoundException('Report not found');
    if (report.assignedProviderId !== userId) {
      throw new ForbiddenException('Not your report');
    }
    await this.assertProviderCanAccessReport(
      user,
      report.organizationId,
      report.assignedProviderId,
    );

    if (report.status !== ReportStatus.IN_PROGRESS) {
      throw new ForbiddenException(
        'Only in-progress jobs can receive completion evidence',
      );
    }

    const saved = await this.getUploadSecurity().saveBase64Image({
      imageBase64: dto.imageBase64,
      contentType: dto.contentType,
      folder: 'report-completion',
      reportId,
      invalidSizeMessage: 'Invalid completion image size',
    });

    await this.audit('Provider Completion Evidence Uploaded', user, {
      targetType: 'Report',
      targetId: reportId,
      imagePath: saved.imagePath,
    });
    await this.recordReportActivity(
      reportId,
      'COMPLETION_EVIDENCE_UPLOADED',
      user,
      {
        organizationId: report.organizationId,
        fromStatus: report.status,
        toStatus: report.status,
        providerId: userId,
        metadata: { imagePath: saved.imagePath, imageUrl: saved.imageUrl },
      },
    );

    return {
      completionImagePath: saved.imagePath,
      completionImageUrl:
        this.protectedEvidenceUrl(
          reportId,
          'report-completion',
          saved.imagePath,
        ) ?? saved.imageUrl,
    };
  }

  async uploadReportEvidence(
    reportId: string,
    dto: UploadReportEvidenceDto,
    user: JwtUser,
  ) {
    const userId = this.getUserId(user);

    if (user.role !== UserRole.CITIZEN) {
      throw new ForbiddenException('Only citizens can upload report evidence');
    }

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) throw new NotFoundException('Report not found');

    if (report.citizenId !== userId) {
      throw new ForbiddenException('Not your report');
    }

    const saved = await this.getUploadSecurity().saveBase64Image({
      imageBase64: dto.imageBase64,
      contentType: dto.contentType,
      folder: 'report-evidence',
      reportId,
      invalidSizeMessage: 'Invalid report image size',
    });

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        evidenceImagePath: saved.imagePath,
        evidenceImageUrl: saved.imageUrl,
      },
      include: this.includeRelations(),
    });
    await this.audit('Report Evidence Uploaded', user, {
      targetType: 'Report',
      targetId: reportId,
      imagePath: saved.imagePath,
    });
    await this.recordReportActivity(
      reportId,
      'REPORT_EVIDENCE_UPLOADED',
      user,
      {
        organizationId: report.organizationId,
        fromStatus: report.status,
        toStatus: report.status,
        metadata: { imagePath: saved.imagePath, imageUrl: saved.imageUrl },
      },
    );
    return this.withProtectedEvidenceUrls(updated);
  }

  async confirmCitizenCompletion(
    reportId: string,
    dto: CitizenConfirmCompletionDto,
    user: JwtUser,
  ) {
    const report = await this.getCitizenReviewReport(reportId, user);
    const updated = await this.prisma.report.update({
      where: { id: report.id },
      data: {
        status: ReportStatus.CLOSED,
        citizenRating: dto.rating,
        citizenFeedback: dto.feedback?.trim() || null,
        completionRejectionReason: null,
      },
      include: this.includeRelations(),
    });

    await this.notifyStatusChange(updated);
    await this.audit('Citizen Confirmed Completion', user, {
      targetType: 'Report',
      targetId: reportId,
      rating: dto.rating,
    });
    await this.recordReportActivity(
      reportId,
      'CITIZEN_CONFIRMED_COMPLETION',
      user,
      {
        organizationId: updated.organizationId,
        fromStatus: report.status,
        toStatus: updated.status,
        providerId: updated.assignedProviderId ?? undefined,
        note: dto.feedback?.trim() || undefined,
        metadata: { rating: dto.rating },
      },
    );
    await this.workflowOrchestrator?.citizenConfirmedCompletion({
      reportId,
      organizationId: updated.organizationId,
      actorId: this.getUserId(user),
      actorRole: user.role,
      fromStatus: report.status,
      toStatus: updated.status,
      providerId: updated.assignedProviderId ?? null,
      citizenId: updated.citizenId,
      metadata: {
        rating: dto.rating,
        feedback: dto.feedback?.trim() || null,
      },
    });
    return updated;
  }

  async rejectCitizenCompletion(
    reportId: string,
    dto: CitizenRejectCompletionDto,
    user: JwtUser,
  ) {
    const report = await this.getCitizenReviewReport(reportId, user);
    const updated = await this.prisma.report.update({
      where: { id: report.id },
      data: {
        status: ReportStatus.ASSIGNED,
        completionRejectionReason: dto.reason.trim(),
      },
      include: this.includeRelations(),
    });

    await this.notifyStatusChange(updated);
    await this.audit('Citizen Requested Completion Review', user, {
      targetType: 'Report',
      targetId: reportId,
      reason: dto.reason.trim(),
    });
    await this.recordReportActivity(
      reportId,
      'CITIZEN_MARKED_WORK_INCOMPLETE',
      user,
      {
        organizationId: updated.organizationId,
        fromStatus: report.status,
        toStatus: updated.status,
        providerId: updated.assignedProviderId ?? undefined,
        reason: dto.reason.trim(),
      },
    );
    await this.notifyOrganizationOperators(updated.organizationId, {
      reportId,
      type: 'completion_review_requested',
      title: 'Citizen requested review',
      message: `Citizen marked "${updated.title}" as still incomplete.`,
    });
    await this.workflowOrchestrator?.citizenRejectedCompletion({
      reportId,
      organizationId: updated.organizationId,
      actorId: this.getUserId(user),
      actorRole: user.role,
      fromStatus: report.status,
      toStatus: updated.status,
      providerId: updated.assignedProviderId ?? null,
      citizenId: updated.citizenId,
      metadata: { reason: dto.reason.trim() },
    });
    return updated;
  }

  async getCitizenCompletionReview(reportId: string, user: JwtUser) {
    const userId = this.getUserId(user);
    if (user.role !== UserRole.CITIZEN) {
      throw new ForbiddenException('Only citizens can review completion');
    }

    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: this.includeRelations(),
    });

    if (!report) throw new NotFoundException('Report not found');
    if (report.citizenId !== userId) {
      throw new ForbiddenException('Not your report');
    }

    const awaitingReview = report.status === ReportStatus.COMPLETED_BY_PROVIDER;
    const protectedReport = this.withProtectedEvidenceUrls(report);
    return {
      ...protectedReport,
      completion: {
        note: protectedReport.completionNote,
        imageUrl: protectedReport.completionImageUrl,
        imagePath: protectedReport.completionImagePath,
        submittedAt: protectedReport.completedByProviderAt,
        location: this.completionLocationMetadata(protectedReport),
      },
      provider: protectedReport.assignedProvider,
      availableActions: {
        confirm: awaitingReview,
        markIncomplete: awaitingReview,
      },
    };
  }

  // ===================== DASHBOARD =====================

  async getDashboardSummary(user: JwtUser, query?: AdminDashboardQueryDto) {
    const where = this.buildOrgScope(user, query?.period);
    await this.expireOverdueAssignments({
      organizationId: where.organizationId,
      actor: user,
    });

    const [
      total,
      pending,
      awaitingOrganizationDecision,
      triage,
      assigned,
      inProgress,
      completed,
      closed,
    ] = await Promise.all([
      this.prisma.report.count({ where }),
      this.prisma.report.count({
        where: {
          ...where,
          status: { in: [ReportStatus.PENDING, ReportStatus.ORG_REVIEW] },
        },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.ORG_REVIEW },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.TRIAGE },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.ASSIGNED },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.IN_PROGRESS },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.COMPLETED_BY_PROVIDER },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.CLOSED },
      }),
    ]);

    return {
      total,
      pending,
      awaitingOrganizationDecision,
      triage,
      assigned,
      inProgress,
      completed,
      closed,
    };
  }

  // ===================== CHART ANALYTICS =====================

  async getReportTrends(user: JwtUser) {
    const reports = await this.prisma.report.findMany({
      where: this.buildOrgScope(user),
      select: { createdAt: true, status: true },
    });

    const created: Record<string, number> = {};
    const completed: Record<string, number> = {};

    for (const r of reports) {
      const d = r.createdAt.toISOString().split('T')[0];

      created[d] = (created[d] || 0) + 1;

      if (
        r.status === ReportStatus.CLOSED ||
        r.status === ReportStatus.COMPLETED_BY_PROVIDER
      ) {
        completed[d] = (completed[d] || 0) + 1;
      }
    }

    return {
      created: this.formatChart(created),
      completed: this.formatChart(completed),
    };
  }

  async getCategoryTrends(user: JwtUser) {
    const reports = await this.prisma.report.findMany({
      where: this.buildOrgScope(user),
      select: { category: true, createdAt: true },
    });

    const map: Record<string, Record<string, number>> = {};

    for (const r of reports) {
      const d = r.createdAt.toISOString().split('T')[0];

      if (!map[r.category]) map[r.category] = {};
      map[r.category][d] = (map[r.category][d] || 0) + 1;
    }

    return Object.keys(map).map((cat) => ({
      category: cat,
      data: this.formatChart(map[cat]),
    }));
  }

  // ===================== ADVANCED ANALYTICS =====================

  async getAdvancedAnalytics(user: JwtUser) {
    const reports = await this.prisma.report.findMany({
      where: this.buildOrgScope(user),
    });

    let totalTime = 0;
    let count = 0;
    const providerMap: Record<string, number> = {};

    for (const r of reports) {
      if (r.status === ReportStatus.CLOSED) {
        const diff =
          new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime();

        totalTime += diff;
        count++;
      }

      if (r.assignedProviderId) {
        providerMap[r.assignedProviderId] =
          (providerMap[r.assignedProviderId] || 0) + 1;
      }
    }

    const avgHours = count === 0 ? 0 : totalTime / count / (1000 * 60 * 60);

    return {
      avgResolutionHours: Number(avgHours.toFixed(2)),
      totalCompleted: count,
      topProviders: Object.entries(providerMap)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 5)
        .map(([id, jobs]) => ({ providerId: id, jobs })),
    };
  }

  async getProviderPerformance(user: JwtUser) {
    const where: any = { role: UserRole.PROVIDER };
    if (!this.isSuperAdmin(user)) {
      const organizationId = this.requireUserOrganizationId(user);
      where.OR = [
        { organizationId },
        {
          providerOrganizations: {
            some: {
              organizationId,
              active: true,
            },
          },
        },
      ];
    }
    const reportScope = this.isSuperAdmin(user)
      ? undefined
      : { organizationId: this.requireUserOrganizationId(user) };
    const providers = (await this.prisma.user.findMany({
      where,
      include: { assignedReports: reportScope ? { where: reportScope } : true },
    })) as any[];

    return providers.map((p) => {
      const completed = p.assignedReports.filter(
        (report) =>
          report.status === ReportStatus.CLOSED ||
          report.status === ReportStatus.COMPLETED_BY_PROVIDER,
      );
      const rated = p.assignedReports.filter(
        (report) => typeof report.citizenRating === 'number',
      );
      const ratingTotal = rated.reduce(
        (sum, report) => sum + (report.citizenRating ?? 0),
        0,
      );
      const responseDurations = p.assignedReports
        .filter((report) => report.assignedAt && report.updatedAt)
        .map(
          (report) =>
            report.updatedAt.getTime() - (report.assignedAt?.getTime() ?? 0),
        )
        .filter((value) => value > 0);
      const avgResponseHours =
        responseDurations.length === 0
          ? 0
          : responseDurations.reduce((sum, value) => sum + value, 0) /
            responseDurations.length /
            (1000 * 60 * 60);

      return {
        providerId: p.id,
        fullName: p.fullName,
        email: p.email,
        assignedCount: p.assignedReports.length,
        completedJobs: completed.length,
        averageRating:
          rated.length === 0
            ? 0
            : Number((ratingTotal / rated.length).toFixed(2)),
        ratingCount: rated.length,
        averageResponseHours: Number(avgResponseHours.toFixed(2)),
        recentReviews: rated
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .slice(0, 5)
          .map((report) => ({
            reportId: report.id,
            title: report.title,
            rating: report.citizenRating,
            feedback: report.citizenFeedback,
            reviewedAt: report.updatedAt,
          })),
      };
    });
  }

  async getRecentReports(user: JwtUser) {
    const where = this.buildOrgScope(user);
    await this.expireOverdueAssignments({
      organizationId: where.organizationId,
      actor: user,
    });
    const reports = await this.prisma.report.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
      include: this.includeRelations(),
    });
    return reports.map((report) => this.withProtectedEvidenceUrls(report));
  }

  // ===================== HELPERS =====================

  private formatChart(map: Record<string, number>) {
    return Object.keys(map)
      .sort()
      .map((date) => ({ date, count: map[date] }));
  }

  private async getCitizenReviewReport(reportId: string, user: JwtUser) {
    const userId = this.getUserId(user);
    if (user.role !== UserRole.CITIZEN) {
      throw new ForbiddenException('Only citizens can review completion');
    }
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (report.citizenId !== userId)
      throw new ForbiddenException('Not your report');
    if (report.status !== ReportStatus.COMPLETED_BY_PROVIDER) {
      throw new ForbiddenException('Report is not awaiting citizen review');
    }
    return report;
  }

  private getUserId(user: JwtUser) {
    const id = user.id ?? user.userId ?? user.sub;
    if (!id) throw new ForbiddenException('User id missing');
    return id;
  }

  private requireUserOrganizationId(user: JwtUser) {
    if (!user.organizationId) throw new ForbiddenException('No org');
    return user.organizationId;
  }

  private buildOrgScope(user: JwtUser, period?: string) {
    const where: any = {};

    if (!this.isSuperAdmin(user)) {
      if (!user.organizationId) throw new ForbiddenException('No org');
      where.organizationId = user.organizationId;
      where.status = { not: ReportStatus.TRIAGE };
    }

    if (period) {
      const date = new Date();
      if (period === '7d') date.setDate(date.getDate() - 7);
      if (period === '30d') date.setDate(date.getDate() - 30);
      where.createdAt = { gte: date };
    }

    return where;
  }

  private async getDashboardOrganizationMetrics(user: JwtUser) {
    if (this.isSuperAdmin(user)) {
      const [total, active, suspended, archived] = await Promise.all([
        this.prisma.organization.count(),
        this.prisma.organization.count({ where: { status: 'ACTIVE' } }),
        this.prisma.organization.count({ where: { status: 'SUSPENDED' } }),
        this.prisma.organization.count({ where: { status: 'ARCHIVED' } }),
      ]);
      return { total, active, suspended, archived };
    }

    if (!user.organizationId) return null;
    const organization = await this.prisma.organization.findUnique({
      where: { id: user.organizationId },
      select: {
        id: true,
        name: true,
        status: true,
        subscriptionPlan: true,
        billingStatus: true,
        allowedReportsPerMonth: true,
      },
    });
    return organization;
  }

  private includeRelations() {
    return {
      citizen: true,
      assignedProvider: true,
      organization: true,
      assignedOrganization: true,
    };
  }

  private serializeOrganizationCandidate(
    organization: any,
    category: string,
    report?: { location?: string | null; description?: string | null; title?: string | null },
  ) {
    const activeProviders = this.organizationActiveProviders(organization);
    const acceptedProviders = this.organizationAcceptedProviders(organization);
    const explicitCapabilityProviders = activeProviders.filter((provider) =>
      this.activeProviderCapabilityIds(provider).some((id) =>
        ACTIVE_MAINTENANCE_CAPABILITIES.has(id),
      ),
    );
    const inheritedProfileProviders = activeProviders.filter(
      (provider) => this.jsonStringList(provider.serviceCategories).length > 0,
    );
    const inheritedCategories = this.collectStringList(
      activeProviders.flatMap((provider) =>
        this.jsonStringList(provider.serviceCategories),
      ),
    );
    const explicitCapabilities = this.collectStringList(
      activeProviders.flatMap((provider) =>
        this.activeProviderCapabilityIds(provider),
      ),
    );
    const coverageAreas = this.collectStringList(
      activeProviders.flatMap((provider) =>
        this.jsonStringList(provider.coverageAreas),
      ),
    );
    const serviceModuleReady = this.maintenanceModuleEnabled(
      organization.enabledModules,
    );
    const normalizedCategory = category.trim().toLowerCase();
    const inheritedCategoryMatch =
      !normalizedCategory ||
      inheritedCategories.some((item) => item.toLowerCase() === normalizedCategory);
    const explicitCapabilityBacked = explicitCapabilityProviders.length > 0;
    const locationText = [
      report?.location,
      report?.description,
      report?.title,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const jurisdiction = [
      organization.lga,
      organization.state,
      organization.address,
      ...coverageAreas,
    ]
      .filter(
        (item): item is string =>
          typeof item === 'string' && item.trim().length > 0,
      )
      .map((item) => item.toLowerCase());
    const jurisdictionMatch =
      jurisdiction.length === 0 ||
      !locationText ||
      jurisdiction.some((item) => locationText.includes(item));
    const reasons: string[] = [];
    if (organization.status !== OrganizationStatus.ACTIVE) {
      reasons.push('Organization is not active.');
    }
    if (!serviceModuleReady) {
      reasons.push('Maintenance Services is not enabled for this organization.');
    }
    if (
      organization.billingStatus === BillingStatus.SUSPENDED ||
      organization.billingStatus === BillingStatus.CANCELLED
    ) {
      reasons.push('Organization billing status blocks dispatch.');
    }
    if (!organization.contactEmail && !organization.contactPhone) {
      reasons.push('Organization contact channel is missing.');
    }
    if (!organization.state && !organization.lga && !organization.address) {
      reasons.push('Organization jurisdiction or address is missing.');
    }
    if (activeProviders.length === 0) {
      reasons.push('No accepted active provider membership is linked.');
    }
    if (!inheritedCategories.length) {
      reasons.push('No inherited provider profile categories are configured.');
    } else if (!inheritedCategoryMatch) {
      reasons.push(`No active provider profile covers ${category}.`);
    }
    if (!explicitCapabilityBacked) {
      reasons.push('No active provider has explicit approved maintenance capability metadata.');
    }
    if (!jurisdictionMatch) {
      reasons.push('Organization jurisdiction or provider coverage does not match the report location.');
    }
    const eligible = reasons.length === 0;
    const confidence = !eligible
      ? explicitCapabilityBacked || inheritedCategoryMatch
        ? 'LOW'
        : 'NONE'
      : explicitCapabilityBacked && jurisdictionMatch
        ? 'HIGH'
        : 'MEDIUM';

    return {
      type: 'ORGANIZATION',
      id: organization.id,
      name: organization.name,
      eligible,
      ready: eligible,
      reasons,
      exclusionReasons: reasons,
      categoryMatch: {
        requestedCategory: category,
        matched: inheritedCategoryMatch,
        source: explicitCapabilityBacked
          ? 'EXPLICIT_CAPABILITY_METADATA'
          : inheritedCategoryMatch
            ? 'INHERITED_PROVIDER_PROFILE'
            : 'NONE',
      },
      jurisdictionMatch,
      serviceModuleReady,
      confidence,
      activeProviderCount: activeProviders.length,
      acceptedProviderCount: acceptedProviders.length,
      capabilityBackedProviderCount: explicitCapabilityProviders.length,
      inheritedProfileProviderCount: inheritedProfileProviders.length,
      verifiedCapabilityProviderCount: explicitCapabilityProviders.length,
      coveredCategories: inheritedCategories,
      inheritedProfileCategories: inheritedCategories,
      explicitCapabilities,
      readiness: {
        organizationMembers: (organization.users ?? []).length,
        acceptedProviders: acceptedProviders.length,
        activeProviders: activeProviders.length,
        providersWithExplicitCapabilityMetadata: explicitCapabilityProviders.length,
        providersWithInheritedProfileCategories: inheritedProfileProviders.length,
        verifiedCapabilities: explicitCapabilities,
        maintenanceServicesEnabled: serviceModuleReady,
      },
      jurisdictionSummary: {
        country: organization.country,
        state: organization.state,
        lga: organization.lga,
        address: organization.address,
        coverageAreas,
      },
    };
  }

  private organizationActiveProviders(organization: any) {
    const providers = new Map<string, any>();
    for (const link of organization.providerLinks ?? []) {
      const provider = link.provider;
      if (provider?.id && provider.accountStatus === 'ACTIVE') {
        providers.set(provider.id, provider);
      }
    }
    for (const provider of organization.users ?? []) {
      if (provider.id && provider.accountStatus === 'ACTIVE') {
        providers.set(provider.id, provider);
      }
    }
    return Array.from(providers.values());
  }

  private organizationAcceptedProviders(organization: any) {
    const providers = new Map<string, any>();
    for (const link of organization.providerLinks ?? []) {
      const provider = link.provider;
      if (provider?.id && provider.accountStatus === 'ACTIVE') {
        providers.set(provider.id, provider);
      }
    }
    return Array.from(providers.values());
  }

  private activeProviderCapabilityIds(provider: any) {
    const profileData =
      provider?.profileData && typeof provider.profileData === 'object'
        ? (provider.profileData as Record<string, unknown>)
        : {};
    const assignments = profileData[PROVIDER_CAPABILITIES_KEY];
    if (!Array.isArray(assignments)) return [];
    return assignments
      .filter((item): item is Record<string, unknown> => {
        if (!item || typeof item !== 'object') return false;
        return (item.status?.toString() || 'ACTIVE') === 'ACTIVE';
      })
      .map((item) => item.id?.toString().trim() ?? '')
      .filter((item) => item.length > 0);
  }

  private maintenanceModuleEnabled(value: unknown) {
    if (value == null) return true;
    if (Array.isArray(value)) {
      return value.length === 0 || value.map(String).includes('maintenance');
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (record.maintenance === false) return false;
      const modules = record.modules;
      if (Array.isArray(modules)) return modules.map(String).includes('maintenance');
      const enabledModules = record.enabledModules;
      if (Array.isArray(enabledModules)) {
        return enabledModules.map(String).includes('maintenance');
      }
    }
    return true;
  }

  private routingDiagnostics(report: any, candidates: any[]) {
    const eligible = candidates.filter((candidate) => candidate.eligible);
    return {
      status: report.status,
      automaticRouting: {
        source: report.organizationAssignmentSource ?? null,
        skipped: report.status === ReportStatus.TRIAGE,
        matchCount: eligible.length,
        reason:
          report.status !== ReportStatus.TRIAGE
            ? 'Report was routed to organization review.'
            : eligible.length === 0
              ? 'Automatic routing skipped because no deterministic eligible organization matched.'
              : eligible.length === 1
                ? 'Automatic routing is available for one eligible organization but was not applied to this existing report.'
                : 'Automatic routing skipped because multiple eligible organizations matched.',
      },
      eligibleOrganizationCount: eligible.length,
      candidateCount: candidates.length,
    };
  }

  private async findEligibleIntakeOrganization(dto: CreateReportDto): Promise<{
    organization: any | null;
    matchCount: number;
  }> {
    const organizations = await this.prisma.organization.findMany({
      where: { status: OrganizationStatus.ACTIVE },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        providerLinks: {
          where: { active: true },
          include: {
            provider: {
              select: {
                id: true,
                accountStatus: true,
                serviceCategories: true,
                coverageAreas: true,
                profileData: true,
              },
            },
          },
        },
        users: {
          where: { role: UserRole.PROVIDER, accountStatus: 'ACTIVE' },
          select: {
            id: true,
            accountStatus: true,
            serviceCategories: true,
            coverageAreas: true,
            profileData: true,
          },
        },
      },
    });
    const location = [dto.location, dto.description, dto.title]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const eligible = organizations
      .map((organization) => ({
        organization,
        candidate: this.serializeOrganizationCandidate(
          organization,
          dto.category,
          dto,
        ),
      }))
      .filter(({ organization, candidate }) => {
        if (!candidate.eligible) return false;
        const jurisdiction = [
          organization.lga,
          organization.state,
          organization.address,
          ...candidate.jurisdictionSummary.coverageAreas,
        ]
          .filter(
            (item): item is string =>
              typeof item === 'string' && item.trim().length > 0,
          )
          .map((item) => item.toLowerCase());
        return (
          jurisdiction.length === 0 ||
          jurisdiction.some((item) => location.includes(item))
        );
      });

    if (eligible.length !== 1) {
      return { organization: null, matchCount: eligible.length };
    }
    return { organization: eligible[0].organization, matchCount: 1 };
  }

  private providerMatchesCategory(
    provider: { serviceCategories?: unknown },
    category: string,
  ) {
    const categories = this.jsonStringList(provider.serviceCategories);
    return (
      categories.length === 0 ||
      categories.some((item) => item.toLowerCase() === category.toLowerCase())
    );
  }

  private jsonStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => String(item ?? '').trim())
      .filter((item) => item.length > 0);
  }

  private collectStringList(values: string[]) {
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  }

  private locationSourceFor(dto: {
    latitude?: number | null;
    longitude?: number | null;
  }) {
    return dto.latitude != null && dto.longitude != null
      ? 'DEVICE_GPS'
      : 'UNKNOWN';
  }

  private async enforceMonthlyReportQuota(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { allowedReportsPerMonth: true },
    });
    if (organization?.allowedReportsPerMonth == null) return;
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const reportsThisMonth = await this.prisma.report.count({
      where: { organizationId, createdAt: { gte: monthStart } },
    });
    if (reportsThisMonth >= organization.allowedReportsPerMonth) {
      throw new ConflictException({
        code: 'REPORT_QUOTA_EXCEEDED',
        message: 'This organization has reached its monthly report quota.',
      });
    }
  }

  private completionLocationSourceFor(dto: {
    completionLatitude?: number | null;
    completionLongitude?: number | null;
  }) {
    return dto.completionLatitude != null && dto.completionLongitude != null
      ? 'DEVICE_GPS'
      : 'UNKNOWN';
  }

  private completionLocationMetadata(report: {
    completionLatitude?: number | null;
    completionLongitude?: number | null;
    completionAccuracy?: number | null;
    completionLocationCapturedAt?: Date | string | null;
    completionLocationSource?: string | null;
  }) {
    return {
      latitude: report.completionLatitude ?? null,
      longitude: report.completionLongitude ?? null,
      accuracy: report.completionAccuracy ?? null,
      capturedAt: report.completionLocationCapturedAt ?? null,
      source: report.completionLocationSource ?? 'UNKNOWN',
    };
  }

  private normalizeCompletionEvidenceFields(params: {
    imageUrl?: string | null;
    imagePath?: string | null;
  }) {
    const imagePath =
      this.extractLocalUploadPath(params.imagePath) ??
      this.extractLocalUploadPath(params.imageUrl);
    const imageUrl = imagePath
      ? `/uploads/${imagePath}`
      : this.normalizeExternalImageUrl(params.imageUrl);

    return {
      imageUrl,
      imagePath,
    };
  }

  private normalizeExternalImageUrl(value?: string | null) {
    const trimmed = value?.trim();
    if (!trimmed) return null;

    const localPath = this.extractLocalUploadPath(trimmed);
    if (localPath) return `/uploads/${localPath}`;

    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    return null;
  }

  private extractLocalUploadPath(value?: string | null) {
    const trimmed = value?.trim();
    if (!trimmed) return null;

    let path = trimmed.replace(/\\/g, '/');

    try {
      const parsed = new URL(trimmed);
      path = parsed.pathname;
    } catch {
      // Keep non-URL values as-is.
    }

    path = path.replace(/^\/+/, '');
    if (path.startsWith('uploads/')) {
      path = path.slice('uploads/'.length);
    }

    if (!/^(report-completion|report-evidence|demo)\//.test(path)) {
      return null;
    }

    const segments = path.split('/');
    if (
      segments.some(
        (segment) => segment === '' || segment === '.' || segment === '..',
      )
    ) {
      return null;
    }

    if (!/^[A-Za-z0-9._~/-]+$/.test(path)) {
      return null;
    }

    return path;
  }

  private async withEnterpriseReportDetails<
    T extends EnterpriseReportWithEvidence,
  >(report: T) {
    const [timeline, notifications] = await Promise.all([
      (this.prisma as any).reportActivity?.findMany
        ? (this.prisma as any).reportActivity.findMany({
            where: { reportId: report.id },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          })
        : [],
      (this.prisma as any).notification?.findMany
        ? (this.prisma as any).notification.findMany({
            where: { reportId: report.id },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 25,
          })
        : [],
    ]);

    const protectedReport = this.withProtectedEvidenceUrls(report);
    const evidenceItems = this.reportEvidenceItems(protectedReport);
    return {
      ...protectedReport,
      evidenceItems,
      enterpriseDetails: {
        evidenceItems,
        originalEvidence: {
          imageUrl: protectedReport.evidenceImageUrl ?? null,
          imagePath: protectedReport.evidenceImagePath ?? null,
        },
        completionEvidence: {
          note: protectedReport.completionNote ?? null,
          imageUrl: protectedReport.completionImageUrl ?? null,
          imagePath: protectedReport.completionImagePath ?? null,
          submittedAt: protectedReport.completedByProviderAt ?? null,
          location: this.completionLocationMetadata(protectedReport),
        },
        citizenReview: {
          rating: protectedReport.citizenRating ?? null,
          feedback: protectedReport.citizenFeedback ?? null,
          incompleteReason: protectedReport.completionRejectionReason ?? null,
        },
        assignment: {
          assignedAt: protectedReport.assignedAt ?? null,
          deadlineAt: protectedReport.assignmentDeadlineAt ?? null,
          lastOutcome: protectedReport.lastAssignmentOutcome ?? null,
          lastReason: protectedReport.lastAssignmentReason ?? null,
          lastProviderId: protectedReport.lastAssignmentProviderId ?? null,
        },
        timeline,
        notifications,
      },
    };
  }

  private reportEvidenceItems(report: EnterpriseReportWithEvidence) {
    const items: Array<{
      kind: EvidenceKind;
      imageUrl: string;
      imagePath: string | null;
      source: string;
    }> = [];
    const seen = new Set<string>();
    const add = (
      kind: EvidenceKind,
      imageUrl?: string | null,
      imagePath?: string | null,
      source = 'report',
    ) => {
      const url = imageUrl?.trim();
      const path = this.extractLocalUploadPath(imagePath) ?? this.extractLocalUploadPath(url);
      if (!url && !path) return;
      const key = `${kind}:${path ?? url}`.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      items.push({
        kind,
        imageUrl: url ?? `/uploads/${path}`,
        imagePath: path,
        source,
      });
    };

    add(
      'report-evidence',
      report.evidenceImageUrl,
      report.evidenceImagePath,
      'citizen',
    );
    add(
      'report-completion',
      report.completionImageUrl,
      report.completionImagePath,
      'provider_completion',
    );
    return items;
  }

  private async assertCanAccessEvidence(
    report: ReportWithEvidence,
    kind: EvidenceKind,
    user: JwtUser,
  ) {
    const userId = this.getUserId(user);
    const activeUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true, role: true, organizationId: true },
    });

    if (!activeUser || activeUser.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException('Evidence not available');
    }

    if (this.isSuperAdmin(user)) return;

    if (user.role === UserRole.CITIZEN && report.citizenId === userId) return;

    if (this.isProvider(user)) {
      if (
        report.assignedProviderId === userId ||
        report.lastAssignmentProviderId === userId
      ) {
        return;
      }
      await this.assertProviderCanAccessReport(
        user,
        report.organizationId,
        report.assignedProviderId,
      );
    }

    const sameOrg =
      activeUser.organizationId &&
      activeUser.organizationId === report.organizationId;
    if ((this.isAdmin(user) || this.isDispatch(user)) && sameOrg) return;

    throw new ForbiddenException('Evidence not available');
  }

  private withProtectedEvidenceUrls<T extends ReportWithEvidence>(
    report: T,
  ): T {
    return {
      ...report,
      priority: report.priority ?? this.resolveReportPriority(report),
      evidenceImageUrl:
        this.protectedEvidenceUrl(
          report.id,
          'report-evidence',
          report.evidenceImagePath ?? report.evidenceImageUrl,
        ) ?? report.evidenceImageUrl,
      completionImageUrl:
        this.protectedEvidenceUrl(
          report.id,
          'report-completion',
          report.completionImagePath ?? report.completionImageUrl,
        ) ?? report.completionImageUrl,
    } as T;
  }

  private resolveReportPriority(report: {
    description?: string | null;
    createdAt?: Date | string | null;
    status?: ReportStatus | string;
  }) {
    const text = (report.description ?? '').toLowerCase();
    let priority = 'Low';

    if (
      text.includes('fire') ||
      text.includes('accident') ||
      text.includes('collapsed') ||
      text.includes('emergency') ||
      text.includes('injury')
    ) {
      priority = 'High';
    } else if (
      text.includes('blocked') ||
      text.includes('flood') ||
      text.includes('outage')
    ) {
      priority = 'Medium';
    }

    const createdAt =
      report.createdAt instanceof Date
        ? report.createdAt
        : report.createdAt
          ? new Date(report.createdAt)
          : null;
    if (
      createdAt &&
      !Number.isNaN(createdAt.getTime()) &&
      normalizeReportStatus(report.status ?? ReportStatus.PENDING) ===
        ReportStatus.PENDING
    ) {
      const ageMinutes = Date.now() - createdAt.getTime();
      const minutes = ageMinutes / (1000 * 60);
      if (minutes >= 60 && priority === 'High') return 'Critical';
      if (minutes >= 30 && priority === 'Medium') return 'High';
      if (minutes >= 20 && priority === 'Low') return 'Medium';
    }

    return priority;
  }

  private protectedEvidenceUrl(
    reportId: string,
    kind: EvidenceKind,
    value?: string | null,
  ) {
    const path = this.extractLocalUploadPath(value);
    if (!path) return null;

    const parts = path.split('/');
    if (parts.length !== 3 || parts[0] !== kind || parts[1] !== reportId) {
      return null;
    }

    return `/api/report/${reportId}/${kind === 'report-evidence' ? 'evidence' : 'completion-evidence'}/${parts[2]}`;
  }

  private assertSafeEvidenceFileName(fileName: string) {
    if (
      fileName !== basename(fileName) ||
      !/^[A-Za-z0-9._~-]+$/.test(fileName)
    ) {
      throw new NotFoundException('Evidence not found');
    }
  }

  private contentTypeForEvidenceFile(fileName: string) {
    switch (extname(fileName).toLowerCase()) {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      case '.webp':
        return 'image/webp';
      default:
        throw new NotFoundException('Evidence not found');
    }
  }

  private assertInsideUploadRoot(uploadRoot: string, targetPath: string) {
    const relativePath = relative(uploadRoot, targetPath);

    if (
      relativePath === '' ||
      relativePath.startsWith('..') ||
      relativePath.includes(`..${sep}`) ||
      resolve(uploadRoot, relativePath) !== targetPath
    ) {
      throw new NotFoundException('Evidence not found');
    }
  }

  private async createNotification(data: {
    userId: string;
    reportId?: string;
    type: string;
    title: string;
    message: string;
  }) {
    const notification = (this.prisma as any).notification;
    if (!notification?.create) return;
    await notification.create({ data });
  }

  private async notifyReportMessageParticipants(
    report: {
      id: string;
      title: string;
      organizationId: string;
      citizenId: string;
      assignedProviderId: string | null;
    },
    authorId: string,
    message: string,
  ) {
    const participants = new Set<string>();
    participants.add(report.citizenId);
    if (report.assignedProviderId) participants.add(report.assignedProviderId);

    const operators = await this.prisma.user.findMany({
      where: {
        organizationId: report.organizationId,
        role: { in: [UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER] },
        accountStatus: { not: 'DEACTIVATED' },
      },
      select: { id: true },
      take: 25,
    });
    operators.forEach((operator) => participants.add(operator.id));
    participants.delete(authorId);

    await Promise.all(
      [...participants].map((userId) =>
        this.createNotification({
          userId,
          reportId: report.id,
          type: 'REPORT_DISCUSSION_MESSAGE',
          title: 'New report discussion message',
          message: `"${report.title}": ${message.slice(0, 140)}`,
        }),
      ),
    );
  }

  private async notifyOrganizationOperators(
    organizationId: string,
    data: {
      reportId: string;
      type: string;
      title: string;
      message: string;
    },
  ) {
    if (!this.prisma.user?.findMany) return;
    const operators = await this.prisma.user.findMany({
      where: {
        organizationId,
        role: { in: [UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER] },
        accountStatus: 'ACTIVE',
      },
      select: { id: true },
    });

    await Promise.all(
      operators.map((operator) =>
        this.createNotification({
          userId: operator.id,
          ...data,
        }),
      ),
    );
  }

  private async expireOverdueAssignments(filter: {
    providerId?: string;
    organizationId?: string;
    actor?: JwtUser;
  }) {
    const overdueReports = await this.prisma.report.findMany({
      where: {
        status: ReportStatus.ASSIGNED,
        assignmentDeadlineAt: { lt: new Date() },
        ...(filter.providerId ? { assignedProviderId: filter.providerId } : {}),
        ...(filter.organizationId
          ? { organizationId: filter.organizationId }
          : {}),
      },
      select: {
        id: true,
        title: true,
        organizationId: true,
        citizenId: true,
        assignedProviderId: true,
      },
    });
    const expired: Array<{
      id: string;
      title: string;
      organizationId: string;
      previousProviderId: string | null;
    }> = [];

    for (const report of overdueReports) {
      await this.prisma.report.update({
        where: { id: report.id },
        data: {
          status: ReportStatus.PENDING,
          assignedProviderId: null,
          assignedAt: null,
          assignmentDeadlineAt: null,
          lastAssignmentOutcome: AssignmentOutcome.TIMED_OUT,
          lastAssignmentReason: 'Assignment acceptance window expired',
          lastAssignmentAt: new Date(),
          lastAssignmentProviderId: report.assignedProviderId,
        },
      });
      await this.recordReportActivity(
        report.id,
        'ASSIGNMENT_TIMED_OUT',
        filter.actor ?? {
          role: UserRole.DISPATCH_OFFICER,
          fullName: 'System',
        },
        {
          organizationId: report.organizationId,
          fromStatus: ReportStatus.ASSIGNED,
          toStatus: ReportStatus.PENDING,
          providerId: report.assignedProviderId ?? undefined,
          reason: 'Assignment acceptance window expired',
          metadata: { autoUnassigned: true },
        },
      );
      await this.notifyOrganizationOperators(report.organizationId, {
        reportId: report.id,
        type: 'assignment_timeout',
        title: 'Assignment timed out',
        message: `Assignment for "${report.title}" timed out and returned to dispatch.`,
      });
      if (report.assignedProviderId) {
        await this.createNotification({
          userId: report.assignedProviderId,
          reportId: report.id,
          type: 'assignment_timeout',
          title: 'Assignment timed out',
          message: `Your assignment for "${report.title}" expired and was returned to dispatch.`,
        });
      }
      await this.createNotification({
        userId: report.citizenId,
        reportId: report.id,
        type: 'assignment_timeout',
        title: 'Assignment update',
        message: `The provider assignment for "${report.title}" timed out. Dispatch will reassign it.`,
      });
      await this.audit(
        'Assignment Timed Out',
        filter.actor ?? {
          role: UserRole.DISPATCH_OFFICER,
          fullName: 'System',
        },
        {
          targetType: 'Report',
          targetId: report.id,
          previousProviderId: report.assignedProviderId,
          organizationId: report.organizationId,
        },
      );
      expired.push({
        id: report.id,
        title: report.title,
        organizationId: report.organizationId,
        previousProviderId: report.assignedProviderId,
      });
    }
    return expired;
  }

  private async assertAssignmentStillAcceptable(
    report: {
      status: ReportStatus;
      assignedProviderId: string | null;
      assignmentDeadlineAt: Date | null;
    },
    user: JwtUser,
    userId: string,
  ) {
    if (
      report.status !== ReportStatus.ASSIGNED ||
      report.assignedProviderId !== userId ||
      !report.assignmentDeadlineAt ||
      report.assignmentDeadlineAt.getTime() >= Date.now()
    ) {
      return;
    }

    await this.expireOverdueAssignments({
      providerId: userId,
      actor: user,
    });
    throw new ConflictException('Assignment acceptance window expired');
  }

  private async assertActiveProvider(userId: string) {
    if (!this.prisma.user?.findUnique) return;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true, role: true },
    });
    if (!user || user.role !== UserRole.PROVIDER) {
      throw new ForbiddenException('Provider account not found');
    }
    if (user.accountStatus === 'SUSPENDED') {
      throw new ForbiddenException('Provider account is suspended');
    }
  }

  private async authorizedProviderOrganizationIds(user: JwtUser) {
    const userId = this.getUserId(user);
    const ids = new Set<string>();
    if (user.organizationId) ids.add(user.organizationId);
    const linkModel = (this.prisma as any).providerOrganization;
    if (linkModel?.findMany) {
      const links = await linkModel.findMany({
        where: { providerId: userId, active: true },
        select: { organizationId: true },
      });
      for (const link of links as Array<{ organizationId?: string | null }>) {
        if (link.organizationId) ids.add(link.organizationId);
      }
    }
    return [...ids];
  }

  private async assertProviderCanAccessReport(
    user: JwtUser,
    organizationId: string,
    assignedProviderId?: string | null,
  ) {
    if (!this.isProvider(user)) return;
    if (assignedProviderId && assignedProviderId === this.getUserId(user)) {
      return;
    }
    const organizationIds = await this.authorizedProviderOrganizationIds(user);
    if (!organizationIds.includes(organizationId)) {
      throw new ForbiddenException('Provider organization access denied');
    }
  }

  private async audit(
    action: string,
    user: JwtUser,
    metadata: Record<string, unknown> = {},
  ) {
    const audit = (this.prisma as any).demoAuditLog;
    if (!audit?.create) return;
    const actorUserId = user.id ?? user.userId ?? user.sub;
    if (!actorUserId) return;
    await audit.create({
      data: {
        action,
        actorUserId,
        metadata,
      },
    });
  }

  private async recordReportActivity(
    reportId: string,
    action: string,
    user: JwtUser,
    details: {
      organizationId: string;
      fromStatus?: ReportStatus | null;
      toStatus?: ReportStatus | null;
      providerId?: string;
      reason?: string;
      note?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    const activity = (this.prisma as any).reportActivity;
    if (!activity?.create) return;

    const actorUserId = user.id ?? user.userId ?? user.sub;
    await activity.create({
      data: {
        reportId,
        organizationId: details.organizationId,
        actorUserId: actorUserId ?? null,
        actorRole: user.role ?? null,
        actorName: user.fullName ?? user.email ?? null,
        action,
        fromStatus: details.fromStatus ?? null,
        toStatus: details.toStatus ?? null,
        providerId: details.providerId ?? null,
        reason: details.reason ?? null,
        note: details.note ?? null,
        metadata: details.metadata ?? undefined,
      },
    });
  }

  private activityActionForStatus(status: ReportStatus) {
    switch (status) {
      case ReportStatus.ASSIGNED:
        return 'PROVIDER_ASSIGNED';
      case ReportStatus.IN_PROGRESS:
        return 'PROVIDER_STARTED_WORK';
      case ReportStatus.COMPLETED_BY_PROVIDER:
        return 'PROVIDER_SUBMITTED_COMPLETION';
      case ReportStatus.CLOSED:
        return 'REPORT_CLOSED';
      case ReportStatus.PENDING:
      default:
        return 'REPORT_STATUS_CHANGED';
    }
  }

  private async notifyStatusChange(report: {
    id: string;
    title: string;
    citizenId: string;
    status: ReportStatus;
  }) {
    const messageByStatus: Partial<
      Record<ReportStatus, { title: string; message: string; type: string }>
    > = {
      [ReportStatus.ASSIGNED]: {
        type: 'assigned',
        title: 'Report assigned',
        message: `Your report "${report.title}" has been assigned to a provider.`,
      },
      [ReportStatus.IN_PROGRESS]: {
        type: 'status_update',
        title: 'Work started',
        message: `A provider has started work on "${report.title}".`,
      },
      [ReportStatus.COMPLETED_BY_PROVIDER]: {
        type: 'completion_review',
        title: 'Ready for review',
        message: `The provider marked "${report.title}" complete. Please review it.`,
      },
      [ReportStatus.CLOSED]: {
        type: 'resolved',
        title: 'Report closed',
        message: `Your report "${report.title}" has been closed.`,
      },
    };

    const notification = messageByStatus[report.status];
    if (!notification) return;

    await this.createNotification({
      userId: report.citizenId,
      reportId: report.id,
      ...notification,
    });
  }

  private isSuperAdmin(user: JwtUser) {
    return user.role === UserRole.SUPER_ADMIN;
  }

  private getUploadSecurity() {
    return this.uploadSecurity ?? new UploadSecurityService();
  }

  private isAdmin(user: JwtUser) {
    return user.role === UserRole.ORG_ADMIN;
  }

  private isDispatch(user: JwtUser) {
    return user.role === UserRole.DISPATCH_OFFICER;
  }

  private isProvider(user: JwtUser) {
    return user.role === UserRole.PROVIDER;
  }

  private assertAssignmentAllowed(
    report: {
      id?: string;
      status: ReportStatus | string;
      assignedProviderId: string | null;
      organizationId: string;
    },
    providerOrganizationId: string | null,
    providerLinkedToReportOrgOrUser: boolean | JwtUser,
    userOrProviderId?: JwtUser | string,
    providerId?: string,
  ) {
    const providerLinkedToReportOrg =
      typeof providerLinkedToReportOrgOrUser === 'boolean'
        ? providerLinkedToReportOrgOrUser
        : false;
    const user =
      typeof providerLinkedToReportOrgOrUser === 'boolean'
        ? (userOrProviderId as JwtUser)
        : providerLinkedToReportOrgOrUser;
    const resolvedProviderId =
      typeof providerLinkedToReportOrgOrUser === 'boolean'
        ? providerId
        : (userOrProviderId as string | undefined);
    const normalizedCurrentStatus = normalizeReportStatus(report.status);
    const normalizedNextStatus = normalizeReportStatus(ReportStatus.ASSIGNED);

    this.logger.debug({
      message: 'Validating report assignment workflow',
      reportId: report.id,
      currentStatus: report.status,
      assignedProviderId: report.assignedProviderId,
      providerId: resolvedProviderId,
      normalizedCurrentStatus,
      normalizedNextStatus,
    });

    if (normalizedCurrentStatus !== ReportStatus.PENDING) {
      throw new ForbiddenException(
        'Report cannot be assigned in its current status',
      );
    }

    if (report.assignedProviderId) {
      throw new ForbiddenException('Report already has an assigned provider');
    }

    if (!this.isSuperAdmin(user)) {
      if (report.organizationId !== user.organizationId) {
        throw new ForbiddenException('Cross-org not allowed');
      }

      if (
        providerOrganizationId !== user.organizationId &&
        !providerLinkedToReportOrg
      ) {
        throw new ForbiddenException('Provider must be same org');
      }
    }
  }

  private assertStatusTransitionAllowed(
    report: {
      status: ReportStatus;
      assignedProviderId: string | null;
      organizationId: string;
    },
    nextStatus: ReportStatus,
    user: JwtUser,
    userId: string,
  ) {
    if (nextStatus === ReportStatus.ASSIGNED) {
      throw new ForbiddenException(
        'Use provider assignment to move a report to ASSIGNED',
      );
    }

    if (!canTransitionReportStatus(report.status, nextStatus)) {
      throw new ForbiddenException(
        `Invalid status transition from ${report.status} to ${nextStatus}`,
      );
    }

    if (this.isProvider(user)) {
      if (report.assignedProviderId !== userId) {
        throw new ForbiddenException('Not your report');
      }

      if (
        nextStatus !== ReportStatus.IN_PROGRESS &&
        nextStatus !== ReportStatus.COMPLETED_BY_PROVIDER
      ) {
        throw new ForbiddenException('Invalid status for provider');
      }

      return;
    }

    if (this.isAdmin(user) || this.isDispatch(user)) {
      if (report.organizationId !== user.organizationId) {
        throw new ForbiddenException('Wrong org');
      }

      return;
    }

    if (!this.isSuperAdmin(user)) {
      throw new ForbiddenException('Not allowed');
    }
  }
}
