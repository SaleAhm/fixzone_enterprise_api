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

  it('records session revocation as blocked readiness until token versions exist', async () => {
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'security-target',
      profileData: {},
    });
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
        enforced: false,
        state: 'blocked_until_token_version_foundation',
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
