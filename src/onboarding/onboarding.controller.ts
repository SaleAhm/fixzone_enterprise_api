import { Body, Controller, Post } from '@nestjs/common';
import { CitizenRegisterDto } from './dto/citizen-register.dto';
import { OrganizationRegisterDto } from './dto/organization-register.dto';
import { ProviderAccessRequestDto } from './dto/provider-access-request.dto';
import { OnboardingService } from './onboarding.service';
import {
  EnterpriseRateLimit,
  RateLimitTier,
} from '../security/rate-limit.constants';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post('citizen/register')
  @EnterpriseRateLimit(RateLimitTier.Registration)
  registerCitizen(@Body() dto: CitizenRegisterDto) {
    return this.onboardingService.registerCitizen(dto);
  }

  @Post('provider/request-access')
  @EnterpriseRateLimit(RateLimitTier.Registration)
  requestProviderAccess(@Body() dto: ProviderAccessRequestDto) {
    return this.onboardingService.requestProviderAccess(dto);
  }

  @Post('organization/register')
  @EnterpriseRateLimit(RateLimitTier.Registration)
  registerOrganization(@Body() dto: OrganizationRegisterDto) {
    return this.onboardingService.registerOrganization(dto);
  }
}
