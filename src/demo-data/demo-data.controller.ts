import { Controller, Delete, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DemoDataService } from './demo-data.service';

type CurrentAuthUser = {
  id?: string;
  userId?: string;
  sub?: string;
  role: UserRole;
};

@Controller('admin/demo-data')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DemoDataController {
  constructor(private readonly demoDataService: DemoDataService) {}

  @Post('seed')
  @Roles(UserRole.SUPER_ADMIN)
  seed(@CurrentUser() user: CurrentAuthUser) {
    return this.demoDataService.seed(user);
  }

  @Delete('purge')
  @Roles(UserRole.SUPER_ADMIN)
  purge(@CurrentUser() user: CurrentAuthUser) {
    return this.demoDataService.purge(user);
  }
}
