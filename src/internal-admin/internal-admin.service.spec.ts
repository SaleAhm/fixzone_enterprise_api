/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import {
  AccountStatus,
  InternalRoleAssignmentStatus,
  InternalScopeType,
  InvitationStatus,
  PaymentEnvironment,
  PaymentProvider,
  PrivilegedApprovalStatus,
  PrivilegedOperationType,
  UserRole,
} from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { InternalAdminService } from './internal-admin.service';

describe('InternalAdminService', () => {
  const superAdmin = {
    sub: 'super-1',
    role: UserRole.SUPER_ADMIN,
    accountStatus: AccountStatus.ACTIVE,
    preferredLocale: 'en',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('invites a predefined internal administrator using the Invitation foundation', async () => {
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.invitation.findFirst.mockResolvedValue(null);
    prisma.invitation.create.mockResolvedValue({
      id: 'invite-1',
      email: 'finance@example.test',
      fullName: 'Finance Admin',
      role: UserRole.FINANCE_BILLING_ADMIN,
      status: InvitationStatus.PENDING,
      organizationId: null,
      expiresAt: new Date('2026-09-01T00:00:00Z'),
      createdAt: new Date('2026-08-29T00:00:00Z'),
    });

    const service = new InternalAdminService(prisma as never);
    const result = await service.inviteAdministrator(
      {
        email: 'Finance@Example.Test',
        fullName: 'Finance Admin',
        role: UserRole.FINANCE_BILLING_ADMIN,
        reason: 'billing segregation',
      },
      superAdmin,
    );

    expect(result.email).toBe('finance@example.test');
    expect(prisma.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: UserRole.FINANCE_BILLING_ADMIN,
          status: InvitationStatus.PENDING,
          metadata: expect.objectContaining({
            localization: expect.objectContaining({
              key: 'internal_admin.invitation_created',
              fallbackLocale: 'en',
            }),
            mfa: expect.objectContaining({
              enforced: false,
              state: 'blocked_until_mfa_foundation',
            }),
          }),
        }),
      }),
    );
    expect(prisma.complianceAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'Internal Admin Invitation Created',
        }),
      }),
    );
  });

  it('calculates effective permissions from active assignments and denies expired assignments', async () => {
    const prisma = mockPrisma();
    prisma.internalRoleAssignment.findMany.mockResolvedValue([
      {
        scopeType: InternalScopeType.PLATFORM,
        scopeRef: null,
        organizationId: null,
        moduleKey: null,
        jurisdiction: null,
        permissionsSnapshot: ['payment.transaction_read'],
      },
    ]);

    const service = new InternalAdminService(prisma as never);
    const effective = await service.effectivePermissions({
      sub: 'finance-1',
      role: UserRole.SUPPORT_ADMIN,
      accountStatus: AccountStatus.ACTIVE,
    });

    expect(effective.permissions).toEqual(
      expect.arrayContaining([
        'support.account_assistance',
        'payment.transaction_read',
      ]),
    );
    expect(prisma.internalRoleAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: InternalRoleAssignmentStatus.ACTIVE,
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        }),
      }),
    );
  });

  it('denies unrelated organization administrators by default', async () => {
    const prisma = mockPrisma();
    const service = new InternalAdminService(prisma as never);

    await expect(
      service.assertPermission(
        {
          sub: 'org-admin-1',
          role: UserRole.ORG_ADMIN,
          organizationId: 'org-1',
          accountStatus: AccountStatus.ACTIVE,
        },
        'internal_admin.read',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('blocks self-promotion and audits the denied attempt', async () => {
    const prisma = mockPrisma();
    const service = new InternalAdminService(prisma as never);

    await expect(
      service.assignRole(
        'super-1',
        { role: UserRole.FINANCE_BILLING_ADMIN },
        superAdmin,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.complianceAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'Internal Admin Privilege Denied',
          metadata: expect.objectContaining({
            reason: 'self_promotion_denied',
          }),
        }),
      }),
    );
  });

  it('protects the final active platform super administrator', async () => {
    const prisma = mockPrisma();
    prisma.user.count.mockResolvedValue(0);
    const service = new InternalAdminService(prisma as never);

    await expect(
      service.suspendAdministrator(
        'target-super',
        { reason: 'test' },
        superAdmin,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('advances tokenVersion when revoking all sessions', async () => {
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'security-target',
      profileData: {},
    });
    prisma.user.update.mockResolvedValue({ tokenVersion: 4 });
    const service = new InternalAdminService(prisma as never);

    const result = await service.revokeSessions(
      'security-target',
      { reason: 'credential concern' },
      {
        sub: 'security-1',
        role: UserRole.SECURITY_ADMIN,
        accountStatus: AccountStatus.ACTIVE,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        enforced: true,
        state: 'token_version_advanced',
        tokenVersion: 4,
      }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tokenVersion: { increment: 1 } }),
      }),
    );
  });

  it('blocks self-approval for privileged approval requests', async () => {
    const prisma = mockPrisma();
    prisma.privilegedApprovalRequest.findUnique.mockResolvedValue({
      id: 'approval-1',
      requesterId: 'super-1',
      operationType: PrivilegedOperationType.PAYMENT_CONFIGURATION_CHANGE,
    });
    const service = new InternalAdminService(prisma as never);

    await expect(
      service.decideApprovalRequest(
        'approval-1',
        { decision: 'APPROVE' },
        superAdmin,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('keeps platform-super-admin grants in a pending dual-approval contract', async () => {
    const prisma = mockPrisma();
    prisma.privilegedApprovalRequest.create.mockResolvedValue({
      id: 'approval-2',
      operationType: PrivilegedOperationType.PLATFORM_SUPER_ADMIN_GRANT,
      status: PrivilegedApprovalStatus.PENDING,
      requesterId: 'super-1',
      executionBlocked: true,
    });
    const service = new InternalAdminService(prisma as never);

    const result = await service.assignRole(
      'target-1',
      { role: UserRole.PLATFORM_SUPER_ADMIN },
      superAdmin,
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: PrivilegedApprovalStatus.PENDING,
        executionBlocked: true,
      }),
    );
    expect(prisma.internalRoleAssignment.create).not.toHaveBeenCalled();
  });

  it('blocks disabled enterprise role grants', async () => {
    const prisma = mockPrisma();
    const service = new InternalAdminService(prisma as never);

    await expect(
      service.assignRole(
        'target-1',
        { role: UserRole.ASSET_INTELLIGENCE_ADMIN },
        superAdmin,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('requires explicit finance permissions for reconciliation', async () => {
    const prisma = mockPrisma();
    const service = new InternalAdminService(prisma as never);

    await expect(
      service.assertPermission(
        {
          sub: 'finance-1',
          role: UserRole.FINANCE_BILLING_ADMIN,
          accountStatus: AccountStatus.ACTIVE,
        },
        'payment.reconciliation_manage',
      ),
    ).resolves.toBeUndefined();
  });

  it('separates refund request from refund approval', async () => {
    const prisma = mockPrisma();
    const service = new InternalAdminService(prisma as never);

    await expect(
      service.assertPermission(
        {
          sub: 'finance-1',
          role: UserRole.FINANCE_BILLING_ADMIN,
          accountStatus: AccountStatus.ACTIVE,
        },
        'payment.refund_approve',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lists internal invitations with pagination and omits token material', async () => {
    const prisma = mockPrisma();
    prisma.invitation.count.mockResolvedValue(1);
    prisma.invitation.findMany.mockResolvedValue([
      {
        id: 'invite-queue-1',
        email: 'delegate@example.test',
        fullName: 'Delegate Admin',
        role: UserRole.SUPPORT_ADMIN,
        status: InvitationStatus.PENDING,
        organizationId: null,
        invitedById: 'super-1',
        acceptedUserId: null,
        metadata: {
          source: 'internal_admin_delegation',
          scope: { type: InternalScopeType.PLATFORM },
          localization: { key: 'internal_admin.invitation_pending' },
        },
        expiresAt: new Date(Date.now() + 60_000),
        acceptedAt: null,
        declinedAt: null,
        revokedAt: null,
        createdAt: new Date('2026-08-29T12:00:00Z'),
        updatedAt: new Date('2026-08-29T12:00:00Z'),
        invitedBy: {
          id: 'super-1',
          fullName: 'Super Admin',
          email: 'owner@example.test',
          role: UserRole.SUPER_ADMIN,
        },
      },
    ]);

    const service = new InternalAdminService(prisma as never);
    const result = await service.listInvitations(
      { page: 1, pageSize: 10, status: InvitationStatus.PENDING },
      superAdmin,
    );

    expect(result).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });
    expect(result.items[0]).toMatchObject({
      id: 'invite-queue-1',
      email: 'de******@example.test',
      status: InvitationStatus.PENDING,
      availability: 'available',
      reasonCode: 'pending',
    });
    expect(JSON.stringify(result)).not.toContain('inviteCode');
    expect(JSON.stringify(result)).not.toContain('tokenHash');
    expect(JSON.stringify(result)).not.toContain('temporaryPasswordHash');
    expect(prisma.invitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 10,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('does not allow organization-scoped internal readers to widen invitation queue filters to platform scope', async () => {
    const prisma = mockPrisma();
    prisma.internalRoleAssignment.findMany.mockResolvedValue([
      {
        scopeType: InternalScopeType.ORGANIZATION,
        scopeRef: 'org-1',
        organizationId: 'org-1',
        moduleKey: null,
        jurisdiction: null,
        permissionsSnapshot: ['internal_admin.read'],
      },
    ]);
    prisma.invitation.count.mockResolvedValue(0);
    prisma.invitation.findMany.mockResolvedValue([]);

    const service = new InternalAdminService(prisma as never);
    const result = await service.listInvitations(
      { page: 1, pageSize: 10, scopeType: InternalScopeType.PLATFORM },
      {
        sub: 'scoped-1',
        role: UserRole.SUPPORT_ADMIN,
        organizationId: 'org-1',
        accountStatus: AccountStatus.ACTIVE,
      },
    );

    expect(result.items).toEqual([]);
    expect(prisma.invitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            { organizationId: { in: ['org-1'] } },
            {
              metadata: {
                path: ['scope', 'type'],
                equals: InternalScopeType.PLATFORM,
              },
            },
          ],
        }),
      }),
    );
    expect(prisma.invitation.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ organizationId: { in: ['org-1'] } }]),
        }),
      }),
    );
    expect(prisma.complianceAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'Internal Admin Privilege Denied',
          metadata: expect.objectContaining({
            reason: 'invitation_scope_filter_denied',
          }),
        }),
      }),
    );
  });

  it('keeps organization-scoped invitation list totals constrained without filters', async () => {
    const prisma = mockPrisma();
    prisma.internalRoleAssignment.findMany.mockResolvedValue([
      {
        scopeType: InternalScopeType.ORGANIZATION,
        scopeRef: 'org-1',
        organizationId: 'org-1',
        moduleKey: null,
        jurisdiction: null,
        permissionsSnapshot: ['internal_admin.read'],
      },
    ]);
    prisma.invitation.count.mockResolvedValue(1);
    prisma.invitation.findMany.mockResolvedValue([
      {
        id: 'invite-org-1',
        email: 'delegate@example.test',
        fullName: 'Delegate Admin',
        role: UserRole.SUPPORT_ADMIN,
        status: InvitationStatus.REVOKED,
        organizationId: 'org-1',
        invitedById: 'super-1',
        acceptedUserId: null,
        metadata: {
          source: 'internal_admin_delegation',
          scope: {
            type: InternalScopeType.ORGANIZATION,
            organizationId: 'org-1',
          },
        },
        expiresAt: null,
        acceptedAt: null,
        declinedAt: null,
        revokedAt: new Date('2026-08-29T12:00:00Z'),
        createdAt: new Date('2026-08-29T12:00:00Z'),
        updatedAt: new Date('2026-08-29T12:00:00Z'),
        invitedBy: {
          id: 'super-1',
          fullName: 'Super Admin',
          email: 'owner@example.test',
          role: UserRole.SUPER_ADMIN,
        },
      },
    ]);

    const service = new InternalAdminService(prisma as never);
    const result = await service.listInvitations(
      { page: 1, pageSize: 10 },
      {
        sub: 'scoped-1',
        role: UserRole.SUPPORT_ADMIN,
        organizationId: 'org-1',
        accountStatus: AccountStatus.ACTIVE,
      },
    );

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('inviteCode');
    expect(JSON.stringify(result)).not.toContain('tokenHash');
    expect(JSON.stringify(result)).not.toContain('temporaryPasswordHash');
    expect(prisma.invitation.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [{ organizationId: { in: ['org-1'] } }],
        }),
      }),
    );
  });

  it('lets organization-scoped internal readers narrow invitations to their organization only', async () => {
    const prisma = mockPrisma();
    prisma.internalRoleAssignment.findMany.mockResolvedValue([
      {
        scopeType: InternalScopeType.ORGANIZATION,
        scopeRef: 'org-1',
        organizationId: 'org-1',
        moduleKey: null,
        jurisdiction: null,
        permissionsSnapshot: ['internal_admin.read'],
      },
    ]);
    prisma.invitation.count.mockResolvedValue(0);
    prisma.invitation.findMany.mockResolvedValue([]);

    const service = new InternalAdminService(prisma as never);
    await service.listInvitations(
      { page: 1, pageSize: 10, organizationId: 'org-1' },
      {
        sub: 'scoped-1',
        role: UserRole.SUPPORT_ADMIN,
        organizationId: 'org-1',
        accountStatus: AccountStatus.ACTIVE,
      },
    );

    expect(prisma.invitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            { organizationId: { in: ['org-1'] } },
            { organizationId: 'org-1' },
          ],
        }),
      }),
    );
    expect(prisma.complianceAuditLog.create).not.toHaveBeenCalled();
  });

  it('does not disclose invitations when organization-scoped readers request another organization', async () => {
    const prisma = mockPrisma();
    prisma.internalRoleAssignment.findMany.mockResolvedValue([
      {
        scopeType: InternalScopeType.ORGANIZATION,
        scopeRef: 'org-1',
        organizationId: 'org-1',
        moduleKey: null,
        jurisdiction: null,
        permissionsSnapshot: ['internal_admin.read'],
      },
    ]);
    prisma.invitation.count.mockResolvedValue(0);
    prisma.invitation.findMany.mockResolvedValue([]);

    const service = new InternalAdminService(prisma as never);
    const result = await service.listInvitations(
      { page: 1, pageSize: 10, organizationId: 'org-2' },
      {
        sub: 'scoped-1',
        role: UserRole.SUPPORT_ADMIN,
        organizationId: 'org-1',
        accountStatus: AccountStatus.ACTIVE,
      },
    );

    expect(result.total).toBe(0);
    expect(prisma.invitation.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            { organizationId: { in: ['org-1'] } },
            { organizationId: 'org-2' },
          ],
        }),
      }),
    );
    expect(prisma.complianceAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'Internal Admin Privilege Denied',
          metadata: expect.objectContaining({
            reason: 'invitation_scope_filter_denied',
          }),
        }),
      }),
    );
  });

  it('preserves platform invitation visibility for platform super administrators', async () => {
    const prisma = mockPrisma();
    prisma.invitation.count.mockResolvedValue(1);
    prisma.invitation.findMany.mockResolvedValue([
      {
        id: 'invite-platform-1',
        email: 'delegate@example.test',
        fullName: 'Delegate Admin',
        role: UserRole.SUPPORT_ADMIN,
        status: InvitationStatus.PENDING,
        organizationId: null,
        invitedById: 'super-1',
        acceptedUserId: null,
        metadata: {
          source: 'internal_admin_delegation',
          scope: { type: InternalScopeType.PLATFORM },
        },
        expiresAt: null,
        acceptedAt: null,
        declinedAt: null,
        revokedAt: null,
        createdAt: new Date('2026-08-29T12:00:00Z'),
        updatedAt: new Date('2026-08-29T12:00:00Z'),
        invitedBy: {
          id: 'super-1',
          fullName: 'Super Admin',
          email: 'owner@example.test',
          role: UserRole.SUPER_ADMIN,
        },
      },
    ]);

    const service = new InternalAdminService(prisma as never);
    const result = await service.listInvitations(
      { page: 1, pageSize: 10, scopeType: InternalScopeType.PLATFORM },
      superAdmin,
    );

    expect(result.total).toBe(1);
    expect(prisma.invitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              metadata: {
                path: ['scope', 'type'],
                equals: InternalScopeType.PLATFORM,
              },
            },
          ],
        }),
      }),
    );
  });

  it('derives expired internal invitation state without mutating records', async () => {
    const prisma = mockPrisma();
    prisma.invitation.findUnique.mockResolvedValue({
      id: 'invite-expired',
      email: 'old@example.test',
      fullName: 'Expired Admin',
      role: UserRole.SUPPORT_ADMIN,
      status: InvitationStatus.PENDING,
      organizationId: null,
      invitedById: 'super-1',
      acceptedUserId: null,
      metadata: {
        source: 'internal_admin_delegation',
        scope: { type: InternalScopeType.PLATFORM },
      },
      expiresAt: new Date('2026-01-01T00:00:00Z'),
      acceptedAt: null,
      declinedAt: null,
      revokedAt: null,
      createdAt: new Date('2025-12-25T00:00:00Z'),
      updatedAt: new Date('2025-12-25T00:00:00Z'),
      invitedBy: {
        id: 'super-1',
        fullName: 'Super Admin',
        email: 'owner@example.test',
        role: UserRole.SUPER_ADMIN,
      },
    });

    const service = new InternalAdminService(prisma as never);
    const detail = await service.invitationDetail('invite-expired', superAdmin);

    expect(detail.status).toBe(InvitationStatus.EXPIRED);
    expect(detail.reasonCode).toBe('expired');
    expect(prisma.invitation.update).not.toHaveBeenCalled();
  });

  it('denies out-of-scope invitation detail and audits the attempt', async () => {
    const prisma = mockPrisma();
    prisma.internalRoleAssignment.findMany.mockResolvedValue([
      {
        scopeType: InternalScopeType.ORGANIZATION,
        scopeRef: 'org-1',
        organizationId: 'org-1',
        moduleKey: null,
        jurisdiction: null,
        permissionsSnapshot: ['internal_admin.read'],
      },
    ]);
    prisma.invitation.findUnique.mockResolvedValue({
      id: 'invite-org-2',
      email: 'other@example.test',
      fullName: 'Other Admin',
      role: UserRole.SUPPORT_ADMIN,
      status: InvitationStatus.PENDING,
      organizationId: 'org-2',
      invitedById: 'super-1',
      acceptedUserId: null,
      metadata: {
        source: 'internal_admin_delegation',
        scope: {
          type: InternalScopeType.ORGANIZATION,
          organizationId: 'org-2',
        },
      },
      expiresAt: null,
      acceptedAt: null,
      declinedAt: null,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      invitedBy: {
        id: 'super-1',
        fullName: 'Super Admin',
        email: 'owner@example.test',
        role: UserRole.SUPER_ADMIN,
      },
    });

    const service = new InternalAdminService(prisma as never);
    await expect(
      service.invitationDetail('invite-org-2', {
        sub: 'scoped-1',
        role: UserRole.CITIZEN,
        organizationId: 'org-1',
        accountStatus: AccountStatus.ACTIVE,
      }),
    ).rejects.toThrow('Invitation not found');
    expect(prisma.complianceAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'Internal Admin Privilege Denied',
          metadata: expect.objectContaining({
            reason: 'invitation_scope_bypass_denied',
          }),
        }),
      }),
    );
  });

  it('lists privileged approvals with finance-limited visibility and blocked execution state', async () => {
    const prisma = mockPrisma();
    prisma.internalRoleAssignment.findMany.mockResolvedValue([
      {
        scopeType: InternalScopeType.PLATFORM,
        scopeRef: null,
        organizationId: null,
        moduleKey: null,
        jurisdiction: null,
        permissionsSnapshot: ['payment.configuration_manage'],
      },
    ]);
    prisma.privilegedApprovalRequest.count.mockResolvedValue(1);
    prisma.privilegedApprovalRequest.findMany.mockResolvedValue([
      {
        id: 'approval-finance-1',
        operationType: PrivilegedOperationType.PAYMENT_CONFIGURATION_CHANGE,
        status: PrivilegedApprovalStatus.PENDING,
        requesterId: 'requester-1',
        approverId: null,
        targetUserId: null,
        organizationId: null,
        requestedRole: null,
        requestedScope: { organizationId: null },
        payload: {
          blockedReason: 'Payment configuration change requires review.',
          paystackSecret: 'must-not-return',
        },
        reason: 'Rotate public metadata',
        decisionReason: null,
        requestedAt: new Date('2026-08-29T12:00:00Z'),
        decidedAt: null,
        executionBlocked: true,
        createdAt: new Date('2026-08-29T12:00:00Z'),
        updatedAt: new Date('2026-08-29T12:00:00Z'),
        requester: {
          id: 'requester-1',
          fullName: 'Requester',
          email: 'requester@example.test',
          role: UserRole.FINANCE_BILLING_ADMIN,
        },
        approver: null,
      },
    ]);

    const service = new InternalAdminService(prisma as never);
    const result = await service.listPrivilegedApprovals(
      {
        operationType: PrivilegedOperationType.PAYMENT_CONFIGURATION_CHANGE,
        canDecide: 'true',
      },
      {
        sub: 'finance-1',
        role: UserRole.FINANCE_BILLING_ADMIN,
        accountStatus: AccountStatus.ACTIVE,
      },
    );

    expect(result.items[0]).toMatchObject({
      id: 'approval-finance-1',
      operationType: PrivilegedOperationType.PAYMENT_CONFIGURATION_CHANGE,
      canDecide: true,
      executionState: 'PENDING',
      fallbackMessage: 'Payment configuration change requires review.',
    });
    expect(JSON.stringify(result)).not.toContain('paystackSecret');
    expect(prisma.privilegedApprovalRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          operationType: PrivilegedOperationType.PAYMENT_CONFIGURATION_CHANGE,
          requesterId: { not: 'finance-1' },
          status: PrivilegedApprovalStatus.PENDING,
        }),
      }),
    );
  });

  it('marks requester self-approval as prohibited in approval detail', async () => {
    const prisma = mockPrisma();
    prisma.internalRoleAssignment.findMany.mockResolvedValue([
      {
        scopeType: InternalScopeType.PLATFORM,
        scopeRef: null,
        organizationId: null,
        moduleKey: null,
        jurisdiction: null,
        permissionsSnapshot: ['payment.configuration_manage'],
      },
    ]);
    prisma.privilegedApprovalRequest.findUnique.mockResolvedValue({
      id: 'approval-self',
      operationType: PrivilegedOperationType.PAYMENT_CONFIGURATION_CHANGE,
      status: PrivilegedApprovalStatus.PENDING,
      requesterId: 'finance-1',
      approverId: null,
      targetUserId: null,
      organizationId: null,
      requestedRole: null,
      requestedScope: {},
      payload: {},
      reason: 'self check',
      decisionReason: null,
      requestedAt: new Date(),
      decidedAt: null,
      executionBlocked: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      requester: {
        id: 'finance-1',
        fullName: 'Finance',
        email: 'finance@example.test',
        role: UserRole.FINANCE_BILLING_ADMIN,
      },
      approver: null,
    });

    const service = new InternalAdminService(prisma as never);
    const detail = await service.privilegedApprovalDetail('approval-self', {
      sub: 'finance-1',
      role: UserRole.FINANCE_BILLING_ADMIN,
      accountStatus: AccountStatus.ACTIVE,
    });

    expect(detail.canDecide).toBe(false);
    expect(detail.selfApprovalConflict).toBe(true);
    expect(detail.decisionProhibitedReason).toBe('self_approval_denied');
  });

  it('does not allow organization-scoped readers to widen approval list scope', async () => {
    const prisma = mockPrisma();
    prisma.internalRoleAssignment.findMany.mockResolvedValue([
      {
        scopeType: InternalScopeType.ORGANIZATION,
        scopeRef: 'org-1',
        organizationId: 'org-1',
        moduleKey: null,
        jurisdiction: null,
        permissionsSnapshot: ['payment.configuration_manage'],
      },
    ]);
    prisma.privilegedApprovalRequest.count.mockResolvedValue(0);
    prisma.privilegedApprovalRequest.findMany.mockResolvedValue([]);

    const service = new InternalAdminService(prisma as never);
    const result = await service.listPrivilegedApprovals(
      { organizationId: 'org-2' },
      {
        sub: 'scoped-1',
        role: UserRole.FINANCE_BILLING_ADMIN,
        organizationId: 'org-1',
        accountStatus: AccountStatus.ACTIVE,
      },
    );

    expect(result.total).toBe(0);
    expect(prisma.privilegedApprovalRequest.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            { organizationId: { in: ['org-1'] } },
            { organizationId: 'org-2' },
          ],
        }),
      }),
    );
  });

  it('denies organization-scoped approval detail outside scope', async () => {
    const prisma = mockPrisma();
    prisma.internalRoleAssignment.findMany.mockResolvedValue([
      {
        scopeType: InternalScopeType.ORGANIZATION,
        scopeRef: 'org-1',
        organizationId: 'org-1',
        moduleKey: null,
        jurisdiction: null,
        permissionsSnapshot: ['payment.configuration_manage'],
      },
    ]);
    prisma.privilegedApprovalRequest.findUnique.mockResolvedValue({
      id: 'approval-org-2',
      operationType: PrivilegedOperationType.PAYMENT_CONFIGURATION_CHANGE,
      status: PrivilegedApprovalStatus.PENDING,
      requesterId: 'requester-1',
      approverId: null,
      targetUserId: null,
      organizationId: 'org-2',
      requestedRole: null,
      requestedScope: { organizationId: 'org-2' },
      payload: {},
      reason: 'outside scope',
      decisionReason: null,
      requestedAt: new Date(),
      decidedAt: null,
      executionBlocked: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      requester: {
        id: 'requester-1',
        fullName: 'Requester',
        email: 'requester@example.test',
        role: UserRole.FINANCE_BILLING_ADMIN,
      },
      approver: null,
    });

    const service = new InternalAdminService(prisma as never);
    await expect(
      service.privilegedApprovalDetail('approval-org-2', {
        sub: 'scoped-1',
        role: UserRole.FINANCE_BILLING_ADMIN,
        organizationId: 'org-1',
        accountStatus: AccountStatus.ACTIVE,
      }),
    ).rejects.toThrow('Approval request not found');
    expect(prisma.complianceAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'Internal Admin Privilege Denied',
          metadata: expect.objectContaining({
            reason: 'approval_detail_scope_denied',
          }),
        }),
      }),
    );
  });

  it('denies suspended internal administrators from queue visibility', async () => {
    const prisma = mockPrisma();
    const service = new InternalAdminService(prisma as never);

    await expect(
      service.listPrivilegedApprovals(
        {},
        {
          sub: 'security-1',
          role: UserRole.SECURITY_ADMIN,
          accountStatus: AccountStatus.SUSPENDED,
        },
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});

function mockPrisma() {
  return {
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({
        id: 'target-1',
        role: UserRole.SUPPORT_ADMIN,
        accountStatus: AccountStatus.ACTIVE,
        organizationId: null,
      }),
      count: jest.fn().mockResolvedValue(1),
      update: jest.fn().mockResolvedValue({
        id: 'target-1',
        fullName: 'Target Admin',
        email: 'target@example.test',
        role: UserRole.SUPPORT_ADMIN,
        accountStatus: AccountStatus.ACTIVE,
        organizationId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
    invitation: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    internalRoleAssignment: {
      create: jest.fn().mockResolvedValue({ id: 'assignment-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({
        id: 'assignment-1',
        userId: 'target-1',
        role: UserRole.SUPPORT_ADMIN,
      }),
      update: jest.fn().mockResolvedValue({ id: 'assignment-1' }),
    },
    privilegedApprovalRequest: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    complianceAuditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    notification: { create: jest.fn().mockResolvedValue({ id: 'note-1' }) },
    paymentTransaction: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'txn-1',
          provider: PaymentProvider.PAYSTACK,
          environment: PaymentEnvironment.TEST,
        },
      ]),
    },
    $transaction: jest.fn((callback: (client: any) => unknown) =>
      callback(mockPrisma()),
    ),
  };
}
