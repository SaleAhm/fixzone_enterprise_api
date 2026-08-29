import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  InternalRoleAssignmentStatus,
  InternalScopeType,
  InvitationStatus,
  Prisma,
  PrivilegedApprovalStatus,
  PrivilegedOperationType,
  UserRole,
} from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  internalAdminPermissionKeys,
  internalRoleDefinitionsEnabledForThisRelease,
  resolveInternalRoleDefinition,
  roleDefinitionEnabled,
} from './internal-role-catalog';
import {
  EffectivePermissionResult,
  highRiskOperationPermissions,
  InternalAdminUser,
  InternalPermissionKey,
  InternalScope,
  RequestContext,
} from './internal-admin.types';
import { AssignInternalRoleDto } from './dto/assign-internal-role.dto';
import { InternalAdminActionDto } from './dto/internal-admin-action.dto';
import { InviteInternalAdminDto } from './dto/invite-internal-admin.dto';
import {
  CreatePrivilegedApprovalDto,
  DecidePrivilegedApprovalDto,
} from './dto/privileged-approval.dto';

@Injectable()
export class InternalAdminService {
  constructor(private readonly prisma: PrismaService) {}

  roleCatalog() {
    return {
      fallbackLocale: 'en',
      permissions: internalAdminPermissionKeys,
      roles: internalRoleDefinitionsEnabledForThisRelease().map((role) => ({
        role: role.role,
        canonicalName: role.canonicalName,
        displayName: role.displayName,
        description: role.description,
        permissions: role.permissions,
        defaultScopeType: role.defaultScopeType,
        enabled: role.enabled,
        requiresEnterpriseFeature: role.requiresEnterpriseFeature ?? null,
        highRiskGrant: Boolean(role.highRiskGrant),
        version: role.version,
        reusedExistingRole: role.reusedExistingRole ?? null,
      })),
      mfaReadiness: this.mfaReadiness(),
    };
  }

  async listAdministrators(user: InternalAdminUser) {
    await this.assertPermission(user, 'internal_admin.read');
    const users = await this.prisma.user.findMany({
      where: { role: { in: this.internalRoleValues() } },
      select: this.adminSelect(),
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
      take: 250,
    });
    return Promise.all(
      users.map(async (admin) => ({
        ...this.safeAdmin(admin),
        effective: await this.effectivePermissionsForUser(admin.id),
      })),
    );
  }

  async viewEffectiveAccess(targetUserId: string, user: InternalAdminUser) {
    await this.assertPermission(user, 'internal_admin.read');
    return this.effectivePermissionsForUser(targetUserId);
  }

  async inviteAdministrator(
    dto: InviteInternalAdminDto,
    user: InternalAdminUser,
    context?: RequestContext,
  ) {
    await this.assertPermission(user, 'internal_admin.invite');
    const actorId = this.actorId(user);
    const role = this.parseInternalRole(dto.role);
    const definition = this.requireEnabledRole(role);
    this.assertGrantCeiling(user, definition.permissions);
    if (definition.highRiskGrant) {
      return this.createApprovalRequest(
        {
          operationType: PrivilegedOperationType.PLATFORM_SUPER_ADMIN_GRANT,
          requestedRole: role,
          reason: dto.reason,
        },
        user,
        context,
        'Platform super-admin invitation requires dual approval.',
      );
    }

    const email = this.normalizeEmail(dto.email);
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('A user already exists with this email.');
    }

    const duplicate = await this.prisma.invitation.findFirst({
      where: { email, status: InvitationStatus.PENDING, role },
    });
    if (duplicate) return this.safeInvitation(duplicate);

    const scope = this.resolveScope(dto, definition.defaultScopeType, user);
    const invitation = await this.prisma.invitation.create({
      data: {
        email,
        fullName: this.requiredText(dto.fullName, 'fullName'),
        role,
        status: InvitationStatus.PENDING,
        inviteCode: this.inviteCode(),
        invitedById: actorId,
        organizationId: scope.organizationId,
        expiresAt: this.optionalDate(dto.expiresAt) ?? this.defaultExpiry(),
        metadata: this.safeJson({
          source: 'internal_admin_delegation',
          scope,
          roleDefinitionVersion: definition.version,
          mfa: this.mfaReadiness(),
          localization: {
            key: 'internal_admin.invitation_created',
            params: { role },
            preferredLocale: user.preferredLocale ?? 'en',
            fallbackLocale: 'en',
          },
        }),
      },
    });

