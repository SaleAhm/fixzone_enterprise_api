import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccountStatus, Prisma, ReportStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AnalyticsInterval,
  ExecutiveAnalyticsQueryDto,
} from './dto/executive-analytics-query.dto';

export type AnalyticsUser = {
  id?: string;
  userId?: string;
  sub?: string;
  role: UserRole;
  organizationId?: string | null;
};

type TrendPoint = {
  period: string;
  submitted: number;
  resolved: number;
  active: number;
  rework: number;
};

const ACTIVE_STATUSES: ReportStatus[] = [
  ReportStatus.PENDING,
  ReportStatus.ASSIGNED,
  ReportStatus.IN_PROGRESS,
  ReportStatus.COMPLETED_BY_PROVIDER,
];

const RESOLVED_STATUSES: ReportStatus[] = [
  ReportStatus.COMPLETED_BY_PROVIDER,
  ReportStatus.CLOSED,
];

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getExecutiveOverview(
    user: AnalyticsUser,
    query: ExecutiveAnalyticsQueryDto,
  ) {
    const where = this.reportWhere(user, query);
    const providerWhere = this.providerWhere(user, query);
    const orgWhere = this.organizationWhere(user, query);
    const activityWhere = this.activityWhere(user, query);

    const [
      totalReports,
      activeReports,
      resolvedReports,
      closedReports,
      participatingOrganizations,
      activeProviders,
      closedReportsForTiming,
      reworkEvents,
      assignmentRejections,
    ] = await Promise.all([
      this.prisma.report.count({ where }),
      this.prisma.report.count({
        where: { ...where, status: { in: ACTIVE_STATUSES } },
      }),
      this.prisma.report.count({
        where: { ...where, status: { in: RESOLVED_STATUSES } },
      }),
      this.prisma.report.count({
        where: { ...where, status: ReportStatus.CLOSED },
      }),
      this.prisma.organization.count({ where: orgWhere }),
      this.prisma.user.count({ where: providerWhere }),
      this.prisma.report.findMany({
        where: { ...where, status: ReportStatus.CLOSED },
        select: { createdAt: true, updatedAt: true },
      }),
      this.prisma.reportActivity.count({
        where: {
          ...activityWhere,
          action: 'CITIZEN_MARKED_WORK_INCOMPLETE',
        },
      }),
      this.prisma.reportActivity.count({
        where: { ...activityWhere, action: 'PROVIDER_REJECTED' },
      }),
    ]);

    return {
      scope: this.scopeLabel(user, query),
      totals: {
        totalReports,
        activeReports,
        resolvedReports,
        closedReports,
        participatingOrganizations,
        activeProviders,
      },
      quality: {
        resolutionRate:
          totalReports === 0
            ? null
            : Number(((resolvedReports / totalReports) * 100).toFixed(1)),
        averageResolutionHours:
          closedReportsForTiming.length === 0
            ? null
            : Number(
                (
                  closedReportsForTiming.reduce((sum, report) => {
                    return (
                      sum +
                      report.updatedAt.getTime() -
                      report.createdAt.getTime()
                    );
                  }, 0) /
                  closedReportsForTiming.length /
                  (1000 * 60 * 60)
                ).toFixed(2),
              ),
        reworkEvents,
        assignmentRejections,
      },
      privacy:
        'Executive analytics are aggregated. Payloads exclude citizen identities, report descriptions, evidence URLs, exact addresses, and precise coordinates.',
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  async getTrendAnalytics(
    user: AnalyticsUser,
    query: ExecutiveAnalyticsQueryDto,
  ) {
    const reports = await this.prisma.report.findMany({
      where: this.reportWhere(user, query),
      select: { createdAt: true, updatedAt: true, status: true },
      orderBy: { createdAt: 'asc' },
    });
    const activityRows = await this.prisma.reportActivity.findMany({
      where: {
        ...this.activityWhere(user, query),
        action: 'CITIZEN_MARKED_WORK_INCOMPLETE',
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const interval = query.interval ?? AnalyticsInterval.Daily;
    const points = new Map<string, TrendPoint>();

    for (const report of reports) {
      const key = this.bucket(report.createdAt, interval);
      const point = this.ensureTrendPoint(points, key);
      point.submitted += 1;
      if (RESOLVED_STATUSES.includes(report.status)) {
        point.resolved += 1;
      }
      if (ACTIVE_STATUSES.includes(report.status)) {
        point.active += 1;
      }
    }

    for (const row of activityRows) {
      const key = this.bucket(row.createdAt, interval);
      this.ensureTrendPoint(points, key).rework += 1;
    }

    return {
      interval,
      points: [...points.values()].sort((a, b) =>
        a.period.localeCompare(b.period),
      ),
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  async getCategoryDistribution(
    user: AnalyticsUser,
    query: ExecutiveAnalyticsQueryDto,
  ) {
    const rows = await this.prisma.report.groupBy({
      by: ['category'],
      where: this.reportWhere(user, query),
      _count: { _all: true },
      orderBy: { _count: { category: 'desc' } },
    });

    return {
      categories: rows.map((row) => ({
        category: this.safeLabel(row.category, 'Uncategorized'),
        count: row._count._all,
      })),
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  async getStatusDistribution(
    user: AnalyticsUser,
    query: ExecutiveAnalyticsQueryDto,
  ) {
    const rows = await this.prisma.report.groupBy({
      by: ['status'],
      where: this.reportWhere(user, query),
      _count: { _all: true },
      orderBy: { _count: { status: 'desc' } },
    });

    return {
      statuses: rows.map((row) => ({
        status: row.status,
        count: row._count._all,
      })),
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  async getProviderPerformance(
    user: AnalyticsUser,
    query: ExecutiveAnalyticsQueryDto,
  ) {
    const reports = await this.prisma.report.findMany({
      where: {
        ...this.reportWhere(user, query),
        assignedProviderId: { not: null },
      },
      select: {
        assignedAt: true,
        completedByProviderAt: true,
        updatedAt: true,
        status: true,
        citizenRating: true,
        assignedProvider: {
          select: {
            id: true,
            fullName: true,
            providerId: true,
            organization: { select: { name: true } },
          },
        },
      },
    });

    const providers = new Map<
      string,
      {
        providerPublicId: string;
        providerName: string;
        organizationName: string | null;
        assigned: number;
        completed: number;
        ratingTotal: number;
        ratingCount: number;
        resolutionHoursTotal: number;
        resolutionHoursCount: number;
      }
    >();

    for (const report of reports) {
      const provider = report.assignedProvider;
      if (!provider) continue;
      const row =
        providers.get(provider.id) ??
        {
          providerPublicId: provider.providerId ?? 'PROVIDER',
          providerName: provider.fullName,
          organizationName: provider.organization?.name ?? null,
          assigned: 0,
          completed: 0,
          ratingTotal: 0,
          ratingCount: 0,
          resolutionHoursTotal: 0,
          resolutionHoursCount: 0,
        };

      row.assigned += 1;
      if (RESOLVED_STATUSES.includes(report.status)) {
        row.completed += 1;
      }
      if (report.citizenRating != null) {
        row.ratingTotal += report.citizenRating;
        row.ratingCount += 1;
      }
      if (report.assignedAt) {
        const completedAt = report.completedByProviderAt ?? report.updatedAt;
        row.resolutionHoursTotal +=
          (completedAt.getTime() - report.assignedAt.getTime()) /
          (1000 * 60 * 60);
        row.resolutionHoursCount += 1;
      }
      providers.set(provider.id, row);
    }

    return {
      providers: [...providers.values()]
        .map((provider) => ({
          providerPublicId: provider.providerPublicId,
          providerName: provider.providerName,
          organizationName: provider.organizationName,
          assigned: provider.assigned,
          completed: provider.completed,
          completionRate:
            provider.assigned === 0
              ? null
              : Number(((provider.completed / provider.assigned) * 100).toFixed(1)),
          averageRating:
            provider.ratingCount === 0
              ? null
              : Number((provider.ratingTotal / provider.ratingCount).toFixed(2)),
          averageResolutionHours:
            provider.resolutionHoursCount === 0
              ? null
              : Number(
                  (
                    provider.resolutionHoursTotal /
                    provider.resolutionHoursCount
                  ).toFixed(2),
                ),
        }))
        .sort((a, b) => b.completed - a.completed)
        .slice(0, 12),
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  async getGeographicSummary(
    user: AnalyticsUser,
    query: ExecutiveAnalyticsQueryDto,
  ) {
    const reports = await this.prisma.report.findMany({
      where: this.reportWhere(user, query),
      select: {
        organization: {
          select: { state: true, lga: true, country: true },
        },
      },
    });
    const providers = await this.prisma.user.findMany({
      where: this.providerWhere(user, query),
      select: {
        organization: {
          select: { state: true, lga: true, country: true },
        },
      },
    });

    const reportsByRegion = new Map<string, number>();
    const providersByRegion = new Map<string, number>();

    for (const report of reports) {
      const region = this.regionLabel(report.organization);
      reportsByRegion.set(region, (reportsByRegion.get(region) ?? 0) + 1);
    }
    for (const provider of providers) {
      const region = this.regionLabel(provider.organization);
      providersByRegion.set(region, (providersByRegion.get(region) ?? 0) + 1);
    }

    return {
      reportsByRegion: this.toSummary(reportsByRegion, 'region'),
      providersByRegion: this.toSummary(providersByRegion, 'region'),
      precision: 'state_lga_country_only',
      privacy:
        'Geographic summaries use organization region fields only and do not expose report coordinates or street-level locations.',
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  private reportWhere(
    user: AnalyticsUser,
    query: ExecutiveAnalyticsQueryDto,
  ): Prisma.ReportWhereInput {
    const where: Prisma.ReportWhereInput = {};
    const organizationId = this.organizationScope(user, query);
    if (organizationId) where.organizationId = organizationId;
    if (query.category?.trim()) {
      where.category = { equals: query.category.trim(), mode: 'insensitive' };
    }
    const dateFilter = this.dateFilter(query);
    if (dateFilter) where.createdAt = dateFilter;
    return where;
  }

  private activityWhere(
    user: AnalyticsUser,
    query: ExecutiveAnalyticsQueryDto,
  ): Prisma.ReportActivityWhereInput {
    const where: Prisma.ReportActivityWhereInput = {};
    const organizationId = this.organizationScope(user, query);
    if (organizationId) where.organizationId = organizationId;
    const dateFilter = this.dateFilter(query);
    if (dateFilter) where.createdAt = dateFilter;
    return where;
  }

  private providerWhere(
    user: AnalyticsUser,
    query: ExecutiveAnalyticsQueryDto,
  ): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {
      role: UserRole.PROVIDER,
      accountStatus: AccountStatus.ACTIVE,
    };
    const organizationId = this.organizationScope(user, query);
    if (organizationId) where.organizationId = organizationId;
    return where;
  }

  private organizationWhere(
    user: AnalyticsUser,
    query: ExecutiveAnalyticsQueryDto,
  ): Prisma.OrganizationWhereInput {
    const where: Prisma.OrganizationWhereInput = {};
    const organizationId = this.organizationScope(user, query);
    if (organizationId) where.id = organizationId;
    return where;
  }

  private organizationScope(
    user: AnalyticsUser,
    query: ExecutiveAnalyticsQueryDto,
  ) {
    if (user.role === UserRole.SUPER_ADMIN) {
      return query.organizationId?.trim() || undefined;
    }
    if (!user.organizationId) {
      throw new ForbiddenException('Organization scoped analytics required');
    }
    if (
      query.organizationId?.trim() &&
      query.organizationId.trim() !== user.organizationId
    ) {
      throw new ForbiddenException('Cannot access another organization analytics scope');
    }
    return user.organizationId;
  }

  private dateFilter(query: ExecutiveAnalyticsQueryDto) {
    const filter: Prisma.DateTimeFilter = {};
    if (query.from) filter.gte = new Date(query.from);
    if (query.to) filter.lte = new Date(query.to);
    return Object.keys(filter).length === 0 ? undefined : filter;
  }

  private ensureTrendPoint(points: Map<string, TrendPoint>, key: string) {
    const existing = points.get(key);
    if (existing) return existing;
    const created = {
      period: key,
      submitted: 0,
      resolved: 0,
      active: 0,
      rework: 0,
    };
    points.set(key, created);
    return created;
  }

  private bucket(date: Date, interval: AnalyticsInterval) {
    if (interval === AnalyticsInterval.Monthly) {
      return date.toISOString().slice(0, 7);
    }
    if (interval === AnalyticsInterval.Weekly) {
      const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      const days = Math.floor(
        (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
          start.getTime()) /
          86400000,
      );
      const week = Math.floor(days / 7) + 1;
      return `${date.getUTCFullYear()}-W${week.toString().padStart(2, '0')}`;
    }
    return date.toISOString().slice(0, 10);
  }

  private scopeLabel(user: AnalyticsUser, query: ExecutiveAnalyticsQueryDto) {
    const organizationId = this.organizationScope(user, query);
    return {
      organizationId: organizationId ?? null,
      global: !organizationId,
      role: user.role,
    };
  }

  private regionLabel(row?: {
    state?: string | null;
    lga?: string | null;
    country?: string | null;
  } | null) {
    const state = this.safeLabel(row?.state, '');
    const lga = this.safeLabel(row?.lga, '');
    const country = this.safeLabel(row?.country, '');
    const local = [lga, state].filter(Boolean).join(', ');
    if (local && country) return `${local}, ${country}`;
    if (local) return local;
    if (country) return country;
    return 'Unspecified region';
  }

  private safeLabel(value: string | null | undefined, fallback: string) {
    const clean = value?.trim();
    return clean && clean.length <= 80 ? clean : fallback;
  }

  private toSummary(map: Map<string, number>, key: string) {
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ [key]: label, count }));
  }
}
