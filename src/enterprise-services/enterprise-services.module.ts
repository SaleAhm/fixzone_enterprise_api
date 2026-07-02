import { Module } from '@nestjs/common';
import { EnterpriseServicesController } from './enterprise-services.controller';
import { EnterpriseServicesService } from './enterprise-services.service';
import { MaintenanceServiceAdapter } from './maintenance-service.adapter';

@Module({
  controllers: [EnterpriseServicesController],
  providers: [EnterpriseServicesService, MaintenanceServiceAdapter],
  exports: [EnterpriseServicesService, MaintenanceServiceAdapter],
})
export class EnterpriseServicesModule {}
