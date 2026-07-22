import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GovernanceController } from './governance.controller';
import { GovernanceService } from './governance.service';

@Module({
  imports: [PrismaModule],
  controllers: [GovernanceController],
  providers: [GovernanceService],
  exports: [GovernanceService],
})
export class GovernanceModule {}
