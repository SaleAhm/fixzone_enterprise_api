import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TrustService } from './trust.service';
import type { TrustUser } from './trust.service';

@Controller('security')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SecurityController {
  constructor(private readonly trust: TrustService) {}

  @Get('me/login-history')
  @Roles(
    UserRole.CITIZEN,
    UserRole.PROVIDER,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.SUPER_ADMIN,
  )
  loginHistory(@CurrentUser() user: TrustUser) {
    return this.trust.getLoginHistory(user);
  }
}
