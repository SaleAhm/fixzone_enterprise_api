import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PlatformModulesService } from './platform-modules.service';

@Controller('platform-modules')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PlatformModulesController {
  constructor(
    private readonly platformModulesService: PlatformModulesService,
  ) {}

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.PROVIDER,
    UserRole.CITIZEN,
  )
  listModules() {
    return this.platformModulesService.listModules();
  }
}
