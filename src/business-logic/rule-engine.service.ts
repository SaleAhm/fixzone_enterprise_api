import { Injectable } from '@nestjs/common';
import { ReportStatus } from '@prisma/client';

export const MAINTENANCE_WORKFLOW_STATES = [
  'SUBMITTED/PENDING',
  ReportStatus.ASSIGNED,
  ReportStatus.IN_PROGRESS,
  ReportStatus.COMPLETED_BY_PROVIDER,
  'CITIZEN_CONFIRMED',
  'CITIZEN_REJECTED',
  ReportStatus.CLOSED,
] as const;

@Injectable()
export class RuleEngineService {
  maintenanceWorkflowStates() {
    return MAINTENANCE_WORKFLOW_STATES;
  }
}
