import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const ACTIVE_PRODUCTION_MODULE_KEY = 'maintenance';

export type PlatformModuleDefinition = {
  key: string;
  displayName: string;
  moduleName: string;
  description: string;
  serviceCategories: string[];
  clientRoles: string[];
  professionalRoles: string[];
  workflowStages: string[];
  assignmentRules: string[];
  slaRules: string[];
  analyticsVisibility: string[];
  billingFeatureFlags: string[];
  activeProduction: boolean;
  metadataOnly: boolean;
};

export type OrganizationModuleSummary = {
  enabledModuleKeys: string[];
  activeProductionModuleKeys: string[];
  metadataOnlyModuleKeys: string[];
  activeModules: PlatformModuleDefinition[];
  metadataOnlyModules: PlatformModuleDefinition[];
  maintenanceActive: boolean;
};

const PLATFORM_MODULES: PlatformModuleDefinition[] = [
  {
    key: 'maintenance',
    displayName: 'Maintenance Services',
    moduleName: 'FixZone',
    description:
      'FixZone maintenance operations for reports, dispatch, providers, evidence, validation and municipal service analytics.',
    serviceCategories: [
      'Road',
      'Drainage',
      'Water',
      'Electricity',
      'Waste',
      'Public Safety',
    ],
    clientRoles: ['Citizen', 'Organization requester'],
    professionalRoles: [
      'Provider',
      'Dispatch officer',
      'Organization administrator',
    ],
    workflowStages: [
      'Submitted',
      'Reviewed',
      'Assigned',
      'Accepted',
      'In Progress',
      'Completed',
      'Validated',
      'Closed',
    ],
    assignmentRules: [
      'Organization scope',
      'Provider service category',
      'Coverage area',
      'Availability',
      'Priority',
    ],
    slaRules: [
      'Priority-based response time',
      'Assignment timeout',
      'Completion review window',
    ],
    analyticsVisibility: [
      'Super Admin',
      'Organization Admin',
      'Dispatch Officer',
      'Provider',
    ],
    billingFeatureFlags: [
      'report_quota',
      'provider_quota',
      'user_quota',
      'storage_quota',
    ],
    activeProduction: true,
    metadataOnly: false,
  },
  {
    key: 'healthcare',
    displayName: 'Healthcare',
    moduleName: 'Healthcare',
    description:
      'Future healthcare service requests, patient/provider workflows, facilities and care coordination.',
    serviceCategories: ['Primary Care', 'Diagnostics', 'Emergency', 'Pharmacy'],
    clientRoles: ['Patient', 'Guardian'],
    professionalRoles: ['Clinician', 'Facility Admin'],
    workflowStages: [
      'Requested',
      'Triaged',
      'Assigned',
      'In Care',
      'Reviewed',
      'Closed',
    ],
    assignmentRules: ['Facility scope', 'Specialty', 'Availability'],
    slaRules: ['Triage time', 'Appointment window'],
    analyticsVisibility: ['Organization Admin', 'Clinical Admin'],
    billingFeatureFlags: ['appointments', 'facility_users'],
    activeProduction: false,
    metadataOnly: true,
  },
  {
    key: 'legal',
    displayName: 'Legal Services',
    moduleName: 'Legal Services',
    description:
      'Future legal intake, case routing, consultation and matter-management workflows.',
    serviceCategories: ['Consultation', 'Contracts', 'Disputes', 'Compliance'],
    clientRoles: ['Client'],
    professionalRoles: ['Lawyer', 'Paralegal', 'Firm Admin'],
    workflowStages: [
      'Intake',
      'Conflict Check',
      'Assigned',
      'In Review',
      'Resolved',
    ],
    assignmentRules: ['Practice area', 'Jurisdiction', 'Availability'],
    slaRules: ['Intake response', 'Review deadline'],
    analyticsVisibility: ['Firm Admin'],
    billingFeatureFlags: ['matters', 'professionals'],
    activeProduction: false,
    metadataOnly: true,
  },
  {
    key: 'architecture_engineering',
    displayName: 'Architecture & Engineering',
    moduleName: 'Architecture & Engineering',
    description:
      'Future project intake, technical review, site visit and professional assignment workflows.',
    serviceCategories: [
      'Architecture',
      'Civil Engineering',
      'Structural',
      'MEP',
    ],
    clientRoles: ['Client', 'Property Owner'],
    professionalRoles: ['Architect', 'Engineer', 'Practice Admin'],
    workflowStages: [
      'Brief',
      'Reviewed',
      'Assigned',
      'Design',
      'Inspection',
      'Delivered',
    ],
    assignmentRules: ['Discipline', 'Project location', 'License'],
    slaRules: ['Review time', 'Milestone deadline'],
    analyticsVisibility: ['Practice Admin'],
    billingFeatureFlags: ['projects', 'professional_seats'],
    activeProduction: false,
    metadataOnly: true,
  },
  {
    key: 'ict',
    displayName: 'ICT Services',
    moduleName: 'ICT Services',
    description:
      'Future IT support, implementation, managed-service and professional technology workflows.',
    serviceCategories: ['Support', 'Networking', 'Software', 'Cybersecurity'],
    clientRoles: ['Client', 'Employee'],
    professionalRoles: ['Technician', 'Engineer', 'Service Desk Admin'],
    workflowStages: [
      'Ticket',
      'Triaged',
      'Assigned',
      'In Progress',
      'Resolved',
      'Closed',
    ],
    assignmentRules: ['Skill', 'Severity', 'Availability'],
    slaRules: ['Severity response', 'Resolution target'],
    analyticsVisibility: ['Service Admin'],
    billingFeatureFlags: ['tickets', 'agents'],
    activeProduction: false,
    metadataOnly: true,
  },
  {
    key: 'agriculture',
    displayName: 'Agriculture',
    moduleName: 'Agriculture',
    description:
      'Future agricultural advisory, cooperative, extension, equipment and field-service workflows.',
    serviceCategories: ['Advisory', 'Inputs', 'Mechanization', 'Extension'],
    clientRoles: ['Farmer', 'Cooperative member'],
    professionalRoles: ['Extension Officer', 'Agronomist', 'Cooperative Admin'],
    workflowStages: [
      'Requested',
      'Reviewed',
      'Assigned',
      'Field Visit',
      'Completed',
    ],
    assignmentRules: ['Crop type', 'Location', 'Expertise'],
    slaRules: ['Seasonal priority', 'Visit window'],
    analyticsVisibility: ['Cooperative Admin'],
    billingFeatureFlags: ['members', 'field_requests'],
    activeProduction: false,
    metadataOnly: true,
  },
  {
    key: 'education',
    displayName: 'Education',
    moduleName: 'Education',
    description:
      'Future institution support, student services, facilities, advisory and academic operations workflows.',
    serviceCategories: [
      'Student Services',
      'Facilities',
      'Advisory',
      'Administration',
    ],
    clientRoles: ['Student', 'Parent', 'Staff'],
    professionalRoles: ['Advisor', 'Instructor', 'Institution Admin'],
    workflowStages: [
      'Submitted',
      'Reviewed',
      'Assigned',
      'In Progress',
      'Closed',
    ],
    assignmentRules: ['Department', 'Campus', 'Role'],
    slaRules: ['Response target', 'Academic calendar priority'],
    analyticsVisibility: ['Institution Admin'],
    billingFeatureFlags: ['students', 'staff_users'],
    activeProduction: false,
    metadataOnly: true,
  },
  {
    key: 'security',
    displayName: 'Security Services',
    moduleName: 'Security Services',
    description:
      'Future incident intake, guard assignment, patrol, escalation and emergency response workflows.',
    serviceCategories: ['Incident', 'Patrol', 'Emergency', 'Access Control'],
    clientRoles: ['Resident', 'Staff', 'Client'],
    professionalRoles: ['Security Officer', 'Supervisor', 'Security Admin'],
    workflowStages: [
      'Reported',
      'Triaged',
      'Dispatched',
      'Responding',
      'Resolved',
    ],
    assignmentRules: ['Zone', 'Severity', 'Team availability'],
    slaRules: ['Incident response', 'Escalation time'],
    analyticsVisibility: ['Security Admin', 'Super Admin'],
    billingFeatureFlags: ['guards', 'zones', 'incidents'],
    activeProduction: false,
    metadataOnly: true,
  },
  {
    key: 'property_facilities',
    displayName: 'Property / Facilities',
    moduleName: 'Property / Facilities',
    description:
      'Future property operations, facilities requests, inspections and vendor coordination workflows.',
    serviceCategories: ['Facilities', 'Inspection', 'Tenant Request', 'Vendor'],
    clientRoles: ['Tenant', 'Property Owner'],
    professionalRoles: ['Facility Manager', 'Vendor', 'Property Admin'],
    workflowStages: [
      'Requested',
      'Approved',
      'Assigned',
      'In Progress',
      'Closed',
    ],
    assignmentRules: ['Property', 'Unit', 'Vendor category'],
    slaRules: ['Tenant response', 'Vendor completion'],
    analyticsVisibility: ['Property Admin'],
    billingFeatureFlags: ['properties', 'units', 'vendors'],
    activeProduction: false,
    metadataOnly: true,
  },
  {
    key: 'cleaning_home',
    displayName: 'Cleaning / Home Services',
    moduleName: 'Cleaning / Home Services',
    description:
      'Future bookings, service professionals, household jobs and recurring home-service workflows.',
    serviceCategories: ['Cleaning', 'Repairs', 'Home Care', 'Errands'],
    clientRoles: ['Customer', 'Homeowner'],
    professionalRoles: ['Service Professional', 'Supervisor'],
    workflowStages: [
      'Booked',
      'Confirmed',
      'Assigned',
      'In Service',
      'Completed',
    ],
    assignmentRules: ['Service area', 'Skill', 'Schedule'],
    slaRules: ['Booking confirmation', 'Arrival window'],
    analyticsVisibility: ['Service Admin'],
    billingFeatureFlags: ['bookings', 'professionals'],
    activeProduction: false,
    metadataOnly: true,
  },
  {
    key: 'government',
    displayName: 'Government Services',
    moduleName: 'Government Services',
    description:
      'Future public-sector service intake, department routing, case management and citizen engagement workflows.',
    serviceCategories: ['Public Service', 'Permit', 'Complaint', 'Engagement'],
    clientRoles: ['Citizen', 'Business'],
    professionalRoles: ['Officer', 'Department Admin'],
    workflowStages: [
      'Submitted',
      'Department Review',
      'Assigned',
      'Actioned',
      'Closed',
    ],
    assignmentRules: ['Department', 'Jurisdiction', 'Priority'],
    slaRules: ['Public response', 'Department SLA'],
    analyticsVisibility: ['Agency Admin', 'Super Admin'],
    billingFeatureFlags: ['departments', 'public_cases'],
    activeProduction: false,
    metadataOnly: true,
  },
  {
    key: 'multi_service',
    displayName: 'Multi-Service Organization',
    moduleName: 'Multi-Service Organization',
    description:
      'A future-ready tenant profile for organizations operating multiple SecureZone service modules.',
    serviceCategories: ['Multiple modules'],
    clientRoles: ['Client'],
    professionalRoles: ['Professional', 'Organization Admin'],
    workflowStages: ['Module-defined'],
    assignmentRules: ['Module-defined'],
    slaRules: ['Module-defined'],
    analyticsVisibility: ['Organization Admin', 'Super Admin'],
    billingFeatureFlags: ['module_bundle', 'cross_module_users'],
    activeProduction: false,
    metadataOnly: true,
  },
];

