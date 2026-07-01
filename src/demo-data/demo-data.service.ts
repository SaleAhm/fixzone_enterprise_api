import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma, ReportStatus, User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GenerateDemoEnvironmentDto } from './dto/generate-demo-environment.dto';

type JwtUser = {
  id?: string;
  userId?: string;
  sub?: string;
  role: UserRole;
};

type DemoSeedResult = {
  demoBatchId: string;
  scenario: string;
  generatedAt: Date;
  intelligenceSummary: DemoIntelligenceSummary;
  created: {
    organizations: number;
    orgAdmins: number;
    dispatchOfficers: number;
    citizens: number;
    providers: number;
    reports: number;
    notifications: number;
  };
  settings: DemoGenerationSettings;
  demoLoginHint: {
    password: string;
    providerEmail: string;
    citizenEmail: string;
    orgAdminEmail: string;
    dispatchOfficerEmail: string;
  };
};

type DemoIntelligenceSummary = {
  title: string;
  highlights: string[];
  categoryCounts: Record<string, number>;
  urgentReports: number;
  activeTeams: number;
  awaitingCitizenConfirmation: number;
  averageResponseTimeMinutes: number;
  estimatedResolutionRate: number;
  citizenSatisfaction: number;
  aiDispatchAccuracy: number;
  highPriorityLocations: string[];
  timelinePreview: string[];
};

type DemoGenerationSettings = Required<
  Pick<
    GenerateDemoEnvironmentDto,
    | 'scenario'
    | 'citizens'
    | 'providers'
    | 'organizations'
    | 'reports'
    | 'notifications'
    | 'completedJobs'
    | 'includeEvidenceImages'
    | 'generateAnalytics'
    | 'generateProviderRatings'
    | 'generateAssignments'
  >
>;

type DemoScenarioProfile = {
  name: string;
  subtitle: string;
  completionRate: number;
  unreadNotificationEvery: number;
  averageResponseTimeMinutes: number;
  aiDispatchAccuracy: number;
  templates: DemoReportTemplate[];
  providerTeams: string[];
  timeline: string[];
};

type DemoReportTemplate = {
  title: string;
  description: string;
  category: string;
  location: string;
  latitude: number;
  longitude: number;
  severity: 'Low' | 'Medium' | 'High' | 'Urgent';
  evidence: string;
};

@Injectable()
export class DemoDataService {
  private readonly logger = new Logger(DemoDataService.name);
  private readonly demoPassword = 'Password123!';

  constructor(private readonly prisma: PrismaService) {}

