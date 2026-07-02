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
    moduleKeys: ['maintenance'],
    metadataOnly: false,
  },
  {
    key: 'civil_works',
    label: 'Civil Works',
    description: 'Road, drainage, structural and public works capability.',
    moduleKeys: ['maintenance'],
    metadataOnly: false,
  },
  {
    key: 'plumbing_water',
    label: 'Plumbing / Water',
    description: 'Water, drainage and plumbing service capability.',
    moduleKeys: ['maintenance'],
    metadataOnly: false,
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
    moduleKeys: ['security'],
    metadataOnly: true,
  },
  {
    key: 'property',
    label: 'Property / Facilities',
    description: 'Future property and facilities professional metadata.',
    moduleKeys: ['property_facilities'],
    metadataOnly: true,
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

@Injectable()
export class EnterpriseServicesService {
  constructor(private readonly maintenanceAdapter: MaintenanceServiceAdapter) {}

  listFramework() {
    return {
      framework: 'SecureZone Enterprise Service Framework',
      activeServiceType: MAINTENANCE_SERVICE.serviceType,
      activeModuleKey: MAINTENANCE_SERVICE.moduleKey,
      serviceDefinitions: [MAINTENANCE_SERVICE],
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
    return [MAINTENANCE_SERVICE];
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
