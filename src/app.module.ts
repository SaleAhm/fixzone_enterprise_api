import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { OrganizationModule } from './organization/organization.module';
import { UsersModule } from './users/users.module';
import { ReportModule } from './report/report.module';
import { NotificationModule } from './notification/notification.module';
import { DemoDataModule } from './demo-data/demo-data.module';
import { PlatformToolsModule } from './platform-tools/platform-tools.module';
import { OnboardingModule } from './onboarding/onboarding.module';
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
    OnboardingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
