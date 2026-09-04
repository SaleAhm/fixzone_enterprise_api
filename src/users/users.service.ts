import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  InvitationStatus,
  Prisma,
  ReportStatus,
  UserRole,
} from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';

type JwtUser = {
  id?: string;
  userId?: string;
  sub?: string;
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  role: UserRole;
  organizationId?: string | null;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService?: AuthService,
  ) {}

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
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: this.adminUserSelect(),
    });
  }

  async getInvitations(user: JwtUser) {
    const invitations = await this.prisma.invitation.findMany({
      where: this.buildInvitationScope(user),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      include: this.invitationInclude(),
    });
    return invitations.map((invitation) =>
      this.serializeInvitation(invitation),
    );
  }

  async discoverProviders(user: JwtUser, query: Record<string, unknown> = {}) {
    const organizationId = this.resolveDiscoveryOrganization(query, user);
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        type: true,
        state: true,
        lga: true,
        country: true,
        profileData: true,
      },
    });
    if (!organization) throw new ForbiddenException('Organization not found');

    const filters = this.discoveryFilters(query);
    const providers = await this.prisma.user.findMany({
      where: {
        role: UserRole.PROVIDER,
        accountStatus: AccountStatus.ACTIVE,
      },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        fullName: true,
        providerId: true,
        serviceCategories: true,
        coverageAreas: true,
        profileData: true,
        identityVerificationStatus: true,
        trustScore: true,
        createdAt: true,
        organizationId: true,
        organization: { select: { id: true, name: true, type: true } },
        providerOrganizations: {
          where: { active: true },
          select: {
            organizationId: true,
            isPrimary: true,
            createdAt: true,
            organization: { select: { id: true, name: true, type: true } },
          },
        },
        assignedReports: {
          select: {
            id: true,
            status: true,
            organizationId: true,
            category: true,
            citizenRating: true,
            citizenFeedback: true,
            completionRejectionReason: true,
            assignedAt: true,
            completedByProviderAt: true,
            updatedAt: true,
          },
        },
      },
    });

    const invitations = await this.prisma.invitation.findMany({
      where: { organizationId, role: UserRole.PROVIDER },
      select: {
        id: true,
        status: true,
        email: true,
        phone: true,
        acceptedUserId: true,
        metadata: true,
        expiresAt: true,
      },
    });
    const invitationByProvider = new Map<
      string,
      (typeof invitations)[number]
    >();
    for (const invitation of invitations) {
      const metadata = this.objectMetadata(invitation.metadata);
      const discoveredProviderId =
        typeof metadata.discoveredProviderId === 'string'
          ? metadata.discoveredProviderId
          : invitation.acceptedUserId;
      if (discoveredProviderId) {
        invitationByProvider.set(discoveredProviderId, invitation);
      }
    }

    const results = providers
      .map((provider) =>
        this.serializeProviderDiscoveryResult(
          provider,
          organization,
          filters,
          invitationByProvider.get(provider.id),
        ),
      )
      .filter((result) => this.discoveryResultMatches(result, filters))
      .sort((a, b) => {
        if (b.recommendationScore !== a.recommendationScore) {
          return b.recommendationScore - a.recommendationScore;
        }
        return a.providerName.localeCompare(b.providerName);
      })
      .slice(0, 50);

    await this.audit('Provider Directory Viewed', user, {
      organizationId,
      filters,
      resultCount: results.length,
    });

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        type: organization.type,
        state: organization.state,
        lga: organization.lga,
      },
      scoringModel: {
        version: 'provider-discovery-rules-v1',
        formula:
          'category 25, coverage 20, verified citizen rating 25, completion history 10, availability/workload 10, verification/KYC 5, organisation fit 5; sparse history is capped with low confidence.',
        privacy:
          'Email, phone, exact private location, identity evidence, private pricing and internal dispute details are not returned.',
      },
      results,
    };
  }

  async inviteDiscoveredProvider(
    providerId: string,
    dto: Record<string, unknown>,
    user: JwtUser,
  ) {
    const organizationId = this.resolveDiscoveryOrganization(dto, user);
    const provider = await this.prisma.user.findFirst({
      where: {
        id: providerId,
        role: UserRole.PROVIDER,
        accountStatus: AccountStatus.ACTIVE,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        accountStatus: true,
        organizationId: true,
        providerId: true,
      },
    });
    if (!provider) throw new NotFoundException('Provider not found');

    const existingMembership =
      await this.prisma.providerOrganization.findUnique({
        where: {
          providerId_organizationId: {
            providerId,
            organizationId,
          },
        },
      });
    if (existingMembership?.active) {
      return {
        code: 'MEMBERSHIP_ALREADY_ACTIVE',
        message: 'This provider already belongs to this organization.',
        providerId,
        organizationId,
      };
    }

    const activeInvitation = await this.prisma.invitation.findFirst({
      where: {
        organizationId,
        role: UserRole.PROVIDER,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
        OR: [
          provider.email ? { email: provider.email } : undefined,
          provider.phone ? { phone: provider.phone } : undefined,
          { metadata: { path: ['discoveredProviderId'], equals: providerId } },
        ].filter(Boolean) as Prisma.InvitationWhereInput[],
      },
    });
    if (activeInvitation) {
      throw new ConflictException({
        code: 'DUPLICATE_PENDING_INVITATION',
        message:
          'This provider already has a pending invitation from this organization.',
      });
    }

    if (!provider.email && !provider.phone) {
      throw new ForbiddenException({
        code: 'PROVIDER_CONTACT_UNAVAILABLE',
        message:
          'This provider cannot be invited until a private platform contact is available.',
      });
    }

    const result = await this.inviteUser(
      {
        role: UserRole.PROVIDER,
        organizationId,
        email: provider.email,
        phone: provider.phone,
        fullName: provider.fullName,
        confirmExistingUser: true,
        existingUserAction: 'ADD_MEMBERSHIP',
        discoveryInvite: true,
      },
      user,
    );

    const invitation = (result as any).invitation;
    if (invitation?.id) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: {
          metadata: {
            ...this.objectMetadata(invitation.metadata),
            discoveredProviderId: providerId,
            invitationSource: 'SMART_PROVIDER_DISCOVERY',
          },
        },
      });
    }
    await this.audit('Provider Discovery Invitation Created', user, {
      providerId,
      organizationId,
      invitationId: invitation?.id ?? null,
    });

    return {
      ...((result as any) ?? {}),
      provider: {
        id: provider.id,
        providerId: provider.providerId,
        fullName: provider.fullName,
      },
    };
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
    if (typeof dto.email === 'string' && existing.role === UserRole.PROVIDER) {
      const email = this.normalizeEmail(dto.email);
      if (email) {
        const duplicate = await this.prisma.user.findUnique({
          where: { email },
          select: { id: true },
        });
        if (duplicate && duplicate.id !== id) {
          throw new ConflictException({
            code: 'IDENTITY_EMAIL_CONFLICT',
            message: 'This email already belongs to another SecureZone user.',
          });
        }
        data.email = email;
        data.emailVerifiedAt = null;
        data.identityVerificationStatus = 'UNVERIFIED';
      } else {
        data.email = null;
        data.emailVerifiedAt = null;
      }
    }
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
    if (
      existing.role === UserRole.SUPER_ADMIN &&
      status !== AccountStatus.ACTIVE
    ) {
      const activeSuperAdmins = await this.prisma.user.count({
        where: {
          role: UserRole.SUPER_ADMIN,
          accountStatus: AccountStatus.ACTIVE,
          id: { not: id },
        },
      });
      if (activeSuperAdmins === 0) {
        throw new ForbiddenException(
          'Cannot deactivate the final active Super Admin',
        );
      }
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

  async resetPassword(id: string, dto: { password?: unknown }, user: JwtUser) {
    void dto;
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

    if (!this.authService) {
      throw new ForbiddenException(
        'Password recovery delivery is not configured.',
      );
    }

    const actorId = user.id ?? user.userId ?? user.sub;
    if (!actorId) throw new ForbiddenException('Actor missing');
    const reset = await this.authService.issueAdministrativePasswordReset(
      id,
      actorId,
    );

    await this.audit('User Password Reset', user, {
      targetUserId: id,
      role: existing.role,
      outcome: 'secure_reset_requested',
    });

    return {
      user: existing,
      recovery: reset,
      message:
        'Password reset initiated. If delivery is configured, reset instructions will be sent.',
    };
  }

  async resendUserInvitation(id: string, user: JwtUser) {
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
        'Legacy invitation reminder recorded. Email/SMS delivery is not configured locally.',
    };
  }

  async inviteUser(dto: Record<string, unknown>, user: JwtUser) {
    const role = this.parseInvitableRole(dto.role);
    const actorId = user.id ?? user.userId ?? user.sub;
    if (!actorId) throw new ForbiddenException('Actor missing');

    if (this.isGovernanceAdminRole(role)) {
      throw new ForbiddenException(
        'Delegated admin roles must be created from governance administration',
      );
    }

    if (role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('This role cannot be invited');
    }
    if (user.role !== UserRole.SUPER_ADMIN && role === UserRole.ORG_ADMIN) {
      throw new ForbiddenException(
        'Organization Admin cannot invite other Organization Admins',
      );
    }

    const organizationId = this.resolveInvitationOrganization(dto, user);
    const email =
      typeof dto.email === 'string' ? dto.email.toLowerCase().trim() : null;
    const phone = typeof dto.phone === 'string' ? dto.phone.trim() : null;
    const fullName =
      typeof dto.fullName === 'string' && dto.fullName.trim()
        ? dto.fullName.trim()
        : 'Invited User';

    if (!email && !phone) {
      throw new ForbiddenException('Email or phone is required');
    }

    const organization = organizationId
      ? await this.prisma.organization.findUnique({
          where: { id: organizationId },
          select: {
            id: true,
            name: true,
            allowedUsers: true,
            allowedProviders: true,
          },
        })
      : null;
    if (organizationId && !organization) {
      throw new ForbiddenException('Organization not found');
    }

    const duplicateFilters = [
      email ? { email } : null,
      phone ? { phone } : null,
    ].filter(
      (value): value is { email: string } | { phone: string } => value !== null,
    );
    const existing = await this.prisma.user.findFirst({
      where: { OR: duplicateFilters },
      select: {
        id: true,
        role: true,
        accountStatus: true,
        organizationId: true,
        email: true,
        phone: true,
        fullName: true,
        providerId: true,
      },
    });

    if (existing && organizationId) {
      const existingMembership =
        role === UserRole.PROVIDER
          ? await this.prisma.providerOrganization.findUnique({
              where: {
                providerId_organizationId: {
                  providerId: existing.id,
                  organizationId,
                },
              },
            })
          : null;
      if (
        role === UserRole.PROVIDER &&
        existing.role === UserRole.PROVIDER &&
        existingMembership?.active
      ) {
        return {
          code: 'MEMBERSHIP_ALREADY_ACTIVE',
          message: 'This provider already belongs to this organization.',
          existingUser: this.existingUserSummary(existing),
          membership: {
            organizationId,
            active: true,
            isPrimary: existingMembership.isPrimary,
          },
        };
      }
      if (
        role === UserRole.PROVIDER &&
        existing.role === UserRole.PROVIDER &&
        existingMembership &&
        !existingMembership.active
      ) {
        throw new ConflictException({
          code: 'MEMBERSHIP_SUSPENDED',
          message:
            'This provider membership exists but is suspended. Reactivate it explicitly before assigning work.',
          existingUser: this.existingUserSummary(existing),
        });
      }
    }
    if (
      existing &&
      organizationId &&
      existing.organizationId === organizationId &&
      existing.role === role &&
      existing.accountStatus !== AccountStatus.DEACTIVATED
    ) {
      return {
        code: 'USER_ALREADY_MEMBER',
        message:
          'This user already belongs to this organization with this role.',
        existingUser: this.existingUserSummary(existing),
      };
    }

    const activeDuplicate = await this.prisma.invitation.findFirst({
      where: {
        status: InvitationStatus.PENDING,
        organizationId,
        role,
        OR: duplicateFilters,
        expiresAt: { gt: new Date() },
      },
    });
    if (activeDuplicate) {
      throw new ConflictException({
        code: 'DUPLICATE_PENDING_INVITATION',
        message: 'A pending invitation already exists.',
      });
    }

    const existingProviderMembershipInvite =
      existing &&
      organizationId &&
      role === UserRole.PROVIDER &&
      existing.role === UserRole.PROVIDER;

    if (existingProviderMembershipInvite) {
      const confirmed =
        dto.confirmExistingUser === true ||
        String(dto.existingUserAction ?? '').toUpperCase() === 'ADD_MEMBERSHIP';
      if (!confirmed) {
        return {
          code: 'EXISTING_USER_REQUIRES_CONFIRMATION',
          requiresConfirmation: true,
          message:
            'This provider already has a SecureZone account. Confirm before adding organization membership.',
          existingUser: this.existingUserSummary(existing),
          organization,
          requestedRole: role,
        };
      }
      await this.enforceProviderQuota(organizationId);
    }

    if (!existingProviderMembershipInvite) {
      await this.enforceUserQuota(organizationId);
    }
    if (role === UserRole.PROVIDER && !existingProviderMembershipInvite) {
      await this.enforceProviderQuota(organizationId);
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const invitation = await this.prisma.invitation.create({
      data: {
        fullName,
        email,
        phone,
        role,
        inviteCode: `INV-${randomUUID().slice(0, 10).toUpperCase()}`,
        organizationId,
        invitedById: actorId,
        tokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        metadata: {
          delivery: 'EMAIL_NOT_CONFIGURED',
          existingUserId: existing?.id ?? null,
          invitationPurpose: existingProviderMembershipInvite
            ? 'PROVIDER_MEMBERSHIP_ACTIVATION'
            : 'USER_ONBOARDING',
        },
      },
      include: this.invitationInclude(),
    });

    if (existing) {
      await this.createNotification({
        userId: existing.id,
        type: 'ORGANIZATION_INVITATION_RECEIVED',
        title: 'Organization invitation received',
        message: `${organization?.name ?? 'SecureZone'} invited you as ${this.humanRole(role)}.`,
      });
    }

    await this.audit('User Invited', user, {
      invitationId: invitation.id,
      role,
      organizationId,
      hasInvitedEmail: Boolean(email),
      hasInvitedPhone: Boolean(phone),
      existingUserId: existing?.id ?? null,
    });

    return {
      invitation: this.serializeInvitation(invitation),
      delivery: {
        status: 'EMAIL_NOT_CONFIGURED',
        message:
          'Invitation created. Email delivery is not configured in this environment, but the invitee can see it after signing in with the invited email or phone.',
      },
      message: 'Invitation created. Email delivery is pending configuration.',
    };
  }

  async revokeInvitation(id: string, user: JwtUser) {
    return this.cancelInvitation(id, user, InvitationStatus.REVOKED);
  }

  async cancelInvitation(
    id: string,
    user: JwtUser,
    status: InvitationStatus = InvitationStatus.CANCELLED,
  ) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id, ...this.buildInvitationScope(user) },
      include: this.invitationInclude(),
    });
    if (!invitation) {
      throw new ForbiddenException(this.domainError('INVITATION_NOT_FOUND'));
    }
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new ConflictException(
        this.domainError('INVITATION_ALREADY_RESOLVED'),
      );
    }

    const revoked = await this.prisma.invitation.update({
      where: { id },
      data: { status, revokedAt: new Date() },
      include: this.invitationInclude(),
    });

    await this.notifyInvitedIdentity(invitation, {
      type: 'ORGANIZATION_INVITATION_CANCELLED',
      title: 'Organization invitation cancelled',
      message: `${invitation.organization?.name ?? 'An organization'} cancelled an invitation.`,
    });

    await this.audit('Invitation Cancelled', user, {
      invitationId: id,
      role: invitation.role,
      organizationId: invitation.organizationId,
      status,
    });
    return this.serializeInvitation(revoked);
  }

  async resendInvitation(id: string, user: JwtUser) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id, ...this.buildInvitationScope(user) },
      include: this.invitationInclude(),
    });
    if (!invitation) {
      throw new ForbiddenException(this.domainError('INVITATION_NOT_FOUND'));
    }
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new ConflictException(
        this.domainError('INVITATION_ALREADY_RESOLVED'),
      );
    }
    if (invitation.expiresAt && invitation.expiresAt <= new Date()) {
      await this.markInvitationExpired(invitation.id);
      throw new ConflictException(this.domainError('INVITATION_EXPIRED'));
    }
    const updated = await this.prisma.invitation.update({
      where: { id },
      data: {
        resentAt: new Date(),
        lastNotificationAt: new Date(),
        metadata: {
          ...this.objectMetadata(invitation.metadata),
          delivery: 'EMAIL_NOT_CONFIGURED',
          resendCount:
            Number(this.objectMetadata(invitation.metadata).resendCount ?? 0) +
            1,
        },
      },
      include: this.invitationInclude(),
    });
    await this.notifyInvitedIdentity(invitation, {
      type: 'ORGANIZATION_INVITATION_RECEIVED',
      title: 'Organization invitation reminder',
      message: `${invitation.organization?.name ?? 'SecureZone'} reminded you about a pending ${this.humanRole(invitation.role)} invitation.`,
    });
    await this.audit('Invitation Resent', user, {
      invitationId: id,
      role: invitation.role,
    });
    return {
      invitation: this.serializeInvitation(updated),
      delivery: {
        status: 'EMAIL_NOT_CONFIGURED',
        message:
          'Invitation reminder recorded. Email delivery is not configured locally.',
      },
    };
  }

  async getMyInvitations(user: JwtUser) {
    const filters = this.inviteeFilters(user);
    if (filters.length === 0) return [];
    const invitations = await this.prisma.invitation.findMany({
      where: {
        status: InvitationStatus.PENDING,
        OR: filters,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: this.invitationInclude(),
    });
    const now = new Date();
    const expiredIds = invitations
      .filter(
        (invitation) => invitation.expiresAt && invitation.expiresAt <= now,
      )
      .map((invitation) => invitation.id);
    if (expiredIds.length) {
      await this.prisma.invitation.updateMany({
        where: { id: { in: expiredIds } },
        data: { status: InvitationStatus.EXPIRED },
      });
    }
    return invitations
      .filter((invitation) => !expiredIds.includes(invitation.id))
      .map((invitation) => this.serializeInvitation(invitation));
  }

  async acceptInvitation(id: string, user: JwtUser) {
    const actorId = user.id ?? user.userId ?? user.sub;
    if (!actorId) throw new ForbiddenException('Actor missing');
    const invitation = await this.prisma.invitation.findUnique({
      where: { id },
      include: this.invitationInclude(),
    });
    if (!invitation) {
      throw new NotFoundException(this.domainError('INVITATION_NOT_FOUND'));
    }
    this.assertInviteeMatches(invitation, user);
    if (invitation.status !== InvitationStatus.PENDING) {
      if (
        invitation.status === InvitationStatus.ACCEPTED &&
        invitation.acceptedUserId === actorId
      ) {
        return this.serializeInvitation(invitation);
      }
      throw new ConflictException(
        this.domainError(
          invitation.status === InvitationStatus.CANCELLED ||
            invitation.status === InvitationStatus.REVOKED
            ? 'INVITATION_CANCELLED'
            : invitation.status === InvitationStatus.EXPIRED
              ? 'INVITATION_EXPIRED'
              : 'INVITATION_ALREADY_RESOLVED',
        ),
      );
    }
    if (invitation.expiresAt && invitation.expiresAt <= new Date()) {
      await this.markInvitationExpired(invitation.id);
      throw new ConflictException(this.domainError('INVITATION_EXPIRED'));
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const freshInvitation = await tx.invitation.findUniqueOrThrow({
        where: { id },
        select: { status: true, expiresAt: true },
      });
      if (freshInvitation.status !== InvitationStatus.PENDING) {
        throw new ConflictException(
          this.domainError('INVITATION_ALREADY_RESOLVED'),
        );
      }
      if (
        freshInvitation.expiresAt &&
        freshInvitation.expiresAt <= new Date()
      ) {
        await tx.invitation.update({
          where: { id },
          data: { status: InvitationStatus.EXPIRED },
        });
        throw new ConflictException(this.domainError('INVITATION_EXPIRED'));
      }
      const currentUser = await tx.user.findUniqueOrThrow({
        where: { id: actorId },
        select: {
          id: true,
          role: true,
          organizationId: true,
          accountStatus: true,
        },
      });
      const data: Prisma.UserUpdateInput = {
        accountStatus:
          currentUser.accountStatus === AccountStatus.SUSPENDED
            ? AccountStatus.SUSPENDED
            : AccountStatus.ACTIVE,
      };
      const providerMembershipOnly =
        currentUser.role === UserRole.PROVIDER &&
        invitation.role === UserRole.PROVIDER &&
        invitation.organizationId &&
        currentUser.organizationId !== invitation.organizationId;
      if (invitation.organizationId && !providerMembershipOnly) {
        data.organization = { connect: { id: invitation.organizationId } };
      }
      if (
        currentUser.role !== UserRole.SUPER_ADMIN &&
        !providerMembershipOnly
      ) {
        data.role = invitation.role;
      }
      const acceptedUser = await tx.user.update({
        where: { id: actorId },
        data,
        select: this.adminUserSelect(),
      });
      if (invitation.role === UserRole.PROVIDER && invitation.organizationId) {
        await tx.providerOrganization.upsert({
          where: {
            providerId_organizationId: {
              providerId: actorId,
              organizationId: invitation.organizationId,
            },
          },
          update: {
            active: true,
            isPrimary: currentUser.organizationId === invitation.organizationId,
          },
          create: {
            providerId: actorId,
            organizationId: invitation.organizationId,
            active: true,
            isPrimary: currentUser.organizationId === invitation.organizationId,
          },
        });
      }
      return tx.invitation.update({
        where: { id },
        data: {
          status: InvitationStatus.ACCEPTED,
          acceptedAt: new Date(),
          acceptedUserId: actorId,
          metadata: {
            ...this.objectMetadata(invitation.metadata),
            acceptedUserRole: acceptedUser.role,
          },
        },
        include: this.invitationInclude(),
      });
    });

    await this.createNotification({
      userId: invitation.invitedById,
      type: 'ORGANIZATION_INVITATION_ACCEPTED',
      title: 'Invitation accepted',
      message: `${user.fullName ?? invitation.fullName} accepted the ${this.humanRole(invitation.role)} invitation.`,
    });
    await this.audit('Invitation Accepted', user, {
      invitationId: id,
      role: invitation.role,
      organizationId: invitation.organizationId,
    });
    if (invitation.role === UserRole.PROVIDER && invitation.organizationId) {
      await this.audit('Provider Membership Activated', user, {
        invitationId: id,
        providerId: actorId,
        organizationId: invitation.organizationId,
      });
    }
    return this.serializeInvitation(updated);
  }

  async declineInvitation(id: string, user: JwtUser) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id },
      include: this.invitationInclude(),
    });
    if (!invitation) {
      throw new NotFoundException(this.domainError('INVITATION_NOT_FOUND'));
    }
    this.assertInviteeMatches(invitation, user);
    if (invitation.status !== InvitationStatus.PENDING) {
      if (invitation.status === InvitationStatus.DECLINED) {
        return this.serializeInvitation(invitation);
      }
      throw new ConflictException(
        this.domainError(
          invitation.status === InvitationStatus.CANCELLED ||
            invitation.status === InvitationStatus.REVOKED
            ? 'INVITATION_CANCELLED'
            : invitation.status === InvitationStatus.EXPIRED
              ? 'INVITATION_EXPIRED'
              : 'INVITATION_ALREADY_RESOLVED',
        ),
      );
    }
    if (invitation.expiresAt && invitation.expiresAt <= new Date()) {
      await this.markInvitationExpired(invitation.id);
      throw new ConflictException(this.domainError('INVITATION_EXPIRED'));
    }
    const updated = await this.prisma.invitation.update({
      where: { id },
      data: {
        status: InvitationStatus.DECLINED,
        declinedAt: new Date(),
      },
      include: this.invitationInclude(),
    });
    await this.createNotification({
      userId: invitation.invitedById,
      type: 'ORGANIZATION_INVITATION_DECLINED',
      title: 'Invitation declined',
      message: `${user.fullName ?? invitation.fullName} declined the ${this.humanRole(invitation.role)} invitation.`,
    });
    await this.audit('Invitation Declined', user, {
      invitationId: id,
      role: invitation.role,
      organizationId: invitation.organizationId,
    });
    return this.serializeInvitation(updated);
  }

  async approveProviderRequest(id: string, user: JwtUser) {
    const existing = await this.getUser(id, user);
    if (existing.role !== UserRole.PENDING_PROVIDER) {
      throw new ForbiddenException('User is not a pending provider request');
    }
    const providerId =
      existing.providerId ??
      `PRV-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
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

    if (user.role === UserRole.SUPER_ADMIN) return {};
    const organizationId = user.organizationId;
    if (!organizationId)
      throw new ForbiddenException('No organization assigned');
    return {
      OR: [
        { organizationId },
        {
          role: UserRole.PROVIDER,
          providerOrganizations: {
            some: { organizationId, active: true },
          },
        },
      ],
    } satisfies Prisma.UserWhereInput;
  }

  private buildInvitationScope(user: JwtUser) {
    if (user.role === UserRole.SUPER_ADMIN) return {};
    if (user.role !== UserRole.ORG_ADMIN || !user.organizationId) {
      throw new ForbiddenException('Not allowed');
    }
    return { organizationId: user.organizationId };
  }

  private parseInvitableRole(raw: unknown) {
    const value = String(raw ?? '')
      .trim()
      .toUpperCase();
    if (!Object.values(UserRole).includes(value as UserRole)) {
      throw new ForbiddenException('Invalid role');
    }
    return value as UserRole;
  }

  private isGovernanceAdminRole(role: UserRole) {
    const governanceAdminRoles: UserRole[] = [
      UserRole.PLATFORM_OWNER,
      UserRole.EXECUTIVE_SUPER_ADMIN,
      UserRole.TECHNICAL_ADMIN,
      UserRole.BILLING_ADMIN,
      UserRole.LEGAL_ADMIN,
      UserRole.ASSIGNMENT_ADMIN,
      UserRole.ASSET_ADMIN,
      UserRole.COMPLIANCE_ADMIN,
      UserRole.REGULATORY_ADMIN,
      UserRole.SUPPORT_ADMIN,
    ];
    return governanceAdminRoles.includes(role);
  }

  private resolveInvitationOrganization(
    dto: Record<string, unknown>,
    user: JwtUser,
  ) {
    if (user.role === UserRole.SUPER_ADMIN) {
      return typeof dto.organizationId === 'string' && dto.organizationId.trim()
        ? dto.organizationId.trim()
        : (user.organizationId ?? null);
    }
    if (!user.organizationId) {
      throw new ForbiddenException('No organization assigned');
    }
    return user.organizationId;
  }

  private resolveDiscoveryOrganization(
    dto: Record<string, unknown>,
    user: JwtUser,
  ) {
    if (user.role === UserRole.SUPER_ADMIN) {
      const requested =
        typeof dto.organizationId === 'string' ? dto.organizationId.trim() : '';
      const fallback = user.organizationId?.trim() ?? '';
      const organizationId = requested || fallback;
      if (!organizationId) {
        throw new ForbiddenException('Organization is required for discovery');
      }
      return organizationId;
    }
    if (user.role !== UserRole.ORG_ADMIN || !user.organizationId) {
      throw new ForbiddenException('Provider discovery requires org admin');
    }
    return user.organizationId;
  }

  private discoveryFilters(query: Record<string, unknown>) {
    return {
      serviceCategory: this.optionalString(query.serviceCategory),
      expertise: this.optionalString(query.expertise),
      coverageArea: this.optionalString(query.coverageArea),
      availability: this.optionalString(query.availability),
      verificationStatus: this.optionalString(query.verificationStatus),
      membershipStatus: this.optionalString(query.membershipStatus),
      invitationStatus: this.optionalString(query.invitationStatus),
      minimumRating: this.optionalNumber(query.minimumRating),
    };
  }

  private serializeProviderDiscoveryResult(
    provider: any,
    organization: {
      id: string;
      name: string;
      type: string;
      state: string | null;
      lga: string | null;
      country: string | null;
      profileData: unknown;
    },
    filters: ReturnType<UsersService['discoveryFilters']>,
    invitation?: {
      id: string;
      status: InvitationStatus;
      expiresAt: Date | null;
    },
  ) {
    const serviceCategories = this.stringList(provider.serviceCategories);
    const coverageAreas = this.stringList(provider.coverageAreas);
    const orgNeeds = this.organizationServiceNeeds(organization, filters);
    const profileText = JSON.stringify(
      provider.profileData ?? {},
    ).toLowerCase();
    const closedJobs = provider.assignedReports.filter(
      (report: any) => report.status === ReportStatus.CLOSED,
    );
    const verifiedRatings = closedJobs.filter(
      (report: any) => typeof report.citizenRating === 'number',
    );
    const ratingCount = verifiedRatings.length;
    const rawAverage =
      ratingCount === 0
        ? null
        : verifiedRatings.reduce(
            (sum: number, report: any) => sum + report.citizenRating,
            0,
          ) / ratingCount;
    const bayesianRating =
      rawAverage == null
        ? null
        : (ratingCount * rawAverage + 5 * 3.8) / (ratingCount + 5);
    const activeWorkload = provider.assignedReports.filter((report: any) =>
      [ReportStatus.ASSIGNED, ReportStatus.IN_PROGRESS].includes(report.status),
    ).length;
    const rejectedCompletions = provider.assignedReports.filter(
      (report: any) => report.completionRejectionReason,
    ).length;
    const organizationMembership = provider.providerOrganizations.find(
      (link: any) => link.organizationId === organization.id,
    );
    const membershipStatus = organizationMembership
      ? 'MEMBER'
      : provider.providerOrganizations.length > 0 ||
          provider.organizationId !== null
        ? 'ACTIVE_ELSEWHERE'
        : 'INDEPENDENT';
    const invitationStatus = invitation
      ? invitation.status === InvitationStatus.PENDING &&
        invitation.expiresAt &&
        invitation.expiresAt <= new Date()
        ? InvitationStatus.EXPIRED
        : invitation.status
      : 'NONE';

    let score = 0;
    const recommendationReasons: string[] = [];
    const cautionReasons: string[] = [];
    const matchedCategory =
      this.containsAny(serviceCategories, orgNeeds) ||
      (filters.serviceCategory
        ? this.containsText(serviceCategories, filters.serviceCategory)
        : false);
    if (matchedCategory) {
      score += 25;
      recommendationReasons.push(
        `Matches ${filters.serviceCategory ?? orgNeeds[0] ?? 'service needs'}`,
      );
    }

    const locationNeeds = [
      organization.lga,
      organization.state,
      organization.country,
      filters.coverageArea,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase());
    const coversArea =
      coverageAreas.length === 0
        ? false
        : locationNeeds.some((need) =>
            coverageAreas.some((area) => area.toLowerCase().includes(need)),
          );
    if (coversArea) {
      score += 20;
      recommendationReasons.push("Covers the organization's service area");
    } else if (coverageAreas.length === 0) {
      cautionReasons.push('Coverage area not verified');
    }

    if (bayesianRating != null) {
      score += Math.min(25, Math.max(0, ((bayesianRating - 3) / 2) * 25));
      recommendationReasons.push(
        `${rawAverage!.toFixed(1)} verified citizen rating from ${ratingCount} completed job${ratingCount === 1 ? '' : 's'}`,
      );
    } else {
      cautionReasons.push('Insufficient verified history');
    }

    if (closedJobs.length > 0) {
      score += Math.min(10, closedJobs.length * 2);
      recommendationReasons.push(
        `${closedJobs.length} completed job${closedJobs.length === 1 ? '' : 's'}`,
      );
    }

    if (activeWorkload === 0) {
      score += 10;
      recommendationReasons.push('Currently available');
    } else if (activeWorkload <= 2) {
      score += 5;
      recommendationReasons.push('Moderate active workload');
    } else {
      cautionReasons.push('High active workload');
    }

    const verified = provider.identityVerificationStatus !== 'UNVERIFIED';
    if (verified) {
      score += 5;
      recommendationReasons.push('Verification in progress or completed');
    } else {
      cautionReasons.push('Verification not completed');
    }

    if (this.organizationTypeMatchesProfile(organization.type, profileText)) {
      score += 5;
      recommendationReasons.push(`Profile aligns with ${organization.type}`);
    }

    if (membershipStatus === 'MEMBER') {
      recommendationReasons.push('Already an active organization member');
    } else if (membershipStatus === 'ACTIVE_ELSEWHERE') {
      cautionReasons.push('Already active in another organization');
    }
    if (invitationStatus === InvitationStatus.PENDING) {
      cautionReasons.push('Organization invitation pending');
    }
    if (rejectedCompletions > 0) {
      cautionReasons.push('Has citizen rework or rejection history');
    }

    const confidenceLevel =
      ratingCount >= 10 && closedJobs.length >= 10
        ? 'HIGH'
        : ratingCount >= 3 || closedJobs.length >= 5
          ? 'MEDIUM'
          : 'LOW';
    if (confidenceLevel === 'LOW') {
      cautionReasons.push('Limited verified history');
      score = Math.min(score, 74);
    }

    return {
      providerId: provider.id,
      publicProviderId: provider.providerId,
      providerName: provider.fullName,
      serviceCategories,
      broadCoverageAreas: coverageAreas,
      verificationStatus: provider.identityVerificationStatus,
      recommendationScore: Math.round(score),
      confidenceLevel,
      recommendationReasons,
      cautionReasons: [...new Set(cautionReasons)],
      ratingSummary: {
        verifiedCitizenAverage:
          rawAverage == null ? null : Number(rawAverage.toFixed(2)),
        bayesianAverage:
          bayesianRating == null ? null : Number(bayesianRating.toFixed(2)),
        verifiedRatingCount: ratingCount,
      },
      completedJobCount: closedJobs.length,
      acceptanceRate: null,
      acceptanceRateStatus: 'Insufficient verified assignment response data',
      activeWorkload,
      membershipStatus,
      invitationStatus,
      primaryProfileOrganization: provider.organization
        ? {
            id: provider.organization.id,
            name: provider.organization.name,
            type: provider.organization.type,
          }
        : null,
      activeMembershipCount: provider.providerOrganizations.length,
    };
  }

  private discoveryResultMatches(
    result: ReturnType<UsersService['serializeProviderDiscoveryResult']>,
    filters: ReturnType<UsersService['discoveryFilters']>,
  ) {
    if (
      filters.serviceCategory &&
      !this.containsText(result.serviceCategories, filters.serviceCategory)
    ) {
      return false;
    }
    if (
      filters.coverageArea &&
      !this.containsText(result.broadCoverageAreas, filters.coverageArea)
    ) {
      return false;
    }
    if (
      filters.verificationStatus &&
      result.verificationStatus !== filters.verificationStatus
    ) {
      return false;
    }
    if (
      filters.membershipStatus &&
      result.membershipStatus !== filters.membershipStatus
    ) {
      return false;
    }
    if (
      filters.invitationStatus &&
      result.invitationStatus !== filters.invitationStatus
    ) {
      return false;
    }
    if (
      filters.minimumRating != null &&
      (result.ratingSummary.verifiedCitizenAverage == null ||
        result.ratingSummary.verifiedCitizenAverage < filters.minimumRating)
    ) {
      return false;
    }
    if (filters.availability === 'available' && result.activeWorkload > 0) {
      return false;
    }
    return true;
  }

  private organizationServiceNeeds(
    organization: { type: string; profileData: unknown },
    filters: ReturnType<UsersService['discoveryFilters']>,
  ) {
    const configured = this.stringList(
      this.objectMetadata(organization.profileData).serviceNeeds,
    );
    return [
      filters.serviceCategory,
      ...configured,
      ...this.defaultNeedsForOrganizationType(organization.type),
    ].filter((value): value is string => Boolean(value));
  }

  private defaultNeedsForOrganizationType(type: string) {
    const normalized = type.toUpperCase();
    if (normalized.includes('UTILITY')) return ['Electricity', 'Water'];
    if (normalized.includes('ESTATE') || normalized.includes('FACILITY')) {
      return ['Waste', 'Water', 'Electricity', 'Roads'];
    }
    if (normalized.includes('GOVERNMENT') || normalized.includes('AGENCY')) {
      return ['Roads', 'Drainage', 'Electricity', 'Waste', 'Water'];
    }
    return ['Roads', 'Drainage', 'Electricity', 'Waste', 'Water'];
  }

  private organizationTypeMatchesProfile(type: string, profileText: string) {
    return type
      .toLowerCase()
      .split('_')
      .some((part) => part.length > 3 && profileText.includes(part));
  }

  private containsAny(values: string[], needles: string[]) {
    return needles.some((needle) => this.containsText(values, needle));
  }

  private containsText(values: string[], needle: string) {
    const normalized = needle.trim().toLowerCase();
    return values.some((value) => value.toLowerCase().includes(normalized));
  }

  private optionalString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private optionalNumber(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private stringList(value: unknown) {
    return Array.isArray(value)
      ? value
          .map((item) => String(item ?? '').trim())
          .filter((item) => item.length > 0)
      : [];
  }

  private inviteeFilters(user: JwtUser) {
    const filters: Array<{ email: string } | { phone: string }> = [];
    const email = user.email?.toLowerCase().trim();
    const phone = user.phone?.trim();
    if (email) filters.push({ email });
    if (phone) filters.push({ phone });
    return filters;
  }

  private assertInviteeMatches(
    invitation: {
      email: string | null;
      phone: string | null;
    },
    user: JwtUser,
  ) {
    const emailMatches =
      invitation.email &&
      user.email &&
      invitation.email.toLowerCase() === user.email.toLowerCase();
    const phoneMatches =
      invitation.phone && user.phone && invitation.phone === user.phone;
    if (!emailMatches && !phoneMatches) {
      throw new ForbiddenException(this.domainError('INVITATION_NOT_OWNED'));
    }
  }

  private async markInvitationExpired(id: string) {
    await this.prisma.invitation.update({
      where: { id },
      data: { status: InvitationStatus.EXPIRED },
    });
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private objectMetadata(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private normalizeEmail(value: string) {
    const email = value.toLowerCase().trim();
    if (!email) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Enter a valid email address');
    }
    return email;
  }

  private existingUserSummary(existing: {
    id: string;
    fullName?: string | null;
    email?: string | null;
    phone?: string | null;
    role: UserRole;
    accountStatus: AccountStatus;
    organizationId?: string | null;
    providerId?: string | null;
  }) {
    return {
      id: existing.id,
      fullName: existing.fullName,
      email: existing.email,
      phone: existing.phone,
      role: existing.role,
      accountStatus: existing.accountStatus,
      organizationId: existing.organizationId,
      providerId: existing.providerId,
    };
  }

  private async enforceUserQuota(organizationId: string | null) {
    if (!organizationId) return;
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { allowedUsers: true },
    });
    if (organization?.allowedUsers == null) return;
    const users = await this.prisma.user.count({ where: { organizationId } });
    if (users >= organization.allowedUsers) {
      throw new ConflictException({
        code: 'USER_QUOTA_EXCEEDED',
        message: 'This organization has reached its user quota.',
      });
    }
  }

  private async enforceProviderQuota(organizationId: string | null) {
    if (!organizationId) return;
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { allowedProviders: true },
    });
    if (organization?.allowedProviders == null) return;
    const providers = await this.prisma.user.count({
      where: {
        role: UserRole.PROVIDER,
        OR: [
          { organizationId },
          {
            providerOrganizations: {
              some: { organizationId, active: true },
            },
          },
        ],
      },
    });
    if (providers >= organization.allowedProviders) {
      throw new ConflictException({
        code: 'PROVIDER_QUOTA_EXCEEDED',
        message: 'This organization has reached its provider quota.',
      });
    }
  }

  private invitationInclude() {
    return {
      organization: { select: { id: true, name: true, type: true } },
      invitedBy: { select: { id: true, fullName: true, role: true } },
      acceptedUser: { select: { id: true, fullName: true, role: true } },
    };
  }

  private serializeInvitation(invitation: any) {
    const metadata = this.objectMetadata(invitation.metadata);
    const now = new Date();
    const expired =
      invitation.status === InvitationStatus.PENDING &&
      invitation.expiresAt &&
      invitation.expiresAt <= now;
    return {
      id: invitation.id,
      inviteCode: invitation.inviteCode,
      email: invitation.email,
      phone: invitation.phone,
      fullName: invitation.fullName,
      role: invitation.role,
      status: expired ? InvitationStatus.EXPIRED : invitation.status,
      organizationId: invitation.organizationId,
      organization: invitation.organization,
      invitedBy: invitation.invitedBy,
      acceptedUser: invitation.acceptedUser,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      declinedAt: invitation.declinedAt,
      revokedAt: invitation.revokedAt,
      cancelledAt:
        invitation.status === InvitationStatus.CANCELLED
          ? invitation.revokedAt
          : null,
      resentAt: invitation.resentAt,
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt,
      deliveryStatus: metadata.delivery ?? 'EMAIL_NOT_CONFIGURED',
      emailDeliveryConfigured: false,
    };
  }

  private async notifyInvitedIdentity(
    invitation: {
      email: string | null;
      phone: string | null;
    },
    notification: { type: string; title: string; message: string },
  ) {
    const filters = [
      invitation.email ? { email: invitation.email } : null,
      invitation.phone ? { phone: invitation.phone } : null,
    ].filter(
      (value): value is { email: string } | { phone: string } => value !== null,
    );
    if (!filters.length) return;
    const user = await this.prisma.user.findFirst({
      where: { OR: filters },
      select: { id: true },
    });
    if (!user) return;
    await this.createNotification({ userId: user.id, ...notification });
  }

  private async createNotification(data: {
    userId: string;
    type: string;
    title: string;
    message: string;
  }) {
    await this.prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
      },
    });
  }

  private humanRole(role: UserRole) {
    return role
      .toLowerCase()
      .split('_')
      .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
      .join(' ');
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
      profileData: true,
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

  private domainError(code: string, message?: string) {
    const messages: Record<string, string> = {
      INVITATION_NOT_FOUND: 'Invitation was not found.',
      INVITATION_NOT_OWNED: 'Invitation is not assigned to this account.',
      INVITATION_ALREADY_RESOLVED: 'Invitation is no longer pending.',
      INVITATION_EXPIRED: 'Invitation has expired.',
      INVITATION_CANCELLED: 'Invitation has been cancelled.',
      MEMBERSHIP_ALREADY_ACTIVE:
        'This provider already has an active organization membership.',
      DUPLICATE_PENDING_INVITATION:
        'A pending invitation already exists for this provider and organization.',
      ORGANIZATION_NOT_AUTHORIZED: 'Organization access denied.',
    };
    return { code, message: message ?? messages[code] ?? code };
  }
}
