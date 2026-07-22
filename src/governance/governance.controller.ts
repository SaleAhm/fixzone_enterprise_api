import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccountStatus, UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  EnterpriseRateLimit,
  RateLimitTier,
} from '../security/rate-limit.constants';
import { GovernanceService } from './governance.service';

type CurrentAuthUser = {
  id?: string;
  userId?: string;
  sub?: string;
  email?: string | null;
  fullName?: string | null;
  role?: UserRole | string;
  organizationId?: string | null;
};

const governanceRoles = [
  UserRole.SUPER_ADMIN,
  UserRole.PLATFORM_OWNER,
  UserRole.EXECUTIVE_SUPER_ADMIN,
  UserRole.TECHNICAL_ADMIN,
  UserRole.BILLING_ADMIN,
  UserRole.LEGAL_ADMIN,
  UserRole.ASSIGNMENT_ADMIN,
  UserRole.ASSET_ADMIN,
  UserRole.COMPLIANCE_ADMIN,
  UserRole.REGULATORY_ADMIN,
  UserRole.SUPPORT_ADMIN,
];

@Controller('governance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GovernanceController {
  constructor(private readonly governanceService: GovernanceService) {}

  @Get('permissions/matrix')
  @Roles(...governanceRoles)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getPermissionMatrix() {
    return this.governanceService.getPermissionMatrix();
  }

  @Get('foundations')
  @Roles(...governanceRoles)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getFoundationSummary() {
    return this.governanceService.getFoundationSummary();
  }

  @Post('sub-admins')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.PLATFORM_OWNER,
    UserRole.EXECUTIVE_SUPER_ADMIN,
  )
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  createSubAdmin(
    @Body() dto: Record<string, unknown>,
    @CurrentUser() user: CurrentAuthUser,
    @Req() req: Request,
  ) {
    return this.governanceService.createSubAdmin(dto, user, this.context(req));
  }

  @Patch('sub-admins/:id/activate')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.PLATFORM_OWNER,
    UserRole.EXECUTIVE_SUPER_ADMIN,
  )
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  activateSubAdmin(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
    @Req() req: Request,
  ) {
    return this.governanceService.setSubAdminStatus(
      id,
      AccountStatus.ACTIVE,
      user,
      this.context(req),
    );
  }

  @Patch('sub-admins/:id/deactivate')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.PLATFORM_OWNER,
    UserRole.EXECUTIVE_SUPER_ADMIN,
  )
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  deactivateSubAdmin(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
    @Req() req: Request,
  ) {
    return this.governanceService.setSubAdminStatus(
      id,
      AccountStatus.DEACTIVATED,
      user,
      this.context(req),
    );
  }

  @Post('sub-admins/:id/permissions')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.PLATFORM_OWNER,
    UserRole.EXECUTIVE_SUPER_ADMIN,
  )
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  assignPermissions(
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
    @CurrentUser() user: CurrentAuthUser,
    @Req() req: Request,
  ) {
    return this.governanceService.assignPermissions(
      id,
      dto,
      user,
      this.context(req),
    );
  }

  @Post('sub-admins/:id/scopes')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.PLATFORM_OWNER,
    UserRole.EXECUTIVE_SUPER_ADMIN,
  )
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  assignScopes(
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
    @CurrentUser() user: CurrentAuthUser,
    @Req() req: Request,
  ) {
    return this.governanceService.assignScopes(
      id,
      dto,
      user,
      this.context(req),
    );
  }

  @Post('regulatory/cases')
  @Roles(...governanceRoles)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  createRegulatoryCase(
    @Body() dto: Record<string, unknown>,
    @CurrentUser() user: CurrentAuthUser,
    @Req() req: Request,
  ) {
    return this.governanceService.createRegulatoryCase(
      dto,
      user,
      this.context(req),
    );
  }

  @Post('evidence/packages')
  @Roles(...governanceRoles)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  createEvidencePackage(
    @Body() dto: Record<string, unknown>,
    @CurrentUser() user: CurrentAuthUser,
    @Req() req: Request,
  ) {
    return this.governanceService.createEvidencePackage(
      dto,
      user,
      this.context(req),
    );
  }

  @Post('evidence/access-log')
  @Roles(...governanceRoles)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  logEvidenceAccess(
    @Body() dto: Record<string, unknown>,
    @CurrentUser() user: CurrentAuthUser,
    @Req() req: Request,
  ) {
    return this.governanceService.logEvidenceAccess(
      dto,
      user,
      this.context(req),
    );
  }

  @Post('assets/claims')
  @Roles(...governanceRoles)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  createAssetClaim(
    @Body() dto: Record<string, unknown>,
    @CurrentUser() user: CurrentAuthUser,
    @Req() req: Request,
  ) {
    return this.governanceService.createAssetClaim(
      dto,
      user,
      this.context(req),
    );
  }

  @Post('assets/ownership-recommendations')
  @Roles(...governanceRoles)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  createOwnershipRecommendation(
    @Body() dto: Record<string, unknown>,
    @CurrentUser() user: CurrentAuthUser,
    @Req() req: Request,
  ) {
    return this.governanceService.createOwnershipRecommendation(
      dto,
      user,
      this.context(req),
    );
  }

  private context(req: Request) {
    return {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? null,
    };
  }
}
