import {
  AccountStatus,
  InternalScopeType,
  PrivilegedApprovalStatus,
  PrivilegedOperationType,
  UserRole,
} from '@prisma/client';
import {
  allowEnvName,
  fixtureBatch,
  fixtureDomain,
  fixtureEmail,
  fixtureManifest,
  fixturePrefix,
  fixtureUsers,
  isFixturePayload,
  passwordEnvName,
  validateFixturePassword,
  validateLocalFixtureGuard,
} from '../../scripts/internal-admin-uat-fixtures';

describe('internal admin UAT fixture pack', () => {
  const localDatabaseUrl =
    'postgresql://localhost:5432/fixzone_enterprise?schema=public';
  const localFixturePassword = 'x'.repeat(16);

  function guardEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
      DATABASE_URL: localDatabaseUrl,
      [allowEnvName]: 'true',
      [passwordEnvName]: localFixturePassword,
      ...overrides,
    };
  }

  it('refuses production, non-local and unconfirmed environments', () => {
    expect(() =>
      validateLocalFixtureGuard({ env: guardEnv({ NODE_ENV: 'production' }) }),
    ).toThrow('NODE_ENV=production');
    expect(() =>
      validateLocalFixtureGuard({
        env: guardEnv({ [allowEnvName]: undefined }),
      }),
    ).toThrow(allowEnvName);
    expect(() =>
      validateLocalFixtureGuard({
        env: guardEnv({
          DATABASE_URL: 'postgresql://db.fixzone.ng:5432/fixzone_enterprise',
        }),
      }),
    ).toThrow('non-local database host');
    expect(() =>
      validateLocalFixtureGuard({
        env: guardEnv({
          DATABASE_URL: 'postgresql://localhost:5433/fixzone_enterprise',
        }),
      }),
    ).toThrow('port');
    expect(() =>
      validateLocalFixtureGuard({
        env: guardEnv({
          DATABASE_URL: 'postgresql://localhost:5432/postgres',
        }),
      }),
    ).toThrow('fixzone_enterprise');
    expect(() =>
      validateLocalFixtureGuard({
        env: guardEnv({ FRONTEND_URL: 'https://fixzone.ng' }),
      }),
    ).toThrow('production-like FRONTEND_URL');
  });

  it('accepts and sanitizes the exact local database identity', () => {
    expect(validateLocalFixtureGuard({ env: guardEnv() })).toEqual({
      host: 'localhost',
      port: '5432',
      database: 'fixzone_enterprise',
      schema: 'public',
      batch: fixtureBatch,
      confirmation: true,
    });
    expect(() =>
      validateLocalFixtureGuard({
        env: guardEnv(),
        batch: 'unapproved-batch',
      }),
    ).toThrow('approved prefix');
  });

  it('requires a local password without exposing the value in the manifest', () => {
    expect(() =>
      validateFixturePassword(guardEnv({ [passwordEnvName]: 'short' })),
    ).toThrow(passwordEnvName);
    expect(validateFixturePassword(guardEnv())).toBe(localFixturePassword);

    const serializedManifest = JSON.stringify(fixtureManifest());
    expect(serializedManifest).toContain(passwordEnvName);
    expect(serializedManifest).not.toContain(localFixturePassword);
  });

  it('defines the required local-only identities and stable namespace', () => {
    const manifest = fixtureManifest();
    expect(fixtureUsers).toHaveLength(9);
    expect(manifest.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'platform-super-admin',
          role: UserRole.PLATFORM_SUPER_ADMIN,
          status: AccountStatus.ACTIVE,
        }),
        expect.objectContaining({
          label: 'finance-billing-admin',
          role: UserRole.FINANCE_BILLING_ADMIN,
        }),
        expect.objectContaining({
          label: 'ordinary-org-admin',
          role: UserRole.ORG_ADMIN,
          organizationScoped: true,
        }),
        expect.objectContaining({
          label: 'suspended-internal-admin',
          status: AccountStatus.SUSPENDED,
        }),
      ]),
    );
    expect(fixtureEmail('platform-super-admin')).toBe(
      `${fixturePrefix}platform-super-admin@${fixtureDomain}`,
    );
    expect(() => fixtureEmail('unknown')).toThrow('Unknown fixture user label');
  });

  it('defines deterministic assignment, invitation and approval scenarios', () => {
    const manifest = fixtureManifest();
    expect(manifest.expectedCounts).toMatchObject({
      organizations: 1,
      users: 9,
      assignments: 7,
      invitations: 4,
      approvals: 6,
      suspendedUsers: 1,
      expiredAssignments: 1,
      organizationScopedAssignments: 1,
    });
    const financeAssignment = manifest.assignments.find(
      (assignment) => assignment.label === 'finance-visibility',
    );
    expect(financeAssignment).toMatchObject({
      userLabel: 'finance-billing-admin',
    });
    expect(financeAssignment?.permissions).toEqual(
      expect.arrayContaining([
        'payment.configuration_manage',
        'payment.refund_approve',
      ]),
    );
    expect(manifest.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'organization-reader',
          scopeType: InternalScopeType.ORGANIZATION,
          organizationScoped: true,
        }),
        expect.objectContaining({
          label: 'expired-reader',
          expired: true,
        }),
      ]),
    );
    expect(manifest.invitations.map((item) => item.state).sort()).toEqual([
      'ACCEPTED',
      'EXPIRED_BY_TIME',
      'PENDING',
      'REVOKED',
    ]);
    expect(manifest.approvals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'pending-payment-configuration',
          operationType: PrivilegedOperationType.PAYMENT_CONFIGURATION_CHANGE,
          requesterLabel: 'finance-billing-admin',
          status: PrivilegedApprovalStatus.PENDING,
        }),
        expect.objectContaining({
          label: 'pending-high-value-refund',
          operationType: PrivilegedOperationType.HIGH_VALUE_REFUND_APPROVAL,
          requesterLabel: 'finance-billing-admin',
        }),
        expect.objectContaining({
          label: 'self-approval-prohibited',
          requesterLabel: 'privileged-requester',
          targetLabel: 'privileged-requester',
        }),
        expect.objectContaining({
          label: 'approved-execution-blocked',
          status: PrivilegedApprovalStatus.APPROVED,
          executionBlocked: true,
        }),
      ]),
    );
    for (const approval of manifest.approvals) {
      if (approval.approverLabel) {
        expect(approval.approverLabel).not.toBe(approval.requesterLabel);
      }
    }
  });

  it('isolates cleanup targets to fixture-owned approval payloads', () => {
    expect(isFixturePayload({ fixtureBatch, fixtureLabel: 'approval' })).toBe(
      true,
    );
    expect(isFixturePayload({ fixtureBatch: 'other-batch' })).toBe(false);
    expect(isFixturePayload(null)).toBe(false);
    expect(isFixturePayload(['not', 'an', 'object'])).toBe(false);
  });
});
