import { Module } from '@nestjs/common';
import { EnterpriseFeatureModule } from '../enterprise-features/enterprise-feature.module';
import { PrismaModule } from '../prisma/prisma.module';
import { GovernanceController } from './governance.controller';
import { GovernanceService } from './governance.service';

@Module({
  imports: [PrismaModule, EnterpriseFeatureModule],
  controllers: [GovernanceController],
  providers: [GovernanceService],
  exports: [GovernanceService],
})
export class GovernanceModule {}
