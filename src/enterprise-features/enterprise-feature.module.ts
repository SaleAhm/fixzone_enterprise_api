import { Module } from '@nestjs/common';
import { EnterpriseFeatureGuard } from './enterprise-feature.guard';

@Module({
  providers: [EnterpriseFeatureGuard],
  exports: [EnterpriseFeatureGuard],
})
export class EnterpriseFeatureModule {}
