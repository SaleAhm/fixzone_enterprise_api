/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { InternalScopeType, UserRole } from '@prisma/client';
import {
  internalRoleDefinitionsEnabledForThisRelease,
  resolveInternalRoleDefinition,
} from './internal-role-catalog';

describe('internal role catalog', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SECUREZONE_ENTERPRISE_FOUNDATIONS_ENABLED;
    delete process.env.SECUREZONE_ASSET_INTELLIGENCE_ENABLED;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses predefined internal roles and stable permission keys', () => {
    const finance = resolveInternalRoleDefinition(
      UserRole.FINANCE_BILLING_ADMIN,
    );

    expect(finance).toEqual(
      expect.objectContaining({
        role: UserRole.FINANCE_BILLING_ADMIN,
        defaultScopeType: InternalScopeType.PLATFORM,
        permissions: expect.arrayContaining([
          'payment.transaction_read',
          'payment.reconciliation_manage',
          'payment.refund_request',
        ]),
      }),
    );
  });

  it('keeps disabled enterprise foundation roles unavailable by default', () => {
    const roles = internalRoleDefinitionsEnabledForThisRelease();
    const asset = roles.find(
      (role) => role.role === UserRole.ASSET_INTELLIGENCE_ADMIN,
    );

    expect(asset?.enabled).toBe(false);
  });
});
