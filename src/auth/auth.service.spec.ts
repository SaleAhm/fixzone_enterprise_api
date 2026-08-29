import { UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { TrustService } from '../trust/trust.service';

type PrismaAuthMock = {
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  demoAuditLog: {
    create: jest.Mock;
  };
};

type UserUpdateArgs = {
  data: {
    profileData?: unknown;
  };
};

function prismaMock(prisma: PrismaAuthMock): PrismaService {
  return prisma as unknown as PrismaService;
}

describe('AuthService localization preferences', () => {
  const authUser = {
    id: 'user-1',
    fullName: 'Citizen User',
    role: UserRole.CITIZEN,
    organizationId: 'org-1',
  };

  function createService(prisma: PrismaAuthMock) {
    return new AuthService(
      { signAsync: jest.fn() },
      prismaMock(prisma),
      {} as TrustService,
    );
  }

  it('stores supported locale preferences in existing profileData', async () => {
    const prisma: PrismaAuthMock = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ profileData: { address: 'Old address' } }),
        update: jest.fn(({ data }: UserUpdateArgs) =>
          Promise.resolve({
            ...authUser,
            email: 'citizen@example.test',
            phone: '+2348000000001',
            firebaseUid: null,
            secureZoneId: 'SZ-1',
            providerId: null,
            accountStatus: 'ACTIVE',
            providerEngagementType: null,
            serviceCategories: null,
            coverageAreas: null,
            profileData: data.profileData,
            subscriptionPlan: null,
            identityVerificationStatus: 'UNVERIFIED',
            identityVerificationLevel: 0,
            trustScore: 0,
            identityType: 'INDIVIDUAL',
            organization: null,
          }),
        ),
      },
      demoAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };

    const result = await createService(prisma).updateMe(authUser, {
      preferredLocale: 'ar-EG',
    });

    expect(result.profileData).toMatchObject({
      address: 'Old address',
      preferredLanguage: 'ar',
    });
    expect(result.preferredLocale).toBe('ar');
  });

  it('rejects unsupported locale preferences with a stable code', async () => {
    const prisma: PrismaAuthMock = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      demoAuditLog: { create: jest.fn() },
    };

    await expect(
      createService(prisma).updateMe(authUser, { preferredLocale: 'de' }),
    ).rejects.toMatchObject({
      response: {
        code: 'UNSUPPORTED_LOCALE',
      },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
