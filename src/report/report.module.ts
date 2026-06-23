import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { DispatchAiService } from './services/dispatch-ai.service';

@Module({
  imports: [PrismaModule],
  controllers: [ReportController],
  providers: [ReportService, DispatchAiService],
  exports: [ReportService, DispatchAiService],
})
export class ReportModule {}
