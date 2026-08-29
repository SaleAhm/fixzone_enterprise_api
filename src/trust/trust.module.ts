import { Module } from '@nestjs/common';
import { EnterpriseFeatureModule } from '../enterprise-features/enterprise-feature.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DisputesController } from './disputes.controller';
import { EntitlementsController } from './entitlements.controller';
import { IdentityController } from './identity.controller';
import { RecordsController } from './records.controller';
import { SecurityController } from './security.controller';
import { TrustService } from './trust.service';

@Module({
  imports: [PrismaModule, EnterpriseFeatureModule],
  controllers: [
    IdentityController,
    SecurityController,
    RecordsController,
    DisputesController,
    EntitlementsController,
  ],
  providers: [TrustService],
  exports: [TrustService],
})
export class TrustModule {}
