import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { AssignmentOutcome, ReportStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrustService } from '../trust/trust.service';
import { AssignProviderDto } from './dto/assign-provider.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import { UploadCompletionEvidenceDto } from './dto/upload-completion-evidence.dto';
import { UploadReportEvidenceDto } from './dto/upload-report-evidence.dto';
import { AdminDashboardQueryDto } from './dto/admin-dashboard-query.dto';
import { RejectAssignmentDto } from './dto/reject-assignment.dto';
import { CitizenConfirmCompletionDto } from './dto/citizen-confirm-completion.dto';
import { CitizenRejectCompletionDto } from './dto/citizen-reject-completion.dto';
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

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);
  private readonly assignmentTimeoutMinutes = Number(
    process.env.ASSIGNMENT_TIMEOUT_MINUTES || 30,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly trustService?: TrustService,
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

    const report = await this.prisma.report.create({
      data: {
        ...dto,
        status: ReportStatus.PENDING,
        citizenId: userId,
        organizationId: user.organizationId,
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
      metadata: { category: report.category },
    });

    return report;
  }

  // ===================== CITIZEN =====================

  async getMyReports(user: JwtUser) {
    const userId = this.getUserId(user);

    try {
      const reports = await this.prisma.report.findMany({
        where: { citizenId: userId },
        orderBy: { createdAt: 'desc' },
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

      return reports;
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

    return this.prisma.report.findMany({
      where: { assignedProviderId: userId },
      orderBy: { createdAt: 'desc' },
      include: this.includeRelations(),
    });
  }

  // ===================== ORGANIZATION =====================

  async getOrganizationReports(user: JwtUser) {
    const where = this.buildOrgScope(user);
    await this.expireOverdueAssignments({
      organizationId: where.organizationId,
    });

    return this.prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: this.includeRelations(),
    });
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

    if (report.citizenId === userId || report.assignedProviderId === userId) {
      return this.withEnterpriseReportDetails(report);
    }

    if ((this.isAdmin(user) || this.isDispatch(user)) && sameOrg) {
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

  // ===================== ASSIGN =====================

  async assignProvider(
    reportId: string,
    dto: AssignProviderDto,
    user: JwtUser,
  ) {
    return this.assignProviderById(reportId, dto.providerId, user);
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
    return updated;
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

    this.assertAssignmentAllowed(
      report,
      provider.organizationId,
      provider.providerOrganizations.some(
        (link) => link.organizationId === report.organizationId && link.active,
      ),
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
    });
    await this.recordReportActivity(reportId, 'PROVIDER_ASSIGNED', user, {
      organizationId: updated.organizationId,
      fromStatus: report.status,
      toStatus: updated.status,
      providerId,
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
      data.completionNote = dto.completionNote?.trim() || null;
      data.completionImageUrl = dto.completionImageUrl?.trim() || null;
      data.completionImagePath = dto.completionImagePath?.trim() || null;
      data.completedByProviderAt = new Date();
    }

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data,
      include: this.includeRelations(),
    });

    await this.notifyStatusChange(updated);
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
          completionImagePath: dto.completionImagePath?.trim() || undefined,
        },
      },
    );
    return updated;
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

    if (report.status !== ReportStatus.IN_PROGRESS) {
      throw new ForbiddenException(
        'Only in-progress jobs can receive completion evidence',
      );
    }

    const image = Buffer.from(dto.imageBase64, 'base64');

    if (image.length === 0 || image.length > 5 * 1024 * 1024) {
      throw new ForbiddenException('Invalid completion image size');
    }

    const saved = await this.saveImage({
      image,
      contentType: dto.contentType,
      folder: 'report-completion',
      reportId,
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
      completionImageUrl: saved.imageUrl,
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

    const image = Buffer.from(dto.imageBase64, 'base64');

    if (image.length === 0 || image.length > 5 * 1024 * 1024) {
      throw new ForbiddenException('Invalid report image size');
    }

    const saved = await this.saveImage({
      image,
      contentType: dto.contentType,
      folder: 'report-evidence',
      reportId,
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
    return updated;
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
        citizenRating: dto.rating ?? null,
        citizenFeedback: dto.feedback?.trim() || null,
        completionRejectionReason: null,
      },
      include: this.includeRelations(),
    });

    await this.notifyStatusChange(updated);
    await this.audit('Citizen Confirmed Completion', user, {
      targetType: 'Report',
      targetId: reportId,
      rating: dto.rating ?? null,
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
        metadata: { rating: dto.rating ?? null },
      },
    );
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
    return {
      ...report,
      completion: {
        note: report.completionNote,
        imageUrl: report.completionImageUrl,
        imagePath: report.completionImagePath,
        submittedAt: report.completedByProviderAt,
      },
      provider: report.assignedProvider,
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

    const [total, pending, assigned, inProgress, completed, closed] =
      await Promise.all([
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
      ]);

    return { total, pending, assigned, inProgress, completed, closed };
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
    const providers = await this.prisma.user.findMany({
      where: {
        role: UserRole.PROVIDER,
        ...(this.isSuperAdmin(user)
          ? {}
          : { organizationId: user.organizationId }),
      },
      include: { assignedReports: true },
    });

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
    return this.prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: this.includeRelations(),
    });
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

  private buildOrgScope(user: JwtUser, period?: string) {
    const where: any = {};

    if (!this.isSuperAdmin(user)) {
      if (!user.organizationId) throw new ForbiddenException('No org');
      where.organizationId = user.organizationId;
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
    };
  }

  private async withEnterpriseReportDetails<T extends { id: string }>(
    report: T,
  ) {
    const [timeline, notifications] = await Promise.all([
      (this.prisma as any).reportActivity?.findMany
        ? (this.prisma as any).reportActivity.findMany({
            where: { reportId: report.id },
            orderBy: { createdAt: 'asc' },
          })
        : [],
      (this.prisma as any).notification?.findMany
        ? (this.prisma as any).notification.findMany({
            where: { reportId: report.id },
            orderBy: { createdAt: 'desc' },
            take: 25,
          })
        : [],
    ]);

    return {
      ...report,
      enterpriseDetails: {
        originalEvidence: {
          imageUrl: (report as any).evidenceImageUrl ?? null,
          imagePath: (report as any).evidenceImagePath ?? null,
        },
        completionEvidence: {
          note: (report as any).completionNote ?? null,
          imageUrl: (report as any).completionImageUrl ?? null,
          imagePath: (report as any).completionImagePath ?? null,
          submittedAt: (report as any).completedByProviderAt ?? null,
        },
        citizenReview: {
          rating: (report as any).citizenRating ?? null,
          feedback: (report as any).citizenFeedback ?? null,
          incompleteReason: (report as any).completionRejectionReason ?? null,
        },
        assignment: {
          assignedAt: (report as any).assignedAt ?? null,
          deadlineAt: (report as any).assignmentDeadlineAt ?? null,
          lastOutcome: (report as any).lastAssignmentOutcome ?? null,
          lastReason: (report as any).lastAssignmentReason ?? null,
          lastProviderId: (report as any).lastAssignmentProviderId ?? null,
        },
        timeline,
        notifications,
      },
    };
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

  private async saveImage(params: {
    image: Buffer;
    contentType: string;
    folder: string;
    reportId: string;
  }) {
    const extensionByContentType: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const extension = extensionByContentType[params.contentType];
    const fileName = `${Date.now()}-${randomUUID()}.${extension}`;
    const relativePath = join(params.folder, params.reportId, fileName);
    const uploadRoot = join(process.cwd(), 'uploads');
    const targetDir = join(uploadRoot, params.folder, params.reportId);
    const targetPath = join(uploadRoot, relativePath);

    await mkdir(targetDir, { recursive: true });
    await writeFile(targetPath, params.image);

    const imagePath = relativePath.replace(/\\/g, '/');
    return {
      imagePath,
      imageUrl: `/uploads/${imagePath}`,
    };
  }

  private isSuperAdmin(user: JwtUser) {
    return user.role === UserRole.SUPER_ADMIN;
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
