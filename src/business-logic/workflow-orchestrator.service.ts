import { Injectable } from '@nestjs/common';
import { ReportStatus, UserRole } from '@prisma/client';
import { AnalyticsEventPipelineService } from './analytics-event-pipeline.service';
import { AuditPipelineService } from './audit-pipeline.service';
import { NotificationPipelineService } from './notification-pipeline.service';
import { PolicyEngineService } from './policy-engine.service';
import { WorkflowEventBusService } from './workflow-event-bus.service';

@Injectable()
export class WorkflowOrchestratorService {
  constructor(
    private readonly eventBus: WorkflowEventBusService,
    private readonly notifications: NotificationPipelineService,
    private readonly analytics: AnalyticsEventPipelineService,
    private readonly audit: AuditPipelineService,
    private readonly policy: PolicyEngineService,
  ) {}

  async providerCompletedReport(input: WorkflowInput) {
    await this.policy.assertMaintenanceActive();
    await this.publish('provider_completed_report', input);
  }

  async citizenConfirmedCompletion(input: WorkflowInput) {
    await this.policy.assertMaintenanceActive();
    await this.publish('citizen_confirmed_completion', input);
  }

  async citizenRejectedCompletion(input: WorkflowInput) {
    await this.policy.assertMaintenanceActive();
    await this.publish('citizen_rejected_completion', input);
  }

  async assignmentChanged(input: WorkflowInput) {
    await this.publish('assignment_changed', input);
  }

  private async publish(type: string, input: WorkflowInput) {
    const event = this.eventBus.create({
      type,
      moduleKey: 'maintenance',
      ...input,
    });
    await this.notifications.emit(event);
    await this.analytics.emit(event);
    await this.audit.emit(event);
    return event;
  }
}

export type WorkflowInput = {
  reportId: string;
  organizationId: string;
  actorId?: string | null;
  actorRole?: UserRole | null;
  fromStatus?: ReportStatus | null;
  toStatus?: ReportStatus | null;
  providerId?: string | null;
  citizenId?: string | null;
  metadata?: Record<string, unknown>;
};
