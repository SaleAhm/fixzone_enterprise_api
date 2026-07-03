import { Injectable, Logger } from '@nestjs/common';
import { WorkflowEvent } from './workflow-event-bus.service';

@Injectable()
export class AnalyticsEventPipelineService {
  private readonly logger = new Logger(AnalyticsEventPipelineService.name);

  async emit(event: WorkflowEvent) {
    this.logger.debug({
      message: 'Workflow analytics event captured',
      type: event.type,
      moduleKey: event.moduleKey,
      reportId: event.reportId,
      organizationId: event.organizationId,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
    });
    return { captured: true, type: event.type };
  }
}
