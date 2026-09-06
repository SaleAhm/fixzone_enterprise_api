import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus, UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { PrivilegedMfaService } from './privileged-mfa.service';
import { PrismaService } from '../prisma/prisma.service';
import { TrustService } from '../trust/trust.service';
import { FirebaseAuthVerifierService } from './firebase-auth-verifier.service';

function user(role: UserRole, overrides: Record<string, unknown> = {}) {
  return {
    id: `${role.toLowerCase()}-user`,
    email: `${role.toLowerCase()}@example.test`,
    phone: null,
    fullName: role,
    role,
    organizationId: role === UserRole.ORG_ADMIN ? 'org-1' : null,
    providerId: role === UserRole.PROVIDER ? 'PROV-1' : null,
    accountStatus: AccountStatus.ACTIVE,
    tokenVersion: 4,
    passwordHash: '',
    phoneVerifiedAt: null,
    emailVerifiedAt: null,
    secureZoneId: 'SZ-1',
    ...overrides,
  };
}

async function createService(loginUser: ReturnType<typeof user>) {
  const passwordHash = await bcrypt.hash('Password123', 4);
  const storedUser = { ...loginUser, passwordHash };
  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue(storedUser),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    demoAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const jwtService = {
    signAsync: jest.fn().mockResolvedValue('full-jwt'),
  };
  const trustService = {
    ensureIdentity: jest.fn((id: string) =>
      Promise.resolve({
        id,
        secureZoneId: 'SZ-1',
        identityVerificationStatus: 'EMAIL_VERIFIED',
        identityVerificationLevel: 1,
        trustScore: 0,
        identityType: 'GOVERNMENT_REPRESENTATIVE',
      }),
    ),
    recordLogin: jest.fn().mockResolvedValue({}),
  };
  const mfaService = {
    createPreAuthSession: jest.fn().mockResolvedValue({
      status: 'MFA_CHALLENGE_REQUIRED',
      mfaRequired: true,
      preAuthToken: 'pre-auth-token',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    }),
  };
  const service = new AuthService(
    jwtService as unknown as JwtService,
    prisma as unknown as PrismaService,
    trustService as unknown as TrustService,
    { verifyIdToken: jest.fn() } as unknown as FirebaseAuthVerifierService,
    undefined,
    mfaService as unknown as PrivilegedMfaService,
  );
  return { service, prisma, jwtService, trustService, mfaService };
}

describe('AuthService privileged MFA login gating', () => {
  it('does not issue a normal JWT for SUPER_ADMIN password success', async () => {
    const { service, jwtService, trustService, mfaService } =
      await createService(user(UserRole.SUPER_ADMIN));

    const result = await service.login({
      email: 'SUPER_ADMIN@example.test',
      password: 'Password123',
    });

    expect(result).toMatchObject({
      status: 'MFA_CHALLENGE_REQUIRED',
      mfaRequired: true,
      preAuthToken: 'pre-auth-token',
    });
    expect(jwtService.signAsync).not.toHaveBeenCalled();
    expect(mfaService.createPreAuthSession).toHaveBeenCalled();
    expect(trustService.recordLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        failureReason: 'mfa_pending',
      }),
    );
  });

  it.each([
    UserRole.PLATFORM_SUPER_ADMIN,
    UserRole.PLATFORM_OWNER,
    UserRole.EXECUTIVE_SUPER_ADMIN,
    UserRole.TECHNICAL_ADMIN,
    UserRole.OPERATIONS_ADMIN,
    UserRole.ORGANIZATION_ONBOARDING_ADMIN,
    UserRole.PROVIDER_ADMIN,
    UserRole.FINANCE_BILLING_ADMIN,
    UserRole.BILLING_ADMIN,
    UserRole.LEGAL_ADMIN,
    UserRole.ASSIGNMENT_ADMIN,
    UserRole.ASSET_ADMIN,
    UserRole.ASSET_INTELLIGENCE_ADMIN,
    UserRole.COMPLIANCE_ADMIN,
    UserRole.COMPLIANCE_AUDIT_ADMIN,
    UserRole.REGULATORY_ADMIN,
    UserRole.SECURITY_ADMIN,
    UserRole.INVESTIGATION_ADMIN,
    UserRole.RELEASE_OPERATIONS_ADMIN,
    UserRole.BACKUP_RECOVERY_ADMIN,
    UserRole.SUPPORT_ADMIN,
  ])('requires pre-auth MFA for internal role %s', async (role) => {
    const { service, jwtService, mfaService } = await createService(user(role));

    await service.login({
      email: `${role}@example.test`,
      password: 'Password123',
    });

    expect(jwtService.signAsync).not.toHaveBeenCalled();
    expect(mfaService.createPreAuthSession).toHaveBeenCalled();
  });

  it('preserves existing ORG_ADMIN login behaviour in this tranche', async () => {
    const { service, jwtService, mfaService } = await createService(
      user(UserRole.ORG_ADMIN),
    );

    const result = await service.login({
      email: 'org_admin@example.test',
      password: 'Password123',
    });

    expect(result).toHaveProperty('accessToken', 'full-jwt');
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ role: UserRole.ORG_ADMIN, tokenVersion: 4 }),
      expect.any(Object),
    );
    expect(mfaService.createPreAuthSession).not.toHaveBeenCalled();
  });

  it.each([UserRole.PROVIDER, UserRole.CITIZEN])(
    'does not change %s password login behaviour',
    async (role) => {
      const { service, jwtService, mfaService } = await createService(
        user(role),
      );

      const result = await service.login({
        email: `${role}@example.test`,
        password: 'Password123',
        ...(role === UserRole.PROVIDER ? { providerId: 'PROV-1' } : {}),
      });

      expect(result).toHaveProperty('accessToken', 'full-jwt');
      expect(jwtService.signAsync).toHaveBeenCalled();
      expect(mfaService.createPreAuthSession).not.toHaveBeenCalled();
    },
  );

  it('denies inactive privileged accounts before creating pre-auth state', async () => {
    const { service, jwtService, mfaService } = await createService(
      user(UserRole.SUPER_ADMIN, { accountStatus: AccountStatus.SUSPENDED }),
    );

    await expect(
      service.login({ email: 'admin@example.test', password: 'Password123' }),
    ).rejects.toThrow('Authentication failed');
    expect(jwtService.signAsync).not.toHaveBeenCalled();
    expect(mfaService.createPreAuthSession).not.toHaveBeenCalled();
  });
});
