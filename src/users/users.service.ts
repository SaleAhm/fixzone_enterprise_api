import {
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type JwtUser = {
  id?: string;
  userId?: string;
  sub?: string;
  email?: string | null;
  role: UserRole;
  organizationId?: string | null;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getRecentUsers(user: JwtUser) {
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      user.role !== UserRole.ORG_ADMIN &&
      user.role !== UserRole.DISPATCH_OFFICER
    ) {
      throw new ForbiddenException('Not allowed');
    }

    if (
      user.role !== UserRole.SUPER_ADMIN &&
      !user.organizationId
    ) {
      throw new ForbiddenException('No organization assigned');
    }

    const where =
      user.role === UserRole.SUPER_ADMIN
        ? {}
        : { organizationId: user.organizationId };

    return this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
        organizationId: true,
      },
    });
  }
}