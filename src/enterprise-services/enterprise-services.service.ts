import { Injectable } from '@nestjs/common';
import {
  ProviderCapabilityDefinition,
  ServiceDefinition,
} from './enterprise-services.types';
import { MaintenanceServiceAdapter } from './maintenance-service.adapter';

const PROVIDER_CAPABILITIES: ProviderCapabilityDefinition[] = [
  {
    key: 'electrical',
    label: 'Electrical',
    description: 'Electrical maintenance, utility and installation capability.',
    moduleKeys: ['maintenance', 'property_facilities'],
    metadataOnly: false,
    rolloutStage: 'PRODUCTION',
    verificationRequirement: 0,
  },
  {
    key: 'civil_works',
    label: 'Civil Works',
    description: 'Road, drainage, structural and public works capability.',
    moduleKeys: ['maintenance', 'property_facilities'],
    metadataOnly: false,
    rolloutStage: 'PRODUCTION',
    verificationRequirement: 0,
  },
  {
    key: 'plumbing_water',
    label: 'Plumbing / Water',
    description: 'Water, drainage and plumbing service capability.',
    moduleKeys: ['maintenance', 'property_facilities'],
    metadataOnly: false,
    rolloutStage: 'PRODUCTION',
    verificationRequirement: 0,
  },
  {
    key: 'property_management',
    label: 'Property Management',
    description:
      'Pilot capability metadata for property management, tenant coordination and facility oversight.',
    moduleKeys: ['property_facilities'],
    metadataOnly: true,
    rolloutStage: 'PILOT',
    verificationRequirement: 1,
  },
  {
    key: 'facilities',
    label: 'Facilities',
    description:
      'Pilot capability metadata for facilities operations and building service coordination.',
    moduleKeys: ['property_facilities'],
    metadataOnly: true,
    rolloutStage: 'PILOT',
    verificationRequirement: 1,
  },
  {
    key: 'cleaning',
    label: 'Cleaning',
    description:
      'Pilot capability metadata for cleaning service requests and janitorial operations.',
    moduleKeys: ['property_facilities', 'cleaning_home'],
    metadataOnly: true,
    rolloutStage: 'PILOT',
    verificationRequirement: 1,
  },
  {
    key: 'inspection',
    label: 'Inspection',
    description:
      'Pilot capability metadata for property inspection and safety check workflows.',
    moduleKeys: ['property_facilities'],
    metadataOnly: true,
    rolloutStage: 'PILOT',
    verificationRequirement: 1,
  },
  {
    key: 'architecture',
    label: 'Architecture',
    description: 'Future architecture professional capability metadata.',
    moduleKeys: ['architecture_engineering'],
    metadataOnly: true,
  },
  {
    key: 'medical',
    label: 'Medical',
    description: 'Future healthcare professional capability metadata.',
    moduleKeys: ['healthcare'],
    metadataOnly: true,
  },
  {
    key: 'legal',
    label: 'Legal',
    description: 'Future legal professional capability metadata.',
    moduleKeys: ['legal'],
    metadataOnly: true,
  },
  {
    key: 'ict',
    label: 'ICT',
    description: 'Future ICT professional capability metadata.',
    moduleKeys: ['ict'],
    metadataOnly: true,
  },
  {
    key: 'agriculture',
    label: 'Agriculture',
    description: 'Future agriculture professional capability metadata.',
    moduleKeys: ['agriculture'],
    metadataOnly: true,
  },
  {
    key: 'security',
    label: 'Security',
    description: 'Future security professional capability metadata.',
    moduleKeys: ['security', 'property_facilities'],
    metadataOnly: true,
    rolloutStage: 'INTERNAL',
  },
  {
    key: 'property',
    label: 'Property / Facilities',
    description:
      'Pilot Property / Facilities reference-module capability metadata.',
    moduleKeys: ['property_facilities'],
    metadataOnly: true,
    rolloutStage: 'PILOT',
    verificationRequirement: 1,
  },
  {
    key: 'education',
    label: 'Education',
    description: 'Future education professional capability metadata.',
    moduleKeys: ['education'],
    metadataOnly: true,
  },
];

