import { SetMetadata } from '@nestjs/common';

export const ENTERPRISE_FEATURE_KEY = 'enterprise_feature';

export type EnterpriseFeatureKey =
  | 'enterprise_governance'
  | 'investigation'
  | 'regulatory_governance'
  | 'asset_intelligence'
  | 'evidence_export';

export const RequireEnterpriseFeature = (feature: EnterpriseFeatureKey) =>
  SetMetadata(ENTERPRISE_FEATURE_KEY, feature);
