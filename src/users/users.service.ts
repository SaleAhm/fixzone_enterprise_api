import { ForbiddenException, Injectable } from '@nestjs/common';
import { AccountStatus, Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
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

  async getInvitations(user: JwtUser) {
    return this.prisma.invitation.findMany({
      where: this.buildInvitationScope(user),
      orderBy: { createdAt: 'desc' },
      take: 100,
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

  async resetPassword(
    id: string,
    dto: { password?: unknown },
    user: JwtUser,
  ) {
    const existing = await this.getUser(id, user);
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      existing.role !== UserRole.PROVIDER &&
      existing.role !== UserRole.CITIZEN
    ) {
      throw new ForbiddenException(
        'Only Super Admin can reset administrator passwords',
      );
    }

    const password =
      typeof dto.password === 'string' && dto.password.trim().length >= 8
        ? dto.password.trim()
        : 'Password123!';
    const passwordHash = await bcrypt.hash(password, 10);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { passwordHash, accountStatus: 'ACTIVE' },
      select: this.adminUserSelect(),
    });

    await this.audit('User Password Reset', user, {
      targetUserId: id,
      role: existing.role,
    });

    return {
      user: updated,
      temporaryPassword: password,
      message: 'Password reset successfully.',
    };
  }

  async resendInvitation(id: string, user: JwtUser) {
    const existing = await this.getUser(id, user);
    if (
      existing.role === UserRole.SUPER_ADMIN &&
      user.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only Super Admin can invite Super Admin users',
      );
    }

    await this.audit('User Invitation Resent', user, {
      targetUserId: id,
      role: existing.role,
      email: existing.email,
      phone: existing.phone,
    });

    return {
      user: existing,
      message:
        'Invitation recorded. Email/SMS delivery can be connected to the notification provider.',
    };
  }

  async inviteUser(dto: Record<string, unknown>, user: JwtUser) {
    const role = this.parseInvitableRole(dto.role);
    const actorId = user.id ?? user.userId ?? user.sub;
    if (!actorId) throw new ForbiddenException('Actor missing');

    if (role === UserRole.SUPER_ADMIN || role === UserRole.PENDING_PROVIDER) {
      throw new ForbiddenException('This role cannot be invited');
    }
    if (user.role !== UserRole.SUPER_ADMIN && role === UserRole.ORG_ADMIN) {
      throw new ForbiddenException(
        'Organization Admin cannot invite other Organization Admins',
      );
    }

    const organizationId = this.resolveInvitationOrganization(dto, user);
    const email = typeof dto.email === 'string' ? dto.email.toLowerCase().trim() : null;
    const phone = typeof dto.phone === 'string' ? dto.phone.trim() : null;
    const fullName =
      typeof dto.fullName === 'string' && dto.fullName.trim()
        ? dto.fullName.trim()
        : 'Invited User';

    if (!email && !phone) {
      throw new ForbiddenException('Email or phone is required');
    }

    const duplicateFilters = [
      email ? { email } : null,
      phone ? { phone } : null,
    ].filter((value): value is { email: string } | { phone: string } => value !== null);
    const existing = await this.prisma.user.findFirst({
      where: { OR: duplicateFilters },
    });
    if (existing) throw new ForbiddenException('User already exists');

    const temporaryPassword =
      typeof dto.temporaryPassword === 'string' &&
      dto.temporaryPassword.trim().length >= 8
        ? dto.temporaryPassword.trim()
        : `FixZone-${randomUUID().slice(0, 8)}!`;
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    const invitedUser = await this.prisma.user.create({
      data: {
        fullName,
        email,
        phone,
        role,
        accountStatus: AccountStatus.PENDING_INVITE,
        passwordHash,
        organizationId,
      },
      select: this.adminUserSelect(),
    });

    const invitation = await this.prisma.invitation.create({
      data: {
        fullName,
        email,
        phone,
        role,
        temporaryPasswordHash: passwordHash,
        inviteCode: `INV-${randomUUID().slice(0, 10).toUpperCase()}`,
        organizationId,
        invitedById: actorId,
        acceptedUserId: invitedUser.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        metadata: {
          createdUserId: invitedUser.id,
          delivery: 'MANUAL',
        },
      },
    });

    await this.audit('User Invited', user, {
      targetUserId: invitedUser.id,
      invitationId: invitation.id,
      role,
      organizationId,
    });

    return {
      user: invitedUser,
      invitation,
      temporaryPassword,
      message: 'Invitation generated successfully.',
    };
  }

  async revokeInvitation(id: string, user: JwtUser) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id, ...this.buildInvitationScope(user) },
    });
    if (!invitation) throw new ForbiddenException('Invitation not found');

    const revoked = await this.prisma.invitation.update({
      where: { id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    if (invitation.acceptedUserId) {
      await this.prisma.user.update({
        where: { id: invitation.acceptedUserId },
        data: { accountStatus: AccountStatus.DEACTIVATED },
      });
    }

    await this.audit('Invitation Revoked', user, {
      invitationId: id,
      role: invitation.role,
    });
    return revoked;
  }

  async approveProviderRequest(id: string, user: JwtUser) {
    const existing = await this.getUser(id, user);
    if (existing.role !== UserRole.PENDING_PROVIDER) {
      throw new ForbiddenException('User is not a pending provider request');
    }
    const providerId =
      existing.providerId ?? `PRV-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        role: UserRole.PROVIDER,
        accountStatus: AccountStatus.ACTIVE,
        providerId,
        subscriptionPlan: existing.subscriptionPlan ?? 'FREE',
      },
      select: this.adminUserSelect(),
    });

    if (updated.organizationId) {
      await this.prisma.providerOrganization.upsert({
        where: {
          providerId_organizationId: {
            providerId: updated.id,
            organizationId: updated.organizationId,
          },
        },
        update: { active: true, isPrimary: true },
        create: {
          providerId: updated.id,
          organizationId: updated.organizationId,
          active: true,
          isPrimary: true,
        },
      });
    }

    await this.audit('Provider Request Approved', user, {
      targetUserId: id,
      providerId,
    });
    return updated;
  }

  async rejectProviderRequest(id: string, user: JwtUser) {
    const existing = await this.getUser(id, user);
    if (existing.role !== UserRole.PENDING_PROVIDER) {
      throw new ForbiddenException('User is not a pending provider request');
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: { accountStatus: AccountStatus.DEACTIVATED },
      select: this.adminUserSelect(),
    });
    await this.audit('Provider Request Rejected', user, { targetUserId: id });
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

  private buildInvitationScope(user: JwtUser) {
    if (user.role === UserRole.SUPER_ADMIN) return {};
    if (user.role !== UserRole.ORG_ADMIN || !user.organizationId) {
      throw new ForbiddenException('Not allowed');
    }
    return { organizationId: user.organizationId };
  }

  private parseInvitableRole(raw: unknown) {
    const value = String(raw ?? '').trim().toUpperCase();
    if (!Object.values(UserRole).includes(value as UserRole)) {
      throw new ForbiddenException('Invalid role');
    }
    return value as UserRole;
  }

  private resolveInvitationOrganization(dto: Record<string, unknown>, user: JwtUser) {
    if (user.role === UserRole.SUPER_ADMIN) {
      return typeof dto.organizationId === 'string' && dto.organizationId.trim()
        ? dto.organizationId.trim()
        : user.organizationId ?? null;
    }
    if (!user.organizationId) {
      throw new ForbiddenException('No organization assigned');
    }
    return user.organizationId;
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
