import { BadRequestException } from '@nestjs/common';
import { AccountStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { OnboardingService } from './onboarding.service';

const organizationDto = {
  organizationName: 'Public Org',
  organizationClass: 'GOVERNMENT' as const,
  country: 'Nigeria',
  state: 'Lagos',
  contactEmail: 'contact@example.test',
  contactPhone: '+2348000000000',
  ownerFullName: 'Owner User',
  ownerEmail: 'owner@example.test',
  ownerPhone: '+2348000000001',
  password: 'Password123!',
  confirmPassword: 'Password123!',
};

type PublicOrgAuditCreateArgs = {
  data?: {
    action?: string;
    actorUserId?: string;
    metadata?: {
      reason?: string;
      hasOwnerEmail?: boolean;
      hasOwnerPhone?: boolean;
    };
  };
};

type PublicOrgPrismaMock = {
  organization: {
    findFirst: jest.Mock<unknown, []>;
    create: jest.Mock<unknown, []>;
  };
  user: {
    findFirst: jest.Mock<unknown, []>;
    create: jest.Mock<unknown, []>;
  };
  providerOrganization: {
    create: jest.Mock<unknown, []>;
  };
  userEntitlement: {
    create: jest.Mock<unknown, []>;
  };
  demoAuditLog: {
    create: jest.Mock<
      Promise<Record<string, never>>,
      [PublicOrgAuditCreateArgs]
    >;
  };
  $transaction: jest.Mock<unknown, []>;
};

type ProviderCreateArgs = {
  data: Record<string, unknown>;
};

type ProviderAccessPrismaMock = {
  user: {
    findFirst: jest.Mock<Promise<null>, []>;
    create: jest.Mock<Promise<Record<string, unknown>>, [ProviderCreateArgs]>;
  };
  invitation: {
    findUnique: jest.Mock<
      Promise<{
        organizationId: string;
        status: string;
        role: UserRole;
      }>,
      []
    >;
  };
};

describe('OnboardingService public organization gate', () => {
  const originalFlag = process.env.ENABLE_PUBLIC_ORGANIZATION_REGISTRATION;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.ENABLE_PUBLIC_ORGANIZATION_REGISTRATION;
    } else {
      process.env.ENABLE_PUBLIC_ORGANIZATION_REGISTRATION = originalFlag;
    }
  });

  it.each([undefined, '', 'false', 'TRUE', '1'])(
    'denies public organization registration by default/invalid flag %p without partial records',
    async (flag) => {
      if (flag === undefined) {
        delete process.env.ENABLE_PUBLIC_ORGANIZATION_REGISTRATION;
      } else {
        process.env.ENABLE_PUBLIC_ORGANIZATION_REGISTRATION = flag;
      }
      const prisma: PublicOrgPrismaMock = {
        organization: {
          findFirst: jest.fn<unknown, []>(),
          create: jest.fn<unknown, []>(),
        },
        user: {
          findFirst: jest.fn<unknown, []>(),
          create: jest.fn<unknown, []>(),
        },
        providerOrganization: { create: jest.fn<unknown, []>() },
        userEntitlement: { create: jest.fn<unknown, []>() },
        demoAuditLog: {
          create: jest.fn<
            Promise<Record<string, never>>,
            [PublicOrgAuditCreateArgs]
          >(() => Promise.resolve({})),
        },
        $transaction: jest.fn<unknown, []>(),
      };
      const service = new OnboardingService(
        prisma as unknown as PrismaService,
        {} as AuthService,
      );

      await expect(
        service.registerOrganization(organizationDto),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.organization.create).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.providerOrganization.create).not.toHaveBeenCalled();
      expect(prisma.userEntitlement.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      const auditArg = prisma.demoAuditLog.create.mock.calls[0][0];
      expect(auditArg.data?.action).toBe(
        'Public Organization Registration Denied',
      );
      expect(auditArg.data?.actorUserId).toBe('anonymous');
      expect(auditArg.data?.metadata?.reason).toBe(
        'public_org_registration_disabled',
      );
      expect(auditArg.data?.metadata?.hasOwnerEmail).toBe(true);
      expect(auditArg.data?.metadata?.hasOwnerPhone).toBe(true);
    },
  );

  it('keeps invitation-based provider access requests functional', async () => {
    const prisma: ProviderAccessPrismaMock = {
      user: {
        findFirst: jest.fn<Promise<null>, []>(() => Promise.resolve(null)),
        create: jest.fn<Promise<Record<string, unknown>>, [ProviderCreateArgs]>(
          ({ data }) =>
            Promise.resolve({
              id: 'provider-request-1',
              ...data,
              createdAt: new Date('2026-09-04T00:00:00.000Z'),
            }),
        ),
      },
      invitation: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            organizationId: 'org-1',
            status: 'PENDING',
            role: UserRole.PROVIDER,
          }),
        ),
      },
    };
    const service = new OnboardingService(
      prisma as unknown as PrismaService,
      {} as AuthService,
    );

    const result = await service.requestProviderAccess({
      applicantType: 'INDIVIDUAL',
      fullName: 'Provider User',
      email: 'provider@example.test',
      phone: '+2348000000002',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      address: '1 Test Street',
      coverageArea: 'Ikeja',
      serviceCategories: ['Roads'],
      yearsOfExperience: 4,
      organizationInviteCode: 'INV-123',
    });

    expect(result.request).toMatchObject({
      role: UserRole.PENDING_PROVIDER,
      accountStatus: AccountStatus.PENDING_APPROVAL,
      organizationId: 'org-1',
    });
    expect(prisma.user.create).toHaveBeenCalled();
  });
});