  async seed(
    user: JwtUser,
    dto: GenerateDemoEnvironmentDto = {},
  ): Promise<DemoSeedResult> {
    const superAdminId = this.requireSuperAdmin(user);
    const settings = this.resolveSettings(dto);
    const profile = this.scenarioProfile(settings.scenario);
    const generatedAt = new Date();
    const demoBatchId = `demo-${generatedAt
      .toISOString()
      .replace(/[-:.TZ]/g, '')
      .slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const passwordHash = await bcrypt.hash(this.demoPassword, 10);
    const tag = {
      isDemo: true,
      demoBatchId,
      demoScenario: settings.scenario,
      demoGeneratedAt: generatedAt,
      createdBySuperAdminId: superAdminId,
    };

    await this.audit('Generated Demo Started', superAdminId, {
      demoBatchId,
      scenario: profile.name,
      metadata: settings,
    });

    this.logger.warn({
      message: 'Super Admin started demo environment generation',
      superAdminId,
      demoBatchId,
      settings,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const organizations: { id: string; name: string }[] = [];
      const providers: User[] = [];
      const citizens: User[] = [];
      const orgAdmins: User[] = [];
      const dispatchOfficers: User[] = [];
      let userSequence = 0;

      for (let i = 0; i < settings.organizations; i += 1) {
        const organizationName =
          this.organizationNames[i % this.organizationNames.length];
        const organization = await tx.organization.create({
          data: {
            name:
              settings.organizations === 1
                ? `${organizationName} Demo`
                : `${organizationName} Demo ${i + 1}`,
            ...tag,
          },
        });
        organizations.push(organization);

        orgAdmins.push(
          await tx.user.create({
            data: {
              fullName: `${organizationName} Admin`,
              email: this.demoEmail('org.admin', i + 1, demoBatchId),
              phone: this.demoPhone(++userSequence),
              passwordHash,
              role: UserRole.ORG_ADMIN,
              organizationId: organization.id,
              ...tag,
            },
          }),
        );

        dispatchOfficers.push(
          await tx.user.create({
            data: {
              fullName: `${organizationName} Dispatch Officer`,
              email: this.demoEmail('dispatch', i + 1, demoBatchId),
              phone: this.demoPhone(++userSequence),
              passwordHash,
              role: UserRole.DISPATCH_OFFICER,
              organizationId: organization.id,
              ...tag,
            },
          }),
        );
      }

      for (let i = 0; i < settings.providers; i += 1) {
        const organization = organizations[i % organizations.length];
        providers.push(
          await tx.user.create({
            data: {
              fullName: profile.providerTeams[i % profile.providerTeams.length],
              email: this.demoEmail('provider', i + 1, demoBatchId),
              phone: this.demoPhone(++userSequence),
              passwordHash,
              role: UserRole.PROVIDER,
              organizationId: organization.id,
              providerId: `DEMO-PRV-${String(i + 1).padStart(3, '0')}`,
              accountStatus: 'ACTIVE',
              providerEngagementType: 'INTERNAL_STAFF',
              serviceCategories: [
                'Roads',
                'Drainage',
                'Electricity',
                'Water',
                'Waste',
              ],
              coverageAreas: [
                organization.name,
                'Central District',
                'Market Corridor',
              ],
              subscriptionPlan: 'PROFESSIONAL',
              profileData: {
                registrationNumber: `FZ-DEMO-RC-${String(i + 1).padStart(4, '0')}`,
                performanceBadge:
                  i % 3 === 0
                    ? 'Gold Response Team'
                    : i % 3 === 1
                      ? 'Verified Municipal Provider'
                      : 'Rapid Response Partner',
                profilePhotoUrl: `/uploads/demo/provider-${(i % 6) + 1}.jpg`,
                activeSubscription: true,
                billingHistory: [
                  { plan: 'FREE', status: 'COMPLETED', amount: 0 },
                  {
                    plan: 'PROFESSIONAL',
                    status: 'ACTIVE',
                    amount: 45000,
                  },
                ],
              },
              ...tag,
            },
          }),
        );
      }

      for (let i = 0; i < settings.citizens; i += 1) {
        const organization = organizations[i % organizations.length];
        citizens.push(
          await tx.user.create({
            data: {
              fullName: this.citizenNames[i % this.citizenNames.length],
              email: this.demoEmail('citizen', i + 1, demoBatchId),
              phone: this.demoPhone(++userSequence),
              passwordHash,
              role: UserRole.CITIZEN,
              organizationId: organization.id,
              ...tag,
            },
          }),
        );
      }

      let reports = 0;
      let notifications = 0;
      const categoryCounts: Record<string, number> = {};
      const statusCounts: Record<string, number> = {};
      const hotspotCounts: Record<string, number> = {};
      const statusPlan = this.statusPlan(settings, profile);

      for (let i = 0; i < settings.reports; i += 1) {
        const template = profile.templates[i % profile.templates.length];
        const status = statusPlan[i % statusPlan.length];
        const citizen = citizens[i % citizens.length];
        const provider = providers[i % providers.length];
        const assigned = status === ReportStatus.PENDING ? null : provider.id;
        const createdAt = this.hoursAgo(settings.reports - i + 6);
        const responseMinutes = profile.averageResponseTimeMinutes + (i % 9);
        const updatedAt = new Date(
          createdAt.getTime() + responseMinutes * 60000,
        );
        const evidence = this.evidenceFor(template);
        categoryCounts[template.category] =
          (categoryCounts[template.category] ?? 0) + 1;
        statusCounts[status] = (statusCounts[status] ?? 0) + 1;
        hotspotCounts[template.location] =
          (hotspotCounts[template.location] ?? 0) + 1;

        const report = await tx.report.create({
          data: {
            title: template.title,
            description: `[${template.severity} priority] ${template.description} Timeline: ${profile.timeline.join(' → ')}`,
            category: template.category,
            location: template.location,
            latitude: template.latitude,
            longitude: template.longitude,
            status,
            citizenId: citizen.id,
            organizationId: citizen.organizationId ?? organizations[0].id,
            assignedProviderId: settings.generateAssignments ? assigned : null,
            assignedAt:
              settings.generateAssignments && assigned ? updatedAt : null,
            completedByProviderAt:
              status === ReportStatus.COMPLETED_BY_PROVIDER ||
              status === ReportStatus.CLOSED
                ? updatedAt
                : null,
            completionNote:
              status === ReportStatus.COMPLETED_BY_PROVIDER ||
              status === ReportStatus.CLOSED
                ? 'Demo provider marked this job complete for review.'
                : null,
            completionImageUrl:
              settings.includeEvidenceImages &&
              (status === ReportStatus.COMPLETED_BY_PROVIDER ||
                status === ReportStatus.CLOSED)
                ? evidence.url
                : null,
            completionImagePath:
              settings.includeEvidenceImages &&
              (status === ReportStatus.COMPLETED_BY_PROVIDER ||
                status === ReportStatus.CLOSED)
                ? evidence.path
                : null,
            evidenceImageUrl: settings.includeEvidenceImages
              ? evidence.url
              : null,
            evidenceImagePath: settings.includeEvidenceImages
              ? evidence.path
              : null,
            citizenRating:
              settings.generateProviderRatings && status === ReportStatus.CLOSED
                ? 4 + (i % 2)
                : null,
            citizenFeedback:
              settings.generateProviderRatings && status === ReportStatus.CLOSED
                ? 'Demo citizen confirmed the work was resolved.'
                : null,
            createdAt,
            updatedAt,
            ...tag,
          },
        });
        reports += 1;

        const notificationData = this.notificationForStatus(
          status,
          report.title,
        );
        await tx.notification.create({
          data: {
            userId: citizen.id,
            reportId: report.id,
            type: notificationData.type,
            title: notificationData.title,
            message: notificationData.message,
            read: i % profile.unreadNotificationEvery === 0,
            createdAt: updatedAt,
            ...tag,
          },
        });
        notifications += 1;
      }

      const allDemoUsers = [
        ...citizens,
        ...providers,
        ...orgAdmins,
        ...dispatchOfficers,
      ];

      for (let i = notifications; i < settings.notifications; i += 1) {
        const recipient = allDemoUsers[i % allDemoUsers.length];
        await tx.notification.create({
          data: {
            userId: recipient.id,
            type: 'demo_activity',
            title: `${profile.name} demo update`,
            message: 'Demo city activity was generated for dashboard realism.',
            read: i % 4 === 0,
            createdAt: this.hoursAgo(settings.notifications - i),
            ...tag,
          },
        });
        notifications += 1;
      }

      return {
        organizations: organizations.length,
        citizens: citizens.length,
        providers: providers.length,
        orgAdmins: orgAdmins.length,
        dispatchOfficers: dispatchOfficers.length,
        reports,
        notifications,
        intelligenceSummary: this.buildIntelligenceSummary({
          profile,
          reports,
          providers: providers.length,
          notifications,
          categoryCounts,
          statusCounts,
          hotspotCounts,
        }),
        providerEmail: providers[0]?.email ?? '',
        citizenEmail: citizens[0]?.email ?? '',
        orgAdminEmail: orgAdmins[0]?.email ?? '',
        dispatchOfficerEmail: dispatchOfficers[0]?.email ?? '',
      };
    });

    await this.audit('Generated Demo Completed', superAdminId, {
      demoBatchId,
      scenario: profile.name,
      metadata: {
        ...result,
        intelligenceSummary: result.intelligenceSummary,
      },
    });

    this.logger.warn({
      message: 'Super Admin completed demo environment generation',
      superAdminId,
      demoBatchId,
      created: result,
    });

    return {
      demoBatchId,
      scenario: profile.name,
      generatedAt,
      intelligenceSummary: result.intelligenceSummary,
      created: {
        organizations: result.organizations,
        orgAdmins: result.orgAdmins,
        dispatchOfficers: result.dispatchOfficers,
        citizens: result.citizens,
        providers: result.providers,
        reports: result.reports,
        notifications: result.notifications,
      },
      settings,
      demoLoginHint: {
        password: this.demoPassword,
        providerEmail: result.providerEmail,
        citizenEmail: result.citizenEmail,
        orgAdminEmail: result.orgAdminEmail,
        dispatchOfficerEmail: result.dispatchOfficerEmail,
      },
    };
  }

  async reset(user: JwtUser, dto: GenerateDemoEnvironmentDto = {}) {
    const deleted = await this.purge(user, 'Reset Demo Purge');
    const generated = await this.seed(user, dto);
    return { deleted: deleted.deleted, generated };
  }

  async purge(user: JwtUser, action = 'Purged Demo') {
    const superAdminId = this.requireSuperAdmin(user);

    await this.audit(`${action} Started`, superAdminId);

    this.logger.warn({
      message: 'Super Admin started demo environment purge',
      superAdminId,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const notifications = await tx.notification.deleteMany({
        where: { isDemo: true },
      });
      const reports = await tx.report.deleteMany({ where: { isDemo: true } });
      const users = await tx.user.deleteMany({ where: { isDemo: true } });
      const organizations = await tx.organization.deleteMany({
        where: { isDemo: true },
      });

      return {
        notifications: notifications.count,
        reports: reports.count,
        users: users.count,
        organizations: organizations.count,
        images: 0,
        assignments: reports.count,
      };
    });

    await this.audit(`${action} Completed`, superAdminId, {
      metadata: result,
    });

    this.logger.warn({
      message: 'Super Admin completed demo environment purge',
      superAdminId,
      deleted: result,
    });

    return { deleted: result };
  }

  async statistics(user: JwtUser) {
    this.requireSuperAdmin(user);

    const [
      users,
      reports,
      providers,
      notifications,
      organizations,
      unreadNotifications,
      awaitingCitizenConfirmation,
      closedReports,
      categoryGroups,
      latestReport,
      latestAudit,
      latestGenerationAudit,
    ] = await Promise.all([
      this.prisma.user.count({ where: { isDemo: true } }),
      this.prisma.report.count({ where: { isDemo: true } }),
      this.prisma.user.count({
        where: { isDemo: true, role: UserRole.PROVIDER },
      }),
      this.prisma.notification.count({ where: { isDemo: true } }),
      this.prisma.organization.count({ where: { isDemo: true } }),
      this.prisma.notification.count({
        where: { isDemo: true, read: false },
      }),
      this.prisma.report.count({
        where: { isDemo: true, status: ReportStatus.COMPLETED_BY_PROVIDER },
      }),
      this.prisma.report.count({
        where: { isDemo: true, status: ReportStatus.CLOSED },
      }),
      this.prisma.report.groupBy({
        by: ['category'],
        where: { isDemo: true },
        _count: { category: true },
      }),
      this.prisma.report.findFirst({
        where: { isDemo: true },
        orderBy: { demoGeneratedAt: 'desc' },
        select: {
          demoBatchId: true,
          demoScenario: true,
          demoGeneratedAt: true,
        },
      }),
      this.prisma.demoAuditLog.findFirst({
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.demoAuditLog.findFirst({
        where: { action: 'Generated Demo Completed' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const demoExists = users + reports + notifications + organizations > 0;

    return {
      demoExists,
      currentDemoUsers: users,
      currentDemoReports: reports,
      currentDemoProviders: providers,
      currentDemoNotifications: notifications,
      currentDemoOrganizations: organizations,
      unreadDemoNotifications: unreadNotifications,
      awaitingCitizenConfirmation,
      estimatedResolutionRate:
        reports > 0 ? Math.round((closedReports / reports) * 100) : 0,
      categoryCounts: Object.fromEntries(
        categoryGroups.map((group) => [group.category, group._count.category]),
      ),
      batchId: latestReport?.demoBatchId ?? null,
      scenario: latestReport?.demoScenario ?? null,
      generationDate: latestReport?.demoGeneratedAt ?? null,
      generatedBy: latestGenerationAudit?.actorUserId ?? null,
      demoRecordCount: users + reports + notifications + organizations,
      storageUsed: demoExists ? 'local-demo-evidence-assets' : '0 B',
      intelligenceSummary:
        latestGenerationAudit?.metadata &&
        typeof latestGenerationAudit.metadata === 'object' &&
        'intelligenceSummary' in latestGenerationAudit.metadata
          ? latestGenerationAudit.metadata.intelligenceSummary
          : null,
      latestAudit,
    };
  }

  private resolveSettings(
    dto: GenerateDemoEnvironmentDto,
  ): DemoGenerationSettings {
    const scenario = this.normalizeScenario(dto.scenario);
    return {
      scenario,
      citizens: dto.citizens ?? 24,
      providers: dto.providers ?? 8,
      organizations: dto.organizations ?? 4,
      reports: dto.reports ?? 48,
      notifications: dto.notifications ?? 96,
      completedJobs: dto.completedJobs ?? 12,
      includeEvidenceImages: dto.includeEvidenceImages ?? true,
      generateAnalytics: dto.generateAnalytics ?? true,
      generateProviderRatings: dto.generateProviderRatings ?? true,
      generateAssignments: dto.generateAssignments ?? true,
    };
  }

  private normalizeScenario(scenario?: string) {
    switch ((scenario ?? 'Municipal Operations').trim()) {
      case 'Smart City':
        return 'Smart City Operations';
      case 'Flood Disaster':
        return 'Flood Emergency';
      case 'Waste Management':
        return 'Waste Management Campaign';
      default:
        return scenario?.trim() || 'Municipal Operations';
    }
  }

  private statusPlan(
    settings: DemoGenerationSettings,
    profile: DemoScenarioProfile,
  ) {
    if (!settings.generateAssignments) {
      return [ReportStatus.PENDING];
    }

    if (settings.completedJobs <= 0) {
      return [
        ReportStatus.PENDING,
        ReportStatus.ASSIGNED,
        ReportStatus.IN_PROGRESS,
      ];
    }

    if (profile.completionRate >= 80) {
      return [
        ReportStatus.CLOSED,
        ReportStatus.CLOSED,
        ReportStatus.COMPLETED_BY_PROVIDER,
        ReportStatus.IN_PROGRESS,
        ReportStatus.ASSIGNED,
        ReportStatus.PENDING,
      ];
    }

    if (profile.completionRate <= 45) {
      return [
        ReportStatus.PENDING,
        ReportStatus.ASSIGNED,
        ReportStatus.IN_PROGRESS,
        ReportStatus.IN_PROGRESS,
        ReportStatus.COMPLETED_BY_PROVIDER,
        ReportStatus.CLOSED,
      ];
    }

    return [
      ReportStatus.PENDING,
      ReportStatus.ASSIGNED,
      ReportStatus.IN_PROGRESS,
      ReportStatus.COMPLETED_BY_PROVIDER,
      ReportStatus.CLOSED,
    ];
  }

  private scenarioProfile(name: string): DemoScenarioProfile {
    const templates = this.reportTemplatesFor(name);
    const baseTimeline = [
      'Citizen submitted report',
      'AI classified category',
      'Dispatch reviewed report',
      'Provider assigned',
      'Provider accepted job',
      'Work started',
      'Evidence uploaded',
      'Citizen confirmation requested',
      'Report closed',
    ];

    const profiles: Record<string, Partial<DemoScenarioProfile>> = {
      'Smart City Operations': {
        subtitle: 'Balanced municipal activity with fast AI-assisted dispatch.',
        completionRate: 82,
        unreadNotificationEvery: 4,
        averageResponseTimeMinutes: 18,
        aiDispatchAccuracy: 94,
      },
      'Rainy Season': {
        subtitle: 'Drainage, flooded roads, potholes, and sanitation pressure.',
        completionRate: 68,
        unreadNotificationEvery: 3,
        averageResponseTimeMinutes: 27,
        aiDispatchAccuracy: 89,
      },
      'Flood Emergency': {
        subtitle: 'Clustered flood, drainage, road, and power incidents.',
        completionRate: 42,
        unreadNotificationEvery: 2,
        averageResponseTimeMinutes: 41,
        aiDispatchAccuracy: 86,
      },
      'Road Rehabilitation': {
        subtitle:
          'Roadworks, potholes, bridge inspections, and traffic signals.',
        completionRate: 74,
        unreadNotificationEvery: 4,
        averageResponseTimeMinutes: 31,
        aiDispatchAccuracy: 91,
      },
      'Electricity Outage': {
        subtitle: 'Transformer faults, fallen poles, and dark corridors.',
        completionRate: 58,
        unreadNotificationEvery: 2,
        averageResponseTimeMinutes: 36,
        aiDispatchAccuracy: 88,
      },
      'Water Crisis': {
        subtitle:
          'Burst pipes, dry taps, water board escalation, and hygiene risks.',
        completionRate: 61,
        unreadNotificationEvery: 3,
        averageResponseTimeMinutes: 33,
        aiDispatchAccuracy: 87,
      },
      'Waste Management Campaign': {
        subtitle:
          'Waste overflow hotspots and environmental sanitation sweeps.',
        completionRate: 79,
        unreadNotificationEvery: 4,
        averageResponseTimeMinutes: 24,
        aiDispatchAccuracy: 92,
      },
      'Emergency Response': {
        subtitle: 'High-priority public safety and rapid response incidents.',
        completionRate: 55,
        unreadNotificationEvery: 2,
        averageResponseTimeMinutes: 16,
        aiDispatchAccuracy: 90,
      },
      'Municipal Operations': {
        subtitle: 'Representative daily city operations across departments.',
        completionRate: 72,
        unreadNotificationEvery: 3,
        averageResponseTimeMinutes: 29,
        aiDispatchAccuracy: 90,
      },
    };

    const profile = profiles[name] ?? profiles['Municipal Operations'];

    return {
      name,
      subtitle: profile.subtitle ?? 'Representative municipal operations.',
      completionRate: profile.completionRate ?? 72,
      unreadNotificationEvery: profile.unreadNotificationEvery ?? 3,
      averageResponseTimeMinutes: profile.averageResponseTimeMinutes ?? 29,
      aiDispatchAccuracy: profile.aiDispatchAccuracy ?? 90,
      templates,
      providerTeams: this.providerTeamsFor(name),
      timeline: baseTimeline,
    };
  }

  private buildIntelligenceSummary(input: {
    profile: DemoScenarioProfile;
    reports: number;
    providers: number;
    notifications: number;
    categoryCounts: Record<string, number>;
    statusCounts: Record<string, number>;
    hotspotCounts: Record<string, number>;
  }): DemoIntelligenceSummary {
    const urgentReports = input.profile.templates.filter(
      (template) =>
        template.severity === 'Urgent' || template.severity === 'High',
    ).length;
    const awaitingCitizenConfirmation =
      input.statusCounts[ReportStatus.COMPLETED_BY_PROVIDER] ?? 0;
    const closed = input.statusCounts[ReportStatus.CLOSED] ?? 0;
    const resolutionRate =
      input.reports > 0 ? Math.round((closed / input.reports) * 100) : 0;
    const highPriorityLocations = Object.entries(input.hotspotCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([location]) => location);

    const topCategories = Object.entries(input.categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([category, count]) => `${count} ${category.toLowerCase()} reports`);

    return {
      title: `${input.profile.name} Demo Generated`,
      highlights: [
        `${input.reports} reports created`,
        `${input.providers} provider teams active`,
        ...topCategories,
        `${input.notifications} notifications generated`,
        `${awaitingCitizenConfirmation} reports awaiting citizen confirmation`,
        `Average response time: ${input.profile.averageResponseTimeMinutes} minutes`,
        `Estimated resolution rate: ${resolutionRate}%`,
      ],
      categoryCounts: input.categoryCounts,
      urgentReports: Math.min(
        input.reports,
        urgentReports *
          Math.ceil(input.reports / input.profile.templates.length),
      ),
      activeTeams: input.providers,
      awaitingCitizenConfirmation,
      averageResponseTimeMinutes: input.profile.averageResponseTimeMinutes,
      estimatedResolutionRate: resolutionRate,
      citizenSatisfaction:
        input.profile.completionRate >= 75
          ? 4.7
          : input.profile.completionRate >= 60
            ? 4.3
            : 3.9,
      aiDispatchAccuracy: input.profile.aiDispatchAccuracy,
      highPriorityLocations,
      timelinePreview: input.profile.timeline,
    };
  }

  private evidenceFor(template: DemoReportTemplate) {
    const file = template.evidence || 'municipal-operations.svg';
    return {
      url: `/uploads/demo/${file}`,
      path: `uploads/demo/${file}`,
    };
  }

  private requireSuperAdmin(user: JwtUser) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super Admin only');
    }

    const id = user.id ?? user.userId ?? user.sub;
    if (!id) throw new ForbiddenException('User id missing');
    return id;
  }

  private hoursAgo(hours: number) {
    const date = new Date();
    date.setHours(date.getHours() - hours);
    return date;
  }

  private demoEmail(kind: string, index: number, demoBatchId: string) {
    return `demo.${kind}.${index}.${demoBatchId}@fixzone.test`;
  }

  private demoPhone(sequence: number) {
    const suffix = `${Date.now().toString().slice(-7)}${String(
      sequence,
    ).padStart(4, '0')}`;
    return `+2348${suffix}`;
  }

  private async audit(
    action: string,
    actorUserId: string,
    options: {
      demoBatchId?: string;
      scenario?: string;
      metadata?: Prisma.InputJsonValue;
    } = {},
  ) {
    await this.prisma.demoAuditLog.create({
      data: {
        action,
        actorUserId,
        demoBatchId: options.demoBatchId,
        scenario: options.scenario,
        metadata: options.metadata,
      },
    });
  }

  private notificationForStatus(status: ReportStatus, title: string) {
    switch (status) {
      case ReportStatus.ASSIGNED:
        return {
          type: 'assigned',
          title: 'Provider assigned',
          message: `Demo report "${title}" has been assigned to a provider.`,
        };
      case ReportStatus.IN_PROGRESS:
        return {
          type: 'status_update',
          title: 'Repair started',
          message: `A demo provider has started work on "${title}".`,
        };
      case ReportStatus.COMPLETED_BY_PROVIDER:
        return {
          type: 'completion_review',
          title: 'Evidence uploaded',
          message: `Demo report "${title}" is ready for citizen confirmation.`,
        };
      case ReportStatus.CLOSED:
        return {
          type: 'resolved',
          title: 'Report closed',
          message: `Demo report "${title}" has been closed.`,
        };
      case ReportStatus.PENDING:
      default:
        return {
          type: 'acknowledged',
          title: 'Report received',
          message: `Demo report "${title}" has been received.`,
        };
    }
  }

  private reportTemplatesFor(scenario: string) {
    const byScenario: Record<string, DemoReportTemplate[]> = {
      'Rainy Season': [
        {
          title: 'Blocked drainage near community market',
          description:
            'Heavy rainfall is causing water to pool beside shops and pedestrian paths.',
          category: 'Water & Sanitation',
          location: 'Gwarinpa drainage corridor',
          latitude: 9.1077,
          longitude: 7.4082,
          severity: 'High',
          evidence: 'blocked-drainage.svg',
        },
        {
          title: 'Waterlogged access road to primary school',
          description:
            'Students are walking through standing water after overnight rain.',
          category: 'Flood Control',
          location: 'Kubwa school access road',
          latitude: 9.1538,
          longitude: 7.322,
          severity: 'Urgent',
          evidence: 'flooded-street.svg',
        },
        {
          title: 'Pothole cluster slowing traffic after rainfall',
          description:
            'Several potholes opened across a commuter lane after sustained rainfall.',
          category: 'Road & Infrastructure',
          location: 'Airport Road flood-prone segment',
          latitude: 9.018,
          longitude: 7.371,
          severity: 'High',
          evidence: 'pothole-road-damage.svg',
        },
      ],
      'Flood Emergency': [
        {
          title: 'Flooded street blocking evacuation route',
          description:
            'Water levels are rising across a residential evacuation corridor.',
          category: 'Flood Control',
          location: 'Nyanya/Mararaba low-lying corridor',
          latitude: 9.0259,
          longitude: 7.6043,
          severity: 'Urgent',
          evidence: 'flooded-street.svg',
        },
        {
          title: 'Transformer exposed by floodwater',
          description:
            'Residents report floodwater around a transformer base near shops.',
          category: 'Electricity',
          location: 'Garki emergency power hotspot',
          latitude: 9.0305,
          longitude: 7.4878,
          severity: 'Urgent',
          evidence: 'broken-transformer.svg',
        },
        {
          title: 'Drainage channel overflowing into homes',
          description:
            'A drainage channel has overflowed and is entering residential compounds.',
          category: 'Water & Sanitation',
          location: 'Gwarinpa drainage corridor',
          latitude: 9.1077,
          longitude: 7.4082,
          severity: 'Urgent',
          evidence: 'blocked-drainage.svg',
        },
      ],
      'Electricity Outage': [
        {
          title: 'Street light outage at main junction',
          description:
            'The junction has been dark at night and pedestrians are avoiding the area.',
          category: 'Electricity',
          location: 'Wuse traffic light corridor',
          latitude: 9.0765,
          longitude: 7.4938,
          severity: 'High',
          evidence: 'street-light-fault.svg',
        },
        {
          title: 'Exposed cable beside footpath',
          description:
            'An electrical cable is exposed near a footpath used by residents.',
          category: 'Public Safety',
          location: 'Garki residential feeder line',
          latitude: 9.0305,
          longitude: 7.4878,
          severity: 'Urgent',
          evidence: 'fallen-electric-pole.svg',
        },
      ],
      'Waste Management Campaign': [
        {
          title: 'Overflowing waste collection point',
          description:
            'Waste has exceeded the collection bin and is spilling onto the walkway.',
          category: 'Waste Management',
          location: 'Nyanya/Mararaba bus corridor',
          latitude: 9.0259,
          longitude: 7.6043,
          severity: 'Medium',
          evidence: 'waste-overflow.svg',
        },
        {
          title: 'Illegal dumping behind neighborhood clinic',
          description:
            'Residents report repeated dumping that needs evacuation and monitoring.',
          category: 'Waste Management',
          location: 'Gwarinpa clinic service lane',
          latitude: 9.1077,
          longitude: 7.4082,
          severity: 'High',
          evidence: 'refuse-dump.svg',
        },
      ],
      'Road Rehabilitation': [
        {
          title: 'Failed asphalt section on commuter road',
          description:
            'A damaged road segment is forcing vehicles into a single lane.',
          category: 'Road & Infrastructure',
          location: 'Kubwa arterial road',
          latitude: 9.1538,
          longitude: 7.322,
          severity: 'High',
          evidence: 'pothole-road-damage.svg',
        },
        {
          title: 'Damaged traffic signal after roadworks',
          description:
            'Traffic signal heads are misaligned near an active rehabilitation zone.',
          category: 'Traffic Management',
          location: 'Wuse traffic light corridor',
          latitude: 9.0765,
          longitude: 7.4938,
          severity: 'Medium',
          evidence: 'street-light-fault.svg',
        },
      ],
      'Water Crisis': [
        {
          title: 'Burst water pipe flooding service road',
          description:
            'A major water line has burst and is affecting household supply.',
          category: 'Water & Sanitation',
          location: 'Garki water board zone',
          latitude: 9.0305,
          longitude: 7.4878,
          severity: 'Urgent',
          evidence: 'burst-water-pipe.svg',
        },
        {
          title: 'Public facility without running water',
          description:
            'A public health facility is operating without reliable water supply.',
          category: 'Public Facility',
          location: 'Wuse civic facility cluster',
          latitude: 9.0765,
          longitude: 7.4938,
          severity: 'High',
          evidence: 'damaged-public-facility.svg',
        },
      ],
      'Emergency Response': [
        {
          title: 'Fallen electric pole near busy road',
          description:
            'A pole is leaning into a traffic lane and requires immediate cordon.',
          category: 'Public Safety',
          location: 'Airport Road emergency corridor',
          latitude: 9.018,
          longitude: 7.371,
          severity: 'Urgent',
          evidence: 'fallen-electric-pole.svg',
        },
        {
          title: 'Damaged public facility after storm',
          description:
            'A community facility roof and access ramp were damaged by a storm.',
          category: 'Public Facility',
          location: 'Kubwa civic centre',
          latitude: 9.1538,
          longitude: 7.322,
          severity: 'High',
          evidence: 'damaged-public-facility.svg',
        },
      ],
      'Smart City Operations': [
        ...this.defaultReportTemplates,
        {
          title: 'Traffic signal timing fault detected by citizen reports',
          description:
            'Multiple citizens reported abnormal signal timing and traffic buildup.',
          category: 'Traffic Management',
          location: 'Wuse traffic light corridor',
          latitude: 9.0765,
          longitude: 7.4938,
          severity: 'Medium',
          evidence: 'street-light-fault.svg',
        },
      ],
    };

    return byScenario[scenario] ?? this.defaultReportTemplates;
  }

  private providerTeamsFor(scenario: string) {
    const teams: Record<string, string[]> = {
      'Flood Emergency': [
        'Drainage Response Team',
        'Emergency Flood Evacuation Crew',
        'Water Board Emergency Crew',
        'Electrical Fault Response Unit',
        'Road Safety Rapid Response',
      ],
      'Rainy Season': [
        'Drainage Response Team',
        'Road Maintenance Unit Alpha',
        'Waste Collection Team North',
        'Water Board Emergency Crew',
      ],
      'Road Rehabilitation': [
        'Road Maintenance Unit Alpha',
        'Bridge Inspection Team',
        'Traffic Signal Maintenance Team',
      ],
      'Electricity Outage': [
        'Electrical Fault Response Unit',
        'Street Light Maintenance Team',
        'Grid Safety Inspection Crew',
      ],
      'Water Crisis': [
        'Water Board Emergency Crew',
        'Pipe Repair Unit Delta',
        'Public Facility Water Support Team',
      ],
      'Waste Management Campaign': [
        'Waste Collection Team North',
        'Environmental Sanitation Squad',
        'Market Cleanup Taskforce',
      ],
      'Emergency Response': [
        'Emergency Response Unit One',
        'Electrical Safety Rapid Team',
        'Public Facility Rescue Crew',
      ],
    };

    return teams[scenario] ?? this.providerNames;
  }

  private readonly organizationNames = [
    'Road Maintenance Agency',
    'Water Board',
    'Environmental Protection',
    'Waste Management Authority',
    'Electricity Maintenance',
    'Emergency Response',
    'Traffic Management',
  ];

  private readonly providerNames = [
    'Aisha Technical Services',
    'Musa Rapid Repairs',
    'Greenline Sanitation Crew',
    'Northbridge Electrical Team',
    'CivicWorks Maintenance',
    'BlueGate Response Unit',
    'Metro Waste Crew',
    'Rapid Roadworks Team',
  ];

  private readonly citizenNames = [
    'Amina Yusuf',
    'Chinedu Okafor',
    'Grace Danladi',
    'Ibrahim Lawal',
    'Khadija Bello',
    'Maryam Sani',
    'Samuel Adeyemi',
    'Zainab Musa',
    'Emeka Nwosu',
    'Fatima Abdullahi',
  ];

  private readonly defaultReportTemplates: DemoReportTemplate[] = [
    {
      title: 'Road surface damage causing slow traffic',
      description:
        'A damaged section of road is forcing vehicles into the opposite lane.',
      category: 'Road & Infrastructure',
      location: 'Kubwa arterial road',
      latitude: 9.1538,
      longitude: 7.322,
      severity: 'High',
      evidence: 'pothole-road-damage.svg',
    },
    {
      title: 'Blocked drainage near community market',
      description:
        'Water is collecting after rainfall and needs clearing before it affects nearby shops.',
      category: 'Water & Sanitation',
      location: 'Gwarinpa drainage corridor',
      latitude: 9.1077,
      longitude: 7.4082,
      severity: 'High',
      evidence: 'blocked-drainage.svg',
    },
    {
      title: 'Street light outage at main junction',
      description:
        'The junction has been dark at night and pedestrians are avoiding the area.',
      category: 'Electricity',
      location: 'Wuse traffic light corridor',
      latitude: 9.0765,
      longitude: 7.4938,
      severity: 'Medium',
      evidence: 'street-light-fault.svg',
    },
    {
      title: 'Overflowing waste collection point',
      description:
        'Waste has exceeded the collection bin and is spilling onto the walkway.',
      category: 'Waste Management',
      location: 'Nyanya/Mararaba bus corridor',
      latitude: 9.0259,
      longitude: 7.6043,
      severity: 'Medium',
      evidence: 'waste-overflow.svg',
    },
    {
      title: 'Exposed cable beside footpath',
      description:
        'An electrical cable is exposed near a footpath used by residents.',
      category: 'Public Safety',
      location: 'Garki residential feeder line',
      latitude: 9.0305,
      longitude: 7.4878,
      severity: 'Urgent',
      evidence: 'fallen-electric-pole.svg',
    },
  ];
}
