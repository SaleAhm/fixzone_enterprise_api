import { UnauthorizedException } from '@nestjs/common';
import { AccountStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

type JwtUserRecord = {
  id: string;
  secureZoneId: string | null;
  email: string | null;
  phone: string | null;
  firebaseUid: string | null;
  fullName: string | null;
  role: UserRole;
  organizationId: string | null;
  providerId: string | null;
  accountStatus: unknown;
  phoneVerifiedAt: Date | null;
  emailVerifiedAt: Date | null;
  providerEngagementType: string | null;
  serviceCategories: string[];
  coverageAreas: string[];
  profileData: Record<string, unknown> | null;
  subscriptionPlan: string | null;
  identityVerificationStatus: string;
  identityVerificationLevel: number;
  trustScore: number;
  identityType: string;
  createdAt: Date;
  organization: null;
};

function user(overrides: Partial<JwtUserRecord> = {}): JwtUserRecord {
  return {
    id: 'user-1',
    secureZoneId: 'SZ-1',
    email: 'jwt-user@example.test',
    phone: null,
    firebaseUid: null,
    fullName: 'JWT User',
    role: UserRole.CITIZEN,
    organizationId: null,
    providerId: null,
    accountStatus: AccountStatus.ACTIVE,
    phoneVerifiedAt: null,
    emailVerifiedAt: null,
    providerEngagementType: null,
    serviceCategories: [],
    coverageAreas: [],
    profileData: null,
    subscriptionPlan: null,
    identityVerificationStatus: 'UNVERIFIED',
    identityVerificationLevel: 0,
    trustScore: 0,
    identityType: 'INDIVIDUAL',
    createdAt: new Date('2026-09-03T00:00:00.000Z'),
    organization: null,
    ...overrides,
  };
}

function createStrategy(findUnique: jest.Mock) {
  return new JwtStrategy({
    user: { findUnique },
  } as unknown as PrismaService);
}

describe('JwtStrategy current account eligibility', () => {
  const payload = {
    sub: 'user-1',
    role: UserRole.CITIZEN,
  };

  it.each([
    UserRole.CITIZEN,
    UserRole.PROVIDER,
    UserRole.ORG_ADMIN,
    UserRole.PLATFORM_SUPER_ADMIN,
  ])('authenticates active %s accounts', async (role) => {
    const strategy = createStrategy(
      jest
        .fn()
        .mockResolvedValue(user({ role, accountStatus: AccountStatus.ACTIVE })),
    );

    const principal = await strategy.validate({ ...payload, role });

    expect(principal).toMatchObject({
      id: 'user-1',
      sub: 'user-1',
      role,
      accountStatus: AccountStatus.ACTIVE,
    });
  });

  it.each([
    AccountStatus.PENDING_INVITE,
    AccountStatus.PENDING_APPROVAL,
    AccountStatus.SUSPENDED,
    AccountStatus.DEACTIVATED,
  ])('rejects currently ineligible %s accounts', async (accountStatus) => {
    const strategy = createStrategy(
      jest.fn().mockResolvedValue(user({ accountStatus })),
    );

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(strategy.validate(payload)).rejects.toMatchObject({
      response: {
        message: 'Unauthorized',
      },
    });
  });

  it('rejects missing/deleted users with the same generic response', async () => {
    const strategy = createStrategy(jest.fn().mockResolvedValue(null));

    await expect(strategy.validate(payload)).rejects.toMatchObject({
      response: {
        message: 'Unauthorized',
      },
    });
  });

  it.each([null, 'LOCKED', 'active', undefined])(
    'fails closed for malformed account status %p',
    async (accountStatus) => {
      const strategy = createStrategy(
        jest.fn().mockResolvedValue(user({ accountStatus })),
      );

      await expect(strategy.validate(payload)).rejects.toMatchObject({
        response: {
          message: 'Unauthorized',
        },
      });
    },
  );

  it('allows the same user after authoritative reactivation to ACTIVE', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(user({ accountStatus: AccountStatus.SUSPENDED }))
      .mockResolvedValueOnce(user({ accountStatus: AccountStatus.ACTIVE }));
    const strategy = createStrategy(findUnique);

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(strategy.validate(payload)).resolves.toMatchObject({
      accountStatus: AccountStatus.ACTIVE,
    });
  });
});
