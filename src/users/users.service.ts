import { ForbiddenException, Injectable } from '@nestjs/common';
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

  async getUsers(user: JwtUser) {
    return this.prisma.user.findMany({
      where: this.buildAdminScope(user),
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
      select: this.adminUserSelect(),
    });
  }

  async getRecentUsers(user: JwtUser) {
    return this.prisma.user.findMany({
      where: this.buildAdminScope(user),
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: this.adminUserSelect(),
    });
  }

  private buildAdminScope(user: JwtUser) {
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      user.role !== UserRole.ORG_ADMIN &&
      user.role !== UserRole.DISPATCH_OFFICER
    ) {
      throw new ForbiddenException('Not allowed');
    }

    if (user.role !== UserRole.SUPER_ADMIN && !user.organizationId) {
      throw new ForbiddenException('No organization assigned');
    }

    return user.role === UserRole.SUPER_ADMIN
      ? {}
      : { organizationId: user.organizationId };
  }

  private adminUserSelect() {
    return {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
      organizationId: true,
    };
  }
}
