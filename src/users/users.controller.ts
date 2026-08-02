import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  EnterpriseRateLimit,
  RateLimitTier,
} from '../security/rate-limit.constants';
import { UsersService } from './users.service';

type CurrentAuthUser = {
  id?: string;
  userId?: string;
  sub?: string;
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  role: UserRole;
  organizationId?: string | null;
};

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('admin')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getUsers(@CurrentUser() user: CurrentAuthUser) {
    return this.usersService.getUsers(user);
  }

  @Get('admin/recent')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getRecentUsers(@CurrentUser() user: CurrentAuthUser) {
    return this.usersService.getRecentUsers(user);
  }

  @Get('admin/invitations')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getInvitations(@CurrentUser() user: CurrentAuthUser) {
    return this.usersService.getInvitations(user);
  }

  @Get('admin/provider-discovery')
  @Roles(UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  discoverProviders(
    @CurrentUser() user: CurrentAuthUser,
    @Query() query: Record<string, unknown>,
  ) {
    return this.usersService.discoverProviders(user, query);
  }

  @Post('admin/provider-discovery/:providerId/invite')
  @Roles(UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  inviteDiscoveredProvider(
    @Param('providerId') providerId: string,
    @Body() dto: Record<string, unknown>,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.usersService.inviteDiscoveredProvider(providerId, dto, user);
  }

  @Post('admin/invitations')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  inviteUser(
    @Body() dto: Record<string, unknown>,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.usersService.inviteUser(dto, user);
  }

  @Post('admin/invitations/:id/revoke')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  revokeInvitation(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.usersService.revokeInvitation(id, user);
  }

  @Post('admin/invitations/:id/cancel')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  cancelInvitation(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.usersService.cancelInvitation(id, user);
  }

  @Post('admin/invitations/:id/resend')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  resendInvitationById(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.usersService.resendInvitation(id, user);
  }

  @Get('invitations/mine')
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getMyInvitations(@CurrentUser() user: CurrentAuthUser) {
    return this.usersService.getMyInvitations(user);
  }

  @Post('invitations/:id/accept')
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  acceptInvitation(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.usersService.acceptInvitation(id, user);
  }

  @Post('invitations/:id/decline')
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  declineInvitation(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.usersService.declineInvitation(id, user);
  }

  @Get('admin/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getUser(@Param('id') id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.usersService.getUser(id, user);
  }

  @Patch('admin/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  updateUser(
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.usersService.updateUser(id, dto, user);
  }

  @Patch('admin/:id/suspend')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  suspendUser(@Param('id') id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.usersService.setUserStatus(id, 'SUSPENDED', user);
  }

  @Patch('admin/:id/activate')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  activateUser(@Param('id') id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.usersService.setUserStatus(id, 'ACTIVE', user);
  }

  @Post('admin/:id/reset-password')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  resetPassword(
    @Param('id') id: string,
    @Body() dto: { password?: unknown },
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.usersService.resetPassword(id, dto, user);
  }

  @Post('admin/:id/resend-invitation')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  resendUserInvitation(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.usersService.resendUserInvitation(id, user);
  }

  @Post('admin/:id/approve-provider')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  approveProviderRequest(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.usersService.approveProviderRequest(id, user);
  }

  @Post('admin/:id/reject-provider')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  rejectProviderRequest(
    @Param('id') id: string,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.usersService.rejectProviderRequest(id, user);
  }
}
