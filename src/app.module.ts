import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { OrganizationModule } from './organization/organization.module';
import { UsersModule } from './users/users.module';
import { ReportModule } from './report/report.module';
import { NotificationModule } from './notification/notification.module';
import { DemoDataModule } from './demo-data/demo-data.module';
import { PlatformToolsModule } from './platform-tools/platform-tools.module';
import { PlatformModulesModule } from './platform-modules/platform-modules.module';
import { EnterpriseServicesModule } from './enterprise-services/enterprise-services.module';
import { PlatformConfigurationModule } from './platform-configuration/platform-configuration.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { TrustModule } from './trust/trust.module';
import { BusinessLogicModule } from './business-logic/business-logic.module';
import { RateLimitModule } from './security/rate-limit.module';
import { PublicModule } from './public/public.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { GovernanceModule } from './governance/governance.module';
import { PaymentsModule } from './payments/payments.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    OrganizationModule,
    UsersModule,
    ReportModule,
    NotificationModule,
    DemoDataModule,
    PlatformToolsModule,
    PlatformModulesModule,
    EnterpriseServicesModule,
    PlatformConfigurationModule,
    OnboardingModule,
    TrustModule,
    BusinessLogicModule,
    RateLimitModule,
    PublicModule,
    AnalyticsModule,
    GovernanceModule,
    PaymentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
