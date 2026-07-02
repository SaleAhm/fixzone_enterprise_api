import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdateProviderCapabilitiesDto } from './dto/update-provider-capabilities.dto';
import { UpdateServiceConfigurationDto } from './dto/update-service-configuration.dto';
import { PlatformConfigurationService } from './platform-configuration.service';

@Controller('platform')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PlatformConfigurationController {
  constructor(private readonly platform: PlatformConfigurationService) {}

  @Get('config')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.PROVIDER,
    UserRole.CITIZEN,
  )
  getPlatformConfig(@Req() req: Request) {
    return this.platform.getPlatformConfig(req.user ?? {});
  }

  @Get('provider-capabilities')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.PROVIDER,
    UserRole.CITIZEN,
  )
  getProviderCapabilities() {
    return this.platform.getProviderCapabilities();
  }

  @Get('analytics-contracts')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getAnalyticsContracts() {
    return this.platform.getAnalyticsContracts();
  }

  @Get('service-configuration')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getOwnServiceConfiguration(@Req() req: Request) {
    return this.platform.getServiceConfiguration(req.user ?? {});
  }

  @Get('service-configuration/:organizationId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getServiceConfiguration(
    @Param('organizationId') organizationId: string,
    @Req() req: Request,
  ) {
    return this.platform.getServiceConfiguration(
      req.user ?? {},
      organizationId,
    );
  }

  @Patch('service-configuration/:organizationId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  updateServiceConfiguration(
    @Param('organizationId') organizationId: string,
    @Body() dto: UpdateServiceConfigurationDto,
    @Req() req: Request,
  ) {
    return this.platform.updateServiceConfiguration(
      req.user ?? {},
      organizationId,
      dto,
    );
  }

  @Get('providers/:providerId/capabilities')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getProviderCapabilitySummary(
    @Param('providerId') providerId: string,
    @Req() req: Request,
  ) {
    return this.platform.getProviderCapabilitySummary(
      req.user ?? {},
      providerId,
    );
  }

  @Post('providers/:providerId/capabilities')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  assignProviderCapabilities(
    @Param('providerId') providerId: string,
    @Body() dto: UpdateProviderCapabilitiesDto,
    @Req() req: Request,
  ) {
    return this.platform.assignProviderCapabilities(
      req.user ?? {},
      providerId,
      dto,
    );
  }

  @Patch('providers/:providerId/capabilities/:capabilityId/inactive')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  deactivateProviderCapability(
    @Param('providerId') providerId: string,
    @Param('capabilityId') capabilityId: string,
    @Req() req: Request,
  ) {
    return this.platform.deactivateProviderCapability(
      req.user ?? {},
      providerId,
      capabilityId,
    );
  }

  @Delete('providers/:providerId/capabilities/:capabilityId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  removeProviderCapability(
    @Param('providerId') providerId: string,
    @Param('capabilityId') capabilityId: string,
    @Req() req: Request,
  ) {
    return this.platform.removeProviderCapability(
      req.user ?? {},
      providerId,
      capabilityId,
    );
  }
}
