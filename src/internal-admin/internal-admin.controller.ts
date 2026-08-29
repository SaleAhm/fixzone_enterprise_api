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
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  EnterpriseRateLimit,
  RateLimitTier,
} from '../security/rate-limit.constants';
import { AssignInternalRoleDto } from './dto/assign-internal-role.dto';
import { InternalAdminActionDto } from './dto/internal-admin-action.dto';
import { InviteInternalAdminDto } from './dto/invite-internal-admin.dto';
import {
  CreatePrivilegedApprovalDto,
  DecidePrivilegedApprovalDto,
} from './dto/privileged-approval.dto';
import { InternalAdminService } from './internal-admin.service';
import type { InternalAdminUser } from './internal-admin.types';

const internalAccessRoles = [
  UserRole.SUPER_ADMIN,
  UserRole.PLATFORM_SUPER_ADMIN,
  UserRole.PLATFORM_OWNER,
  UserRole.EXECUTIVE_SUPER_ADMIN,
  UserRole.TECHNICAL_ADMIN,
  UserRole.OPERATIONS_ADMIN,
  UserRole.ORGANIZATION_ONBOARDING_ADMIN,
  UserRole.PROVIDER_ADMIN,
  UserRole.FINANCE_BILLING_ADMIN,
  UserRole.BILLING_ADMIN,
  UserRole.LEGAL_ADMIN,
  UserRole.ASSIGNMENT_ADMIN,
  UserRole.ASSET_ADMIN,
  UserRole.ASSET_INTELLIGENCE_ADMIN,
  UserRole.COMPLIANCE_ADMIN,
  UserRole.COMPLIANCE_AUDIT_ADMIN,
  UserRole.REGULATORY_ADMIN,
  UserRole.SECURITY_ADMIN,
  UserRole.INVESTIGATION_ADMIN,
  UserRole.RELEASE_OPERATIONS_ADMIN,
  UserRole.BACKUP_RECOVERY_ADMIN,
  UserRole.SUPPORT_ADMIN,
];

@Controller('internal-admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...internalAccessRoles)
export class InternalAdminController {
  constructor(private readonly internalAdmin: InternalAdminService) {}

  @Get('roles')
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  roleCatalog() {
    return this.internalAdmin.roleCatalog();
  }

  @Get('administrators')
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  listAdministrators(@CurrentUser() user: InternalAdminUser) {
    return this.internalAdmin.listAdministrators(user);
  }

  @Get('administrators/:id/effective-access')
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  effectiveAccess(
    @Param('id') id: string,
    @CurrentUser() user: InternalAdminUser,
  ) {
    return this.internalAdmin.viewEffectiveAccess(id, user);
  }

  @Post('invitations')
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  invite(
    @Body() dto: InviteInternalAdminDto,
    @CurrentUser() user: InternalAdminUser,
    @Req() req: Request,
  ) {
    return this.internalAdmin.inviteAdministrator(dto, user, this.context(req));
  }

  @Post('invitations/:id/accept')
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  acceptInvitation(
    @Param('id') id: string,
    @CurrentUser() user: InternalAdminUser,
    @Req() req: Request,
  ) {
    return this.internalAdmin.acceptInvitation(id, user, this.context(req));
  }

  @Post('administrators/:id/roles')
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  assignRole(
    @Param('id') id: string,
    @Body() dto: AssignInternalRoleDto,
    @CurrentUser() user: InternalAdminUser,
    @Req() req: Request,
  ) {
    return this.internalAdmin.assignRole(id, dto, user, this.context(req));
  }

  @Patch('role-assignments/:id/remove')
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  removeRole(
    @Param('id') id: string,
    @Body() dto: InternalAdminActionDto,
    @CurrentUser() user: InternalAdminUser,
    @Req() req: Request,
  ) {
    return this.internalAdmin.removeRole(id, dto, user, this.context(req));
  }

  @Patch('administrators/:id/suspend')
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  suspend(
    @Param('id') id: string,
    @Body() dto: InternalAdminActionDto,
    @CurrentUser() user: InternalAdminUser,
    @Req() req: Request,
  ) {
    return this.internalAdmin.suspendAdministrator(
      id,
      dto,
      user,
      this.context(req),
    );
  }

  @Patch('administrators/:id/reactivate')
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  reactivate(
    @Param('id') id: string,
    @Body() dto: InternalAdminActionDto,
    @CurrentUser() user: InternalAdminUser,
    @Req() req: Request,
  ) {
    return this.internalAdmin.reactivateAdministrator(
      id,
      dto,
      user,
      this.context(req),
    );
  }

  @Post('administrators/:id/revoke-sessions')
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  revokeSessions(
    @Param('id') id: string,
    @Body() dto: InternalAdminActionDto,
    @CurrentUser() user: InternalAdminUser,
    @Req() req: Request,
  ) {
    return this.internalAdmin.revokeSessions(id, dto, user, this.context(req));
  }

  @Get('administrators/:id/role-history')
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  roleHistory(@Param('id') id: string, @CurrentUser() user: InternalAdminUser) {
    return this.internalAdmin.roleAssignmentHistory(id, user);
  }

  @Post('privileged-approvals')
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  createApproval(
    @Body() dto: CreatePrivilegedApprovalDto,
    @CurrentUser() user: InternalAdminUser,
    @Req() req: Request,
  ) {
    return this.internalAdmin.createApprovalRequest(
      dto,
      user,
      this.context(req),
    );
  }

  @Post('privileged-approvals/:id/decision')
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  decideApproval(
    @Param('id') id: string,
    @Body() dto: DecidePrivilegedApprovalDto,
    @CurrentUser() user: InternalAdminUser,
    @Req() req: Request,
  ) {
    return this.internalAdmin.decideApprovalRequest(
      id,
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