@Injectable()
export class PlatformModulesService {
  private readonly registry = PLATFORM_MODULES;

  listModules() {
    return {
      platformName: 'SecureZone Platform',
      activeProductionModuleKey: ACTIVE_PRODUCTION_MODULE_KEY,
      activeProductionModuleKeys: [ACTIVE_PRODUCTION_MODULE_KEY],
      modules: this.registry,
    };
  }

  normalizeEnabledModules(value: unknown): string[] {
    const rawKeys = this.extractKeys(value);
    const validKeys = new Set(this.registry.map((module) => module.key));
    const normalized = rawKeys.filter((key) => validKeys.has(key));

    if (!normalized.includes(ACTIVE_PRODUCTION_MODULE_KEY)) {
      normalized.unshift(ACTIVE_PRODUCTION_MODULE_KEY);
    }

    return [...new Set(normalized)];
  }

  toJson(value: unknown): Prisma.InputJsonValue {
    return this.normalizeEnabledModules(value);
  }

  organizationModuleSummary(value: unknown): OrganizationModuleSummary {
    const enabledModuleKeys = this.normalizeEnabledModules(value);
    const enabledModules = enabledModuleKeys
      .map((key) => this.registry.find((module) => module.key === key))
      .filter((module): module is PlatformModuleDefinition => Boolean(module));

    const activeModules = enabledModules.filter(
      (module) => module.activeProduction,
    );
    const metadataOnlyModules = enabledModules.filter(
      (module) => !module.activeProduction,
    );

    return {
      enabledModuleKeys,
      activeProductionModuleKeys: activeModules.map((module) => module.key),
      metadataOnlyModuleKeys: metadataOnlyModules.map((module) => module.key),
      activeModules,
      metadataOnlyModules,
      maintenanceActive: enabledModuleKeys.includes(
        ACTIVE_PRODUCTION_MODULE_KEY,
      ),
    };
  }

  private extractKeys(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((item) => item?.toString().trim())
        .filter((item): item is string => Boolean(item));
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.enabledModuleKeys)) {
        return this.extractKeys(record.enabledModuleKeys);
      }
      if (Array.isArray(record.modules)) {
        return this.extractKeys(record.modules);
      }
    }

    return [ACTIVE_PRODUCTION_MODULE_KEY];
  }
}
