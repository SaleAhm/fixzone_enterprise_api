import { Injectable } from '@nestjs/common';
import { ReportStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowEvent } from './workflow-event-bus.service';

@Injectable()
export class NotificationPipelineService {
  constructor(private readonly prisma: PrismaService) {}

  async emit(event: WorkflowEvent) {
    if (!event.reportId) return { sent: 0 };
    if (event.type === 'provider_completed_report') {
      return this.notifyCitizen(event, {
        type: 'completion_review',
        title: 'Ready for review',
        message:
          'Your provider marked this report complete. Please confirm or request review.',
      });
    }
    if (event.type === 'citizen_confirmed_completion') {
      const sent = await this.notifyProvider(event, {
        type: 'completion_confirmed',
        title: 'Completion confirmed',
        message: 'The citizen confirmed your completed work.',
      });
      return { sent };
    }
    if (event.type === 'citizen_rejected_completion') {
      const providerSent = await this.notifyProvider(event, {
        type: 'completion_rejected',
        title: 'Completion needs review',
        message:
          'The citizen marked the work incomplete. Please review the feedback.',
      });
      const operatorSent = await this.notifyOrganizationOperators(event, {
        type: 'completion_review_requested',
        title: 'Citizen requested completion review',
        message: 'A citizen marked provider work incomplete.',
      });
      return { sent: providerSent + operatorSent };
    }
    if (event.toStatus === ReportStatus.ASSIGNED && event.providerId) {
      const sent = await this.notifyProvider(event, {
        type: 'assignment_created',
        title: 'New assignment',
        message: 'A report has been assigned to you.',
      });
      return { sent };
    }
    return { sent: 0 };
  }

  private async notifyCitizen(
    event: WorkflowEvent,
    notification: { type: string; title: string; message: string },
  ) {
    if (!event.citizenId || !event.reportId) return { sent: 0 };
    await this.prisma.notification.create({
      data: {
        userId: event.citizenId,
        reportId: event.reportId,
        ...notification,
      },
    });
    return { sent: 1 };
  }

  private async notifyProvider(
    event: WorkflowEvent,
    notification: { type: string; title: string; message: string },
  ) {
    if (!event.providerId || !event.reportId) return 0;
    await this.prisma.notification.create({
      data: {
        userId: event.providerId,
        reportId: event.reportId,
        ...notification,
      },
    });
    return 1;
  }

  private async notifyOrganizationOperators(
    event: WorkflowEvent,
    notification: { type: string; title: string; message: string },
  ) {
    if (!event.organizationId || !event.reportId) return 0;
    const operators = await this.prisma.user.findMany({
      where: {
        organizationId: event.organizationId,
        role: { in: [UserRole.ORG_ADMIN, UserRole.DISPATCH_OFFICER] },
        accountStatus: 'ACTIVE',
      },
      select: { id: true },
    });
    await Promise.all(
      operators.map((operator) =>
        this.prisma.notification.create({
          data: {
            userId: operator.id,
            reportId: event.reportId,
            ...notification,
          },
        }),
      ),
    );
    return operators.length;
  }
}
