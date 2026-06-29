import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
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
  getUsers(@CurrentUser() user: CurrentAuthUser) {
    return this.usersService.getUsers(user);
  }

  @Get('admin/recent')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getRecentUsers(@CurrentUser() user: CurrentAuthUser) {
    return this.usersService.getRecentUsers(user);
  }

  @Get('admin/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getUser(@Param('id') id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.usersService.getUser(id, user);
  }

  @Patch('admin/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  updateUser(
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
    @CurrentUser() user: CurrentAuthUser,
  ) {
    return this.usersService.updateUser(id, dto, user);
  }

  @Patch('admin/:id/suspend')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  suspendUser(@Param('id') id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.usersService.setUserStatus(id, 'SUSPENDED', user);
  }

  @Patch('admin/:id/activate')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  activateUser(@Param('id') id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.usersService.setUserStatus(id, 'ACTIVE', user);
  }
}
