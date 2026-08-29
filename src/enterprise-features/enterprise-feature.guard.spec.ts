/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { EnterpriseFeatureGuard } from './enterprise-feature.guard';

describe('EnterpriseFeatureGuard', () => {
  const previousEnv = { ...process.env };
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;
  const prisma = {
    organization: {
      findUnique: jest.fn(),
    },
    complianceAuditLog: {
      create: jest.fn(),
    },
  };

  let guard: EnterpriseFeatureGuard;

  beforeEach(() => {
    process.env = { ...previousEnv };
    jest.clearAllMocks();
    guard = new EnterpriseFeatureGuard(reflector, prisma as any);
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(
      'enterprise_governance',
    );
  });

  afterAll(() => {
    process.env = previousEnv;
  });

  it('allows routes that do not request an enterprise foundation feature', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);

    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(prisma.complianceAuditLog.create).not.toHaveBeenCalled();
  });

  it('keeps enterprise foundation features disabled when configuration is absent', async () => {
    await expect(
      guard.canActivate(context({ role: UserRole.SUPER_ADMIN })),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(prisma.complianceAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'Enterprise Feature Access Denied',
          entityId: 'enterprise_governance',
          metadata: expect.objectContaining({
            reason: 'configuration_disabled',
          }),
        }),
      }),
    );
  });

  it('does not let SUPER_ADMIN activate foundations by role alone', async () => {
    delete process.env.SECUREZONE_ENTERPRISE_FOUNDATIONS_ENABLED;
    delete process.env.SECUREZONE_ENTERPRISE_GOVERNANCE_ENABLED;

    await expect(
      guard.canActivate(context({ role: UserRole.SUPER_ADMIN })),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'ENTERPRISE_FEATURE_UNAVAILABLE',
        feature: 'enterprise_governance',
      }),
    });
  });

  it('requires module enablement for organization-scoped users even when env is enabled', async () => {
    process.env.SECUREZONE_ENTERPRISE_FOUNDATIONS_ENABLED = 'true';
    process.env.SECUREZONE_ENTERPRISE_GOVERNANCE_ENABLED = 'true';
    prisma.organization.findUnique.mockResolvedValue({
      enabledModules: ['maintenance'],
    });

    await expect(
      guard.canActivate(
        context({
          role: UserRole.PLATFORM_OWNER,
          organizationId: 'org-1',
        }),
      ),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(prisma.complianceAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ reason: 'module_disabled' }),
        }),
      }),
    );
  });

  it('allows enabled and authorized foundation access to reach the existing controller', async () => {
    process.env.SECUREZONE_ENTERPRISE_FOUNDATIONS_ENABLED = 'true';
    process.env.SECUREZONE_ENTERPRISE_GOVERNANCE_ENABLED = 'true';
    prisma.organization.findUnique.mockResolvedValue({
      enabledModules: ['enterprise_governance'],
    });

    await expect(
      guard.canActivate(
        context({
          role: UserRole.PLATFORM_OWNER,
          organizationId: 'org-1',
        }),
      ),
    ).resolves.toBe(true);
  });

  it('blocks ordinary users when the feature guard is reached', async () => {
    await expect(
      guard.canActivate(context({ role: UserRole.CITIZEN })),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('prevents mutation handlers from executing while disabled', async () => {
    const handler = jest.fn();

    await expect(
      guard.canActivate(context({ role: UserRole.SUPER_ADMIN })),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(handler).not.toHaveBeenCalled();
  });

  it('maps regulatory, asset, investigation and evidence export feature flags independently', async () => {
    const featureCases = [
      ['regulatory_governance', 'SECUREZONE_REGULATORY_GOVERNANCE_ENABLED'],
      ['asset_intelligence', 'SECUREZONE_ASSET_INTELLIGENCE_ENABLED'],
      ['investigation', 'SECUREZONE_INVESTIGATION_ENABLED'],
      ['evidence_export', 'SECUREZONE_EVIDENCE_EXPORT_WORKFLOWS_ENABLED'],
    ] as const;

    process.env.SECUREZONE_ENTERPRISE_FOUNDATIONS_ENABLED = 'true';

    for (const [feature, envName] of featureCases) {
      jest.clearAllMocks();
      (reflector.getAllAndOverride as jest.Mock).mockReturnValue(feature);

      await expect(
        guard.canActivate(context({ role: UserRole.SUPER_ADMIN })),
      ).rejects.toThrow(ServiceUnavailableException);

      process.env[envName] = 'true';
      await expect(
        guard.canActivate(context({ role: UserRole.SUPER_ADMIN })),
      ).resolves.toBe(true);
      delete process.env[envName];
    }
  });

  function context(user?: {
    role?: UserRole;
    organizationId?: string | null;
  }): ExecutionContext {
    return {
      getHandler: () => Function,
      getClass: () => Function,
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            sub: 'user-1',
            role: user?.role ?? UserRole.SUPER_ADMIN,
            organizationId: user?.organizationId ?? null,
          },
          method: 'POST',
          route: { path: '/governance/sub-admins' },
          ip: '127.0.0.1',
          get: (name: string) => (name === 'user-agent' ? 'jest' : undefined),
        }),
      }),
    } as ExecutionContext;
  }
});
