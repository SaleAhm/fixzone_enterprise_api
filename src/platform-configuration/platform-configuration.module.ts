import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EnterpriseServicesModule } from '../enterprise-services/enterprise-services.module';
import { PlatformConfigurationController } from './platform-configuration.controller';
import { PlatformConfigurationService } from './platform-configuration.service';

@Module({
  imports: [PrismaModule, EnterpriseServicesModule],
  controllers: [PlatformConfigurationController],
  providers: [PlatformConfigurationService],
  exports: [PlatformConfigurationService],
})
export class PlatformConfigurationModule {}
