import { Injectable } from '@nestjs/common';
import { ReportStatus, UserRole } from '@prisma/client';

export type WorkflowEvent = {
  type: string;
  moduleKey: 'maintenance' | string;
  reportId?: string;
  organizationId?: string;
  actorId?: string | null;
  actorRole?: UserRole | null;
  fromStatus?: ReportStatus | null;
  toStatus?: ReportStatus | null;
  providerId?: string | null;
  citizenId?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt: Date;
};

@Injectable()
export class WorkflowEventBusService {
  create(event: Omit<WorkflowEvent, 'occurredAt'>): WorkflowEvent {
    return {
      ...event,
      occurredAt: new Date(),
    };
  }
}