    await this.audit('Internal Admin Invitation Created', user, context, {
      entityType: 'Invitation',
      entityId: invitation.id,
      metadata: { role, email, scope, reason: dto.reason ?? null },
    });
    await this.notifyActor(user, 'internal_admin.invitation_created', {
      invitationId: invitation.id,
      role,
    });
    return this.safeInvitation(invitation);
  }

  async acceptInvitation(
    invitationId: string,
    user: InternalAdminUser,
    context?: RequestContext,
  ) {
    const actorId = this.actorId(user);
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException('Invitation is no longer pending.');
    }
    if (invitation.expiresAt && invitation.expiresAt <= new Date()) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.EXPIRED },
      });
      await this.audit('Internal Admin Invitation Expired', user, context, {
        entityType: 'Invitation',
        entityId: invitation.id,
        metadata: { role: invitation.role },
      });
      throw new BadRequestException('Invitation has expired.');
    }
    if (
      invitation.email &&
      user.email &&
      invitation.email.toLowerCase() !== user.email.toLowerCase()
    ) {
      throw new ForbiddenException('Invitation is not assigned to this user.');
    }
    const definition = this.requireEnabledRole(invitation.role);
    const metadata = this.objectRecord(invitation.metadata);
    const scope = this.scopeFromMetadata(metadata);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: actorId },
        data: {
          role: invitation.role,
          accountStatus: AccountStatus.ACTIVE,
          organizationId: scope.organizationId ?? undefined,
          profileData: this.safeJson({
            internalAdmin: true,
            mfaReadiness: this.mfaReadiness(),
          }),
        },
      });
      await tx.internalRoleAssignment.create({
        data: {
          userId: actorId,
          role: invitation.role,
          status: InternalRoleAssignmentStatus.ACTIVE,
          scopeType: scope.type,
          scopeRef: scope.ref,
          organizationId: scope.organizationId,
          moduleKey: scope.moduleKey,
          jurisdiction: this.safeNullableJson(scope.jurisdiction),
          permissionsSnapshot: definition.permissions,
          roleDefinitionVersion: definition.version,
          assignedById: invitation.invitedById,
          reason: 'Invitation accepted.',
          startsAt: new Date(),
          expiresAt: invitation.expiresAt,
        },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          status: InvitationStatus.ACCEPTED,
          acceptedUserId: actorId,
          acceptedAt: new Date(),
        },
      });
    });

    await this.audit('Internal Admin Invitation Accepted', user, context, {
      entityType: 'Invitation',
      entityId: invitation.id,
      metadata: { role: invitation.role, scope },
    });
    return this.effectivePermissionsForUser(actorId);
  }

  async assignRole(
    targetUserId: string,
    dto: AssignInternalRoleDto,
    user: InternalAdminUser,
    context?: RequestContext,
  ) {
    await this.assertPermission(user, 'internal_admin.assign_role');
    const actorId = this.actorId(user);
    if (actorId === targetUserId) {
      await this.auditDenied(user, context, 'self_promotion_denied', {
        targetUserId,
        requestedRole: dto.role,
      });
      throw new ForbiddenException('Administrators cannot promote themselves.');
    }
    const role = this.parseInternalRole(dto.role);
    const definition = this.requireEnabledRole(role);
    this.assertGrantCeiling(user, definition.permissions);
    if (definition.highRiskGrant) {
      return this.createApprovalRequest(
        {
          operationType: PrivilegedOperationType.PLATFORM_SUPER_ADMIN_GRANT,
          targetUserId,
          requestedRole: role,
          reason: dto.reason,
        },
        user,
        context,
        'Platform super-admin grant requires dual approval.',
      );
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: this.adminSelect(),
    });
    if (!target) throw new NotFoundException('Administrator not found');
    const scope = this.resolveScope(dto, definition.defaultScopeType, user);
    const assignment = await this.prisma.internalRoleAssignment.create({
      data: {
        userId: targetUserId,
        role,
        status: InternalRoleAssignmentStatus.ACTIVE,
        scopeType: scope.type,
        scopeRef: scope.ref,
        organizationId: scope.organizationId,
        moduleKey: scope.moduleKey,
        jurisdiction: this.safeNullableJson(scope.jurisdiction),
        permissionsSnapshot: definition.permissions,
        roleDefinitionVersion: definition.version,
        assignedById: actorId,
        reason: this.normalizeText(dto.reason),
        startsAt: this.optionalDate(dto.startsAt) ?? new Date(),
        expiresAt: this.optionalDate(dto.expiresAt),
      },
    });
    await this.audit('Internal Admin Role Assigned', user, context, {
      entityType: 'InternalRoleAssignment',
      entityId: assignment.id,
      metadata: { targetUserId, role, scope, reason: dto.reason ?? null },
    });
    return assignment;
  }

  async removeRole(
    assignmentId: string,
    dto: InternalAdminActionDto,
    user: InternalAdminUser,
    context?: RequestContext,
  ) {
    await this.assertPermission(user, 'internal_admin.assign_role');
    const assignment = await this.prisma.internalRoleAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment) throw new NotFoundException('Role assignment not found');
    if (
      assignment.role === UserRole.PLATFORM_SUPER_ADMIN ||
      assignment.role === UserRole.SUPER_ADMIN
    ) {
      await this.assertNotFinalActiveSuperAdmin(assignment.userId);
    }
    const updated = await this.prisma.internalRoleAssignment.update({
      where: { id: assignmentId },
      data: {
        status: InternalRoleAssignmentStatus.REVOKED,
        revokedAt: new Date(),
        revokedById: this.actorId(user),
        revocationReason: this.normalizeText(dto.reason),
      },
    });
    await this.audit('Internal Admin Role Removed', user, context, {
      entityType: 'InternalRoleAssignment',
      entityId: assignmentId,
      metadata: {
        targetUserId: assignment.userId,
        role: assignment.role,
        reason: dto.reason ?? null,
      },
    });
    return updated;
  }

  async suspendAdministrator(
    targetUserId: string,
    dto: InternalAdminActionDto,
    user: InternalAdminUser,
    context?: RequestContext,
  ) {
    await this.assertPermission(user, 'internal_admin.suspend');
    if (this.actorId(user) === targetUserId) {
      throw new ForbiddenException('Administrators cannot suspend themselves.');
    }
    await this.assertNotFinalActiveSuperAdmin(targetUserId);
    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { accountStatus: AccountStatus.SUSPENDED },
      select: this.adminSelect(),
    });
    await this.audit('Internal Admin Suspended', user, context, {
      entityType: 'User',
      entityId: targetUserId,
      metadata: { reason: dto.reason ?? null },
    });
    return this.safeAdmin(updated);
  }

  async reactivateAdministrator(
    targetUserId: string,
    dto: InternalAdminActionDto,
    user: InternalAdminUser,
    context?: RequestContext,
  ) {
    await this.assertPermission(user, 'internal_admin.suspend');
    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { accountStatus: AccountStatus.ACTIVE },
      select: this.adminSelect(),
    });
    await this.audit('Internal Admin Reactivated', user, context, {
      entityType: 'User',
      entityId: targetUserId,
      metadata: { reason: dto.reason ?? null },
    });
    return this.safeAdmin(updated);
  }

  async revokeSessions(
    targetUserId: string,
    dto: InternalAdminActionDto,
    user: InternalAdminUser,
    context?: RequestContext,
  ) {
    await this.assertPermission(user, 'internal_admin.revoke_sessions');
    if (this.actorId(user) === targetUserId) {
      throw new ForbiddenException(
        'Use account security settings for self-session changes.',
      );
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, profileData: true },
    });
    if (!target) throw new NotFoundException('Administrator not found');
    const revokedAt = new Date().toISOString();
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        profileData: this.safeJson({
          ...this.objectRecord(target.profileData),
          sessionRevocation: {
            requestedAt: revokedAt,
            reason: dto.reason ?? null,
            enforcement: 'blocked_until_token_version_foundation',
          },
        }),
      },
    });
    await this.audit(
      'Internal Admin Sessions Revocation Requested',
      user,
      context,
      {
        entityType: 'User',
        entityId: targetUserId,
        metadata: {
          revokedAt,
          reason: dto.reason ?? null,
          enforcement: 'blocked_until_token_version_foundation',
        },
      },
    );
    return {
      targetUserId,
      revokedAt,
      enforced: false,
      state: 'blocked_until_token_version_foundation',
      fallbackMessage:
        'Session revocation was recorded, but active token invalidation requires the token-version foundation.',
    };
  }

  async roleAssignmentHistory(targetUserId: string, user: InternalAdminUser) {
    await this.assertPermission(user, 'internal_admin.view_audit');
    return this.prisma.internalRoleAssignment.findMany({
      where: { userId: targetUserId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }

  async createApprovalRequest(
    dto: CreatePrivilegedApprovalDto,
    user: InternalAdminUser,
    context?: RequestContext,
    blockedReason = 'High-risk operation requires dual approval.',
  ) {
    const operationType = this.parseOperationType(dto.operationType);
    await this.assertPermission(
      user,
      highRiskOperationPermissions[operationType],
    );
    const request = await this.prisma.privilegedApprovalRequest.create({
      data: {
        operationType,
        status: PrivilegedApprovalStatus.PENDING,
        requesterId: this.actorId(user),
        targetUserId: this.normalizeText(dto.targetUserId),
        organizationId: this.normalizeText(dto.organizationId),
        requestedRole: dto.requestedRole
          ? this.parseInternalRole(dto.requestedRole)
          : null,
        requestedScope: this.safeJson({
          organizationId: this.normalizeText(dto.organizationId),
        }),
        payload: this.safeJson({ blockedReason }),
        reason: this.normalizeText(dto.reason),
        executionBlocked: true,
      },
    });
    await this.audit('Privileged Approval Requested', user, context, {
      entityType: 'PrivilegedApprovalRequest',
      entityId: request.id,
      metadata: {
        operationType,
        targetUserId: request.targetUserId,
        requestedRole: request.requestedRole,
        blockedReason,
      },
    });
    return {
      ...request,
      executionBlocked: true,
      fallbackMessage: blockedReason,
    };
  }

  async decideApprovalRequest(
    requestId: string,
    dto: DecidePrivilegedApprovalDto,
    user: InternalAdminUser,
    context?: RequestContext,
  ) {
    const request = await this.prisma.privilegedApprovalRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Approval request not found');
    if (request.requesterId === this.actorId(user)) {
      await this.auditDenied(user, context, 'self_approval_denied', {
        approvalRequestId: requestId,
        operationType: request.operationType,
      });
      throw new ForbiddenException(
        'Requester cannot approve their own request.',
      );
    }
    await this.assertPermission(
      user,
      highRiskOperationPermissions[request.operationType],
    );
    const approve = String(dto.decision).toUpperCase() === 'APPROVE';
    const status = approve
      ? PrivilegedApprovalStatus.EXECUTION_BLOCKED
      : PrivilegedApprovalStatus.REJECTED;
    const updated = await this.prisma.privilegedApprovalRequest.update({
      where: { id: requestId },
      data: {
        status,
        approverId: this.actorId(user),
        decidedAt: new Date(),
        decisionReason: this.normalizeText(dto.reason),
        executionBlocked: true,
      },
    });
    await this.audit(
      approve
        ? 'Privileged Approval Decision Blocked Execution'
        : 'Privileged Approval Rejected',
      user,
      context,
      {
        entityType: 'PrivilegedApprovalRequest',
        entityId: requestId,
        metadata: {
          operationType: request.operationType,
          decision: dto.decision,
          executionBlocked: true,
        },
      },
    );
    return {
      ...updated,
      executionBlocked: true,
      fallbackMessage:
        'Approval decision recorded. Execution remains blocked until the executable workflow is separately implemented and approved.',
    };
  }

  async hasPermission(
    user: InternalAdminUser,
    permission: InternalPermissionKey,
    organizationId?: string | null,
  ) {
    try {
      const effective = await this.effectivePermissions(user);
      if (!effective.permissions.includes(permission)) return false;
      if (!organizationId) return true;
      return (
        effective.scopes.some(
          (scope) =>
            scope.type === InternalScopeType.PLATFORM ||
            scope.organizationId === organizationId ||
            scope.ref === organizationId,
        ) || user.organizationId === organizationId
      );
    } catch {
      return false;
    }
  }

  async assertPermission(
    user: InternalAdminUser,
    permission: InternalPermissionKey,
    organizationId?: string | null,
  ) {
    if (!(await this.hasPermission(user, permission, organizationId))) {
      await this.auditDenied(user, undefined, 'permission_denied', {
        permission,
        organizationId: organizationId ?? null,
      });
      throw new ForbiddenException(`Permission required: ${permission}`);
    }
  }

  async effectivePermissions(
    user: InternalAdminUser,
  ): Promise<EffectivePermissionResult> {
    return this.effectivePermissionsForUser(this.actorId(user), user);
  }

  private async effectivePermissionsForUser(
    targetUserId: string,
    requestUser?: InternalAdminUser,
  ): Promise<EffectivePermissionResult> {
    const now = new Date();
    const user =
      requestUser && this.actorId(requestUser) === targetUserId
        ? requestUser
        : await this.prisma.user.findUnique({
            where: { id: targetUserId },
            select: {
              id: true,
              role: true,
              organizationId: true,
              accountStatus: true,
            },
          });
    if (!user) throw new NotFoundException('Administrator not found');
    if (user.accountStatus === AccountStatus.SUSPENDED) {
      return this.emptyEffective(targetUserId, user.role);
    }

    const rolePermissions = this.permissionsForRole(user.role);
    const assignments = await this.prisma.internalRoleAssignment.findMany({
      where: {
        userId: targetUserId,
        status: InternalRoleAssignmentStatus.ACTIVE,
        startsAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
    const assignmentPermissions = assignments.flatMap((assignment) =>
      this.permissionArray(assignment.permissionsSnapshot),
    );
    return {
      userId: targetUserId,
      role: user.role,
      permissions: [...new Set([...rolePermissions, ...assignmentPermissions])],
      scopes: [
        ...(rolePermissions.length
          ? [
              {
                type: InternalScopeType.PLATFORM,
                ref: null,
                organizationId: user.organizationId ?? null,
                moduleKey: null,
                jurisdiction: null,
              },
            ]
          : []),
        ...assignments.map((assignment) => ({
          type: assignment.scopeType,
          ref: assignment.scopeRef,
          organizationId: assignment.organizationId,
          moduleKey: assignment.moduleKey,
          jurisdiction: this.objectRecord(assignment.jurisdiction),
        })),
      ],
      mfa: this.mfaReadiness(),
    };
  }

  private permissionsForRole(role: UserRole | undefined) {
    if (!role) return [];
    if (role === UserRole.SUPER_ADMIN) return internalAdminPermissionKeys;
    const definition = resolveInternalRoleDefinition(role);
    if (!definition || !roleDefinitionEnabled(definition)) return [];
    return definition.permissions;
  }

  private async assertNotFinalActiveSuperAdmin(targetUserId: string) {
    const activeSuperAdmins = await this.prisma.user.count({
      where: {
        id: { not: targetUserId },
        accountStatus: AccountStatus.ACTIVE,
        role: { in: [UserRole.SUPER_ADMIN, UserRole.PLATFORM_SUPER_ADMIN] },
      },
    });
    if (activeSuperAdmins < 1) {
      throw new ForbiddenException(
        'Cannot remove the final active platform super administrator.',
      );
    }
  }

  private assertGrantCeiling(
    user: InternalAdminUser,
    requested: InternalPermissionKey[],
  ) {
    if (
      user.role === UserRole.SUPER_ADMIN ||
      user.role === UserRole.PLATFORM_SUPER_ADMIN
    ) {
      return;
    }
    const own = new Set(this.permissionsForRole(user.role));
    const outside = requested.filter((permission) => !own.has(permission));
    if (outside.length) {
      throw new ForbiddenException(
        'Cannot grant permissions outside your effective authority.',
      );
    }
  }

  private requireEnabledRole(role: UserRole) {
    const definition = resolveInternalRoleDefinition(role);
    if (!definition)
      throw new BadRequestException('Invalid internal administrator role.');
    if (!roleDefinitionEnabled(definition)) {
      throw new ForbiddenException({
        code: 'INTERNAL_ROLE_FEATURE_DISABLED',
        role,
        message:
          'This internal role is blocked because its enterprise foundation is disabled.',
      });
    }
    return definition;
  }

  private parseInternalRole(raw: unknown) {
    const role = this.requiredText(raw, 'role').toUpperCase() as UserRole;
    if (!resolveInternalRoleDefinition(role)) {
      throw new BadRequestException('Invalid internal administrator role.');
    }
    return role;
  }

  private parseOperationType(raw: unknown) {
    const value = this.requiredText(
      raw,
      'operationType',
    ).toUpperCase() as PrivilegedOperationType;
    if (!Object.values(PrivilegedOperationType).includes(value)) {
      throw new BadRequestException('Invalid privileged operation type.');
    }
    return value;
  }

  private resolveScope(
    dto: {
      scopeType?: string;
      scopeRef?: string;
      organizationId?: string;
      moduleKey?: string;
    },
    fallback: InternalScopeType,
    user: InternalAdminUser,
  ): InternalScope {
    const type = dto.scopeType
      ? (dto.scopeType.trim().toUpperCase() as InternalScopeType)
      : fallback;
    if (!Object.values(InternalScopeType).includes(type)) {
      throw new BadRequestException('Invalid internal admin scope type.');
    }
    const organizationId = this.normalizeText(dto.organizationId);
    if (
      user.organizationId &&
      organizationId &&
      organizationId !== user.organizationId
    ) {
      throw new ForbiddenException(
        'Cannot widen scope outside actor organization.',
      );
    }
    return {
      type,
      ref: this.normalizeText(dto.scopeRef),
      organizationId: organizationId ?? user.organizationId ?? null,
      moduleKey: this.normalizeText(dto.moduleKey),
      jurisdiction: null,
    };
  }

  private scopeFromMetadata(metadata: Record<string, unknown>): InternalScope {
    const raw =
      metadata.scope && typeof metadata.scope === 'object'
        ? (metadata.scope as Record<string, unknown>)
        : {};
    const type = Object.values(InternalScopeType).includes(
      raw.type as InternalScopeType,
    )
      ? (raw.type as InternalScopeType)
      : InternalScopeType.PLATFORM;
    return {
      type,
      ref: this.normalizeText(raw.ref),
      organizationId: this.normalizeText(raw.organizationId),
      moduleKey: this.normalizeText(raw.moduleKey),
      jurisdiction: this.objectRecord(raw.jurisdiction),
    };
  }

  private internalRoleValues() {
    return [
      UserRole.SUPER_ADMIN,
      ...internalRoleDefinitionsEnabledForThisRelease().map(
        (item) => item.role,
      ),
    ];
  }

  private emptyEffective(
    userId: string,
    role: UserRole | undefined,
  ): EffectivePermissionResult {
    return {
      userId,
      role,
      permissions: [],
      scopes: [],
      mfa: this.mfaReadiness(),
    };
  }

  private safeAdmin(user: {
    id: string;
    fullName: string;
    email: string | null;
    role: UserRole;
    accountStatus: AccountStatus;
    organizationId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      accountStatus: user.accountStatus,
      organizationId: user.organizationId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private safeInvitation(invitation: {
    id: string;
    email: string | null;
    fullName: string;
    role: UserRole;
    status: InvitationStatus;
    organizationId: string | null;
    expiresAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: invitation.id,
      email: invitation.email,
      fullName: invitation.fullName,
      role: invitation.role,
      status: invitation.status,
      organizationId: invitation.organizationId,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      mfa: this.mfaReadiness(),
      localization: {
        key: 'internal_admin.invitation_pending',
        fallbackLocale: 'en',
        fallbackMessage: 'Internal administrator invitation is pending.',
      },
    };
  }

  private adminSelect() {
    return {
      id: true,
      fullName: true,
      email: true,
      role: true,
      accountStatus: true,
      organizationId: true,
      createdAt: true,
      updatedAt: true,
    };
  }

  private async auditDenied(
    user: InternalAdminUser,
    context: RequestContext | undefined,
    reason: string,
    metadata: Record<string, unknown>,
  ) {
    await this.audit('Internal Admin Privilege Denied', user, context, {
      entityType: 'InternalAdmin',
      metadata: { reason, ...metadata },
    });
  }

  private async audit(
    action: string,
    user: InternalAdminUser,
    context: RequestContext | undefined,
    payload: {
      entityType?: string;
      entityId?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    await this.prisma.complianceAuditLog.create({
      data: {
        actorId: this.actorId(user),
        actorRole: user.role as UserRole,
        organizationId: user.organizationId ?? null,
        action,
        entityType: payload.entityType,
        entityId: payload.entityId,
        metadata: this.safeJson({
          ...(payload.metadata ?? {}),
          ipAddress: context?.ipAddress ?? null,
          userAgent: context?.userAgent ?? null,
        }),
      },
    });
  }

  private async notifyActor(
    user: InternalAdminUser,
    key: string,
    params: Record<string, unknown>,
  ) {
    await this.prisma.notification.create({
      data: {
        userId: this.actorId(user),
        type: key,
        title: 'Internal administration',
        message: 'Internal administration event recorded.',
      },
    });
    return {
      key,
      params,
      preferredLocale: user.preferredLocale ?? 'en',
      fallbackLocale: 'en',
    };
  }

  private mfaReadiness() {
    return {
      required: true,
      enforced: false,
      state: 'blocked_until_mfa_foundation' as const,
      fallbackMessage:
        'MFA is required for privileged administration, but enforcement is blocked until the MFA foundation is enabled.',
    };
  }

  private permissionArray(raw: Prisma.JsonValue): InternalPermissionKey[] {
    return Array.isArray(raw)
      ? raw.filter((item): item is InternalPermissionKey =>
          internalAdminPermissionKeys.includes(item as InternalPermissionKey),
        )
      : [];
  }

  private actorId(user: InternalAdminUser) {
    const actorId = user.id ?? user.userId ?? user.sub;
    if (!actorId) throw new ForbiddenException('Actor missing.');
    return actorId;
  }

  private normalizeText(raw: unknown) {
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  }

  private requiredText(raw: unknown, field: string) {
    const value = this.normalizeText(raw);
    if (!value) throw new BadRequestException(`${field} is required.`);
    return value;
  }

  private normalizeEmail(raw: unknown) {
    const email = this.requiredText(raw, 'email').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Enter a valid email address.');
    }
    return email;
  }

  private optionalDate(raw: unknown) {
    const value = this.normalizeText(raw);
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date.');
    }
    return date;
  }

  private defaultExpiry() {
    return new Date(Date.now() + 7 * 24 * 60 * 60_000);
  }

  private inviteCode() {
    return createHash('sha256')
      .update(randomBytes(32))
      .digest('hex')
      .slice(0, 24);
  }

  private objectRecord(raw: unknown): Record<string, unknown> {
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  }

  private safeJson(
    value: Record<string, unknown> | unknown[],
  ): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private safeNullableJson(
    value: Record<string, unknown> | null | undefined,
  ): Prisma.InputJsonValue | undefined {
    return value ? this.safeJson(value) : undefined;
  }
}
