import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { ReviewKycDto } from './dto/review-kyc.dto';
import { TrustEnforcementSettingsDto } from './dto/trust-enforcement-settings.dto';
import { TrustService } from './trust.service';
import type { TrustUser } from './trust.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class IdentityController {
  constructor(private readonly trust: TrustService) {}

  @Get('identity/me')
  @Roles(
    UserRole.CITIZEN,
    UserRole.PROVIDER,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.SUPER_ADMIN,
  )
  getIdentity(@CurrentUser() user: TrustUser) {
    return this.trust.getIdentityMe(user);
  }

  @Post('identity/kyc/submit')
  @Roles(
    UserRole.CITIZEN,
    UserRole.PROVIDER,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.SUPER_ADMIN,
  )
  submitKyc(@CurrentUser() user: TrustUser, @Body() dto: SubmitKycDto) {
    return this.trust.submitKyc(user, dto);
  }

  @Get('identity/kyc/my-submissions')
  @Roles(
    UserRole.CITIZEN,
    UserRole.PROVIDER,
    UserRole.ORG_ADMIN,
    UserRole.DISPATCH_OFFICER,
    UserRole.SUPER_ADMIN,
  )
  myKyc(@CurrentUser() user: TrustUser) {
    return this.trust.getMyKycSubmissions(user);
  }

  @Get('admin/identity/kyc-submissions')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  adminKyc(@CurrentUser() user: TrustUser) {
    return this.trust.getAdminKycSubmissions(user);
  }

  @Post('admin/identity/kyc-submissions/:id/review')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  reviewKyc(
    @CurrentUser() user: TrustUser,
    @Param('id') id: string,
    @Body() dto: ReviewKycDto,
  ) {
    return this.trust.reviewKyc(user, id, dto);
  }

  @Get('admin/audit/compliance')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  audit(
    @CurrentUser() user: TrustUser,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.trust.listAuditLogs(user, query);
  }

  @Get('admin/trust/summary')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  trustSummary(@CurrentUser() user: TrustUser) {
    return this.trust.getAdminTrustSummary(user);
  }

  @Get('admin/trust/enforcement-settings')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  enforcementSettings(@CurrentUser() user: TrustUser) {
    return this.trust.getEnforcementSettings(user);
  }

  @Post('admin/trust/enforcement-settings')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  updateEnforcementSettings(
    @CurrentUser() user: TrustUser,
    @Body() dto: TrustEnforcementSettingsDto,
  ) {
    return this.trust.updateEnforcementSettings(user, dto);
  }
}
