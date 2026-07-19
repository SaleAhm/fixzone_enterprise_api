import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  EnterpriseRateLimit,
  RateLimitTier,
} from '../security/rate-limit.constants';
import { PublicMetricsService } from './public-metrics.service';

@Controller('public')
export class PublicController {
  constructor(private readonly publicMetrics: PublicMetricsService) {}

  @Get('metrics')
  @EnterpriseRateLimit(RateLimitTier.PublicRead)
  getMetrics() {
    return this.publicMetrics.getMetrics();
  }

  @Get('trends')
  @EnterpriseRateLimit(RateLimitTier.PublicRead)
  getTrends() {
    return this.publicMetrics.getTrends();
  }

  @Get('impact-summary')
  @EnterpriseRateLimit(RateLimitTier.PublicRead)
  getImpactSummary() {
    return this.publicMetrics.getImpactSummary();
  }

  @Get('category-summary')
  @EnterpriseRateLimit(RateLimitTier.PublicRead)
  getCategorySummary() {
    return this.publicMetrics.getCategorySummary();
  }

  @Get('geographic-summary')
  @EnterpriseRateLimit(RateLimitTier.PublicRead)
  getGeographicSummary() {
    return this.publicMetrics.getGeographicSummary();
  }

  @Get('platform-status')
  @EnterpriseRateLimit(RateLimitTier.PublicRead)
  getPlatformStatus() {
    return this.publicMetrics.getPlatformStatus();
  }

  @Get('success-stories')
  @EnterpriseRateLimit(RateLimitTier.PublicRead)
  getSuccessStories() {
    return this.publicMetrics.getSuccessStories();
  }

  @Get('visitor-summary')
  @EnterpriseRateLimit(RateLimitTier.PublicRead)
  getVisitorSummary() {
    return this.publicMetrics.getVisitorSummary();
  }

  @Post('visitor-event')
  @EnterpriseRateLimit(RateLimitTier.PublicRead)
  recordVisitorEvent(
    @Body()
    body: {
      sessionId?: unknown;
      path?: unknown;
      referrer?: unknown;
      userAgent?: unknown;
    },
  ) {
    return this.publicMetrics.recordVisitorEvent(body);
  }
}
