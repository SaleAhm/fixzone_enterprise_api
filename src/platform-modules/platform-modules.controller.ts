import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
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

  @Get('access/:moduleKey')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.PROVIDER,
    UserRole.CITIZEN,
  )
  evaluateAccess(@Param('moduleKey') moduleKey: string, @Req() req: Request) {
    return this.platformModulesService.evaluateAccess(req.user ?? {}, {
      moduleKey,
      requiredRoles: [
        UserRole.SUPER_ADMIN,
        UserRole.ORG_ADMIN,
        UserRole.DISPATCH_OFFICER,
        UserRole.PROVIDER,
        UserRole.CITIZEN,
      ],
      requiresOrganization: false,
    });
  }
}
