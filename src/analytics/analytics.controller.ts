import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  EnterpriseRateLimit,
  RateLimitTier,
} from '../security/rate-limit.constants';
import { AnalyticsService } from './analytics.service';
import type { AnalyticsUser } from './analytics.service';
import { ExecutiveAnalyticsQueryDto } from './dto/executive-analytics-query.dto';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('executive/overview')
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getOverview(
    @CurrentUser() user: AnalyticsUser,
    @Query() query: ExecutiveAnalyticsQueryDto,
  ) {
    return this.analyticsService.getExecutiveOverview(user, query);
  }

  @Get('executive/trends')
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getTrends(
    @CurrentUser() user: AnalyticsUser,
    @Query() query: ExecutiveAnalyticsQueryDto,
  ) {
    return this.analyticsService.getTrendAnalytics(user, query);
  }

  @Get('executive/categories')
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getCategories(
    @CurrentUser() user: AnalyticsUser,
    @Query() query: ExecutiveAnalyticsQueryDto,
  ) {
    return this.analyticsService.getCategoryDistribution(user, query);
  }

  @Get('executive/statuses')
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getStatuses(
    @CurrentUser() user: AnalyticsUser,
    @Query() query: ExecutiveAnalyticsQueryDto,
  ) {
    return this.analyticsService.getStatusDistribution(user, query);
  }

  @Get('executive/provider-performance')
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getProviderPerformance(
    @CurrentUser() user: AnalyticsUser,
    @Query() query: ExecutiveAnalyticsQueryDto,
  ) {
    return this.analyticsService.getProviderPerformance(user, query);
  }

  @Get('executive/geographic-summary')
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  getGeographicSummary(
    @CurrentUser() user: AnalyticsUser,
    @Query() query: ExecutiveAnalyticsQueryDto,
  ) {
    return this.analyticsService.getGeographicSummary(user, query);
  }
}
