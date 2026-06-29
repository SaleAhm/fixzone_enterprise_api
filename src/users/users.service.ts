import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccountStatus, Prisma, UserRole } from '@prisma/client';
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

  async getUser(id: string, user: JwtUser) {
    const existing = await this.prisma.user.findFirst({
      where: { id, ...this.buildAdminScope(user) },
      select: this.adminUserSelect(),
    });
    if (!existing) throw new ForbiddenException('User not found in your scope');
    return existing;
  }

  async updateUser(id: string, dto: Record<string, unknown>, user: JwtUser) {
    const existing = await this.getUser(id, user);
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      existing.role === UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only Super Admin can edit Super Admin users',
      );
    }

    const data: Prisma.UserUpdateInput = {};
    if (typeof dto.phone === 'string') data.phone = dto.phone.trim() || null;
    if (typeof dto.fullName === 'string' && dto.fullName.trim()) {
      data.fullName = dto.fullName.trim();
    }
    if (
      typeof dto.organizationId === 'string' &&
      user.role === UserRole.SUPER_ADMIN
    ) {
      data.organization = dto.organizationId.trim()
        ? { connect: { id: dto.organizationId.trim() } }
        : { disconnect: true };
    }
    if (typeof dto.role === 'string' && user.role === UserRole.SUPER_ADMIN) {
      data.role = dto.role as UserRole;
    }
    if (
      typeof dto.providerId === 'string' &&
      existing.role === UserRole.PROVIDER
    ) {
      data.providerId = dto.providerId.trim() || null;
    }
    if (Array.isArray(dto.serviceCategories)) {
      data.serviceCategories = dto.serviceCategories.map((e) => String(e));
    }
    if (Array.isArray(dto.coverageAreas)) {
      data.coverageAreas = dto.coverageAreas.map((e) => String(e));
    }
    if (
      typeof dto.subscriptionPlan === 'string' &&
      existing.role === UserRole.PROVIDER
    ) {
      data.subscriptionPlan = dto.subscriptionPlan as any;
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: this.adminUserSelect(),
    });
    await this.audit(
      existing.role === UserRole.PROVIDER
        ? 'Provider Profile Updated'
        : 'User Profile Updated',
      user,
      { targetUserId: id, changes: Object.keys(data) },
    );
    return updated;
  }

  async setUserStatus(id: string, status: AccountStatus, user: JwtUser) {
    const actorId = user.id ?? user.userId ?? user.sub;
    if (actorId === id) {
      throw new ForbiddenException('You cannot suspend or activate yourself');
    }
    const existing = await this.getUser(id, user);
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      existing.role === UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only Super Admin can manage Super Admin users',
      );
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: { accountStatus: status },
      select: this.adminUserSelect(),
    });
    await this.audit(
      status === 'SUSPENDED'
        ? existing.role === UserRole.PROVIDER
          ? 'Provider Suspended'
          : 'User Suspended'
        : existing.role === UserRole.PROVIDER
          ? 'Provider Activated'
          : 'User Activated',
      user,
      { targetUserId: id, role: existing.role },
    );
    return updated;
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
      providerId: true,
      role: true,
      accountStatus: true,
      serviceCategories: true,
      coverageAreas: true,
      subscriptionPlan: true,
      providerEngagementType: true,
      createdAt: true,
      updatedAt: true,
      organizationId: true,
      organization: { select: { id: true, name: true, type: true } },
    };
  }

  private async audit(
    action: string,
    user: JwtUser,
    metadata: Prisma.InputJsonValue,
  ) {
    const actorUserId = user.id ?? user.userId ?? user.sub;
    if (!actorUserId) return;
    await this.prisma.demoAuditLog.create({
      data: { action, actorUserId, metadata },
    });
  }
}
