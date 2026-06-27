import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { OrganizationModule } from './organization/organization.module';
import { UsersModule } from './users/users.module';
import { ReportModule } from './report/report.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    OrganizationModule,
    UsersModule,
    ReportModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
