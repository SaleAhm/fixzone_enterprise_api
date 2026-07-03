import { Module } from '@nestjs/common';
import { PlatformModulesModule } from '../platform-modules/platform-modules.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AnalyticsEventPipelineService } from './analytics-event-pipeline.service';
import { AuditPipelineService } from './audit-pipeline.service';
import { BusinessLogicService } from './business-logic.service';
import { BusinessLogicController } from './business-logic.controller';
import { EscalationEngineService } from './escalation-engine.service';
import { NotificationPipelineService } from './notification-pipeline.service';
import { PolicyEngineService } from './policy-engine.service';
import { RuleEngineService } from './rule-engine.service';
import { SlaEngineService } from './sla-engine.service';
import { WorkflowEventBusService } from './workflow-event-bus.service';
import { WorkflowOrchestratorService } from './workflow-orchestrator.service';

@Module({
  imports: [PrismaModule, PlatformModulesModule],
  controllers: [BusinessLogicController],
  providers: [
    AnalyticsEventPipelineService,
    AuditPipelineService,
    BusinessLogicService,
    EscalationEngineService,
    NotificationPipelineService,
    PolicyEngineService,
    RuleEngineService,
    SlaEngineService,
    WorkflowEventBusService,
    WorkflowOrchestratorService,
  ],
  exports: [
    BusinessLogicService,
    PolicyEngineService,
    WorkflowOrchestratorService,
  ],
})
export class BusinessLogicModule {}
