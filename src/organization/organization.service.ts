import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingStatus,
  OrganizationStatus,
  Prisma,
  SubscriptionPlan,
  UpgradeRequestStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformModulesService } from '../platform-modules/platform-modules.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import {
  CreateJurisdictionZoneDto,
  UpdateJurisdictionZoneDto,
} from './dto/jurisdiction-zone.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { evaluateRoutingJurisdiction } from './routing-jurisdiction';

type JwtUser = {
  sub: string;
  email?: string | null;
  phone?: string | null;
  fullName?: string;
  role?: string;
  organizationId?: string | null;
};

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformModules: PlatformModulesService,
  ) {}

  async create(dto: CreateOrganizationDto, user: JwtUser) {
    this.assertSuperAdmin(user);
    const name = dto.name?.trim();

    if (!name) {
      throw new BadRequestException('Organization name is required');
    }

    const organization = await this.prisma.organization.create({
      data: this.buildOrganizationData(dto, {
        name,
        enabledModules: this.platformModules.toJson(dto.enabledModules),
      }) as Prisma.OrganizationUncheckedCreateInput,
    });

    await this.audit('Organization Created', user, {
      organizationId: organization.id,
      name: organization.name,
    });

    return this.withStats(organization);
  }

  async findAll(user: JwtUser) {
    const where = this.organizationScope(user);
    const organizations = await this.prisma.organization.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return Promise.all(organizations.map((org) => this.withStats(org)));
  }

  async getMine(user: JwtUser) {
    if (user.role === 'SUPER_ADMIN' && !user.organizationId) {
      return {
        id: 'platform',
        name: 'Global Platform Admin',
        description: 'Platform-wide access',
        platformWide: true,
      };
    }

    if (!user.organizationId) {
      throw new NotFoundException('User is not linked to any organization');
    }

    const organization = await this.prisma.organization.findUnique({
      where: {
        id: user.organizationId,
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
  }

  async getById(id: string, user: JwtUser) {
    this.assertCanAccessOrganization(id, user);
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    return this.withStats(organization);
  }

  async update(id: string, dto: UpdateOrganizationDto, user: JwtUser) {
    this.assertCanManageOrganization(id, user, dto);
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });
    if (!organization) throw new NotFoundException('Organization not found');

    const data = this.buildOrganizationData(dto);
    if (Object.keys(data).length === 0) return this.withStats(organization);
    if (
      dto.subscriptionPlan &&
      this.isDowngrade(organization.subscriptionPlan, dto.subscriptionPlan)
    ) {
      await this.assertDowngradeDoesNotExceedUsage(
        id,
        organization.subscriptionPlan,
        dto.subscriptionPlan,
      );
    }

    const updated = await this.prisma.organization.update({
      where: { id },
      data,
    });

    await this.audit('Organization Updated', user, {
      organizationId: id,
      changes: Object.keys(data),
    });

    return this.withStats(updated);
  }

  async setStatus(id: string, status: OrganizationStatus, user: JwtUser) {
    this.assertSuperAdmin(user);
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });
    if (!organization) throw new NotFoundException('Organization not found');

    const updated = await this.prisma.organization.update({
      where: { id },
      data: { status },
    });

    await this.audit(`Organization ${status}`, user, {
      organizationId: id,
      previousStatus: organization.status,
    });

    return this.withStats(updated);
  }

  async getUsers(id: string, user: JwtUser) {
    this.assertCanAccessOrganization(id, user);
    return this.prisma.user.findMany({
      where: { organizationId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        providerId: true,
        accountStatus: true,
        createdAt: true,
      },
    });
  }

  async getProviders(id: string, user: JwtUser) {
    this.assertCanAccessOrganization(id, user);
    return this.prisma.user.findMany({
      where: {
        role: UserRole.PROVIDER,
        OR: [
          { organizationId: id },
          {
            providerOrganizations: {
              some: { organizationId: id, active: true },
            },
          },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        providerId: true,
        accountStatus: true,
        serviceCategories: true,
        coverageAreas: true,
        profileData: true,
        subscriptionPlan: true,
      },
    });
  }

  async getReports(id: string, user: JwtUser) {
    this.assertCanAccessOrganization(id, user);
    return this.prisma.report.findMany({
      where: { organizationId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        citizen: {
          select: { id: true, fullName: true, email: true, phone: true },
        },
        assignedProvider: {
          select: { id: true, fullName: true, email: true, providerId: true },
        },
      },
      take: 200,
    });
  }

  async getBilling(id: string, user: JwtUser) {
    const organization = await this.getById(id, user);
    return {
      organizationId: organization.id,
      plan: organization.subscriptionPlan,
      status: organization.billingStatus,
      quotas: organization.quotas,
      usage: organization.usage,
      subscriptionStartAt: organization.subscriptionStartAt,
      subscriptionEndAt: organization.subscriptionEndAt,
    };
  }

  async getReadiness(id: string, user: JwtUser) {
    const organization = await this.getById(id, user);
    const [adminCount, dispatchCount, providers, jurisdictionZones] =
      await Promise.all([
        this.prisma.user.count({
          where: {
            organizationId: id,
            role: UserRole.ORG_ADMIN,
            accountStatus: 'ACTIVE',
          },
        }),
        this.prisma.user.count({
          where: {
            organizationId: id,
            role: UserRole.DISPATCH_OFFICER,
            accountStatus: 'ACTIVE',
          },
        }),
        this.prisma.user.findMany({
          where: {
            role: UserRole.PROVIDER,
            accountStatus: 'ACTIVE',
            OR: [
              { organizationId: id },
              {
                providerOrganizations: {
                  some: { organizationId: id, active: true },
                },
              },
            ],
          },
          select: { serviceCategories: true, coverageAreas: true },
        }),
        this.prisma.jurisdictionZone.findMany({
          where: { organizationId: id, active: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
      ]);
    const providerCount = providers.length;
    const coveredCategories = this.collectStringList(
      providers.flatMap((provider) =>
        this.jsonStringList(provider.serviceCategories),
      ),
    );
    const providerCoverageAreas = this.collectStringList(
      providers.flatMap((provider) =>
        this.jsonStringList(provider.coverageAreas),
      ),
    );
    const moduleSummary = this.platformModules.organizationModuleSummary(
      organization.enabledModules,
    );
    const routingMandateCategories = this.organizationMandateCategories(
      organization.profileData,
    );
    const jurisdiction = evaluateRoutingJurisdiction({
      country: organization.country,
      state: organization.state,
      lga: organization.lga,
      address: organization.address,
      jurisdictionZones,
    });
    const organizationJurisdictionAreas = jurisdiction.jurisdictionAreas;
    const routingChecks = [
      this.readinessCheck(
        'routing_contact',
        'Routing contact',
        Boolean(organization.contactEmail || organization.contactPhone),
        'Organization contact channel is present.',
        'Add a contact email or phone for responsibility review.',
      ),
      this.readinessCheck(
        'routing_jurisdiction',
        'Routing jurisdiction',
        jurisdiction.configured,
        'Organization jurisdiction is configured.',
        'Configure a jurisdiction zone, state, LGA or service address.',
      ),
      this.readinessCheck(
        'routing_mandate',
        'Responsibility mandate',
        routingMandateCategories.length > 0 || coveredCategories.length > 0,
        'Responsibility categories are configured.',
        'Configure organization mandate categories or provider service categories.',
      ),
      this.readinessCheck(
        'routing_module',
        'Maintenance module',
        moduleSummary.maintenanceActive,
        'FixZone Maintenance is enabled.',
        'Enable the maintenance module before responsibility review.',
      ),
      this.readinessCheck(
        'routing_billing',
        'Billing status',
        organization.billingStatus !== BillingStatus.SUSPENDED &&
          organization.billingStatus !== BillingStatus.CANCELLED,
        'Billing state allows responsibility review.',
        'Resolve suspended or cancelled billing state.',
      ),
      this.readinessCheck(
        'routing_provider_capacity',
        'Dispatch provider capacity',
        providerCount > 0,
        'At least one active provider is available for dispatch.',
        'Add provider capacity before assignment; responsibility review can still use organization mandates.',
        'warning',
      ),
    ];
    const routingBlockers = routingChecks.filter(
      (check) => check.status === 'blocker',
    );
    const routingWarnings = routingChecks.filter(
      (check) => check.status === 'warning',
    );
    const checks = [
      this.readinessCheck(
        'status',
        'Organization status',
        organization.status === OrganizationStatus.ACTIVE,
        'Organization is active.',
        'Activate the organization before dispatch.',
      ),
      this.readinessCheck(
        'profile',
        'Organization profile',
        Boolean(
          organization.name &&
          (organization.contactEmail || organization.contactPhone),
        ),
        'Organization name and contact channel are present.',
        'Add a contact email or phone before production handover.',
      ),
      this.readinessCheck(
        'jurisdiction',
        'Jurisdiction',
        Boolean(organization.state || organization.lga || organization.address),
        'Jurisdiction or address is configured.',
        'Configure state, LGA or service address.',
      ),
      this.readinessCheck(
        'admin',
        'Administrator',
        adminCount > 0,
        'At least one active organization administrator exists.',
        'Add an active Organization Admin.',
      ),
      this.readinessCheck(
        'dispatch',
        'Dispatch operations',
        dispatchCount > 0,
        'At least one active dispatch officer exists.',
        'Add a dispatch officer or confirm Super Admin manual dispatch coverage.',
        'warning',
      ),
      this.readinessCheck(
        'providers',
        'Provider coverage',
        providerCount > 0,
        'At least one accepted active provider membership is linked.',
        'Accept at least one provider membership invitation before dispatch.',
      ),
      this.readinessCheck(
        'categories',
        'Service categories',
        coveredCategories.length > 0,
        'Provider service category coverage is configured.',
        'Configure provider service categories for dispatch matching.',
      ),
      this.readinessCheck(
        'module',
        'Maintenance module',
        moduleSummary.maintenanceActive,
        'FixZone Maintenance is enabled.',
        'Enable the maintenance module before live operations.',
      ),
      this.readinessCheck(
        'billing',
        'Billing status',
        organization.billingStatus !== BillingStatus.SUSPENDED &&
          organization.billingStatus !== BillingStatus.CANCELLED,
        'Billing state allows operation.',
        'Resolve suspended or cancelled billing state.',
      ),
      this.readinessCheck(
        'plan',
        'Plan assignment',
        Boolean(organization.subscriptionPlan),
        'Subscription plan is assigned.',
        'Assign a subscription plan.',
      ),
    ];
    const blockers = checks.filter((check) => check.status === 'blocker');
    const warnings = checks.filter((check) => check.status === 'warning');
    return {
      organizationId: id,
      organizationName: organization.name,
      accountStatus: organization.status,
      ready: blockers.length === 0,
      blockingReasons: blockers.map((check) => check.message),
      warnings: warnings.map((check) => check.message),
      activeProviderCount: providerCount,
      coveredCategories,
      jurisdictionSummary: {
        country: organization.country,
        state: organization.state,
        lga: organization.lga,
        address: organization.address,
        configuredZones: jurisdictionZones.map((zone) => ({
          id: zone.id,
          name: zone.name,
          zoneType: zone.zoneType,
          country: zone.country,
          state: zone.state,
          lga: zone.lga,
          active: zone.active,
        })),
        organizationJurisdictionAreas,
        jurisdictionSource: jurisdiction.source,
        jurisdictionLevel: jurisdiction.level,
        legacyFallback: jurisdiction.legacyFallback,
        providerCoverageAreas,
      },
      routingReadiness: {
        ready: routingBlockers.length === 0,
        state:
          routingBlockers.length === 0
            ? routingWarnings.length === 0
              ? 'READY'
              : 'READY_WITH_WARNINGS'
            : 'NOT_READY',
        blockingReasons: routingBlockers.map((check) => check.message),
        warnings: routingWarnings.map((check) => check.message),
        mandateCategories: routingMandateCategories,
        inheritedProviderCategories: coveredCategories,
        jurisdictionAreas: organizationJurisdictionAreas,
        jurisdictionSource: jurisdiction.source,
        jurisdictionLevel: jurisdiction.level,
        legacyFallback: jurisdiction.legacyFallback,
        configuredZones: jurisdiction.configuredZones,
        checks: routingChecks,
      },
      subscriptionStatus: organization.billingStatus,
      plan: organization.subscriptionPlan,
      operationalReadiness:
        blockers.length === 0
          ? warnings.length === 0
            ? 'READY'
            : 'READY_WITH_WARNINGS'
          : 'NOT_READY',
      providerCoverage: {
        activeProviders: providerCount,
        coveredCategories,
        coverageAreas: providerCoverageAreas,
        state: providerCount > 0 ? 'AVAILABLE' : 'MANUAL_DISPATCH_REQUIRED',
      },
      moduleState: moduleSummary,
      checks,
      summary: {
        blockers: blockers.length,
        warnings: warnings.length,
        passed: checks.filter((check) => check.status === 'pass').length,
      },
    };
  }

  async listJurisdictionZones(
    id: string,
    user: JwtUser,
    includeInactive = false,
  ) {
    this.assertCanAccessOrganization(id, user);
    return this.prisma.jurisdictionZone.findMany({
      where: {
        organizationId: id,
        ...(includeInactive ? {} : { active: true }),
      },
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async createJurisdictionZone(
    id: string,
    dto: CreateJurisdictionZoneDto,
    user: JwtUser,
  ) {
    this.assertCanManageJurisdictionZones(id, user);
    const data = this.buildJurisdictionZoneData(dto, true);
    const zone = await this.prisma.jurisdictionZone.create({
      data: {
        ...data,
        organizationId: id,
        createdById: user.sub || null,
      },
    });
    await this.audit('Organization Jurisdiction Zone Created', user, {
      organizationId: id,
      jurisdictionZoneId: zone.id,
    });
    return zone;
  }

  async updateJurisdictionZone(
    id: string,
    zoneId: string,
    dto: UpdateJurisdictionZoneDto,
    user: JwtUser,
  ) {
    this.assertCanManageJurisdictionZones(id, user);
    const existing = await this.prisma.jurisdictionZone.findUnique({
      where: { id: zoneId },
    });
    if (!existing || existing.organizationId !== id) {
      throw new NotFoundException('Jurisdiction zone not found');
    }
    const data = this.buildJurisdictionZoneData(dto, false);
    if (Object.keys(data).length === 0) return existing;
    const zone = await this.prisma.jurisdictionZone.update({
      where: { id: zoneId },
      data,
    });
    await this.audit('Organization Jurisdiction Zone Updated', user, {
      organizationId: id,
      jurisdictionZoneId: zone.id,
      active: zone.active,
    });
    return zone;
  }

  getPlanCatalog() {
    return { plans: this.planCatalog() };
  }

  async requestUpgrade(
    id: string,
    dto: Record<string, unknown>,
    user: JwtUser,
  ) {
    this.assertCanAccessOrganization(id, user);
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ORG_ADMIN') {
      throw new ForbiddenException('Upgrade requests require admin access');
    }
    const requestedPlan = this.parsePlan(dto.requestedPlan);
    const organization = await this.prisma.organization.findUnique({
      where: { id },
      select: { id: true, subscriptionPlan: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    if (organization.subscriptionPlan === requestedPlan) {
      throw new ConflictException({
        code: 'PLAN_ALREADY_ACTIVE',
        message: 'This organization is already on the requested plan.',
      });
    }
    if (this.isDowngrade(organization.subscriptionPlan, requestedPlan)) {
      throw new ConflictException({
        code: 'DOWNGRADE_NOT_SUPPORTED',
        message:
          'Downgrade requests are not yet supported. Contact SecureZone administration.',
      });
    }
    const pending = await this.prisma.organizationUpgradeRequest.findFirst({
      where: { organizationId: id, status: UpgradeRequestStatus.PENDING },
    });
    if (pending) {
      throw new ConflictException({
        code: 'UPGRADE_REQUEST_PENDING',
        message: 'An upgrade request is already pending Super Admin review.',
      });
    }
    const requestedByUserId = user.sub;
    if (!requestedByUserId) throw new ForbiddenException('Actor missing');
    const request = await this.prisma.organizationUpgradeRequest.create({
      data: {
        organizationId: id,
        currentPlan: organization.subscriptionPlan,
        requestedPlan,
        requestedByUserId,
        requestNote:
          typeof dto.requestNote === 'string' && dto.requestNote.trim()
            ? dto.requestNote.trim()
            : null,
      },
    });
    await this.audit('Organization Upgrade Requested', user, {
      organizationId: id,
      requestId: request.id,
      currentPlan: request.currentPlan,
      requestedPlan,
    });
    return request;
  }

  async listUpgradeRequests(user: JwtUser) {
    const where =
      user.role === 'SUPER_ADMIN'
        ? {}
        : user.organizationId
          ? { organizationId: user.organizationId }
          : (() => {
              throw new ForbiddenException('No organization scope');
            })();
    return this.prisma.organizationUpgradeRequest.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { organization: { select: { id: true, name: true } } },
      take: 100,
    });
  }

  async reviewUpgradeRequest(
    requestId: string,
    dto: Record<string, unknown>,
    user: JwtUser,
  ) {
    this.assertSuperAdmin(user);
    const action =
      typeof dto.action === 'string' ? dto.action.trim().toUpperCase() : '';
    if (action !== 'APPROVE' && action !== 'REJECT') {
      throw new BadRequestException('Review action must be APPROVE or REJECT');
    }
    const request = await this.prisma.organizationUpgradeRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Upgrade request not found');
    if (request.status !== UpgradeRequestStatus.PENDING) {
      throw new ConflictException('Upgrade request is no longer pending');
    }
    const reviewedByUserId = user.sub;
    if (!reviewedByUserId) throw new ForbiddenException('Actor missing');
    const reviewNote =
      typeof dto.reviewNote === 'string' && dto.reviewNote.trim()
        ? dto.reviewNote.trim()
        : null;
    if (action === 'REJECT') {
      const rejected = await this.prisma.organizationUpgradeRequest.update({
        where: { id: requestId },
        data: {
          status: UpgradeRequestStatus.REJECTED,
          reviewNote,
          reviewedByUserId,
          reviewedAt: new Date(),
        },
      });
      await this.audit('Organization Upgrade Rejected', user, {
        organizationId: rejected.organizationId,
        requestId,
      });
      return rejected;
    }
    const [completed] = await this.prisma.$transaction([
      this.prisma.organizationUpgradeRequest.update({
        where: { id: requestId },
        data: {
          status: UpgradeRequestStatus.COMPLETED,
          reviewNote,
          reviewedByUserId,
          reviewedAt: new Date(),
          completedAt: new Date(),
        },
      }),
      this.prisma.organization.update({
        where: { id: request.organizationId },
        data: {
          subscriptionPlan: request.requestedPlan,
          billingStatus: BillingStatus.ACTIVE,
          ...this.defaultQuotaUpdateForPlan(request.requestedPlan),
        },
      }),
    ]);
    await this.audit('Organization Upgrade Approved', user, {
      organizationId: completed.organizationId,
      requestId,
      requestedPlan: completed.requestedPlan,
    });
    return completed;
  }

  async getBillingOverview(user: JwtUser) {
    const where = this.organizationScope(user);
    const [total, active, pastDue, suspended, cancelled, byPlan] =
      await Promise.all([
        this.prisma.organization.count({ where }),
        this.prisma.organization.count({
          where: { ...where, billingStatus: BillingStatus.ACTIVE },
        }),
        this.prisma.organization.count({
          where: { ...where, billingStatus: BillingStatus.PAST_DUE },
        }),
        this.prisma.organization.count({
          where: { ...where, billingStatus: BillingStatus.SUSPENDED },
        }),
        this.prisma.organization.count({
          where: { ...where, billingStatus: BillingStatus.CANCELLED },
        }),
        this.prisma.organization.groupBy({
          by: ['subscriptionPlan'],
          where,
          _count: { _all: true },
        }),
      ]);

    return {
      totalOrganizations: total,
      active,
      pastDue,
      suspended,
      cancelled,
      plans: byPlan.reduce(
        (acc, item) => ({
          ...acc,
          [item.subscriptionPlan]: item._count._all,
        }),
        {} as Record<SubscriptionPlan, number>,
      ),
      planCatalog: this.planCatalog(),
    };
  }

  private buildOrganizationData(
    dto: Partial<CreateOrganizationDto | UpdateOrganizationDto>,
    required?: Pick<
      Prisma.OrganizationUncheckedCreateInput,
      'name' | 'enabledModules'
    >,
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {
      ...(required ?? {}),
    };

    const stringFields = [
      'name',
      'parentId',
      'tenantCode',
      'contactEmail',
      'contactPhone',
      'address',
      'state',
      'lga',
      'country',
    ] as const;

    for (const field of stringFields) {
      const value = dto[field];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (field === 'name') {
          if (trimmed) data[field] = trimmed;
        } else {
          data[field] = trimmed || null;
        }
      }
    }

    if (dto.type) data.type = dto.type;
    if (dto.subscriptionPlan) data.subscriptionPlan = dto.subscriptionPlan;
    if (dto.billingStatus) data.billingStatus = dto.billingStatus;
    if (typeof dto.allowedUsers === 'number')
      data.allowedUsers = dto.allowedUsers;
    if (typeof dto.allowedProviders === 'number')
      data.allowedProviders = dto.allowedProviders;
    if (typeof dto.allowedReportsPerMonth === 'number') {
      data.allowedReportsPerMonth = dto.allowedReportsPerMonth;
    }
    if (typeof dto.allowedStorageMb === 'number') {
      data.allowedStorageMb = dto.allowedStorageMb;
    }
    if (dto.profileData)
      data.profileData = dto.profileData as Prisma.InputJsonValue;
    if (dto.enabledModules !== undefined) {
      data.enabledModules = this.platformModules.toJson(dto.enabledModules);
    }

    return data;
  }

  private async withStats<T extends { id: string }>(organization: T) {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [
      userCount,
      providerCount,
      reportCount,
      monthlyReportCount,
      pendingReports,
      inProgressReports,
      closedReports,
    ] = await Promise.all([
      this.prisma.user.count({ where: { organizationId: organization.id } }),
      this.prisma.user.count({
        where: {
          role: UserRole.PROVIDER,
          OR: [
            { organizationId: organization.id },
            {
              providerOrganizations: {
                some: { organizationId: organization.id, active: true },
              },
            },
          ],
        },
      }),
      this.prisma.report.count({ where: { organizationId: organization.id } }),
      this.prisma.report.count({
        where: {
          organizationId: organization.id,
          createdAt: { gte: monthStart },
        },
      }),
      this.prisma.report.count({
        where: { organizationId: organization.id, status: 'PENDING' },
      }),
      this.prisma.report.count({
        where: { organizationId: organization.id, status: 'IN_PROGRESS' },
      }),
      this.prisma.report.count({
        where: { organizationId: organization.id, status: 'CLOSED' },
      }),
    ]);

    const org = organization as T & {
      allowedUsers?: number | null;
      allowedProviders?: number | null;
      allowedReportsPerMonth?: number | null;
      allowedStorageMb?: number | null;
      enabledModules?: Prisma.JsonValue | null;
    };

    return {
      ...organization,
      counts: {
        users: userCount,
        providers: providerCount,
        reports: reportCount,
        monthlyReports: monthlyReportCount,
        pendingReports,
        inProgressReports,
        closedReports,
      },
      usage: {
        users: userCount,
        providers: providerCount,
        reportsThisMonth: monthlyReportCount,
      },
      quotas: {
        users: org.allowedUsers,
        providers: org.allowedProviders,
        reportsPerMonth: org.allowedReportsPerMonth,
        storageMb: org.allowedStorageMb,
      },
      moduleSummary: this.platformModules.organizationModuleSummary(
        org.enabledModules,
      ),
    };
  }

  private organizationScope(user: JwtUser): Prisma.OrganizationWhereInput {
    if (user.role === 'SUPER_ADMIN') return { status: { not: 'ARCHIVED' } };
    if (!user.organizationId)
      throw new ForbiddenException('No organization scope');
    return { id: user.organizationId, status: { not: 'ARCHIVED' } };
  }

  private assertCanAccessOrganization(id: string, user: JwtUser) {
    if (user.role === 'SUPER_ADMIN') return;
    if (!user.organizationId || user.organizationId !== id) {
      throw new ForbiddenException('Organization access denied');
    }
  }

  private assertCanManageOrganization(
    id: string,
    user: JwtUser,
    dto: UpdateOrganizationDto,
  ) {
    if (user.role === 'SUPER_ADMIN') return;
    if (user.role !== 'ORG_ADMIN' || user.organizationId !== id) {
      throw new ForbiddenException('Organization management denied');
    }

    const restricted = [
      'type',
      'parentId',
      'tenantCode',
      'subscriptionPlan',
      'billingStatus',
      'allowedUsers',
      'allowedProviders',
      'allowedReportsPerMonth',
      'allowedStorageMb',
      'enabledModules',
    ] as const;
    if (restricted.some((field) => dto[field] !== undefined)) {
      throw new ForbiddenException(
        'Only Super Admin can update billing and tenant controls',
      );
    }
  }

  private assertCanManageJurisdictionZones(id: string, user: JwtUser) {
    if (user.role === 'SUPER_ADMIN') return;
    if (user.role !== 'ORG_ADMIN' || user.organizationId !== id) {
      throw new ForbiddenException('Jurisdiction management denied');
    }
  }

  private assertSuperAdmin(user: JwtUser) {
    if (user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Super Admin access required');
    }
  }

  private readinessCheck(
    key: string,
    label: string,
    passed: boolean,
    passMessage: string,
    failMessage: string,
    failureStatus: 'blocker' | 'warning' = 'blocker',
  ) {
    return {
      key,
      label,
      status: passed ? 'pass' : failureStatus,
      message: passed ? passMessage : failMessage,
    };
  }

  private buildJurisdictionZoneData(
    dto: Partial<CreateJurisdictionZoneDto | UpdateJurisdictionZoneDto>,
    creating: boolean,
  ): Prisma.JurisdictionZoneUncheckedCreateInput &
    Prisma.JurisdictionZoneUncheckedUpdateInput {
    const zoneType =
      typeof dto.zoneType === 'string' ? dto.zoneType.trim().toUpperCase() : '';
    const country =
      typeof dto.country === 'string' && dto.country.trim()
        ? dto.country.trim()
        : null;
    const state =
      typeof dto.state === 'string' && dto.state.trim()
        ? dto.state.trim()
        : null;
    const lga =
      typeof dto.lga === 'string' && dto.lga.trim() ? dto.lga.trim() : null;

    if (creating && !zoneType) {
      throw new BadRequestException('Jurisdiction zone type is required');
    }
    if (zoneType && !['COUNTRY', 'STATE', 'LGA'].includes(zoneType)) {
      throw new BadRequestException(
        'Jurisdiction zone type must be COUNTRY, STATE or LGA',
      );
    }
    if (zoneType === 'COUNTRY' && !country) {
      throw new BadRequestException('Country jurisdiction requires country');
    }
    if (zoneType === 'STATE' && !state) {
      throw new BadRequestException('State jurisdiction requires state');
    }
    if (zoneType === 'LGA' && !lga) {
      throw new BadRequestException('LGA jurisdiction requires LGA');
    }

    const data: Record<string, unknown> = {};
    if (typeof dto.name === 'string') {
      data.name =
        dto.name.trim() ||
        this.defaultJurisdictionZoneName({
          zoneType,
          country,
          state,
          lga,
        });
    } else if (creating) {
      data.name = this.defaultJurisdictionZoneName({
        zoneType,
        country,
        state,
        lga,
      });
    }
    if (zoneType) data.zoneType = zoneType;
    if (dto.country !== undefined || creating)
      data.country = country ?? 'Nigeria';
    if (dto.state !== undefined || creating) data.state = state;
    if (dto.lga !== undefined || creating) data.lga = lga;
    if (typeof dto.active === 'boolean') data.active = dto.active;
    if (dto.metadata !== undefined) {
      data.metadata = dto.metadata as Prisma.InputJsonValue;
    }
    return data as Prisma.JurisdictionZoneUncheckedCreateInput &
      Prisma.JurisdictionZoneUncheckedUpdateInput;
  }

  private defaultJurisdictionZoneName(input: {
    zoneType: string;
    country: string | null;
    state: string | null;
    lga: string | null;
  }) {
    if (input.zoneType === 'LGA' && input.lga) return input.lga;
    if (input.zoneType === 'STATE' && input.state) return input.state;
    if (input.zoneType === 'COUNTRY' && input.country) return input.country;
    return 'Jurisdiction';
  }

  private jsonStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => String(item ?? '').trim())
      .filter((item) => item.length > 0);
  }

  private organizationMandateCategories(profileData: unknown): string[] {
    const profile =
      profileData && typeof profileData === 'object'
        ? (profileData as Record<string, unknown>)
        : {};
    const routing =
      profile.responsibilityRouting &&
      typeof profile.responsibilityRouting === 'object'
        ? (profile.responsibilityRouting as Record<string, unknown>)
        : {};
    return this.collectStringList([
      ...this.jsonStringList(profile.mandates),
      ...this.jsonStringList(profile.supportedCategories),
      ...this.jsonStringList(routing.mandateCategories),
      ...this.jsonStringList(routing.supportedCategories),
    ]);
  }

  private collectStringList(values: unknown[]) {
    return Array.from(
      new Set(
        values
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item) => item.length > 0),
      ),
    ).sort((a, b) => a.localeCompare(b));
  }

  private parsePlan(value: unknown) {
    const plan = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!Object.values(SubscriptionPlan).includes(plan as SubscriptionPlan)) {
      throw new BadRequestException('Invalid subscription plan');
    }
    return plan as SubscriptionPlan;
  }

  private defaultQuotaUpdateForPlan(plan: SubscriptionPlan) {
    const definition = this.planCatalog().find((item) => item.plan === plan);
    return {
      allowedUsers: definition?.defaultUsers ?? null,
      allowedProviders: definition?.defaultProviders ?? null,
      allowedReportsPerMonth: definition?.defaultReportsPerMonth ?? null,
    };
  }

  private isDowngrade(
    currentPlan: SubscriptionPlan,
    requestedPlan: SubscriptionPlan,
  ) {
    return this.planRank(requestedPlan) < this.planRank(currentPlan);
  }

  private planRank(plan: SubscriptionPlan) {
    const order: Record<SubscriptionPlan, number> = {
      FREE: 0,
      DEMO: 0,
      STARTER: 1,
      PROFESSIONAL: 2,
      GOVERNMENT: 3,
      ENTERPRISE: 4,
    };
    return order[plan] ?? 0;
  }

  private async assertDowngradeDoesNotExceedUsage(
    organizationId: string,
    currentPlan: SubscriptionPlan,
    requestedPlan: SubscriptionPlan,
  ) {
    const quota = this.defaultQuotaUpdateForPlan(requestedPlan);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [users, providers, reportsThisMonth] = await Promise.all([
      this.prisma.user.count({ where: { organizationId } }),
      this.prisma.user.count({
        where: {
          role: UserRole.PROVIDER,
          OR: [
            { organizationId },
            {
              providerOrganizations: {
                some: { organizationId, active: true },
              },
            },
          ],
        },
      }),
      this.prisma.report.count({
        where: { organizationId, createdAt: { gte: monthStart } },
      }),
    ]);
    const overLimit =
      (quota.allowedUsers != null && users > quota.allowedUsers) ||
      (quota.allowedProviders != null && providers > quota.allowedProviders) ||
      (quota.allowedReportsPerMonth != null &&
        reportsThisMonth > quota.allowedReportsPerMonth);
    if (overLimit) {
      throw new ConflictException({
        code: 'DOWNGRADE_OVER_LIMIT',
        message:
          'This organization exceeds the target plan limits. No users, providers, reports, evidence or assignments were changed.',
        currentPlan,
        requestedPlan,
        usage: { users, providers, reportsThisMonth },
        targetQuota: quota,
      });
    }
  }

  private planCatalog() {
    return [
      {
        plan: 'FREE',
        label: 'Free',
        defaultUsers: 5,
        defaultProviders: 2,
        defaultReportsPerMonth: 50,
      },
      {
        plan: 'STARTER',
        label: 'Starter',
        defaultUsers: 25,
        defaultProviders: 10,
        defaultReportsPerMonth: 500,
      },
      {
        plan: 'PROFESSIONAL',
        label: 'Professional',
        defaultUsers: 100,
        defaultProviders: 50,
        defaultReportsPerMonth: 5000,
      },
      {
        plan: 'GOVERNMENT',
        label: 'Government',
        defaultUsers: 500,
        defaultProviders: 250,
        defaultReportsPerMonth: 25000,
      },
      {
        plan: 'ENTERPRISE',
        label: 'Enterprise',
        defaultUsers: null,
        defaultProviders: null,
        defaultReportsPerMonth: null,
      },
    ];
  }

  private async audit(
    action: string,
    user: JwtUser,
    metadata: Record<string, unknown> = {},
  ) {
    const actorUserId = user.sub;
    if (!actorUserId) return;
    await this.prisma.demoAuditLog.create({
      data: {
        action,
        actorUserId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}
