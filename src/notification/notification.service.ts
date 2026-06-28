import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
    return this.prisma.notification.findMany({
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
    });
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
}
