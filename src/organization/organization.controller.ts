import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  EnterpriseRateLimit,
  RateLimitTier,
} from '../security/rate-limit.constants';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import {
  CreateJurisdictionZoneDto,
  UpdateJurisdictionZoneDto,
} from './dto/jurisdiction-zone.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { OrganizationService } from './organization.service';

type RequestUser = {
  sub: string;
  email?: string | null;
  phone?: string | null;
  fullName?: string;
  role?: string;
  organizationId?: string | null;
};

@Controller('organizations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  create(@Body() dto: CreateOrganizationDto, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.create(dto, user);
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  findAll(@Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.findAll(user);
  }

  @Get('mine')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  getMine(@Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.getMine(user);
  }

  @Get('billing/overview')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getBillingOverview(@Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.getBillingOverview(user);
  }

  @Get('plans/catalog')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getPlanCatalog() {
    return this.organizationService.getPlanCatalog();
  }

  @Get('upgrade-requests')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getUpgradeRequests(@Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.listUpgradeRequests(user);
  }

  @Post('upgrade-requests/:requestId/review')
  @Roles(UserRole.SUPER_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  reviewUpgradeRequest(
    @Param('requestId') requestId: string,
    @Body() dto: Record<string, unknown>,
    @Req() req: Request,
  ) {
    const user = req.user as RequestUser;
    return this.organizationService.reviewUpgradeRequest(requestId, dto, user);
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getById(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.getById(id, user);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
    @Req() req: Request,
  ) {
    const user = req.user as RequestUser;
    return this.organizationService.update(id, dto, user);
  }

  @Post(':id/activate')
  @Roles(UserRole.SUPER_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  activate(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.setStatus(id, 'ACTIVE', user);
  }

  @Post(':id/suspend')
  @Roles(UserRole.SUPER_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  suspend(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.setStatus(id, 'SUSPENDED', user);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  archive(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.setStatus(id, 'ARCHIVED', user);
  }

  @Get(':id/users')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getUsers(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.getUsers(id, user);
  }

  @Get(':id/providers')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getProviders(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.getProviders(id, user);
  }

  @Get(':id/reports')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getReports(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.getReports(id, user);
  }

  @Get(':id/billing')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getBilling(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.getBilling(id, user);
  }

  @Get(':id/readiness')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getReadiness(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as RequestUser;
    return this.organizationService.getReadiness(id, user);
  }

  @Get(':id/jurisdiction-zones')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getJurisdictionZones(
    @Param('id') id: string,
    @Query() query: { includeInactive?: string },
    @Req() req: Request,
  ) {
    const user = req.user as RequestUser;
    return this.organizationService.listJurisdictionZones(
      id,
      user,
      query.includeInactive === 'true',
    );
  }

  @Post(':id/jurisdiction-zones')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  createJurisdictionZone(
    @Param('id') id: string,
    @Body() dto: CreateJurisdictionZoneDto,
    @Req() req: Request,
  ) {
    const user = req.user as RequestUser;
    return this.organizationService.createJurisdictionZone(id, dto, user);
  }

  @Patch(':id/jurisdiction-zones/:zoneId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  updateJurisdictionZone(
    @Param('id') id: string,
    @Param('zoneId') zoneId: string,
    @Body() dto: UpdateJurisdictionZoneDto,
    @Req() req: Request,
  ) {
    const user = req.user as RequestUser;
    return this.organizationService.updateJurisdictionZone(
      id,
      zoneId,
      dto,
      user,
    );
  }

  @Post(':id/upgrade-requests')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  requestUpgrade(
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
    @Req() req: Request,
  ) {
    const user = req.user as RequestUser;
    return this.organizationService.requestUpgrade(id, dto, user);
  }
}