const MAINTENANCE_SERVICE: ServiceDefinition = {
  moduleKey: 'maintenance',
  serviceType: 'maintenance_report',
  displayName: 'Maintenance Service Request',
  description:
    'Compatibility-backed service definition for existing FixZone Report workflows.',
  activeImplementation: true,
  metadataOnly: false,
  rolloutStage: 'PRODUCTION',
  visibility: 'production',
  organizationAvailability: 'enabled_by_default',
  serviceCategories: ['Road', 'Drainage', 'Water', 'Electricity', 'Waste'],
  lifecycle: [
    { key: 'submitted', label: 'Submitted', mapsToReportStatus: 'PENDING' },
    { key: 'assigned', label: 'Assigned', mapsToReportStatus: 'ASSIGNED' },
    {
      key: 'in_progress',
      label: 'In Progress',
      mapsToReportStatus: 'IN_PROGRESS',
    },
    {
      key: 'completed',
      label: 'Completed by Professional',
      mapsToReportStatus: 'COMPLETED_BY_PROVIDER',
    },
    { key: 'closed', label: 'Closed', mapsToReportStatus: 'CLOSED' },
  ],
  assignmentStrategy: {
    key: 'maintenance_dispatch',
    label: 'Maintenance Dispatch',
    description:
      'Uses existing FixZone dispatch, manual assignment and auto-assignment behavior.',
    inputs: [
      'organization scope',
      'provider category',
      'coverage area',
      'active assignment count',
      'priority',
    ],
  },
  priorityRules: ['Existing report priority and dispatch ordering apply.'],
  slaMetadata: [
    'Assignment timeout metadata is provided by existing report assignment deadlines.',
  ],
  escalationRules: [
    'Existing assignment timeout returns work to dispatch for reassignment.',
  ],
  requiredVerificationLevel: 0,
  requiredSubscriptionPlans: [],
  providerCapabilityRequirements: [
    'electrical',
    'civil_works',
    'plumbing_water',
  ],
  regionRules: ['Organization scope', 'Provider coverage areas'],
  extensionProviders: {
    dashboardWidgetProvider: 'maintenance.dashboard.existing',
    analyticsProvider: 'maintenance.analytics.existing',
    notificationProvider: 'maintenance.notifications.existing',
    aiProvider: 'maintenance.dispatch-ai.existing',
    documentProvider: 'maintenance.evidence.existing',
  },
};

const PROPERTY_FACILITIES_SERVICE: ServiceDefinition = {
  moduleKey: 'property_facilities',
  serviceType: 'property_facilities_request',
  displayName: 'Property / Facilities Service Request',
  description:
    'Pilot reference module definition for property operations, facility maintenance, tenant issues, inspections, cleaning and building repairs. This is metadata-only and does not expose production workflows.',
  activeImplementation: false,
  metadataOnly: true,
  rolloutStage: 'PILOT',
  visibility: 'admin_internal',
  organizationAvailability: 'opt_in_metadata_only',
  serviceCategories: [
    'Property Inspection',
    'Facility Maintenance',
    'Cleaning Service Request',
    'Safety Check',
    'Tenant Issue',
    'Building Repair',
  ],
  lifecycle: [
    { key: 'submitted', label: 'Submitted' },
    { key: 'reviewed', label: 'Reviewed' },
    { key: 'assigned', label: 'Assigned' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'evidence_uploaded', label: 'Evidence Uploaded' },
    { key: 'validated', label: 'Validated' },
    { key: 'closed', label: 'Closed' },
  ],
  assignmentStrategy: {
    key: 'property_facilities_dispatch_pilot',
    label: 'Property / Facilities Dispatch Pilot',
    description:
      'Designed to reuse organization scope, provider capabilities, evidence, trust and notification foundations. Assignment behavior is not active.',
    inputs: [
      'organization scope',
      'property or facility reference',
      'tenant/client context',
      'provider capability metadata',
      'coverage area',
      'priority',
    ],
  },
  priorityRules: [
    'Safety checks and critical building repairs should rank above routine tenant issues.',
    'Pilot priority metadata only; no production assignment ranking is enabled.',
  ],
  slaMetadata: [
    'Inspection response target',
    'Tenant issue response target',
    'Facility repair completion target',
  ],
  escalationRules: [
    'Escalate overdue safety checks to Organization Admin.',
    'Escalate repeated tenant issues to Facility Manager.',
  ],
  requiredVerificationLevel: 1,
  requiredSubscriptionPlans: ['PROFESSIONAL', 'GOVERNMENT', 'ENTERPRISE'],
  providerCapabilityRequirements: [
    'property_management',
    'facilities',
    'cleaning',
    'plumbing_water',
    'electrical',
    'civil_works',
    'security',
    'inspection',
  ],
  regionRules: ['Organization scope', 'Property/facility coverage area'],
  extensionProviders: {
    dashboardWidgetProvider: 'property_facilities.dashboard.pilot',
    analyticsProvider: 'property_facilities.analytics.pilot',
    notificationProvider: 'property_facilities.notifications.pilot',
    aiProvider: 'property_facilities.dispatch-ai.pilot',
    documentProvider: 'property_facilities.evidence.pilot',
  },
};

@Injectable()
export class EnterpriseServicesService {
  constructor(private readonly maintenanceAdapter: MaintenanceServiceAdapter) {}

  listFramework() {
    return {
      framework: 'SecureZone Enterprise Service Framework',
      activeServiceType: MAINTENANCE_SERVICE.serviceType,
      activeModuleKey: MAINTENANCE_SERVICE.moduleKey,
      serviceDefinitions: [MAINTENANCE_SERVICE, PROPERTY_FACILITIES_SERVICE],
      providerCapabilities: PROVIDER_CAPABILITIES,
      registrationSlots: [
        'supportedServiceTypes',
        'supportedProviderCapabilities',
        'assignmentStrategy',
        'dashboardWidgetProvider',
        'analyticsProvider',
        'notificationProvider',
        'aiProvider',
        'documentProvider',
      ],
    };
  }

  listServiceDefinitions() {
    return [MAINTENANCE_SERVICE, PROPERTY_FACILITIES_SERVICE];
  }

  listProviderCapabilities() {
    return PROVIDER_CAPABILITIES;
  }

  getMaintenanceRegistration() {
    return {
      serviceDefinition: MAINTENANCE_SERVICE,
      compatibility: this.maintenanceAdapter.describeCompatibility(),
    };
  }
}
