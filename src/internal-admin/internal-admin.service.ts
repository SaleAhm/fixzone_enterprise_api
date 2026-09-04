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
import {
  InternalAdminPaginationQueryDto,
  InternalInvitationQueueQueryDto,
  PrivilegedApprovalQueueQueryDto,
} from './dto/internal-admin-queue-query.dto';

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

  async listInvitations(
    query: InternalInvitationQueueQueryDto,
    user: InternalAdminUser,
    context?: RequestContext,
  ) {
    await this.assertPermission(user, 'internal_admin.read', null, context);
    const effective = await this.effectivePermissions(user);
    const scopeWhere = await this.invitationScopeWhere(
      effective,
      user,
      context,
    );
    if (this.requestedInvitationScopeOutsideAccess(query, effective, user)) {
      await this.auditDenied(user, context, 'invitation_scope_filter_denied', {
        requestedScopeType: query.scopeType ?? null,
        requestedOrganizationId: query.organizationId ?? null,
      });
    }
    const pagination = this.pagination(query);
    const where: Prisma.InvitationWhereInput = {
      role: { in: this.internalRoleValues() },
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.inviterId ? { invitedById: query.inviterId } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...this.createdAtWhere(query),
      ...this.invitationExpiryWhere(query),
      ...this.andWhere<Prisma.InvitationWhereInput>([
        scopeWhere,
        query.organizationId
          ? { organizationId: query.organizationId }
          : undefined,
        this.invitationMetadataScopeWhere(query),
      ]),
    };
    const orderBy = this.invitationOrderBy(query);
    const [total, items] = await Promise.all([
      this.prisma.invitation.count({ where }),
      this.prisma.invitation.findMany({
        where,
        select: this.invitationQueueSelect(),
        orderBy,
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
    ]);
    return this.pageEnvelope(
      items.map((item) => this.safeInvitationQueueItem(item)),
      pagination.page,
      pagination.pageSize,
      total,
    );
  }

  async invitationDetail(
    invitationId: string,
    user: InternalAdminUser,
    context?: RequestContext,
  ) {
    await this.assertPermission(user, 'internal_admin.read', null, context);
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
      select: this.invitationQueueSelect(),
    });
    if (!invitation || !this.isInternalInvitation(invitation.role)) {
      throw new NotFoundException('Invitation not found');
    }
    const effective = await this.effectivePermissions(user);
    if (
      !this.canViewOrganizationScope(effective, user, invitation.organizationId)
    ) {
      await this.auditDenied(user, context, 'invitation_scope_bypass_denied', {
        invitationId,
        organizationId: invitation.organizationId,
      });
      throw new NotFoundException('Invitation not found');
    }
    return this.safeInvitationQueueItem(invitation, true);
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
    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        tokenVersion: { increment: 1 },
        profileData: this.safeJson({
          ...this.objectRecord(target.profileData),
          sessionRevocation: {
            requestedAt: revokedAt,
            reason: dto.reason ?? null,
            enforcement: 'token_version_advanced',
          },
        }),
      },
      select: { tokenVersion: true },
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
          enforcement: 'token_version_advanced',
          tokenVersion: updated.tokenVersion,
        },
      },
    );
    return {
      targetUserId,
      revokedAt,
      enforced: true,
      state: 'token_version_advanced',
      tokenVersion: updated.tokenVersion,
      message: 'All previously issued FixZone sessions are revoked.',
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

  async listPrivilegedApprovals(
    query: PrivilegedApprovalQueueQueryDto,
    user: InternalAdminUser,
    context?: RequestContext,
  ) {
    const effective = await this.effectivePermissions(user);
    const readableOperations = this.readableApprovalOperations(user, effective);
    if (!readableOperations.length) {
      await this.auditDenied(user, context, 'approval_queue_read_denied', {
        requestedOperationType: query.operationType ?? null,
      });
      throw new ForbiddenException('Approval queue visibility denied.');
    }
    const pagination = this.pagination(query);
    const where: Prisma.PrivilegedApprovalRequestWhereInput = {
      operationType: { in: readableOperations },
      ...(query.status ? { status: query.status } : {}),
      ...(query.operationType ? { operationType: query.operationType } : {}),
      ...(query.requesterId ? { requesterId: query.requesterId } : {}),
      ...(query.targetUserId ? { targetUserId: query.targetUserId } : {}),
      ...(query.search
        ? {
            OR: [
              { reason: { contains: query.search, mode: 'insensitive' } },
              { requesterId: { contains: query.search, mode: 'insensitive' } },
              { targetUserId: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...this.approvalDateWhere(query),
      ...this.approvalExpiryWhere(),
      ...this.andWhere<Prisma.PrivilegedApprovalRequestWhereInput>([
        this.approvalScopeWhere(effective, user),
        query.organizationId
          ? { organizationId: query.organizationId }
          : undefined,
      ]),
    };
    if (query.canDecide === 'true' || query.attention === 'true') {
      where.status = PrivilegedApprovalStatus.PENDING;
      where.requesterId = { not: this.actorId(user) };
    } else if (query.canDecide === 'false') {
      where.OR = [
        ...(Array.isArray(where.OR) ? where.OR : []),
        { requesterId: this.actorId(user) },
        { status: { not: PrivilegedApprovalStatus.PENDING } },
      ];
    }

    const orderBy = this.approvalOrderBy(query);
    const [total, items] = await Promise.all([
      this.prisma.privilegedApprovalRequest.count({ where }),
      this.prisma.privilegedApprovalRequest.findMany({
        where,
        select: this.approvalQueueSelect(),
        orderBy,
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
    ]);
    return this.pageEnvelope(
      items.map((item) => this.safeApprovalQueueItem(item, user, effective)),
      pagination.page,
      pagination.pageSize,
      total,
    );
  }

  async privilegedApprovalDetail(
    approvalId: string,
    user: InternalAdminUser,
    context?: RequestContext,
  ) {
    const effective = await this.effectivePermissions(user);
    const readableOperations = this.readableApprovalOperations(user, effective);
    if (!readableOperations.length) {
      await this.auditDenied(user, context, 'approval_detail_read_denied', {
        approvalId,
      });
      throw new ForbiddenException('Approval detail visibility denied.');
    }
    const request = await this.prisma.privilegedApprovalRequest.findUnique({
      where: { id: approvalId },
      select: this.approvalQueueSelect(),
    });
    if (
      !request ||
      !readableOperations.includes(request.operationType) ||
      !this.canViewOrganizationScope(effective, user, request.organizationId)
    ) {
      await this.auditDenied(user, context, 'approval_detail_scope_denied', {
        approvalId,
      });
      throw new NotFoundException('Approval request not found');
    }
    return this.safeApprovalQueueItem(request, user, effective, true);
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
    context?: RequestContext,
  ) {
    if (!(await this.hasPermission(user, permission, organizationId))) {
      await this.auditDenied(user, context, 'permission_denied', {
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

  private invitationQueueSelect() {
    return {
      id: true,
      email: true,
      fullName: true,
      role: true,
      status: true,
      organizationId: true,
      invitedById: true,
      acceptedUserId: true,
      metadata: true,
      expiresAt: true,
      acceptedAt: true,
      declinedAt: true,
      revokedAt: true,
      createdAt: true,
      updatedAt: true,
      invitedBy: {
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
        },
      },
    } as const;
  }

  private safeInvitationQueueItem(
    invitation: {
      id: string;
      email: string | null;
      fullName: string;
      role: UserRole;
      status: InvitationStatus;
      organizationId: string | null;
      invitedById: string;
      acceptedUserId: string | null;
      metadata: Prisma.JsonValue | null;
      expiresAt: Date | null;
      acceptedAt: Date | null;
      declinedAt: Date | null;
      revokedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      invitedBy: {
        id: string;
        fullName: string;
        email: string | null;
        role: UserRole;
      };
    },
    detail = false,
  ) {
    const metadata = this.objectRecord(invitation.metadata);
    const scope = this.scopeFromMetadata(metadata);
    const derived = this.deriveInvitationState(invitation);
    return {
      id: invitation.id,
      fullName: invitation.fullName,
      email: this.maskEmail(invitation.email),
      recipientEmail: this.maskEmail(invitation.email),
      role: invitation.role,
      status: derived.status,
      storedStatus: invitation.status,
      availability: derived.availability,
      reasonCode: derived.reasonCode,
      scope,
      organizationId: invitation.organizationId,
      inviter: this.safeActor(invitation.invitedBy),
      invitedById: invitation.invitedById,
      acceptedUserId: detail ? invitation.acceptedUserId : undefined,
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      declinedAt: invitation.declinedAt,
      revokedAt: invitation.revokedAt,
      mfa: this.mfaReadiness(),
      localization: this.safeLocalization(metadata),
    };
  }

  private approvalQueueSelect() {
    return {
      id: true,
      operationType: true,
      status: true,
      requesterId: true,
      approverId: true,
      targetUserId: true,
      organizationId: true,
      requestedRole: true,
      requestedScope: true,
      payload: true,
      reason: true,
      decisionReason: true,
      requestedAt: true,
      decidedAt: true,
      executionBlocked: true,
      createdAt: true,
      updatedAt: true,
      requester: {
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
        },
      },
      approver: {
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
        },
      },
    } as const;
  }

  private safeApprovalQueueItem(
    request: {
      id: string;
      operationType: PrivilegedOperationType;
      status: PrivilegedApprovalStatus;
      requesterId: string;
      approverId: string | null;
      targetUserId: string | null;
      organizationId: string | null;
      requestedRole: UserRole | null;
      requestedScope: Prisma.JsonValue | null;
      payload: Prisma.JsonValue | null;
      reason: string | null;
      decisionReason: string | null;
      requestedAt: Date;
      decidedAt: Date | null;
      executionBlocked: boolean;
      createdAt: Date;
      updatedAt: Date;
      requester: {
        id: string;
        fullName: string;
        email: string | null;
        role: UserRole;
      };
      approver: {
        id: string;
        fullName: string;
        email: string | null;
        role: UserRole;
      } | null;
    },
    user: InternalAdminUser,
    effective: EffectivePermissionResult,
    detail = false,
  ) {
    const eligibility = this.approvalDecisionEligibility(
      request,
      user,
      effective,
    );
    return {
      id: request.id,
      operationType: request.operationType,
      requester: this.safeActor(request.requester),
      requesterId: request.requesterId,
      targetUserId: request.targetUserId,
      organizationId: request.organizationId,
      requestedRole: request.requestedRole,
      requestedScope: this.safeRequestedScope(request.requestedScope),
      reason: this.sanitizeReason(request.reason),
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      requestedAt: request.requestedAt,
      decidedAt: request.decidedAt,
      approver: request.approver ? this.safeActor(request.approver) : null,
      approverId: request.approverId,
      decisionReason: detail
        ? this.sanitizeReason(request.decisionReason)
        : undefined,
      canDecide: eligibility.canDecide,
      decisionProhibitedReason: eligibility.reasonCode,
      selfApprovalConflict: request.requesterId === this.actorId(user),
      requiredApprovalCount: 1,
      currentApprovalCount: request.approverId ? 1 : 0,
      executionBlocked: request.executionBlocked,
      executionState: this.executionState(request),
      fallbackMessage: this.safeBlockedReason(request.payload),
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

  private pagination(query: InternalAdminPaginationQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    return { page, pageSize, skip: (page - 1) * pageSize };
  }

  private pageEnvelope<T>(
    items: T[],
    page: number,
    pageSize: number,
    total: number,
  ) {
    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  private createdAtWhere(query: InternalAdminPaginationQueryDto) {
    if (!query.createdFrom && !query.createdTo) return {};
    return {
      createdAt: {
        ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
        ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
      },
    };
  }

  private approvalDateWhere(query: InternalAdminPaginationQueryDto) {
    if (!query.createdFrom && !query.createdTo) return {};
    return {
      requestedAt: {
        ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
        ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
      },
    };
  }

  private invitationExpiryWhere(query: InternalAdminPaginationQueryDto) {
    const now = new Date();
    if (query.expiryState === 'expired') {
      return { expiresAt: { not: null, lte: now } };
    }
    if (query.expiryState === 'active') {
      return { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
    }
    return {};
  }

  private approvalExpiryWhere() {
    return {};
  }

  private invitationMetadataScopeWhere(query: InternalInvitationQueueQueryDto) {
    const filters: Prisma.InvitationWhereInput[] = [];
    if (query.scopeType) {
      filters.push({
        metadata: { path: ['scope', 'type'], equals: query.scopeType },
      });
    }
    if (query.moduleKey) {
      filters.push({
        metadata: { path: ['scope', 'moduleKey'], equals: query.moduleKey },
      });
    }
    return filters.length ? { AND: filters } : {};
  }

  private andWhere<T extends { AND?: T | T[] }>(
    clauses: (T | undefined)[],
  ): { AND: T[] } | Record<string, never> {
    const present = clauses.flatMap((clause) => {
      if (!clause || Object.keys(clause as object).length === 0) return [];
      const keys = Object.keys(clause as object);
      if (keys.length === 1 && clause.AND) {
        return Array.isArray(clause.AND) ? clause.AND : [clause.AND];
      }
      return [clause];
    });
    return present.length ? { AND: present } : {};
  }

  private invitationOrderBy(
    query: InternalAdminPaginationQueryDto,
  ): Prisma.InvitationOrderByWithRelationInput[] {
    const direction = query.sortDirection ?? 'desc';
    if (query.sortBy === 'expiresAt') {
      return [{ expiresAt: direction }, { id: direction }];
    }
    if (query.sortBy === 'status') {
      return [{ status: direction }, { createdAt: 'desc' }];
    }
    if (query.sortBy === 'role') {
      return [{ role: direction }, { createdAt: 'desc' }];
    }
    return [{ createdAt: direction }, { id: direction }];
  }

  private approvalOrderBy(
    query: InternalAdminPaginationQueryDto,
  ): Prisma.PrivilegedApprovalRequestOrderByWithRelationInput[] {
    const direction = query.sortDirection ?? 'desc';
    if (query.sortBy === 'status') {
      return [{ status: direction }, { requestedAt: 'desc' }];
    }
    if (query.sortBy === 'operationType') {
      return [{ operationType: direction }, { requestedAt: 'desc' }];
    }
    return [{ requestedAt: direction }, { id: direction }];
  }

  private async invitationScopeWhere(
    effective: EffectivePermissionResult,
    user: InternalAdminUser,
    context?: RequestContext,
  ): Promise<Prisma.InvitationWhereInput> {
    if (this.canUsePlatformQueueScope(effective, user)) return {};
    const organizationIds = this.organizationScopeIds(effective, user);
    if (!organizationIds.length) {
      await this.auditDenied(user, context, 'invitation_visibility_denied', {
        reason: 'no_authorized_scope',
      });
      throw new ForbiddenException('Invitation visibility denied.');
    }
    return { organizationId: { in: organizationIds } };
  }

  private approvalScopeWhere(
    effective: EffectivePermissionResult,
    user: InternalAdminUser,
  ): Prisma.PrivilegedApprovalRequestWhereInput {
    if (this.canUsePlatformQueueScope(effective, user)) return {};
    const organizationIds = this.organizationScopeIds(effective, user);
    return organizationIds.length
      ? { organizationId: { in: organizationIds } }
      : { organizationId: '__no_authorized_scope__' };
  }

  private canViewOrganizationScope(
    effective: EffectivePermissionResult,
    user: InternalAdminUser,
    organizationId: string | null,
  ) {
    if (this.canUsePlatformQueueScope(effective, user)) return true;
    if (!organizationId) return false;
    return effective.scopes.some(
      (scope) =>
        scope.organizationId === organizationId || scope.ref === organizationId,
    );
  }

  private hasPlatformScope(effective: EffectivePermissionResult) {
    return effective.scopes.some(
      (scope) => scope.type === InternalScopeType.PLATFORM,
    );
  }

  private canUsePlatformQueueScope(
    effective: EffectivePermissionResult,
    user: InternalAdminUser,
  ) {
    if (
      user.role === UserRole.SUPER_ADMIN ||
      user.role === UserRole.PLATFORM_SUPER_ADMIN
    ) {
      return true;
    }
    const hasOrganizationConstraint =
      Boolean(user.organizationId) &&
      effective.scopes.some(
        (scope) =>
          scope.type === InternalScopeType.ORGANIZATION &&
          Boolean(scope.organizationId ?? scope.ref),
      );
    return this.hasPlatformScope(effective) && !hasOrganizationConstraint;
  }

  private requestedInvitationScopeOutsideAccess(
    query: InternalInvitationQueueQueryDto,
    effective: EffectivePermissionResult,
    user: InternalAdminUser,
  ) {
    if (this.canUsePlatformQueueScope(effective, user)) return false;
    if (query.scopeType === InternalScopeType.PLATFORM) return true;
    if (!query.organizationId) return false;
    return !this.organizationScopeIds(effective, user).includes(
      query.organizationId,
    );
  }

  private organizationScopeIds(
    effective: EffectivePermissionResult,
    user: InternalAdminUser,
  ) {
    return [
      ...new Set(
        [
          user.organizationId ?? null,
          ...effective.scopes.map((scope) => scope.organizationId ?? scope.ref),
        ].filter((item): item is string => Boolean(item)),
      ),
    ];
  }

  private readableApprovalOperations(
    user: InternalAdminUser,
    effective: EffectivePermissionResult,
  ) {
    if (
      user.role === UserRole.SUPER_ADMIN ||
      user.role === UserRole.PLATFORM_SUPER_ADMIN ||
      effective.permissions.includes('internal_admin.view_audit')
    ) {
      return Object.values(PrivilegedOperationType);
    }
    return Object.values(PrivilegedOperationType).filter((operationType) =>
      effective.permissions.includes(
        highRiskOperationPermissions[operationType],
      ),
    );
  }

  private approvalDecisionEligibility(
    request: {
      operationType: PrivilegedOperationType;
      status: PrivilegedApprovalStatus;
      requesterId: string;
    },
    user: InternalAdminUser,
    effective: EffectivePermissionResult,
  ) {
    if (request.status !== PrivilegedApprovalStatus.PENDING) {
      return { canDecide: false, reasonCode: 'not_pending' };
    }
    if (request.requesterId === this.actorId(user)) {
      return { canDecide: false, reasonCode: 'self_approval_denied' };
    }
    const required = highRiskOperationPermissions[request.operationType];
    if (!effective.permissions.includes(required)) {
      return { canDecide: false, reasonCode: 'permission_denied' };
    }
    return { canDecide: true, reasonCode: null };
  }

  private executionState(request: {
    status: PrivilegedApprovalStatus;
    executionBlocked: boolean;
  }) {
    if (request.status === PrivilegedApprovalStatus.PENDING) return 'PENDING';
    if (
      request.status === PrivilegedApprovalStatus.REJECTED ||
      request.status === PrivilegedApprovalStatus.CANCELLED
    ) {
      return 'NOT_APPLICABLE';
    }
    if (request.executionBlocked) return 'BLOCKED';
    return 'BLOCKED';
  }

  private safeActor(actor: {
    id: string;
    fullName: string;
    email: string | null;
    role: UserRole;
  }) {
    return {
      id: actor.id,
      fullName: actor.fullName,
      email: this.maskEmail(actor.email),
      role: actor.role,
    };
  }

  private deriveInvitationState(invitation: {
    status: InvitationStatus;
    expiresAt: Date | null;
    acceptedAt: Date | null;
    revokedAt: Date | null;
    declinedAt: Date | null;
  }) {
    const expired =
      invitation.status === InvitationStatus.PENDING &&
      invitation.expiresAt !== null &&
      invitation.expiresAt.getTime() <= Date.now();
    if (expired) {
      return {
        status: InvitationStatus.EXPIRED,
        availability: 'unavailable',
        reasonCode: 'expired',
      };
    }
    if (invitation.status !== InvitationStatus.PENDING) {
      return {
        status: invitation.status,
        availability: 'unavailable',
        reasonCode: invitation.status.toLowerCase(),
      };
    }
    return {
      status: invitation.status,
      availability: 'available',
      reasonCode: 'pending',
    };
  }

  private isInternalInvitation(role: UserRole) {
    return this.internalRoleValues().includes(role);
  }

  private safeRequestedScope(raw: Prisma.JsonValue | null) {
    const scope = this.objectRecord(raw);
    return {
      organizationId: this.normalizeText(scope.organizationId),
      moduleKey: this.normalizeText(scope.moduleKey),
      scopeRef: this.normalizeText(scope.scopeRef ?? scope.ref),
      scopeType: this.normalizeText(scope.scopeType ?? scope.type),
    };
  }

  private safeBlockedReason(raw: Prisma.JsonValue | null) {
    const payload = this.objectRecord(raw);
    const reason = this.normalizeText(payload.blockedReason);
    return reason ?? 'Execution remains blocked until explicitly implemented.';
  }

  private safeLocalization(metadata: Record<string, unknown>) {
    const localization = this.objectRecord(metadata.localization);
    return {
      key: this.normalizeText(localization.key),
      fallbackLocale: this.normalizeText(localization.fallbackLocale) ?? 'en',
      fallbackMessage: this.normalizeText(localization.fallbackMessage),
    };
  }

  private sanitizeReason(value: string | null) {
    if (!value) return null;
    return [...value]
      .map((char) => {
        const code = char.charCodeAt(0);
        return code < 32 || code === 127 ? ' ' : char;
      })
      .join('')
      .slice(0, 500)
      .trim();
  }

  private maskEmail(value: string | null) {
    if (!value) return null;
    const [local, domain] = value.split('@');
    if (!local || !domain) return 'hidden';
    const prefix = local.slice(0, Math.min(2, local.length));
    return `${prefix}${'*'.repeat(Math.max(2, local.length - prefix.length))}@${domain}`;
  }
}
