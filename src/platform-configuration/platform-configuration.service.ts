import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EnterpriseServicesService } from '../enterprise-services/enterprise-services.service';
import { UpdateProviderCapabilitiesDto } from './dto/update-provider-capabilities.dto';
import { UpdateServiceConfigurationDto } from './dto/update-service-configuration.dto';

type PlatformUser = {
  sub?: string;
  id?: string;
  role?: UserRole | string;
  organizationId?: string | null;
};

type TenantServiceConfiguration = {
  enabledServices: string[];
  defaultService: string;
  serviceOrdering: string[];
  serviceVisibility: Record<string, boolean>;
  brandingOverrides: Record<string, unknown>;
  futureSlaConfiguration: Record<string, unknown>;
  futureEscalationConfiguration: Record<string, unknown>;
  futureAiPreferences: Record<string, unknown>;
  futureDocumentRetention: Record<string, unknown>;
  futureRegionalSettings: Record<string, unknown>;
};

const PROFILE_CONFIG_KEY = 'secureZoneServiceConfiguration';
const PROVIDER_CAPABILITIES_KEY = 'secureZoneProviderCapabilities';

@Injectable()
export class PlatformConfigurationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enterpriseServices: EnterpriseServicesService,
  ) {}

  async getPlatformConfig(user: PlatformUser) {
    const organizationId = this.resolveOrganizationId(user);
    const serviceConfiguration = organizationId
      ? await this.getServiceConfiguration(user, organizationId)
      : this.defaultServiceConfiguration();

    return {
      platformName: 'SecureZone Platform',
      activeProductionService: 'maintenance_report',
      activeProductionModule: 'maintenance',
      serviceConfiguration,
      providerCapabilities: this.getProviderCapabilities(),
      analyticsContracts: this.getAnalyticsContracts(),
      guardMode: 'non_blocking',
      futureModulesUsable: false,
    };
  }

  getProviderCapabilities() {
    return [
      this.capability('electrical', 'Electrical', 'Maintenance', false, 0),
      this.capability('plumbing', 'Plumbing', 'Maintenance', false, 0),
      this.capability('mechanical', 'Mechanical', 'Maintenance', false, 0),
      this.capability('civil_works', 'Civil Works', 'Maintenance', false, 0),
      this.capability(
        'architecture',
        'Architecture',
        'Future Services',
        true,
        2,
      ),
      this.capability('medical', 'Medical', 'Future Services', true, 3),
      this.capability('legal', 'Legal', 'Future Services', true, 2),
      this.capability('ict', 'ICT', 'Future Services', true, 1),
      this.capability('agriculture', 'Agriculture', 'Future Services', true, 1),
      this.capability('surveying', 'Surveying', 'Future Services', true, 2),
      this.capability('security', 'Security', 'Future Services', true, 2),
      this.capability('property', 'Property', 'Future Services', true, 1),
      this.capability('education', 'Education', 'Future Services', true, 1),
    ];
  }

  getAnalyticsContracts() {
    return {
      activeModuleKey: 'maintenance',
      contracts: [
        {
          moduleKey: 'maintenance',
          serviceType: 'maintenance_report',
          activeImplementation: true,
          dashboardWidgets: [
            'reports_summary',
            'dispatch_queue',
            'provider_performance',
          ],
          kpis: [
            'total_reports',
            'open_reports',
            'assignment_rate',
            'completion_rate',
          ],
          charts: ['status_distribution', 'category_distribution'],
          reports: ['operations_overview', 'provider_performance'],
          notifications: ['assignment', 'status_update', 'completion_review'],
        },
      ],
    };
  }

  async getServiceConfiguration(
    user: PlatformUser,
    organizationId?: string,
  ): Promise<TenantServiceConfiguration & { organizationId?: string }> {
    const targetOrganizationId =
      organizationId ?? this.requireOrganizationScope(user);
    await this.assertCanAccessOrganization(user, targetOrganizationId);

    const organization = await this.prisma.organization.findUnique({
      where: { id: targetOrganizationId },
      select: { id: true, enabledModules: true, profileData: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');

    const profileData = this.asRecord(organization.profileData);
    return {
      organizationId: organization.id,
      ...this.mergeServiceConfiguration(
        profileData[PROFILE_CONFIG_KEY],
        organization.enabledModules,
      ),
    };
  }

  async updateServiceConfiguration(
    user: PlatformUser,
    organizationId: string,
    dto: UpdateServiceConfigurationDto,
  ) {
    await this.assertCanManageOrganization(user, organizationId);
    const existing = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { profileData: true, enabledModules: true },
    });
    if (!existing) throw new NotFoundException('Organization not found');

    const profileData = this.asRecord(existing.profileData);
    const nextConfiguration = this.mergeServiceConfiguration(
      {
        ...this.asRecord(profileData[PROFILE_CONFIG_KEY]),
        ...dto,
      },
      existing.enabledModules,
    );

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        profileData: {
          ...profileData,
          [PROFILE_CONFIG_KEY]: nextConfiguration,
        } as Prisma.InputJsonValue,
      },
      select: { id: true, profileData: true, enabledModules: true },
    });

    const updatedProfile = this.asRecord(updated.profileData);
    await this.audit('Tenant Service Configuration Updated', user, {
      organizationId,
      enabledServices: nextConfiguration.enabledServices,
      defaultService: nextConfiguration.defaultService,
      serviceVisibility: nextConfiguration.serviceVisibility,
    });
    return {
      organizationId: updated.id,
      ...this.mergeServiceConfiguration(
        updatedProfile[PROFILE_CONFIG_KEY],
        updated.enabledModules,
      ),
    };
  }

  async assignProviderCapabilities(
    user: PlatformUser,
    providerId: string,
    dto: UpdateProviderCapabilitiesDto,
  ) {
    await this.assertCanManageProvider(user, providerId);
    const provider = await this.getProviderForCapabilities(providerId);
    const profileData = this.asRecord(provider.profileData);
    const existing = this.readProviderCapabilityAssignments(profileData);
    const capabilityMap = new Map(existing.map((item) => [item.id, item]));
    const known = new Set(
      this.getProviderCapabilities().map((item) => item.id),
    );

    for (const id of dto.capabilityIds) {
      if (!known.has(id)) continue;
      capabilityMap.set(id, {
        id,
        status: dto.status?.trim() || 'ACTIVE',
        assignedAt: new Date().toISOString(),
        deactivatedAt: null,
        approvalWorkflow: 'placeholder',
      });
    }

    const result = await this.saveProviderCapabilities(
      providerId,
      profileData,
      [...capabilityMap.values()],
    );
    await this.audit('Provider Capabilities Assigned', user, {
      providerId,
      capabilityIds: dto.capabilityIds,
      status: dto.status?.trim() || 'ACTIVE',
    });
    return result;
  }

  async removeProviderCapability(
    user: PlatformUser,
    providerId: string,
    capabilityId: string,
  ) {
    await this.assertCanManageProvider(user, providerId);
    const provider = await this.getProviderForCapabilities(providerId);
    const profileData = this.asRecord(provider.profileData);
    const next = this.readProviderCapabilityAssignments(profileData).filter(
      (item) => item.id !== capabilityId,
    );
    const result = await this.saveProviderCapabilities(
      providerId,
      profileData,
      next,
    );
    await this.audit('Provider Capability Removed', user, {
      providerId,
      capabilityId,
    });
    return result;
  }

  async deactivateProviderCapability(
    user: PlatformUser,
    providerId: string,
    capabilityId: string,
  ) {
    await this.assertCanManageProvider(user, providerId);
    const provider = await this.getProviderForCapabilities(providerId);
    const profileData = this.asRecord(provider.profileData);
    const next = this.readProviderCapabilityAssignments(profileData).map(
      (item) =>
        item.id === capabilityId
          ? {
              ...item,
              status: 'INACTIVE',
              deactivatedAt: new Date().toISOString(),
            }
          : item,
    );
    const result = await this.saveProviderCapabilities(
      providerId,
      profileData,
      next,
    );
    await this.audit('Provider Capability Deactivated', user, {
      providerId,
      capabilityId,
    });
    return result;
  }

  async getProviderCapabilitySummary(user: PlatformUser, providerId: string) {
    await this.assertCanManageProvider(user, providerId);
    const provider = await this.getProviderForCapabilities(providerId);
    return this.providerCapabilitySummary(provider.profileData);
  }

  providerCapabilitySummary(profileData: unknown) {
    const assignments = this.readProviderCapabilityAssignments(
      this.asRecord(profileData),
    );
    const catalog = new Map(
      this.getProviderCapabilities().map((item) => [item.id, item]),
    );
    return {
      assignments: assignments.map((assignment) => ({
        ...assignment,
        capability: catalog.get(assignment.id) ?? null,
      })),
      catalog: this.getProviderCapabilities(),
      activeCount: assignments.filter((item) => item.status === 'ACTIVE')
        .length,
      inactiveCount: assignments.filter((item) => item.status === 'INACTIVE')
        .length,
    };
  }

  private capability(
    id: string,
    name: string,
    category: string,
    metadataOnly: boolean,
    verificationRequirement: number,
  ) {
    return {
      id,
      name,
      description: `${name} provider capability metadata for SecureZone services.`,
      category,
      status: metadataOnly ? 'METADATA_ONLY' : 'ACTIVE',
      verificationRequirement,
      futureCertification: true,
      futureLicensing: true,
      futureExpiry: true,
      futureApprovalWorkflow: 'placeholder',
      metadataOnly,
    };
  }

  private defaultServiceConfiguration(
    enabledModules: unknown = ['maintenance'],
  ): TenantServiceConfiguration {
    const enabledServices = this.normalizeEnabledServices(enabledModules);
    return {
      enabledServices,
      defaultService: 'maintenance_report',
      serviceOrdering: enabledServices,
      serviceVisibility: Object.fromEntries(
        enabledServices.map((service) => [service, true]),
      ),
      brandingOverrides: {},
      futureSlaConfiguration: {},
      futureEscalationConfiguration: {},
      futureAiPreferences: {},
      futureDocumentRetention: {},
      futureRegionalSettings: {},
    };
  }

  private mergeServiceConfiguration(
    value: unknown,
    enabledModules: unknown,
  ): TenantServiceConfiguration {
    const base = this.defaultServiceConfiguration(enabledModules);
    const record = this.asRecord(value);
    const enabledServices = this.normalizeEnabledServices(
      record.enabledServices ?? base.enabledServices,
    );
    if (!enabledServices.includes('maintenance_report')) {
      enabledServices.unshift('maintenance_report');
    }
    return {
      enabledServices,
      defaultService:
        typeof record.defaultService === 'string' && record.defaultService
          ? record.defaultService
          : base.defaultService,
      serviceOrdering: this.normalizeEnabledServices(
        record.serviceOrdering ?? enabledServices,
      ),
      serviceVisibility:
        this.asBooleanRecord(record.serviceVisibility) ??
        base.serviceVisibility,
      brandingOverrides: this.asRecord(record.brandingOverrides),
      futureSlaConfiguration: this.asRecord(record.futureSlaConfiguration),
      futureEscalationConfiguration: this.asRecord(
        record.futureEscalationConfiguration,
      ),
      futureAiPreferences: this.asRecord(record.futureAiPreferences),
      futureDocumentRetention: this.asRecord(record.futureDocumentRetention),
      futureRegionalSettings: this.asRecord(record.futureRegionalSettings),
    };
  }

  private normalizeEnabledServices(value: unknown): string[] {
    const items = Array.isArray(value)
      ? value.map((item) => item?.toString().trim()).filter(Boolean)
      : ['maintenance_report'];
    const normalized = [...new Set(items as string[])];
    return normalized.includes('maintenance_report')
      ? normalized
      : ['maintenance_report', ...normalized];
  }

  private async getProviderForCapabilities(providerId: string) {
    const provider = await this.prisma.user.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        role: true,
        organizationId: true,
        profileData: true,
      },
    });
    if (!provider || provider.role !== UserRole.PROVIDER) {
      throw new NotFoundException('Provider not found');
    }
    return provider;
  }

  private async saveProviderCapabilities(
    providerId: string,
    profileData: Record<string, unknown>,
    assignments: Array<Record<string, unknown>>,
  ) {
    const updated = await this.prisma.user.update({
      where: { id: providerId },
      data: {
        profileData: {
          ...profileData,
          [PROVIDER_CAPABILITIES_KEY]: assignments,
        } as Prisma.InputJsonValue,
      },
      select: { id: true, profileData: true },
    });
    return {
      providerId: updated.id,
      ...this.providerCapabilitySummary(updated.profileData),
    };
  }

  private readProviderCapabilityAssignments(
    profileData: Record<string, unknown>,
  ) {
    const value = profileData[PROVIDER_CAPABILITIES_KEY];
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object',
      )
      .map((item) => ({
        id: item.id?.toString() ?? '',
        status: item.status?.toString() || 'ACTIVE',
        assignedAt: item.assignedAt?.toString() ?? null,
        deactivatedAt: item.deactivatedAt?.toString() ?? null,
        approvalWorkflow: item.approvalWorkflow?.toString() ?? 'placeholder',
      }))
      .filter((item) => item.id);
  }

  private async assertCanAccessOrganization(
    user: PlatformUser,
    organizationId: string,
  ) {
    if (user.role === UserRole.SUPER_ADMIN || user.role === 'SUPER_ADMIN')
      return;
    if (!user.organizationId || user.organizationId !== organizationId) {
      throw new ForbiddenException('Organization access denied');
    }
  }

  private async assertCanManageOrganization(
    user: PlatformUser,
    organizationId: string,
  ) {
    if (user.role === UserRole.SUPER_ADMIN || user.role === 'SUPER_ADMIN')
      return;
    if (
      (user.role !== UserRole.ORG_ADMIN && user.role !== 'ORG_ADMIN') ||
      user.organizationId !== organizationId
    ) {
      throw new ForbiddenException('Organization management denied');
    }
  }

  private async assertCanManageProvider(
    user: PlatformUser,
    providerId: string,
  ) {
    if (user.role === UserRole.SUPER_ADMIN || user.role === 'SUPER_ADMIN')
      return;
    if (!user.organizationId)
      throw new ForbiddenException('No organization scope');
    const provider = await this.prisma.user.findUnique({
      where: { id: providerId },
      select: { organizationId: true },
    });
    if (!provider || provider.organizationId !== user.organizationId) {
      throw new ForbiddenException('Provider is outside your organization');
    }
  }

  private resolveOrganizationId(user: PlatformUser) {
    return user.organizationId ?? null;
  }

  private requireOrganizationScope(user: PlatformUser) {
    if (!user.organizationId)
      throw new ForbiddenException('No organization scope');
    return user.organizationId;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  }

  private asBooleanRecord(value: unknown): Record<string, boolean> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => typeof entry === 'boolean')
      .map(([key, entry]) => [key, entry as boolean]);
    return Object.fromEntries(entries);
  }

  private async audit(
    action: string,
    user: PlatformUser,
    metadata: Record<string, unknown> = {},
  ) {
    const actorUserId = user.sub ?? user.id;
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
