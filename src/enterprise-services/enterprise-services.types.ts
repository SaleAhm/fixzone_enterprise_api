export type ServiceLifecycleStage = {
  key: string;
  label: string;
  mapsToReportStatus?: string;
};

export type AssignmentStrategyDefinition = {
  key: string;
  label: string;
  description: string;
  inputs: string[];
};

export type ProviderCapabilityDefinition = {
  key: string;
  label: string;
  description: string;
  moduleKeys: string[];
  metadataOnly: boolean;
};

export type ServiceDefinition = {
  moduleKey: string;
  serviceType: string;
  displayName: string;
  description: string;
  activeImplementation: boolean;
  metadataOnly: boolean;
  serviceCategories: string[];
  lifecycle: ServiceLifecycleStage[];
  assignmentStrategy: AssignmentStrategyDefinition;
  priorityRules: string[];
  slaMetadata: string[];
  escalationRules: string[];
  requiredVerificationLevel: number;
  requiredSubscriptionPlans: string[];
  providerCapabilityRequirements: string[];
  regionRules: string[];
  extensionProviders: {
    dashboardWidgetProvider: string;
    analyticsProvider: string;
    notificationProvider: string;
    aiProvider: string;
    documentProvider: string;
  };
};

export type GenericServiceRequest = {
  framework: 'SecureZone Enterprise Service Framework';
  moduleKey: string;
  serviceType: string;
  sourceEntity: 'Report';
  sourceId?: string;
  title?: string;
  description?: string;
  category?: string;
  location?: string;
  lifecycleStage?: string;
  requesterId?: string;
  organizationId?: string;
  assignedProfessionalId?: string | null;
  priority?: string;
  metadata: Record<string, unknown>;
};
