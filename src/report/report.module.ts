import { Module } from '@nestjs/common';
import { BusinessLogicModule } from '../business-logic/business-logic.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UploadSecurityModule } from '../security/upload-security.module';
import { TrustModule } from '../trust/trust.module';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { DispatchAiService } from './services/dispatch-ai.service';

@Module({
  imports: [
    PrismaModule,
    TrustModule,
    BusinessLogicModule,
    UploadSecurityModule,
  ],
  controllers: [ReportController],
  providers: [ReportService, DispatchAiService],
  exports: [ReportService, DispatchAiService],
})
export class ReportModule {}
