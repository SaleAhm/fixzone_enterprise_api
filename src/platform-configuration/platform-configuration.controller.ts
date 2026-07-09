import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  EnterpriseRateLimit,
  RateLimitTier,
} from '../security/rate-limit.constants';
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
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getAnalyticsContracts() {
    return this.platform.getAnalyticsContracts();
  }

  @Get('readiness')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getRuntimeReadiness(@Req() req: Request) {
    return this.platform.getRuntimeReadiness(req.user ?? {});
  }

  @Get('health-summary')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getPlatformHealthSummary(@Req() req: Request) {
    return this.platform.getPlatformHealthSummary(req.user ?? {});
  }

  @Get('rollout-governance')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.PROVIDER,
    UserRole.CITIZEN,
  )
  getRolloutGovernance() {
    return this.platform.getRolloutGovernance();
  }

  @Get('module-readiness/:moduleKey')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getModuleReadiness(
    @Param('moduleKey') moduleKey: string,
    @Req() req: Request,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.platform.getModuleReadiness(req.user ?? {}, moduleKey, {
      organizationId,
    });
  }

  @Get('module-activation-governance/:moduleKey')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getModuleActivationGovernance(
    @Param('moduleKey') moduleKey: string,
    @Req() req: Request,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.platform.getModuleActivationGovernance(
      req.user ?? {},
      moduleKey,
      { organizationId },
    );
  }

  @Get('readiness/:organizationId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getOrganizationRuntimeReadiness(
    @Param('organizationId') organizationId: string,
    @Req() req: Request,
  ) {
    return this.platform.getRuntimeReadiness(req.user ?? {}, organizationId);
  }

  @Get('configuration-validation/:organizationId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  validateTenantConfiguration(
    @Param('organizationId') organizationId: string,
    @Req() req: Request,
  ) {
    return this.platform.validateTenantConfiguration(
      req.user ?? {},
      organizationId,
    );
  }

  @Get('audit-history')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getPlatformAuditHistory(
    @Req() req: Request,
    @Query('action') action?: string,
    @Query('organizationId') organizationId?: string,
    @Query('groupBy') groupBy?: string,
    @Query('limit') limit?: string,
  ) {
    return this.platform.getPlatformAuditHistory(req.user ?? {}, {
      action,
      organizationId,
      groupBy,
      limit,
    });
  }

  @Get('service-configuration')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getOwnServiceConfiguration(@Req() req: Request) {
    return this.platform.getServiceConfiguration(req.user ?? {});
  }

  @Get('service-configuration/:organizationId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
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
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
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
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
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
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
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
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
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
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
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
