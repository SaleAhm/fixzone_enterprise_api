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
  role: UserRole;
  organizationId?: string | null;
};

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  // ===================== PROVIDER =====================

  async getAssignedReports(user: JwtUser) {
    const userId = this.getUserId(user);

    if (!this.isProvider(user)) {
      throw new ForbiddenException('Only providers allowed');
    }

    return this.prisma.report.findMany({
      where: { assignedProviderId: userId },
      orderBy: { createdAt: 'desc' },
      include: this.includeRelations(),
    });
  }

  // ===================== ORGANIZATION =====================

  async getOrganizationReports(user: JwtUser) {
    const where = this.buildOrgScope(user);

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

    if (this.isSuperAdmin(user)) return report;

    const sameOrg =
      user.organizationId && report.organizationId === user.organizationId;

    if (report.citizenId === userId || report.assignedProviderId === userId) {
      return report;
    }

    if ((this.isAdmin(user) || this.isDispatch(user)) && sameOrg) {
      return report;
    }

    throw new ForbiddenException('Access denied');
  }

  // ===================== ASSIGN =====================

  async assignProvider(
    reportId: string,
    dto: AssignProviderDto,
    user: JwtUser,
  ) {
    return this.assignProviderById(reportId, dto.providerId, user);
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
        assignmentDeadlineAt: null,
        lastAssignmentOutcome: null,
        lastAssignmentReason: null,
        lastAssignmentAt: null,
        lastAssignmentProviderId: null,
      },
      include: this.includeRelations(),
    });

    await this.notifyStatusChange(updated);
    await this.audit('Report Assigned', user, {
      targetType: 'Report',
      targetId: reportId,
      providerId,
      organizationId: updated.organizationId,
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
        status: ReportStatus.IN_PROGRESS,
        completionRejectionReason: dto.reason.trim(),
      },
      include: this.includeRelations(),
    });

    await this.notifyStatusChange(updated);
    await this.audit('Citizen Rejected Completion', user, {
      targetType: 'Report',
      targetId: reportId,
      reason: dto.reason.trim(),
    });
    return updated;
  }

  // ===================== DASHBOARD =====================

  async getDashboardSummary(user: JwtUser, query?: AdminDashboardQueryDto) {
    const where = this.buildOrgScope(user, query?.period);

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

    return providers.map((p) => ({
      providerId: p.id,
      fullName: p.fullName,
      assignedCount: p.assignedReports.length,
    }));
  }

  async getRecentReports(user: JwtUser) {
    return this.prisma.report.findMany({
      where: this.buildOrgScope(user),
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

  private includeRelations() {
    return {
      citizen: true,
      assignedProvider: true,
      organization: true,
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
