// src/report/services/dispatch-ai.service.ts
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ReportStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportService } from '../report.service';

type AuthUser = {
  id?: string;
  userId?: string;
  sub?: string;
  role: UserRole;
  organizationId?: string | null;
};

type ProviderRecommendation = {
  providerId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  activeAssignments: number;
  score: number;
  reasons: string[];
};

@Injectable()
export class DispatchAiService {
  private readonly logger = new Logger(DispatchAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reportService: ReportService,
  ) {}

  async recommendProviders(reportId: string, user: AuthUser) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    if (user.role === UserRole.SUPER_ADMIN) {
      return this.buildRecommendations(report);
    }

    if (
      user.role !== UserRole.ORG_ADMIN &&
      user.role !== UserRole.DISPATCH_OFFICER
    ) {
      throw new ForbiddenException('Not allowed');
    }

    if (!user.organizationId) {
      throw new ForbiddenException('User has no organization access');
    }

    if (report.organizationId !== user.organizationId) {
      throw new ForbiddenException('Cross-org not allowed');
    }

    return this.buildRecommendations(report);
  }

  private async buildRecommendations(report: {
    id: string;
    title: string;
    category: string;
    location: string;
    status: ReportStatus;
    organizationId: string;
  }) {
    const [totalUsers, providerRoleCount, organizationProviderCount] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({
          where: {
            role: UserRole.PROVIDER,
          },
        }),
        this.prisma.user.count({
          where: {
            role: UserRole.PROVIDER,
            organizationId: report.organizationId,
          },
        }),
      ]);

    this.logger.debug(
      {
        reportId: report.id,
        reportCategory: report.category,
        reportStatus: report.status,
        organizationId: report.organizationId,
        totalUsersBeforeFiltering: totalUsers,
        providersAfterRoleFiltering: providerRoleCount,
        providersAfterOrganizationFiltering: organizationProviderCount,
        providersAfterCategoryFiltering: organizationProviderCount,
        categoryFilterApplied: false,
        categoryFilterReason:
          'Provider category/skill fields do not exist in the current Prisma schema.',
      },
      'Dispatch recommendation provider filtering counts',
    );

    const providers = await this.prisma.user.findMany({
      where: {
        role: UserRole.PROVIDER,
        organizationId: report.organizationId,
      },
      include: {
        assignedReports: {
          where: {
            status: {
              in: [ReportStatus.ASSIGNED, ReportStatus.IN_PROGRESS],
            },
          },
          select: {
            id: true,
            status: true,
          },
        },
      },
      orderBy: {
        fullName: 'asc',
      },
    });

    this.logger.debug(
      {
        reportId: report.id,
        organizationId: report.organizationId,
        providersLoadedForRanking: providers.length,
      },
      'Dispatch recommendation providers loaded',
    );

    const rankedProviders = providers
      .map((provider) => {
        const activeAssignments = provider.assignedReports.length;
        let score = 100;
        const reasons: string[] = ['Same organization', 'Provider role matched'];

        if (activeAssignments === 0) {
          reasons.push('No active assignments');
        } else if (activeAssignments <= 2) {
          score -= 10;
          reasons.push('Low active workload');
        } else if (activeAssignments <= 4) {
          score -= 25;
          reasons.push('Moderate active workload');
        } else {
          score -= 40;
          reasons.push('High active workload');
        }

        return {
          providerId: provider.id,
          fullName: provider.fullName,
          email: provider.email,
          phone: provider.phone,
          activeAssignments,
          score,
          reasons,
        } satisfies ProviderRecommendation;
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.activeAssignments !== b.activeAssignments) {
          return a.activeAssignments - b.activeAssignments;
        }
        return a.fullName.localeCompare(b.fullName);
      });

    this.logger.debug(
      {
        reportId: report.id,
        organizationId: report.organizationId,
        finalRecommendationCount: rankedProviders.length,
        returnedRecommendationCount: Math.min(rankedProviders.length, 5),
      },
      'Dispatch recommendation final count',
    );

    return {
      report: {
        id: report.id,
        title: report.title,
        category: report.category,
        location: report.location,
        status: report.status,
        organizationId: report.organizationId,
      },
      totalCandidates: rankedProviders.length,
      bestMatch: rankedProviders[0] ?? null,
      recommendations: rankedProviders.slice(0, 5),
    };
  }

  async autoAssignBestProvider(reportId: string, user: AuthUser) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    const recommendations = await this.recommendProviders(reportId, user);
    const bestMatch = recommendations.bestMatch;

    if (!bestMatch) {
      throw new NotFoundException('No provider available for assignment');
    }

    const updatedReport = await this.reportService.assignProviderById(
      reportId,
      bestMatch.providerId,
      user,
    );

    return {
      message: 'Best provider auto-assigned successfully',
      recommendation: bestMatch,
      report: updatedReport,
    };
  }
}
