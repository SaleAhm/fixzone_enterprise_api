import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TrustService } from './trust.service';
import type { TrustUser } from './trust.service';

@Controller('entitlements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EntitlementsController {
  constructor(private readonly trust: TrustService) {}

  @Get('me')
  @Roles(
    UserRole.CITIZEN,
    UserRole.PROVIDER,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.SUPER_ADMIN,
  )
  me(@CurrentUser() user: TrustUser) {
    return this.trust.getEntitlementsMe(user);
  }
}
