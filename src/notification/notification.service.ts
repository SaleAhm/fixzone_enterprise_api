import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_LOCALE,
  preferredLocaleFromProfile,
} from '../localization/supported-locales';

type JwtUser = {
  id?: string;
  userId?: string;
  sub?: string;
  role: UserRole;
};

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async listMine(user: JwtUser) {
    const userId = this.getUserId(user);
    const [recipient, notifications] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { profileData: true },
      }),
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          report: {
            select: {
              id: true,
              title: true,
              status: true,
              category: true,
              location: true,
            },
          },
        },
      }),
    ]);
    const locale = preferredLocaleFromProfile(recipient?.profileData);
    return notifications.map((notification) => ({
      ...notification,
      preferredLocale: locale,
      localization: this.localizationContract(notification),
    }));
  }

  async unreadCount(user: JwtUser) {
    const userId = this.getUserId(user);
    const count = await this.prisma.notification.count({
      where: { userId, read: false },
    });
    return { count };
  }

  async markRead(id: string, user: JwtUser) {
    const userId = this.getUserId(user);
    const existing = await this.prisma.notification.findUnique({
      where: { id },
    });

    if (!existing) throw new NotFoundException('Notification not found');
    if (existing.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return this.prisma.notification.update({
      where: { id },
      data: { read: true },
    });
  }

  async markAllRead(user: JwtUser) {
    const userId = this.getUserId(user);
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return { ok: true };
  }

  private getUserId(user: JwtUser) {
    const id = user.id ?? user.userId ?? user.sub;
    if (!id) throw new ForbiddenException('User id missing');
    return id;
  }

  private localizationContract(notification: {
    type: string;
    title: string;
    message: string;
    report?: {
      id: string;
      title: string;
      status: string;
      category: string;
      location: string;
    } | null;
  }) {
    const key = this.notificationKey(notification.type);
    return {
      key,
      fallbackLocale: DEFAULT_LOCALE,
      fallbackTitle: notification.title,
      fallbackMessage: notification.message,
      params: {
        reportId: notification.report?.id ?? null,
        reportTitle: notification.report?.title ?? null,
        reportStatus: notification.report?.status ?? null,
        reportCategory: notification.report?.category ?? null,
        reportLocation: notification.report?.location ?? null,
      },
      note: 'User-generated report fields remain in their original language and are not machine-translated by the backend.',
    };
  }

  private notificationKey(type: string) {
    const normalized = type
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_');
    return normalized ? `notification.${normalized}` : 'notification.general';
  }
}
