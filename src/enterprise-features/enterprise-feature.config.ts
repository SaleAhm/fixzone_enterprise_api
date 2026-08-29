import type { EnterpriseFeatureKey } from './enterprise-feature.decorator';

export type EnterpriseFeatureConfig = {
  displayName: string;
  moduleKey: string;
  envName: string;
};

export const ENTERPRISE_FOUNDATION_MASTER_ENV =
  'SECUREZONE_ENTERPRISE_FOUNDATIONS_ENABLED';

export const ENTERPRISE_FEATURES: Record<
  EnterpriseFeatureKey,
  EnterpriseFeatureConfig
> = {
  enterprise_governance: {
    displayName: 'Enterprise Governance',
    moduleKey: 'enterprise_governance',
    envName: 'SECUREZONE_ENTERPRISE_GOVERNANCE_ENABLED',
  },
  investigation: {
    displayName: 'Investigation',
    moduleKey: 'investigation',
    envName: 'SECUREZONE_INVESTIGATION_ENABLED',
  },
  regulatory_governance: {
    displayName: 'Regulatory Governance',
    moduleKey: 'regulatory_governance',
    envName: 'SECUREZONE_REGULATORY_GOVERNANCE_ENABLED',
  },
  asset_intelligence: {
    displayName: 'Asset Intelligence',
    moduleKey: 'asset_intelligence',
    envName: 'SECUREZONE_ASSET_INTELLIGENCE_ENABLED',
  },
  evidence_export: {
    displayName: 'Enterprise Evidence Package and Export Workflows',
    moduleKey: 'evidence_export',
    envName: 'SECUREZONE_EVIDENCE_EXPORT_WORKFLOWS_ENABLED',
  },
};

export function enterpriseFlagEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === 'true';
}
