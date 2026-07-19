import { Injectable } from '@nestjs/common';
import { AccountStatus, Prisma, ReportStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type CountPoint = {
  date: string;
  reports: number;
  resolved: number;
};

type VisitorAnalyticsStore = {
  totalPageViews: number;
  daily: Record<string, { pageViews: number; sessionIds: string[] }>;
  lastUpdatedAt: string | null;
};

const VISITOR_SETTING_KEY = 'public.visitorAnalytics.v1';
const VISITOR_RETENTION_DAYS = 31;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;

@Injectable()
export class PublicMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetrics() {
    const [
      totalReports,
      activeReports,
      resolvedReports,
      closedReports,
      participatingOrganizations,
      verifiedProviders,
      closedForResolutionTime,
      regionRows,
    ] = await Promise.all([
      this.prisma.report.count(),
      this.prisma.report.count({
        where: {
          status: {
            in: [
              ReportStatus.PENDING,
              ReportStatus.ASSIGNED,
              ReportStatus.IN_PROGRESS,
              ReportStatus.COMPLETED_BY_PROVIDER,
            ],
          },
        },
      }),
      this.prisma.report.count({
        where: {
          status: {
            in: [ReportStatus.COMPLETED_BY_PROVIDER, ReportStatus.CLOSED],
          },
        },
      }),
      this.prisma.report.count({ where: { status: ReportStatus.CLOSED } }),
      this.prisma.organization.count(),
      this.prisma.user.count({
        where: {
          role: UserRole.PROVIDER,
          accountStatus: AccountStatus.ACTIVE,
        },
      }),
      this.prisma.report.findMany({
        where: { status: ReportStatus.CLOSED },
        select: { createdAt: true, updatedAt: true },
      }),
      this.prisma.organization.findMany({
        select: { state: true, country: true },
      }),
    ]);

    return {
      totalReports,
      activeReports,
      resolvedReports,
      closedReports,
      resolutionRate:
        totalReports === 0
          ? null
          : Number(((resolvedReports / totalReports) * 100).toFixed(1)),
      averageResolutionTime:
        closedForResolutionTime.length === 0
          ? null
          : Number(
              (
                closedForResolutionTime.reduce((sum, report) => {
                  return (
                    sum +
                    report.updatedAt.getTime() -
                    report.createdAt.getTime()
                  );
                }, 0) /
                closedForResolutionTime.length /
                (1000 * 60 * 60)
              ).toFixed(2),
            ),
      participatingOrganizations,
      verifiedProviders,
      pilotRegions: this.countBroadRegions(regionRows),
      lastUpdatedAt: new Date().toISOString(),
      availability: {
        resolutionRate: totalReports > 0,
        averageResolutionTime: closedForResolutionTime.length > 0,
        pilotRegions: regionRows.length > 0,
      },
    };
  }

  async getTrends() {
    const reports = await this.prisma.report.findMany({
      select: {
        category: true,
        status: true,
        createdAt: true,
        organization: {
          select: {
            state: true,
            country: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const byDate = new Map<string, CountPoint>();
    const categories = new Map<string, number>();
    const broadGeography = new Map<string, number>();

    for (const report of reports) {
      const date = report.createdAt.toISOString().slice(0, 10);
      const existing = byDate.get(date) ?? { date, reports: 0, resolved: 0 };
      existing.reports += 1;
      if (
        report.status === ReportStatus.CLOSED ||
        report.status === ReportStatus.COMPLETED_BY_PROVIDER
      ) {
        existing.resolved += 1;
      }
      byDate.set(date, existing);

      const category = this.safeLabel(report.category, 'Uncategorized');
      categories.set(category, (categories.get(category) ?? 0) + 1);

      const region = this.broadRegion(report.organization);
      broadGeography.set(region, (broadGeography.get(region) ?? 0) + 1);
    }

    return {
      reportsOverTime: [...byDate.values()],
      categories: this.toSummary(categories, 'category'),
      broadGeography: this.toSummary(broadGeography, 'region'),
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  async getPlatformStatus() {
    const metrics = await this.getMetrics();
    return {
      status: 'online',
      activeProductionModule: 'maintenance',
      futureModulesOperational: false,
      publicMetricsAvailable: true,
      successStoriesCurated: true,
      lastUpdatedAt: metrics.lastUpdatedAt,
    };
  }

  async getImpactSummary() {
    const metrics = await this.getMetrics();
    const trends = await this.getTrends();
    return {
      headline: {
        totalReports: metrics.totalReports,
        resolvedReports: metrics.resolvedReports,
        activeReports: metrics.activeReports,
        resolutionRate: metrics.resolutionRate,
        averageResolutionTime: metrics.averageResolutionTime,
      },
      trendPoints: trends.reportsOverTime.slice(-12),
      privacy:
        'Public impact analytics are aggregated and exclude identities, descriptions, evidence, exact addresses, and precise coordinates.',
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  async getCategorySummary() {
    const trends = await this.getTrends();
    return {
      categories: trends.categories.slice(0, 8),
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  async getGeographicSummary() {
    const trends = await this.getTrends();
    return {
      broadGeography: trends.broadGeography.slice(0, 8),
      precision: 'state_country_only',
      privacy:
        'Public geographic analytics use broad organization regions only. Exact report locations and coordinates are never exposed.',
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  async getSuccessStories() {
    const stories = await this.prisma.publicSuccessStory.findMany({
      where: { approvedForPublic: true },
      orderBy: [{ displayOrder: 'asc' }, { approvedAt: 'desc' }],
      take: 12,
      select: {
        id: true,
        title: true,
        summary: true,
        category: true,
        broadLocation: true,
        organizationName: true,
        outcome: true,
        resolvedAt: true,
        approvedAt: true,
        publicImage: true,
      },
    });

    return {
      stories,
      lastUpdatedAt: new Date().toISOString(),
      publicationPolicy:
        'Stories are manually curated and approved. Reports are never published automatically.',
    };
  }

  async getVisitorSummary() {
    const store = await this.readVisitorStore();
    const today = this.todayKey();
    const todayRow = store.daily[today];

    return {
      totalPageViews: store.totalPageViews,
      todayPageViews: todayRow?.pageViews ?? 0,
      todaySessions: todayRow?.sessionIds.length ?? 0,
      metricType: 'aggregate_page_views_and_daily_sessions',
      retentionDays: VISITOR_RETENTION_DAYS,
      lastUpdatedAt: store.lastUpdatedAt,
      privacy:
        'Visitor analytics store aggregate page views and anonymous browser-generated session IDs for daily deduplication. Raw IP addresses, fingerprints, identities, and precise user data are not stored.',
    };
  }

  async recordVisitorEvent(input: {
    sessionId?: unknown;
    path?: unknown;
    referrer?: unknown;
    userAgent?: unknown;
  }) {
    const sessionId = this.safeSessionId(input.sessionId);
    const path = this.safePath(input.path);

    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.platformSetting.findUnique({
        where: { key: VISITOR_SETTING_KEY },
      });
      const store = this.normalizeVisitorStore(current?.value);
      const today = this.todayKey();
      const daily = store.daily[today] ?? { pageViews: 0, sessionIds: [] };

      const hasSession = daily.sessionIds.includes(sessionId);
      daily.pageViews += 1;
      if (!hasSession) daily.sessionIds.push(sessionId);

      const next = this.pruneVisitorStore({
        ...store,
        totalPageViews: store.totalPageViews + 1,
        daily: { ...store.daily, [today]: daily },
        lastUpdatedAt: new Date().toISOString(),
      });

      await tx.platformSetting.upsert({
        where: { key: VISITOR_SETTING_KEY },
        create: {
          key: VISITOR_SETTING_KEY,
          value: next as unknown as Prisma.InputJsonValue,
        },
        update: {
          value: next as unknown as Prisma.InputJsonValue,
        },
      });

      return next;
    });

    const todayRow = updated.daily[this.todayKey()];
    return {
      recorded: true,
      countedAs: 'page_view',
      path,
      totalPageViews: updated.totalPageViews,
      todayPageViews: todayRow?.pageViews ?? 0,
      todaySessions: todayRow?.sessionIds.length ?? 0,
      lastUpdatedAt: updated.lastUpdatedAt,
    };
  }

  private countBroadRegions(
    rows: { state: string | null; country: string | null }[],
  ) {
    const regions = new Set(
      rows
        .map((row) => this.broadRegion(row))
        .filter((region) => region !== 'Unspecified region'),
    );

    return regions.size === 0 ? null : regions.size;
  }

  private broadRegion(row?: {
    state?: string | null;
    country?: string | null;
  }) {
    const state = this.safeLabel(row?.state ?? '', '');
    const country = this.safeLabel(row?.country ?? '', '');
    if (state && country) return `${state}, ${country}`;
    if (state) return state;
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

  private async readVisitorStore() {
    const setting = await this.prisma.platformSetting.findUnique({
      where: { key: VISITOR_SETTING_KEY },
    });
    return this.pruneVisitorStore(this.normalizeVisitorStore(setting?.value));
  }

  private normalizeVisitorStore(value: unknown): VisitorAnalyticsStore {
    const source =
      value && typeof value === 'object'
        ? (value as Partial<VisitorAnalyticsStore>)
        : {};

    const daily: VisitorAnalyticsStore['daily'] = {};
    if (source.daily && typeof source.daily === 'object') {
      for (const [date, row] of Object.entries(source.daily)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        if (!row || typeof row !== 'object') continue;
        const candidate = row as { pageViews?: unknown; sessionIds?: unknown };
        daily[date] = {
          pageViews: this.safeNumber(candidate.pageViews),
          sessionIds: Array.isArray(candidate.sessionIds)
            ? candidate.sessionIds
                .map((id) => this.safeSessionId(id))
                .filter(Boolean)
            : [],
        };
      }
    }

    return {
      totalPageViews: this.safeNumber(source.totalPageViews),
      daily,
      lastUpdatedAt:
        typeof source.lastUpdatedAt === 'string' ? source.lastUpdatedAt : null,
    };
  }

  private pruneVisitorStore(store: VisitorAnalyticsStore) {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - VISITOR_RETENTION_DAYS + 1);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    const daily = Object.fromEntries(
      Object.entries(store.daily).filter(([date]) => date >= cutoffKey),
    );
    return { ...store, daily };
  }

  private todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  private safeSessionId(value: unknown) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (SESSION_ID_PATTERN.test(text)) return text;
    return `anon-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 12)}`;
  }

  private safePath(value: unknown) {
    const text = typeof value === 'string' ? value.trim() : '/';
    if (!text.startsWith('/')) return '/';
    return text.slice(0, 160);
  }

  private safeNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    return 0;
  }
}
