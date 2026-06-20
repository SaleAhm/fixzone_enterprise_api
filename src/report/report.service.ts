import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { ReportStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AssignProviderDto } from './dto/assign-provider.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import { UploadCompletionEvidenceDto } from './dto/upload-completion-evidence.dto';
import { AdminDashboardQueryDto } from './dto/admin-dashboard-query.dto';
import {
  canTransitionReportStatus,
  normalizeReportStatus,
} from './report-workflow';

type JwtUser = {
  id?: string;
  userId?: string;
  sub?: string;
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

    return this.prisma.report.create({
      data: {
        ...dto,
        status: ReportStatus.PENDING,
        citizenId: userId,
        organizationId: user.organizationId,
      },
      include: this.includeRelations(),
    });
  }

  // ===================== CITIZEN =====================

  async getMyReports(user: JwtUser) {
    const userId = this.getUserId(user);

    return this.prisma.report.findMany({
      where: { citizenId: userId },
      orderBy: { createdAt: 'desc' },
      include: this.includeRelations(),
    });
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
    });

    if (!provider || provider.role !== UserRole.PROVIDER) {
      throw new ForbiddenException('Invalid provider');
    }

    this.assertAssignmentAllowed(
      report,
      provider.organizationId,
      user,
      providerId,
    );

    return this.prisma.report.update({
      where: { id: reportId },
      data: {
        assignedProviderId: providerId,
        status: ReportStatus.ASSIGNED,
      },
      include: this.includeRelations(),
    });
  }

  // ===================== STATUS =====================

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

    this.assertStatusTransitionAllowed(report, dto.status, user, userId);

    const data: any = { status: dto.status };

    if (dto.status === ReportStatus.COMPLETED_BY_PROVIDER) {
      data.completionNote = dto.completionNote?.trim() || null;
      data.completionImageUrl = dto.completionImageUrl?.trim() || null;
      data.completionImagePath = dto.completionImagePath?.trim() || null;
      data.completedByProviderAt = new Date();
    }

    return this.prisma.report.update({
      where: { id: reportId },
      data,
      include: this.includeRelations(),
    });
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

    const extensionByContentType: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const extension = extensionByContentType[dto.contentType];
    const fileName = `${Date.now()}-${randomUUID()}.${extension}`;
    const relativePath = join('report-completion', reportId, fileName);
    const uploadRoot = join(process.cwd(), 'uploads');
    const targetDir = join(uploadRoot, 'report-completion', reportId);
    const targetPath = join(uploadRoot, relativePath);

    await mkdir(targetDir, { recursive: true });
    await writeFile(targetPath, image);

    const publicPath = `/uploads/${relativePath.replace(/\\/g, '/')}`;

    return {
      completionImagePath: relativePath.replace(/\\/g, '/'),
      completionImageUrl: publicPath,
    };
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
    user: JwtUser,
    providerId?: string,
  ) {
    const normalizedCurrentStatus = normalizeReportStatus(report.status);
    const normalizedNextStatus = normalizeReportStatus(ReportStatus.ASSIGNED);

    this.logger.debug({
      message: 'Validating report assignment workflow',
      reportId: report.id,
      currentStatus: report.status,
      assignedProviderId: report.assignedProviderId,
      providerId,
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

      if (providerOrganizationId !== user.organizationId) {
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
