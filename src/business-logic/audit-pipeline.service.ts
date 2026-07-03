import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowEvent } from './workflow-event-bus.service';

@Injectable()
export class AuditPipelineService {
  constructor(private readonly prisma: PrismaService) {}

  async emit(event: WorkflowEvent) {
    await this.prisma.complianceAuditLog.create({
      data: {
        actorId: event.actorId ?? null,
        actorRole: event.actorRole ?? null,
        organizationId: event.organizationId ?? null,
        action: this.actionFor(event.type),
        entityType: event.reportId ? 'Report' : 'WorkflowEvent',
        entityId: event.reportId ?? event.type,
        metadata: {
          moduleKey: event.moduleKey,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          providerId: event.providerId,
          citizenId: event.citizenId,
          ...(event.metadata ?? {}),
        } as Prisma.InputJsonValue,
      },
    });
  }

  private actionFor(type: string) {
    return `Workflow ${type
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')}`;
  }
}
