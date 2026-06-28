import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DemoDataService } from './demo-data.service';
import { GenerateDemoEnvironmentDto } from './dto/generate-demo-environment.dto';

type CurrentAuthUser = {
  id?: string;
  userId?: string;
  sub?: string;
  role: UserRole;
};

@Controller('admin/platform-tools/demo-environment')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DemoEnvironmentController {
  constructor(private readonly demoDataService: DemoDataService) {}

  @Get('statistics')
  @Roles(UserRole.SUPER_ADMIN)
  statistics(@CurrentUser() user: CurrentAuthUser) {
    return this.demoDataService.statistics(user);
  }

  @Post('generate')
  @Roles(UserRole.SUPER_ADMIN)
  generate(
    @CurrentUser() user: CurrentAuthUser,
    @Body() dto: GenerateDemoEnvironmentDto,
  ) {
    return this.demoDataService.seed(user, dto);
  }

  @Post('reset')
  @Roles(UserRole.SUPER_ADMIN)
  reset(
    @CurrentUser() user: CurrentAuthUser,
    @Body() dto: GenerateDemoEnvironmentDto,
  ) {
    return this.demoDataService.reset(user, dto);
  }

  @Delete('purge')
  @Roles(UserRole.SUPER_ADMIN)
  purge(@CurrentUser() user: CurrentAuthUser) {
    return this.demoDataService.purge(user);
  }
}

@Controller('admin/demo-data')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LegacyDemoDataController {
  constructor(private readonly demoDataService: DemoDataService) {}

  @Post('seed')
  @Roles(UserRole.SUPER_ADMIN)
  seed(
    @CurrentUser() user: CurrentAuthUser,
    @Body() dto: GenerateDemoEnvironmentDto,
  ) {
    return this.demoDataService.seed(user, dto);
  }

  @Delete('purge')
  @Roles(UserRole.SUPER_ADMIN)
  purge(@CurrentUser() user: CurrentAuthUser) {
    return this.demoDataService.purge(user);
  }
}
