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

type AuditHistoryQuery = {
  action?: string;
  organizationId?: string;
  groupBy?: string;
  limit?: string;
};

type ModuleReadinessQuery = {
  organizationId?: string;
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
const ACTIVE_SERVICE_TYPE = 'maintenance_report';
const PROPERTY_FACILITIES_SERVICE_TYPE = 'property_facilities_request';
const FUTURE_SERVICE_TYPES = [
  'future_healthcare',
  'future_legal',
  'future_ict',
  'future_agriculture',
  'future_education',
  'future_security',
  'future_property',
  PROPERTY_FACILITIES_SERVICE_TYPE,
  'future_architecture_engineering',
  'future_cleaning_home',
  'future_government',
];
const KNOWN_SERVICE_TYPES = [ACTIVE_SERVICE_TYPE, ...FUTURE_SERVICE_TYPES];

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
    const configurationValidation =
      this.validateServiceConfigurationRecord(serviceConfiguration);

    return {
      platformName: 'SecureZone Platform',
      activeProductionService: ACTIVE_SERVICE_TYPE,
      activeProductionModule: 'maintenance',
      serviceConfiguration,
      configurationValidation,
      providerCapabilities: this.getProviderCapabilities(),
      analyticsContracts: this.getAnalyticsContracts(),
      rolloutGovernance: this.getRolloutGovernance(),
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
        'property_management',
        'Property Management',
        'Property / Facilities Pilot',
        true,
        1,
        'PILOT',
      ),
      this.capability(
        'facilities',
        'Facilities',
        'Property / Facilities Pilot',
        true,
        1,
        'PILOT',
      ),
      this.capability(
        'cleaning',
        'Cleaning',
        'Property / Facilities Pilot',
        true,
        1,
        'PILOT',
      ),
      this.capability(
        'inspection',
        'Inspection',
        'Property / Facilities Pilot',
        true,
        1,
        'PILOT',
      ),
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

  getRolloutGovernance() {
    return {
      activeProductionService: ACTIVE_SERVICE_TYPE,
      activeProductionModule: 'maintenance',
      stages: [
        {
          key: 'EXPERIMENTAL',
          label: 'Experimental',
          description: 'Exploratory internal concept; not tenant-facing.',
        },
        {
          key: 'INTERNAL',
          label: 'Internal',
          description: 'Metadata/configuration only; no operational workflow.',
        },
        {
          key: 'PILOT',
          label: 'Pilot',
          description: 'Limited controlled rollout after acceptance gates.',
        },
        {
          key: 'BETA',
          label: 'Beta',
          description: 'Broader pre-production rollout with monitoring.',
        },
        {
          key: 'PRODUCTION',
          label: 'Production',
          description: 'Operational production service.',
        },
        {
          key: 'DEPRECATED',
          label: 'Deprecated',
          description: 'Operational but scheduled for replacement/removal.',
        },
        {
          key: 'RETIRED',
          label: 'Retired',
          description: 'No longer operational.',
        },
      ],
      modules: [
        {
          moduleKey: 'maintenance',
          serviceType: ACTIVE_SERVICE_TYPE,
          stage: 'PRODUCTION',
          operational: true,
          activationAllowed: true,
          note: 'FixZone Maintenance is the only operational production service.',
        },
        ...FUTURE_SERVICE_TYPES.filter(
          (serviceType) => serviceType !== 'future_property',
        ).map((serviceType) => ({
          moduleKey:
            serviceType === PROPERTY_FACILITIES_SERVICE_TYPE
              ? 'property_facilities'
              : serviceType.replace(/^future_/, ''),
          serviceType,
          stage:
            serviceType === PROPERTY_FACILITIES_SERVICE_TYPE ||
            serviceType === 'future_property'
              ? 'PILOT'
              : 'INTERNAL',
          operational: false,
          activationAllowed: false,
          note:
            serviceType === PROPERTY_FACILITIES_SERVICE_TYPE ||
            serviceType === 'future_property'
              ? 'Property / Facilities reference module metadata only; user workflows are not exposed.'
              : 'Future module metadata only; business workflow is not active.',
        })),
      ],
      activationGates: [
        'Architecture decision approved',
        'Tenant configuration validated',
        'Provider capability requirements defined',
        'Trust and entitlement policy approved',
        'Audit and incident runbooks completed',
        'Backend, Flutter and e2e validation passed',
      ],
    };
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
  ): Promise<
    TenantServiceConfiguration & {
      organizationId?: string;
      validation: ReturnType<
        PlatformConfigurationService['validateServiceConfigurationRecord']
      >;
    }
  > {
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
      validation: this.validateServiceConfigurationRecord(
        this.mergeServiceConfiguration(
          profileData[PROFILE_CONFIG_KEY],
          organization.enabledModules,
        ),
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
      validation: this.validateServiceConfigurationInput(
        {
          ...this.asRecord(profileData[PROFILE_CONFIG_KEY]),
          ...dto,
        },
        existing.enabledModules,
      ),
    });
    const merged = this.mergeServiceConfiguration(
      updatedProfile[PROFILE_CONFIG_KEY],
      updated.enabledModules,
    );
    return {
      organizationId: updated.id,
      ...merged,
      validation: this.validateServiceConfigurationRecord(merged),
    };
  }

  async validateTenantConfiguration(
    user: PlatformUser,
    organizationId?: string,
  ) {
    const targetOrganizationId =
      organizationId ?? this.requireOrganizationScope(user);
    await this.assertCanAccessOrganization(user, targetOrganizationId);
    const organization = await this.prisma.organization.findUnique({
      where: { id: targetOrganizationId },
      select: { id: true, enabledModules: true, profileData: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    const profileData = this.asRecord(organization.profileData);
    const rawConfiguration = this.asRecord(profileData[PROFILE_CONFIG_KEY]);
    const merged = this.mergeServiceConfiguration(
      rawConfiguration,
      organization.enabledModules,
    );
    return {
      organizationId: organization.id,
      validation: this.validateServiceConfigurationInput(
        rawConfiguration,
        organization.enabledModules,
      ),
      normalizedConfiguration: merged,
    };
  }

  async getRuntimeReadiness(user: PlatformUser, organizationId?: string) {
    const targetOrganizationId =
      organizationId ?? this.resolveOrganizationId(user);
    if (targetOrganizationId) {
      await this.assertCanAccessOrganization(user, targetOrganizationId);
    }

    const where = targetOrganizationId
      ? { organizationId: targetOrganizationId }
      : {};
    const organization = targetOrganizationId
      ? await this.prisma.organization.findUnique({
          where: { id: targetOrganizationId },
          select: {
            id: true,
            name: true,
            enabledModules: true,
            profileData: true,
            subscriptionPlan: true,
            billingStatus: true,
            status: true,
          },
        })
      : null;
    if (targetOrganizationId && !organization) {
      throw new NotFoundException('Organization not found');
    }

    const profileData = this.asRecord(organization?.profileData);
    const serviceConfiguration = this.mergeServiceConfiguration(
      profileData[PROFILE_CONFIG_KEY],
      organization?.enabledModules,
    );
    const validation =
      this.validateServiceConfigurationRecord(serviceConfiguration);

    const [
      providerCount,
      activeProviderCount,
      verifiedProviderCount,
      providerCapabilityAssignedCount,
      reportCount,
      activeReportCount,
      kycPendingCount,
      evidenceRecordCount,
      recentConfigurationEvents,
      recentCapabilityEvents,
    ] = await Promise.all([
      this.prisma.user.count({ where: { ...where, role: UserRole.PROVIDER } }),
      this.prisma.user.count({
        where: { ...where, role: UserRole.PROVIDER, accountStatus: 'ACTIVE' },
      }),
      this.prisma.user.count({
        where: {
          ...where,
          role: UserRole.PROVIDER,
          identityVerificationLevel: { gt: 0 },
        },
      }),
      this.providerCapabilityAssignedCount(where),
      this.prisma.report.count({ where }),
      this.prisma.report.count({
        where: {
          ...where,
          status: { in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS'] },
        },
      }),
      this.prisma.kycSubmission.count({
        where: {
          user: where,
          status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
        },
      }),
      this.prisma.evidenceRecord.count({ where }),
      this.prisma.demoAuditLog.count({
        where: { action: 'Tenant Service Configuration Updated' },
      }),
      this.prisma.demoAuditLog.count({
        where: {
          action: {
            in: [
              'Provider Capabilities Assigned',
              'Provider Capability Deactivated',
              'Provider Capability Removed',
            ],
          },
        },
      }),
    ]);

    const checks = [
      this.readinessCheck(
        'tenant',
        organization?.status === 'SUSPENDED' ? 'warning' : 'ready',
        organization
          ? `Tenant ${organization.name} is ${organization.status}.`
          : 'Super Admin global readiness view.',
      ),
      this.readinessCheck(
        'module',
        serviceConfiguration.enabledServices.includes(ACTIVE_SERVICE_TYPE)
          ? 'ready'
          : 'warning',
        'Maintenance Services is the only operational production service.',
      ),
      this.readinessCheck(
        'configuration',
        validation.valid ? 'ready' : 'warning',
        validation.valid
          ? 'Tenant service configuration is complete enough for runtime presentation.'
          : `${validation.issues.length} configuration issue(s) detected.`,
        validation,
      ),
      this.readinessCheck(
        'provider',
        activeProviderCount > 0 && providerCapabilityAssignedCount > 0
          ? 'ready'
          : 'warning',
        `${activeProviderCount}/${providerCount} providers are active; ${providerCapabilityAssignedCount} have capability metadata.`,
        {
          providerCount,
          activeProviderCount,
          verifiedProviderCount,
          providerCapabilityAssignedCount,
        },
      ),
      this.readinessCheck(
        'service',
        serviceConfiguration.defaultService === ACTIVE_SERVICE_TYPE
          ? 'ready'
          : 'attention',
        `Default service is ${serviceConfiguration.defaultService}. Maintenance remains the only operational destination.`,
        {
          enabledServices: serviceConfiguration.enabledServices,
          serviceOrdering: serviceConfiguration.serviceOrdering,
        },
      ),
      this.readinessCheck(
        'deployment',
        'ready',
        'Runtime deployment checks are available through Platform Tools health.',
        {
          healthEndpoint: '/api/platform-tools/health',
          readinessEndpoint: '/api/platform/readiness',
        },
      ),
      this.readinessCheck(
        'trust',
        kycPendingCount > 0 ? 'attention' : 'ready',
        `${kycPendingCount} KYC submission(s) pending review.`,
      ),
      this.readinessCheck(
        'subscription',
        organization?.billingStatus === 'PAST_DUE' ||
          organization?.billingStatus === 'SUSPENDED'
          ? 'warning'
          : 'ready',
        organization
          ? `${organization.subscriptionPlan} / ${organization.billingStatus}`
          : 'Global subscription readiness is informational.',
      ),
    ];

    const summary = {
      ready: checks.filter((item) => item.status === 'ready').length,
      warning: checks.filter((item) => item.status === 'warning').length,
      attention: checks.filter((item) => item.status === 'attention').length,
      healthScore: this.healthScore(checks),
      overallHealth: this.overallHealth(checks),
      riskIndicators: this.riskIndicators(checks),
      informationalOnly: true,
      enforcementMode: 'non_blocking',
    };

    return {
      organizationId: organization?.id ?? null,
      generatedAt: new Date().toISOString(),
      activeProductionService: ACTIVE_SERVICE_TYPE,
      activeProductionModule: 'maintenance',
      futureModulesOperational: false,
      serviceConfiguration,
      checks,
      summary,
      runtimeSignals: {
        reportCount,
        activeReportCount,
        evidenceRecordCount,
        recentConfigurationEvents,
        recentCapabilityEvents,
        providerCapabilityAssignedCount,
      },
    };
  }

  async getModuleReadiness(
    user: PlatformUser,
    moduleKey: string,
    query: ModuleReadinessQuery = {},
  ) {
    const normalizedModuleKey = moduleKey.trim();
    const targetOrganizationId =
      query.organizationId?.trim() || this.resolveOrganizationId(user);
    if (targetOrganizationId) {
      await this.assertCanAccessOrganization(user, targetOrganizationId);
    }

    const framework = this.enterpriseServices.listFramework();
    const serviceDefinition = framework.serviceDefinitions.find(
      (definition) => definition.moduleKey === normalizedModuleKey,
    );
    const rolloutModule = this.getRolloutGovernance().modules.find(
      (item) => item.moduleKey === normalizedModuleKey,
    );
    const runtimeReadiness = await this.getRuntimeReadiness(
      user,
      targetOrganizationId ?? undefined,
    );
    const providerCoverage = await this.moduleProviderCapabilityCoverage(
      normalizedModuleKey,
      serviceDefinition?.providerCapabilityRequirements ?? [],
      targetOrganizationId ?? undefined,
    );
    const checks = [
      this.moduleCheck(
        'module_registered',
        Boolean(rolloutModule),
        rolloutModule
          ? 'Module is registered in rollout governance.'
          : 'Module is not registered in rollout governance.',
        !rolloutModule,
      ),
      this.moduleCheck(
        'service_definition_complete',
        Boolean(serviceDefinition),
        serviceDefinition
          ? 'Enterprise service definition is registered.'
          : 'Enterprise service definition is missing.',
        !serviceDefinition,
      ),
      this.moduleCheck(
        'provider_capabilities_available',
        providerCoverage.missingDefinitions.length === 0,
        providerCoverage.missingDefinitions.length === 0
          ? 'Provider capability definitions are available.'
          : `${providerCoverage.missingDefinitions.length} provider capability definition(s) are missing.`,
        providerCoverage.missingDefinitions.length > 0,
        providerCoverage,
      ),
      this.moduleCheck(
        'provider_capability_coverage',
        providerCoverage.missingAssignments.length === 0,
        providerCoverage.missingAssignments.length === 0
          ? 'Provider capability coverage is present.'
          : `${providerCoverage.missingAssignments.length} required capability assignment(s) have no provider coverage yet.`,
        false,
        providerCoverage,
      ),
      this.moduleCheck(
        'trust_requirements',
        (serviceDefinition?.requiredVerificationLevel ?? 0) >= 0,
        `Verification requirement level ${
          serviceDefinition?.requiredVerificationLevel ?? 0
        } is defined.`,
      ),
      this.moduleCheck(
        'subscription_requirements',
        Boolean(serviceDefinition),
        serviceDefinition?.requiredSubscriptionPlans.length
          ? `Subscription placeholders configured: ${serviceDefinition.requiredSubscriptionPlans.join(
              ', ',
            )}.`
          : 'No subscription requirement configured.',
      ),
      this.moduleCheck(
        'organization_eligibility',
        Boolean(targetOrganizationId) || user.role === UserRole.SUPER_ADMIN,
        targetOrganizationId
          ? 'Organization scope is available for eligibility evaluation.'
          : 'Global Super Admin readiness view.',
      ),
      this.moduleCheck(
        'rollout_stage',
        rolloutModule?.stage === 'PILOT' ||
          rolloutModule?.stage === 'PRODUCTION',
        rolloutModule
          ? `Rollout stage is ${rolloutModule.stage}.`
          : 'Rollout stage is missing.',
        !rolloutModule,
        rolloutModule ?? {},
      ),
      this.moduleCheck(
        'runtime_health',
        runtimeReadiness.summary.overallHealth !== 'warning',
        `Platform runtime health is ${runtimeReadiness.summary.overallHealth}.`,
        false,
        runtimeReadiness.summary,
      ),
      this.moduleCheck(
        'configuration_completeness',
        true,
        'Configuration validation is available and non-blocking.',
        false,
        {
          validationEndpoint: targetOrganizationId
            ? `/api/platform/configuration-validation/${targetOrganizationId}`
            : null,
        },
      ),
      this.moduleCheck(
        'deployment_readiness',
        true,
        'Deployment validation commands are defined in the operations runbooks.',
      ),
    ];

    const blockingItems = checks.filter((check) => check.blocking);
    const warnings = checks.filter((check) => !check.passed && !check.blocking);
    const readinessScore = this.moduleReadinessScore(checks);
    const readinessState = blockingItems.length
      ? 'not_ready'
      : warnings.length
        ? 'ready_with_warnings'
        : 'ready';

    const snapshot = {
      moduleKey: normalizedModuleKey,
      serviceType: serviceDefinition?.serviceType ?? null,
      rolloutStage: rolloutModule?.stage ?? 'UNKNOWN',
      activationEnabled: false,
      activationDisabledReason:
        normalizedModuleKey === 'maintenance'
          ? 'Maintenance is already the production service.'
          : 'Pilot activation remains disabled until governance approval.',
      generatedAt: new Date().toISOString(),
      readinessScore,
      readinessState,
      blockingItems,
      warnings,
      checks,
      providerCoverage,
      serviceDefinition: serviceDefinition ?? null,
      runtimeSummary: runtimeReadiness.summary,
      informationalOnly: true,
    };

    await this.audit('Module Readiness Evaluated', user, {
      moduleKey: normalizedModuleKey,
      organizationId: targetOrganizationId ?? null,
      readinessScore,
      readinessState,
      blockingItems: blockingItems.map((item) => item.key),
      warnings: warnings.map((item) => item.key),
    });

    return snapshot;
  }

  async getModuleActivationGovernance(
    user: PlatformUser,
    moduleKey: string,
    query: ModuleReadinessQuery = {},
  ) {
    const readiness = await this.getModuleReadiness(user, moduleKey, query);
    const checklist = [
      this.activationItem(
        'architecture_approval',
        'Architecture decision approved',
        readiness.moduleKey === 'property_facilities',
      ),
      this.activationItem(
        'service_definition',
        'Enterprise service definition complete',
        Boolean(readiness.serviceDefinition),
      ),
      this.activationItem(
        'provider_capabilities',
        'Provider capability definitions and coverage reviewed',
        readiness.providerCoverage.missingDefinitions.length === 0,
      ),
      this.activationItem(
        'trust_policy',
        'Trust and verification requirements reviewed',
        Boolean(readiness.serviceDefinition),
      ),
      this.activationItem(
        'subscription_policy',
        'Subscription and entitlement placeholders reviewed',
        Boolean(readiness.serviceDefinition),
      ),
      this.activationItem(
        'runtime_health',
        'Runtime health reviewed',
        readiness.runtimeSummary.overallHealth !== 'warning',
      ),
      this.activationItem(
        'rollback_readiness',
        'Rollback and incident response runbooks available',
        true,
      ),
      this.activationItem(
        'validation',
        'Backend, Flutter and documentation validation required before activation',
        false,
      ),
      this.activationItem(
        'approval',
        'Executive/platform owner approval required',
        false,
      ),
    ];

    return {
      moduleKey: readiness.moduleKey,
      serviceType: readiness.serviceType,
      rolloutStage: readiness.rolloutStage,
      activationEnabled: false,
      activationState: 'disabled',
      activationDisabledReason:
        'Phase 5C evaluates readiness only; activation is intentionally disabled.',
      readiness,
      checklist,
      pilotChecklist: checklist,
      productionChecklist: [
        ...checklist,
        this.activationItem(
          'pilot_complete',
          'Pilot acceptance criteria completed',
          false,
        ),
        this.activationItem(
          'production_support',
          'Production support and SLA ownership assigned',
          false,
        ),
      ],
      rollbackReadiness: {
        available: true,
        runbook: 'docs/INCIDENT_RESPONSE_GUIDE.md',
        activationRollbackRequired: false,
      },
      dependencyChecks: {
        maintenanceUnaffected: true,
        reportMigrationRequired: false,
        schemaMigrationRequired: false,
        userWorkflowExposed: false,
      },
    };
  }

  async getPlatformHealthSummary(user: PlatformUser) {
    const readiness = await this.getRuntimeReadiness(user);
    const summary = readiness.summary as Record<string, unknown>;
    return {
      generatedAt: new Date().toISOString(),
      platformName: 'SecureZone Platform',
      overallHealth: summary.overallHealth,
      healthScore: summary.healthScore,
      riskIndicators: summary.riskIndicators,
      readinessSummary: summary,
      checks: readiness.checks,
      operationalService: {
        moduleKey: 'maintenance',
        serviceType: ACTIVE_SERVICE_TYPE,
        rolloutStage: 'PRODUCTION',
      },
      futureModules: {
        operational: false,
        rolloutStage: 'INTERNAL',
        note: 'Future service modules remain metadata/configuration only.',
      },
    };
  }

  async getPlatformAuditHistory(
    user: PlatformUser,
    query: AuditHistoryQuery = {},
  ) {
    if (user.role !== UserRole.SUPER_ADMIN && user.role !== 'SUPER_ADMIN') {
      if (!user.organizationId) {
        throw new ForbiddenException('No organization scope');
      }
    }
    const actions = [
      'Tenant Service Configuration Updated',
      'Provider Capabilities Assigned',
      'Provider Capability Deactivated',
      'Provider Capability Removed',
      'Module Readiness Evaluated',
    ];
    const requestedAction = query.action?.trim();
    const limit = Math.min(
      Math.max(Number.parseInt(query.limit ?? '50', 10) || 50, 1),
      200,
    );
    const organizationScope =
      user.role === UserRole.SUPER_ADMIN || user.role === 'SUPER_ADMIN'
        ? query.organizationId?.trim()
        : user.organizationId;
    const items = await this.prisma.demoAuditLog.findMany({
      where: {
        action: requestedAction ? requestedAction : { in: actions },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const filtered = organizationScope
      ? items.filter((item) => {
          const metadata = this.asRecord(item.metadata);
          return metadata.organizationId === organizationScope;
        })
      : items;
    const limited = filtered.slice(0, limit);
    return {
      total: filtered.length,
      items: limited,
      actions,
      filters: {
        action: requestedAction ?? null,
        organizationId: organizationScope ?? null,
        groupBy: query.groupBy ?? null,
        limit,
      },
      grouped:
        query.groupBy === 'action'
          ? this.groupAuditItems(limited, 'action')
          : query.groupBy === 'actor'
            ? this.groupAuditItems(limited, 'actorUserId')
            : null,
      timeline: limited.map((item) => ({
        id: item.id,
        action: item.action,
        actorUserId: item.actorUserId,
        createdAt: item.createdAt,
        metadata: item.metadata,
      })),
      note: 'Audit history reuses the existing audit log store and remains informational.',
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
      futureApprovalCount: assignments.filter(
        (item) =>
          catalog.get(item.id)?.metadataOnly === true ||
          item.approvalWorkflow === 'placeholder',
      ).length,
      verificationSummary: {
        requiredLevels: assignments
          .map((item) => catalog.get(item.id)?.verificationRequirement ?? 0)
          .sort((a, b) => b - a),
        highestRequiredLevel: assignments.reduce(
          (highest, item) =>
            Math.max(
              highest,
              catalog.get(item.id)?.verificationRequirement ?? 0,
            ),
          0,
        ),
      },
    };
  }

  private capability(
    id: string,
    name: string,
    category: string,
    metadataOnly: boolean,
    verificationRequirement: number,
    rolloutStage?: string,
  ) {
    return {
      id,
      name,
      description: `${name} provider capability metadata for SecureZone services.`,
      category,
      status: metadataOnly ? 'METADATA_ONLY' : 'ACTIVE',
      rolloutStage: rolloutStage ?? (metadataOnly ? 'INTERNAL' : 'PRODUCTION'),
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
      defaultService: ACTIVE_SERVICE_TYPE,
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
      enabledServices.unshift(ACTIVE_SERVICE_TYPE);
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
      : [ACTIVE_SERVICE_TYPE];
    const normalized = [...new Set(items as string[])];
    return normalized.includes(ACTIVE_SERVICE_TYPE)
      ? normalized
      : [ACTIVE_SERVICE_TYPE, ...normalized];
  }

  private validateServiceConfigurationInput(
    rawConfiguration: unknown,
    enabledModules: unknown,
  ) {
    const raw = this.asRecord(rawConfiguration);
    const merged = this.mergeServiceConfiguration(raw, enabledModules);
    const issues = [
      ...this.duplicateIssues('enabledServices', raw.enabledServices),
      ...this.duplicateIssues('serviceOrdering', raw.serviceOrdering),
      ...this.unknownServiceIssues('enabledServices', raw.enabledServices),
      ...this.unknownServiceIssues('serviceOrdering', raw.serviceOrdering),
    ];
    const warnings = [
      ...this.missingDefaultWarnings(merged),
      ...this.visibilityWarnings(merged),
    ];
    return {
      valid: issues.length === 0,
      issues,
      warnings,
      knownServices: KNOWN_SERVICE_TYPES,
      guardMode: 'non_blocking',
    };
  }

  private validateServiceConfigurationRecord(
    configuration: TenantServiceConfiguration,
  ) {
    const issues = [
      ...this.unknownServiceIssues(
        'enabledServices',
        configuration.enabledServices,
      ),
      ...this.unknownServiceIssues(
        'serviceOrdering',
        configuration.serviceOrdering,
      ),
    ];
    const warnings = [
      ...this.missingDefaultWarnings(configuration),
      ...this.visibilityWarnings(configuration),
    ];
    return {
      valid: issues.length === 0,
      issues,
      warnings,
      knownServices: KNOWN_SERVICE_TYPES,
      guardMode: 'non_blocking',
    };
  }

  private duplicateIssues(field: string, value: unknown) {
    if (!Array.isArray(value)) return [];
    const normalized = value.map((item) => item?.toString().trim());
    const duplicates = normalized.filter(
      (item, index) => item && normalized.indexOf(item) !== index,
    );
    return [...new Set(duplicates)].map((service) => ({
      code: 'duplicate_service',
      field,
      service,
      message: `${field} contains duplicate service '${service}'.`,
    }));
  }

  private unknownServiceIssues(field: string, value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => item?.toString().trim())
      .filter((item): item is string => Boolean(item))
      .filter((service) => !KNOWN_SERVICE_TYPES.includes(service))
      .map((service) => ({
        code: 'unknown_service',
        field,
        service,
        message: `${field} contains unknown service '${service}'.`,
      }));
  }

  private missingDefaultWarnings(configuration: TenantServiceConfiguration) {
    if (configuration.enabledServices.includes(configuration.defaultService)) {
      return [];
    }
    return [
      {
        code: 'default_service_not_enabled',
        field: 'defaultService',
        service: configuration.defaultService,
        message: 'Default service should also be enabled.',
      },
    ];
  }

  private visibilityWarnings(configuration: TenantServiceConfiguration) {
    return configuration.enabledServices
      .filter((service) => configuration.serviceVisibility[service] !== true)
      .map((service) => ({
        code: 'enabled_service_hidden',
        field: 'serviceVisibility',
        service,
        message:
          'Enabled service is hidden from runtime presentation. This is allowed but should be intentional.',
      }));
  }

  private readinessCheck(
    key: string,
    status: 'ready' | 'warning' | 'attention',
    message: string,
    details: Record<string, unknown> = {},
  ) {
    return { key, status, message, details };
  }

  private moduleCheck(
    key: string,
    passed: boolean,
    message: string,
    blocking = false,
    details: Record<string, unknown> = {},
  ) {
    return {
      key,
      passed,
      status: passed ? 'ready' : blocking ? 'blocking' : 'warning',
      blocking: !passed && blocking,
      message,
      details,
    };
  }

  private moduleReadinessScore(
    checks: Array<{ passed: boolean; blocking: boolean }>,
  ) {
    if (!checks.length) return 0;
    const score = checks.reduce((total, check) => {
      if (check.passed) return total + 100;
      if (check.blocking) return total + 25;
      return total + 70;
    }, 0);
    return Math.round(score / checks.length);
  }

  private activationItem(key: string, label: string, passed: boolean) {
    return {
      key,
      label,
      passed,
      required: true,
      status: passed ? 'complete' : 'pending',
    };
  }

  private async moduleProviderCapabilityCoverage(
    moduleKey: string,
    requiredCapabilities: string[],
    organizationId?: string,
  ) {
    const catalog = this.enterpriseServices.listProviderCapabilities();
    const catalogKeys = new Set(catalog.map((capability) => capability.key));
    const moduleCatalog = catalog.filter((capability) =>
      capability.moduleKeys.includes(moduleKey),
    );
    const missingDefinitions = requiredCapabilities.filter(
      (capability) => !catalogKeys.has(capability),
    );
    const providers = await this.prisma.user.findMany({
      where: {
        role: UserRole.PROVIDER,
        ...(organizationId ? { organizationId } : {}),
      },
      select: { id: true, fullName: true, profileData: true },
    });
    const assignedByCapability = new Map<string, number>();
    for (const provider of providers) {
      const assignments = this.readProviderCapabilityAssignments(
        this.asRecord(provider.profileData),
      );
      for (const assignment of assignments) {
        if (assignment.status === 'INACTIVE') continue;
        assignedByCapability.set(
          assignment.id,
          (assignedByCapability.get(assignment.id) ?? 0) + 1,
        );
      }
    }
    const missingAssignments = requiredCapabilities.filter(
      (capability) => !assignedByCapability.has(capability),
    );

    return {
      moduleKey,
      providerCount: providers.length,
      catalogCount: moduleCatalog.length,
      requiredCapabilities,
      availableDefinitions: requiredCapabilities.filter((capability) =>
        catalogKeys.has(capability),
      ),
      missingDefinitions,
      assignedByCapability: Object.fromEntries(assignedByCapability.entries()),
      missingAssignments,
      coveragePercent: requiredCapabilities.length
        ? Math.round(
            ((requiredCapabilities.length - missingAssignments.length) /
              requiredCapabilities.length) *
              100,
          )
        : 100,
    };
  }

  private healthScore(
    checks: Array<{ status: 'ready' | 'warning' | 'attention' }>,
  ) {
    if (!checks.length) return 0;
    const score = checks.reduce((total, check) => {
      if (check.status === 'ready') return total + 100;
      if (check.status === 'attention') return total + 75;
      return total + 45;
    }, 0);
    return Math.round(score / checks.length);
  }

  private overallHealth(
    checks: Array<{ status: 'ready' | 'warning' | 'attention' }>,
  ) {
    const score = this.healthScore(checks);
    if (score >= 90) return 'healthy';
    if (score >= 70) return 'attention';
    return 'warning';
  }

  private riskIndicators(
    checks: Array<{
      key: string;
      status: 'ready' | 'warning' | 'attention';
      message: string;
    }>,
  ) {
    return checks
      .filter((check) => check.status !== 'ready')
      .map((check) => ({
        key: check.key,
        severity: check.status === 'warning' ? 'medium' : 'low',
        message: check.message,
      }));
  }

  private async providerCapabilityAssignedCount(
    where: Record<string, unknown>,
  ) {
    const providers = await this.prisma.user.findMany({
      where: { ...where, role: UserRole.PROVIDER },
      select: { profileData: true },
    });
    return providers.filter(
      (provider) =>
        this.readProviderCapabilityAssignments(
          this.asRecord(provider.profileData),
        ).length > 0,
    ).length;
  }

  private groupAuditItems(
    items: Array<{ action: string; actorUserId: string }>,
    field: 'action' | 'actorUserId',
  ) {
    return items.reduce<Record<string, number>>((groups, item) => {
      const key = item[field] || 'unknown';
      groups[key] = (groups[key] ?? 0) + 1;
      return groups;
    }, {});
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
