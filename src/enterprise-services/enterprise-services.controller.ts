import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { EnterpriseServicesService } from './enterprise-services.service';

@Controller('enterprise-services')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EnterpriseServicesController {
  constructor(private readonly services: EnterpriseServicesService) {}

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.PROVIDER,
    UserRole.CITIZEN,
  )
  listFramework() {
    return this.services.listFramework();
  }

  @Get('definitions')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.PROVIDER,
    UserRole.CITIZEN,
  )
  listServiceDefinitions() {
    return this.services.listServiceDefinitions();
  }

  @Get('provider-capabilities')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.PROVIDER,
    UserRole.CITIZEN,
  )
  listProviderCapabilities() {
    return this.services.listProviderCapabilities();
  }

  @Get('maintenance/registration')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.PROVIDER,
    UserRole.CITIZEN,
  )
  getMaintenanceRegistration() {
    return this.services.getMaintenanceRegistration();
  }
}
