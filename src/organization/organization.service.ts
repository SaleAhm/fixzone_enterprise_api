import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingStatus,
  OrganizationStatus,
  Prisma,
  SubscriptionPlan,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformModulesService } from '../platform-modules/platform-modules.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

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
      orderBy: { createdAt: 'desc' },
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
    await this.assertCanAccessOrganization(id, user);
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    return this.withStats(organization);
  }

  async update(id: string, dto: UpdateOrganizationDto, user: JwtUser) {
    await this.assertCanManageOrganization(id, user, dto);
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });
    if (!organization) throw new NotFoundException('Organization not found');

    const data = this.buildOrganizationData(dto);
    if (Object.keys(data).length === 0) return this.withStats(organization);

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
    await this.assertCanAccessOrganization(id, user);
    return this.prisma.user.findMany({
      where: { organizationId: id },
      orderBy: { createdAt: 'desc' },
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
    await this.assertCanAccessOrganization(id, user);
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
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        providerId: true,
        accountStatus: true,
        serviceCategories: true,
        coverageAreas: true,
        subscriptionPlan: true,
      },
    });
  }

  async getReports(id: string, user: JwtUser) {
    await this.assertCanAccessOrganization(id, user);
    return this.prisma.report.findMany({
      where: { organizationId: id },
      orderBy: { createdAt: 'desc' },
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

  private async assertCanAccessOrganization(id: string, user: JwtUser) {
    if (user.role === 'SUPER_ADMIN') return;
    if (!user.organizationId || user.organizationId !== id) {
      throw new ForbiddenException('Organization access denied');
    }
  }

  private async assertCanManageOrganization(
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

  private assertSuperAdmin(user: JwtUser) {
    if (user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Super Admin access required');
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
