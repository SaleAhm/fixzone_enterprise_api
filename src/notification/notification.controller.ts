import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { NotificationService } from './notification.service';

type CurrentAuthUser = {
  id: string;
  userId?: string;
  sub?: string;
  role: UserRole;
};

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @Roles(UserRole.CITIZEN, UserRole.PROVIDER, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER, UserRole.SUPER_ADMIN)
  listMine(@CurrentUser() user: CurrentAuthUser) {
    return this.notificationService.listMine(user);
  }

  @Get('unread-count')
  @Roles(UserRole.CITIZEN, UserRole.PROVIDER, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER, UserRole.SUPER_ADMIN)
  unreadCount(@CurrentUser() user: CurrentAuthUser) {
    return this.notificationService.unreadCount(user);
  }

  @Patch('read-all')
  @Roles(UserRole.CITIZEN, UserRole.PROVIDER, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER, UserRole.SUPER_ADMIN)
  markAllRead(@CurrentUser() user: CurrentAuthUser) {
    return this.notificationService.markAllRead(user);
  }

  @Patch(':id/read')
  @Roles(UserRole.CITIZEN, UserRole.PROVIDER, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER, UserRole.SUPER_ADMIN)
  markRead(@Param('id') id: string, @CurrentUser() user: CurrentAuthUser) {
    return this.notificationService.markRead(id, user);
  }
}
