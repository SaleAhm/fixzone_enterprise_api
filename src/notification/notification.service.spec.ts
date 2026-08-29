import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { NotificationService } from './notification.service';
import { PrismaService } from '../prisma/prisma.service';

type PrismaNotificationMock = {
  user: {
    findUnique: jest.Mock;
  };
  notification: {
    findMany: jest.Mock;
    count: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
};

function prismaMock(prisma: PrismaNotificationMock): PrismaService {
  return prisma as unknown as PrismaService;
}

describe('NotificationService localization contract', () => {
  it('returns stable localization keys and original-language fallback text', async () => {
    const prisma: PrismaNotificationMock = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ profileData: { preferredLanguage: 'fr-CA' } }),
      },
      notification: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'notification-1',
            userId: 'user-1',
            reportId: 'report-1',
            type: 'COMPLETION_REVIEW_REQUIRED',
            title: 'Completion review required',
            message: 'Please review: Àgbàdo Road repair',
            read: false,
            report: {
              id: 'report-1',
              title: 'Àgbàdo Road repair',
              status: 'COMPLETED_BY_PROVIDER',
              category: 'Road',
              location: 'Ibadan',
            },
          },
        ]),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    const [notification] = await new NotificationService(
      prismaMock(prisma),
    ).listMine({
      id: 'user-1',
      role: UserRole.CITIZEN,
    });

    expect(notification.preferredLocale).toBe('fr');
    expect(notification.localization.key).toBe(
      'notification.completion_review_required',
    );
    expect(notification.localization.fallbackTitle).toBe(
      'Completion review required',
    );
    expect(notification.localization.params.reportTitle).toBe(
      'Àgbàdo Road repair',
    );
  });

  it('rejects notification reads without a user id', async () => {
    const prisma = {
      user: { findUnique: jest.fn() },
      notification: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    await expect(
      new NotificationService(prismaMock(prisma)).listMine({
        role: UserRole.CITIZEN,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
