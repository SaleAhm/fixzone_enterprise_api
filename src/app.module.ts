import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { OrganizationModule } from './organization/organization.module';
import { UsersModule } from './users/users.module';
import { ReportModule } from './report/report.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    OrganizationModule,
    UsersModule,
    ReportModule,
  ],
})
export class AppModule {}