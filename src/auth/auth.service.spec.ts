import { UserRole } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { TrustService } from '../trust/trust.service';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import {
  FirebaseAuthVerifierService,
  VerifiedFirebaseIdentity,
} from './firebase-auth-verifier.service';

type PrismaAuthMock = {
  organization?: {
    findFirst: jest.Mock;
    create: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
    create?: jest.Mock;
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

type MockUserWriteArgs = {
  data: Record<string, unknown>;
  where?: Record<string, unknown>;
};

function prismaMock(prisma: PrismaAuthMock): PrismaService {
  return prisma as unknown as PrismaService;
}

function firstUserWriteArg(mock: jest.Mock): MockUserWriteArgs {
  const [arg] = mock.mock.calls[0] as [MockUserWriteArgs];
  return arg;
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
      { verifyIdToken: jest.fn() } as unknown as FirebaseAuthVerifierService,
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
        findUnique: jest.fn().mockResolvedValue({
          email: 'citizen@example.test',
          phone: '+2348000000001',
          phoneVerifiedAt: null,
          profileData: {},
        }),
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

  it('rejects ordinary profile updates that replace a verified phone', async () => {
    const prisma: PrismaAuthMock = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          email: 'citizen@example.test',
          phone: '+2348000000001',
          phoneVerifiedAt: new Date('2026-08-31T00:00:00.000Z'),
          profileData: {},
        }),
        update: jest.fn(),
      },
      demoAuditLog: { create: jest.fn() },
    };

    await expect(
      createService(prisma).updateMe(authUser, {
        fullName: 'Citizen User',
        phone: '+2348000000999',
      }),
    ).rejects.toThrow('Phone changes require secure verification');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('treats the same ordinary phone value as a no-op and updates safe profile fields', async () => {
    const prisma: PrismaAuthMock = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          email: 'citizen@example.test',
          phone: '+2348000000001',
          phoneVerifiedAt: new Date('2026-08-31T00:00:00.000Z'),
          profileData: { address: 'Old address' },
        }),
        update: jest.fn(({ data }: UserUpdateArgs) =>
          Promise.resolve({
            ...authUser,
            email: 'citizen@example.test',
            phone: '+2348000000001',
            firebaseUid: 'firebase-uid-1',
            secureZoneId: 'SZ-1',
            providerId: null,
            accountStatus: 'ACTIVE',
            phoneVerifiedAt: new Date('2026-08-31T00:00:00.000Z'),
            emailVerifiedAt: null,
            providerEngagementType: null,
            serviceCategories: null,
            coverageAreas: null,
            profileData: data.profileData,
            subscriptionPlan: null,
            identityVerificationStatus: 'PHONE_VERIFIED',
            identityVerificationLevel: 2,
            trustScore: 0,
            identityType: 'INDIVIDUAL',
            organization: null,
          }),
        ),
      },
      demoAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };

    const result = await createService(prisma).updateMe(authUser, {
      fullName: 'Citizen User Updated',
      phone: '+2348000000001',
      address: 'New address',
      state: 'Lagos',
      lga: 'Ikeja',
    });

    const updateArg = firstUserWriteArg(prisma.user.update);
    expect(updateArg.data).not.toHaveProperty('phone');
    expect(result.phone).toBe('+2348000000001');
    expect(result.profileData).toMatchObject({
      address: 'New address',
      state: 'Lagos',
      lga: 'Ikeja',
    });
  });

  it('rejects ordinary profile updates that attach a different email', async () => {
    const prisma: PrismaAuthMock = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          email: null,
          phone: '+2348000000001',
          phoneVerifiedAt: new Date('2026-08-31T00:00:00.000Z'),
          profileData: {},
        }),
        update: jest.fn(),
      },
      demoAuditLog: { create: jest.fn() },
    };

    await expect(
      createService(prisma).updateMe(authUser, {
        email: 'new.email@example.test',
      }),
    ).rejects.toThrow('Email changes require secure verification');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('AuthService Firebase citizen login trust boundary', () => {
  const verifiedPhoneToken: VerifiedFirebaseIdentity = {
    uid: 'firebase-uid-1',
    phoneNumber: '+2348000000001',
    email: 'citizen.claim@test.com',
    emailVerified: false,
    fullName: 'Token Citizen',
  };

  function user(overrides: Record<string, unknown> = {}) {
    return {
      id: 'user-1',
      email: null,
      phone: null,
      firebaseUid: null,
      fullName: 'Citizen User',
      role: UserRole.CITIZEN,
      organizationId: 'org-1',
      providerId: null,
      accountStatus: 'ACTIVE',
      phoneVerifiedAt: null,
      emailVerifiedAt: null,
      secureZoneId: 'SZ-1',
      identityVerificationStatus: 'UNVERIFIED',
      identityVerificationLevel: 0,
      trustScore: 0,
      identityType: 'INDIVIDUAL',
      ...overrides,
    };
  }

  function createFirebaseLoginService(
    options: {
      identity?: VerifiedFirebaseIdentity;
      verifyError?: Error;
      findUnique?: jest.Mock;
      createUser?: jest.Mock;
      updateUser?: jest.Mock;
    } = {},
  ) {
    const created = user({
      id: 'created-user',
      firebaseUid: options.identity?.uid ?? verifiedPhoneToken.uid,
      phone: options.identity?.phoneNumber ?? verifiedPhoneToken.phoneNumber,
      phoneVerifiedAt: new Date('2026-08-31T00:00:00.000Z'),
      fullName: options.identity?.fullName ?? verifiedPhoneToken.fullName,
    });
    const updated = user({
      firebaseUid: options.identity?.uid ?? verifiedPhoneToken.uid,
      phone: options.identity?.phoneNumber ?? verifiedPhoneToken.phoneNumber,
      phoneVerifiedAt: new Date('2026-08-31T00:00:00.000Z'),
      fullName: options.identity?.fullName ?? verifiedPhoneToken.fullName,
    });
    const prisma: PrismaAuthMock = {
      organization: {
        findFirst: jest.fn().mockResolvedValue({ id: 'org-1' }),
        create: jest.fn(),
      },
      user: {
        findUnique: options.findUnique ?? jest.fn().mockResolvedValue(null),
        create:
          options.createUser ??
          jest.fn().mockImplementation(({ data }) =>
            Promise.resolve({
              ...created,
              ...data,
              id: created.id,
            }),
          ),
        update:
          options.updateUser ??
          jest.fn().mockImplementation(({ data }) =>
            Promise.resolve({
              ...updated,
              ...data,
              id: updated.id,
            }),
          ),
      },
      demoAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const firebaseVerifier = {
      verifyIdToken: options.verifyError
        ? jest.fn().mockRejectedValue(options.verifyError)
        : jest.fn().mockResolvedValue(options.identity ?? verifiedPhoneToken),
    };
    const trustService = {
      ensureIdentity: jest.fn((id: string) => Promise.resolve(user({ id }))),
    };
    const jwtService = {
      signAsync: jest.fn().mockResolvedValue('fixzone-jwt'),
    };

    const service = new AuthService(
      jwtService as unknown as JwtService,
      prismaMock(prisma),
      trustService as unknown as TrustService,
      firebaseVerifier as unknown as FirebaseAuthVerifierService,
    );

    return { service, prisma, firebaseVerifier, jwtService };
  }

  it('issues a FixZone JWT only after a valid verified phone Firebase token', async () => {
    const { service, prisma, jwtService } = createFirebaseLoginService();

    const result = await service.firebaseLogin({
      idToken: 'verified-token',
    });

    expect(result.accessToken).toBe('fixzone-jwt');
    const createArg = firstUserWriteArg(prisma.user.create!);
    expect(createArg.data).toMatchObject({
      firebaseUid: 'firebase-uid-1',
      phone: '+2348000000001',
      identityVerificationStatus: 'PHONE_VERIFIED',
      identityVerificationLevel: 2,
      email: null,
      emailVerifiedAt: null,
    });
    expect(createArg.data.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(jwtService.signAsync).toHaveBeenCalled();
  });

  it('rejects missing tokens before user lookup', async () => {
    const { service, prisma, firebaseVerifier } = createFirebaseLoginService({
      verifyError: Object.assign(new Error('missing'), {
        response: { message: 'Firebase ID token is required' },
        status: 401,
      }),
    });

    await expect(service.firebaseLogin({ idToken: '' })).rejects.toThrow(
      'missing',
    );
    expect(firebaseVerifier.verifyIdToken).toHaveBeenCalledWith('');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects invalid expired or revoked tokens without issuing a JWT', async () => {
    const { service, jwtService } = createFirebaseLoginService({
      verifyError: Object.assign(
        new Error('Firebase ID token could not be verified'),
        {
          status: 401,
        },
      ),
    });

    await expect(
      service.firebaseLogin({ idToken: 'expired-or-revoked' }),
    ).rejects.toThrow('Firebase ID token could not be verified');
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('issues a FixZone JWT after a verified email Firebase token', async () => {
    const { service, prisma } = createFirebaseLoginService({
      identity: {
        uid: 'firebase-email-uid-1',
        phoneNumber: null,
        email: 'verified.email@test.com',
        emailVerified: true,
        fullName: 'Verified Email Citizen',
        signInProvider: 'password',
      },
    });

    const result = await service.firebaseLogin({
      idToken: 'verified-email-token',
    });

    expect(result.accessToken).toBe('fixzone-jwt');
    const createArg = firstUserWriteArg(prisma.user.create!);
    expect(createArg.data).toMatchObject({
      firebaseUid: 'firebase-email-uid-1',
      phone: null,
      phoneVerifiedAt: null,
      identityVerificationStatus: 'EMAIL_VERIFIED',
      identityVerificationLevel: 1,
      email: 'verified.email@test.com',
    });
    expect(createArg.data.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('rejects Firebase tokens without verified email or phone ownership claims', async () => {
    const { service, prisma } = createFirebaseLoginService({
      identity: {
        ...verifiedPhoneToken,
        phoneNumber: null,
      },
    });

    await expect(
      service.firebaseLogin({ idToken: 'email-only-token' }),
    ).rejects.toThrow('External authentication failed');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('does not trust client supplied Firebase UID or phone fields', async () => {
    const { service, prisma } = createFirebaseLoginService();
    const attackerDto: FirebaseLoginDto & {
      firebaseUid: string;
      phone: string;
    } = {
      idToken: 'verified-token',
      firebaseUid: 'attacker-uid',
      phone: '+2348999999999',
    };

    await service.firebaseLogin(attackerDto);

    const createArg = firstUserWriteArg(prisma.user.create!);
    expect(createArg.data).toMatchObject({
      firebaseUid: 'firebase-uid-1',
      phone: '+2348000000001',
    });
  });

  it('safely links an existing citizen matched by verified phone', async () => {
    const existing = user({
      id: 'existing-user',
      phone: '+2348000000001',
      firebaseUid: null,
    });
    const { service, prisma } = createFirebaseLoginService({
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(null),
      updateUser: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          ...existing,
          ...data,
        }),
      ),
    });

    await service.firebaseLogin({ idToken: 'verified-token' });

    const updateArg = firstUserWriteArg(prisma.user.update);
    expect(updateArg.where).toEqual({ id: 'existing-user' });
    expect(updateArg.data).toMatchObject({
      firebaseUid: 'firebase-uid-1',
      identityVerificationStatus: 'PHONE_VERIFIED',
      identityVerificationLevel: 2,
    });
    expect(updateArg.data.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('prevents duplicate account linking when UID and phone belong to different users', async () => {
    const { service, prisma } = createFirebaseLoginService({
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(
          user({ id: 'uid-user', firebaseUid: 'firebase-uid-1' }),
        )
        .mockResolvedValueOnce(
          user({ id: 'phone-user', phone: '+2348000000001' }),
        )
        .mockResolvedValueOnce(null),
    });

    await expect(
      service.firebaseLogin({ idToken: 'verified-token' }),
    ).rejects.toThrow('External authentication failed');
    const auditArg = firstUserWriteArg(prisma.demoAuditLog.create);
    expect(auditArg.data).toMatchObject({
      action: 'Firebase Login Rejected',
      metadata: {
        reason: 'uid_phone',
        hasPhoneClaim: true,
      },
    });
  });

  it('does not create a duplicate citizen on repeated Firebase login', async () => {
    const existing = user({
      id: 'existing-user',
      firebaseUid: 'firebase-uid-1',
      phone: '+2348000000001',
      phoneVerifiedAt: new Date('2026-08-31T00:00:00.000Z'),
      identityVerificationStatus: 'PHONE_VERIFIED',
      identityVerificationLevel: 2,
    });
    const { service, prisma } = createFirebaseLoginService({
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(null),
      updateUser: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          ...existing,
          ...data,
        }),
      ),
    });

    await service.firebaseLogin({ idToken: 'verified-token' });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'existing-user' } }),
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects Firebase citizen bridge for provider admin role matches', async () => {
    const { service, prisma } = createFirebaseLoginService({
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(
          user({
            id: 'provider-user',
            firebaseUid: 'firebase-uid-1',
            phone: '+2348000000001',
            role: UserRole.PROVIDER,
          }),
        )
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null),
    });

    await expect(
      service.firebaseLogin({ idToken: 'verified-token' }),
    ).rejects.toThrow('External authentication failed');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('does not mark an unverified token email as verified or attach it', async () => {
    const { service, prisma } = createFirebaseLoginService({
      identity: {
        ...verifiedPhoneToken,
        email: 'unverified.claim@test.com',
        emailVerified: false,
      },
    });

    await service.firebaseLogin({ idToken: 'verified-token' });

    const createArg = firstUserWriteArg(prisma.user.create!);
    expect(createArg.data).toMatchObject({
      email: null,
      emailVerifiedAt: null,
    });
  });

  it('fails closed when Firebase verification configuration is unavailable', async () => {
    const { service, prisma } = createFirebaseLoginService({
      verifyError: Object.assign(
        new Error('Firebase authentication verification is not configured'),
        { status: 401 },
      ),
    });

    await expect(service.firebaseLogin({ idToken: 'token' })).rejects.toThrow(
      'Firebase authentication verification is not configured',
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});
