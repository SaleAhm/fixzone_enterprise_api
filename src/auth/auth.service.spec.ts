import { UserRole } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { TrustService } from '../trust/trust.service';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import {
  FirebaseAuthVerifierService,
  VerifiedFirebaseIdentity,
} from './firebase-auth-verifier.service';
import { PasswordResetDeliveryService } from './password-reset-delivery.service';

type PrismaAuthMock = {
  organization?: {
    findFirst: jest.Mock;
    create: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
    findFirst?: jest.Mock;
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

describe('AuthService public registration role boundary', () => {
  function createRegistrationService(
    overrides: Partial<PrismaAuthMock['user']> = {},
  ) {
    const prisma: PrismaAuthMock = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }) =>
          Promise.resolve({
            ...data,
            id: 'registered-user',
            secureZoneId: 'SZ-1',
            providerId: null,
            accountStatus: 'ACTIVE',
            phoneVerifiedAt: null,
            emailVerifiedAt: null,
          }),
        ),
        update: jest.fn(),
        ...overrides,
      },
      demoAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const trustService = {
      ensureIdentity: jest.fn((id: string) =>
        Promise.resolve({
          id,
          email: 'public-citizen@test.com',
          phone: null,
          fullName: 'Public Citizen',
          role: UserRole.CITIZEN,
          organizationId: null,
          providerId: null,
          accountStatus: 'ACTIVE',
          phoneVerifiedAt: null,
          emailVerifiedAt: null,
          secureZoneId: 'SZ-1',
        }),
      ),
    };
    const service = new AuthService(
      { signAsync: jest.fn().mockResolvedValue('fixzone-jwt') },
      prismaMock(prisma),
      trustService as unknown as TrustService,
      { verifyIdToken: jest.fn() } as unknown as FirebaseAuthVerifierService,
    );

    return { service, prisma };
  }

  it('assigns the server-authoritative CITIZEN role when role is omitted', async () => {
    const { service, prisma } = createRegistrationService();

    const result = await service.register({
      fullName: 'Public Citizen',
      email: 'public-citizen@test.com',
      password: 'Password123!',
    });

    expect(result.user.role).toBe(UserRole.CITIZEN);
    const createArg = firstUserWriteArg(prisma.user.create!);
    expect(createArg.data).toMatchObject({
      role: UserRole.CITIZEN,
      organizationId: null,
    });
  });

  it('rejects direct service-level privileged and workflow role selection before user creation', async () => {
    const { service, prisma } = createRegistrationService();
    const deniedRoles = [
      ...Object.values(UserRole).filter((role) => role !== UserRole.CITIZEN),
      'ADMIN',
      'admin',
      'platform_admin',
      'internal_admin',
      'Org_Admin',
      'provider',
      'pending_provider',
      'unexpected_role',
    ];

    for (const role of deniedRoles) {
      await expect(
        service.register({
          fullName: 'Attack User',
          email: 'attack-user@test.com',
          password: 'Password123!',
          role,
        }),
      ).rejects.toThrow('Role cannot be selected during public registration');
    }

    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    const auditArg = firstUserWriteArg(prisma.demoAuditLog.create);
    expect(auditArg.data).toMatchObject({
      action: 'Public Registration Role Selection Rejected',
      actorUserId: 'anonymous',
      metadata: {
        requestedRoleType: 'string',
        requestedRole: deniedRoles[0],
      },
    });
  });

  it('rejects null and malformed role payloads before user creation', async () => {
    const { service, prisma } = createRegistrationService();

    await expect(
      service.register({
        fullName: 'Malformed Role User',
        email: 'malformed-role@test.com',
        password: 'Password123!',
        role: null,
      }),
    ).rejects.toThrow('Role cannot be selected during public registration');

    await expect(
      service.register({
        fullName: 'Array Role User',
        email: 'array-role@test.com',
        password: 'Password123!',
        role: ['CITIZEN'],
      }),
    ).rejects.toThrow('Role cannot be selected during public registration');

    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

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
      tokenVersion: 0,
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
      verifyError: Object.assign(new Error('Authentication failed'), {
        response: { message: 'Firebase ID token is required' },
        status: 401,
      }),
    });

    await expect(service.firebaseLogin({ idToken: '' })).rejects.toThrow(
      'Authentication failed',
    );
    expect(firebaseVerifier.verifyIdToken).toHaveBeenCalledWith('');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects invalid expired or revoked tokens without issuing a JWT', async () => {
    const { service, jwtService } = createFirebaseLoginService({
      verifyError: Object.assign(new Error('Authentication failed'), {
        status: 401,
      }),
    });

    await expect(
      service.firebaseLogin({ idToken: 'expired-or-revoked' }),
    ).rejects.toThrow('Authentication failed');
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

  it('allows new verified-email citizen registration intent to create a linked citizen', async () => {
    const { service, prisma } = createFirebaseLoginService({
      identity: {
        uid: 'firebase-email-registration-uid-1',
        phoneNumber: null,
        email: 'new.verified.email@test.com',
        emailVerified: true,
        fullName: 'New Verified Citizen',
        signInProvider: 'password',
      },
    });

    const result = await service.firebaseLogin({
      idToken: 'verified-email-registration-token',
      intent: 'registration',
      fullName: 'New Verified Citizen',
    });

    expect(result.accessToken).toBe('fixzone-jwt');
    const createArg = firstUserWriteArg(prisma.user.create!);
    expect(createArg.data).toMatchObject({
      firebaseUid: 'firebase-email-registration-uid-1',
      email: 'new.verified.email@test.com',
      phone: null,
      fullName: 'New Verified Citizen',
    });
    expect(createArg.data.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('keeps existing verified-email registration idempotent when UID is already linked', async () => {
    const existing = user({
      id: 'existing-email-user',
      firebaseUid: 'firebase-email-uid-1',
      email: 'verified.email@test.com',
      emailVerifiedAt: new Date('2026-08-31T00:00:00.000Z'),
      identityVerificationStatus: 'EMAIL_VERIFIED',
      identityVerificationLevel: 1,
    });
    const { service, prisma } = createFirebaseLoginService({
      identity: {
        uid: 'firebase-email-uid-1',
        phoneNumber: null,
        email: 'verified.email@test.com',
        emailVerified: true,
        fullName: 'Submitted Name',
        signInProvider: 'password',
      },
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing),
      updateUser: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          ...existing,
          ...data,
        }),
      ),
    });

    const result = await service.firebaseLogin({
      idToken: 'verified-email-token',
      intent: 'registration',
      fullName: 'Submitted Name',
    });

    expect(result).toHaveProperty('accessToken', 'fixzone-jwt');
    expect(result).toHaveProperty(['user', 'id'], 'existing-email-user');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('returns recovery-required for registration intent with existing unlinked verified email', async () => {
    const existing = user({
      id: 'existing-email-user',
      firebaseUid: null,
      email: 'verified.email@test.com',
      fullName: 'Original Citizen',
      phone: '+2348000000444',
      phoneVerifiedAt: new Date('2026-08-31T00:00:00.000Z'),
      emailVerifiedAt: new Date('2026-08-31T00:00:00.000Z'),
      profileData: { address: 'Original address' },
    });
    const { service, prisma, jwtService } = createFirebaseLoginService({
      identity: {
        uid: 'new-firebase-email-uid',
        phoneNumber: null,
        email: 'verified.email@test.com',
        emailVerified: true,
        fullName: 'Submitted Registration Name',
        signInProvider: 'password',
      },
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existing),
    });

    const result = await service.firebaseLogin({
      idToken: 'verified-email-token',
      intent: 'registration',
      fullName: 'Submitted Registration Name',
    });

    expect(result).toEqual({
      outcome: 'RECOVERY_REQUIRED',
      code: 'CITIZEN_EMAIL_RECOVERY_REQUIRED',
      message:
        'This verified email is associated with an existing FixZone account. Continue through secure account recovery.',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(jwtService.signAsync).not.toHaveBeenCalled();
    const auditArg = firstUserWriteArg(prisma.demoAuditLog.create);
    expect(auditArg.data).toMatchObject({
      action: 'Firebase Login Rejected',
      metadata: {
        reason: 'registration_email_recovery_required',
        hasEmailClaim: true,
        emailVerified: true,
      },
    });
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
    ).rejects.toThrow('Authentication failed');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('does not reveal existing email state to unverified registration tokens', async () => {
    const { service, prisma } = createFirebaseLoginService({
      identity: {
        ...verifiedPhoneToken,
        phoneNumber: null,
        email: 'verified.email@test.com',
        emailVerified: false,
      },
    });

    await expect(
      service.firebaseLogin({
        idToken: 'unverified-email-registration-token',
        intent: 'registration',
      }),
    ).rejects.toThrow('Authentication failed');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
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
    ).rejects.toThrow('Authentication failed');
    const auditArg = firstUserWriteArg(prisma.demoAuditLog.create);
    expect(auditArg.data).toMatchObject({
      action: 'Firebase Login Rejected',
      metadata: {
        reason: 'uid_phone',
        hasPhoneClaim: true,
      },
    });
  });

  it('rejects registration intent when UID and verified email belong to different citizens', async () => {
    const { service, prisma } = createFirebaseLoginService({
      identity: {
        uid: 'firebase-email-uid-1',
        phoneNumber: null,
        email: 'verified.email@test.com',
        emailVerified: true,
        fullName: 'Verified Email Citizen',
        signInProvider: 'password',
      },
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(
          user({ id: 'uid-user', firebaseUid: 'firebase-email-uid-1' }),
        )
        .mockResolvedValueOnce(
          user({ id: 'email-user', email: 'verified.email@test.com' }),
        ),
    });

    await expect(
      service.firebaseLogin({
        idToken: 'verified-email-token',
        intent: 'registration',
      }),
    ).rejects.toThrow('Authentication failed');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
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
    ).rejects.toThrow('Authentication failed');
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
      verifyError: Object.assign(new Error('Authentication failed'), {
        status: 401,
      }),
    });

    await expect(service.firebaseLogin({ idToken: 'token' })).rejects.toThrow(
      'Authentication failed',
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it.each(['PENDING_INVITE', 'PENDING_APPROVAL', 'SUSPENDED', 'DEACTIVATED'])(
    'rejects existing non-active Firebase citizen %s before linking',
    async (accountStatus) => {
      const existing = user({
        id: 'existing-user',
        phone: '+2348000000001',
        firebaseUid: null,
        accountStatus,
      });
      const { service, prisma, jwtService } = createFirebaseLoginService({
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(existing)
          .mockResolvedValueOnce(null),
      });

      await expect(
        service.firebaseLogin({ idToken: 'verified-token' }),
      ).rejects.toThrow('Authentication failed');
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    },
  );

  it('puts tokenVersion into newly issued JWTs', async () => {
    const existing = user({
      id: 'existing-user',
      firebaseUid: 'firebase-uid-1',
      phone: '+2348000000001',
      tokenVersion: 7,
    });
    const { service, jwtService } = createFirebaseLoginService({
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

    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ tokenVersion: 7 }),
      expect.any(Object),
    );
  });
});

describe('AuthService secure password reset foundation', () => {
  const deliveredTokens: string[] = [];

  type ResetUserFixture = {
    id: string;
    email: string;
    phone: string | null;
    fullName: string;
    role: UserRole;
    organizationId: string | null;
    providerId: string | null;
    accountStatus: string;
    tokenVersion: number;
    passwordHash: string;
    phoneVerifiedAt: Date | null;
    emailVerifiedAt: Date | null;
  };

  type ResetTokenFixture = {
    id: string;
    userId: string;
    usedAt: Date | null;
    supersededAt: Date | null;
    expiresAt: Date;
    user: {
      id?: string;
      accountStatus: string;
    };
  };

  type PasswordResetTokenCreateArgs = {
    data: {
      tokenDigest: string;
      expiresAt: Date;
    };
  };

  type PasswordResetTokenFindUniqueArgs = {
    where: {
      tokenDigest: string;
    };
  };

  type SupersedeArgs = {
    data?: {
      supersededAt?: unknown;
    };
  };

  type MarkUsedArgs = {
    where?: {
      id?: string;
    };
    data?: {
      usedAt?: unknown;
    };
  };

  type PasswordUpdateArgs = {
    data?: {
      tokenVersion?: {
        increment?: number;
      };
    };
  };

  type TransactionCallback = (tx: PasswordResetPrismaMock) => Promise<unknown>;

  type PasswordResetPrismaMock = {
    user: {
      findFirst: jest.Mock<Promise<ResetUserFixture | undefined>, []>;
      update: jest.Mock<Promise<ResetUserFixture>, [unknown]>;
    };
    passwordResetToken: {
      create: jest.Mock<
        Promise<{ id: string }>,
        [PasswordResetTokenCreateArgs]
      >;
      updateMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
      findUnique: jest.Mock<
        Promise<ResetTokenFixture | null>,
        [PasswordResetTokenFindUniqueArgs]
      >;
      update: jest.Mock<Promise<{ id: string }>, [unknown]>;
    };
    demoAuditLog: {
      create: jest.Mock<Promise<Record<string, never>>, [unknown]>;
    };
    $transaction: jest.Mock<Promise<unknown>, [unknown]>;
  };

  function resetDigest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  function isTransactionCallback(value: unknown): value is TransactionCallback {
    return typeof value === 'function';
  }

  function createPasswordResetService(
    options: {
      user?: ResetUserFixture;
      token?: ResetTokenFixture | null;
      delivery?: PasswordResetDeliveryService | null;
    } = {},
  ) {
    deliveredTokens.length = 0;
    const user = options.user ?? {
      id: 'user-1',
      email: 'reset@example.test',
      phone: null,
      fullName: 'Reset User',
      role: UserRole.CITIZEN,
      organizationId: null,
      providerId: null,
      accountStatus: 'ACTIVE',
      tokenVersion: 2,
      passwordHash: 'hash',
      phoneVerifiedAt: null,
      emailVerifiedAt: null,
    };
    const prisma: PasswordResetPrismaMock = {
      user: {
        findFirst: jest.fn<Promise<ResetUserFixture | undefined>, []>(() =>
          Promise.resolve(user),
        ),
        update: jest.fn<Promise<ResetUserFixture>, [unknown]>(() =>
          Promise.resolve({ ...user, tokenVersion: 3 }),
        ),
      },
      passwordResetToken: {
        create: jest.fn<
          Promise<{ id: string }>,
          [PasswordResetTokenCreateArgs]
        >(() => Promise.resolve({ id: 'reset-token-1' })),
        updateMany: jest.fn<Promise<{ count: number }>, [unknown]>(() =>
          Promise.resolve({ count: 1 }),
        ),
        findUnique: jest.fn<
          Promise<ResetTokenFixture | null>,
          [PasswordResetTokenFindUniqueArgs]
        >(() => Promise.resolve(options.token ?? null)),
        update: jest.fn<Promise<{ id: string }>, [unknown]>(() =>
          Promise.resolve({ id: 'reset-token-1' }),
        ),
      },
      demoAuditLog: {
        create: jest.fn<Promise<Record<string, never>>, [unknown]>(() =>
          Promise.resolve({}),
        ),
      },
      $transaction: jest.fn<Promise<unknown>, [unknown]>((arg) =>
        isTransactionCallback(arg) ? arg(prisma) : Promise.resolve(undefined),
      ),
    };
    const delivery =
      options.delivery === undefined
        ? ({
            deliver: jest.fn((request: { token: string }) => {
              deliveredTokens.push(request.token);
              return Promise.resolve({
                delivered: true,
                status: 'DELIVERY_ACCEPTED',
              });
            }),
          } satisfies PasswordResetDeliveryService)
        : options.delivery;
    const service = new AuthService(
      { signAsync: jest.fn() } as unknown as JwtService,
      prisma as unknown as PrismaService,
      {} as TrustService,
      { verifyIdToken: jest.fn() } as unknown as FirebaseAuthVerifierService,
      delivery ?? undefined,
    );
    return { service, prisma };
  }

  it('does not expose reset token password value or URL in request responses', async () => {
    const { service, prisma } = createPasswordResetService();

    const response = await service.requestPasswordReset({
      email: 'reset@example.test',
    });

    expect(response).not.toHaveProperty('token');
    expect(response).not.toHaveProperty('resetUrl');
    expect(JSON.stringify(response)).not.toContain(deliveredTokens[0]);
    expect(deliveredTokens).toHaveLength(1);
    const createArg = prisma.passwordResetToken.create.mock.calls[0][0];
    expect(createArg.data.tokenDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(createArg.data.tokenDigest).not.toBe(deliveredTokens[0]);
    expect(createArg.data.expiresAt).toBeInstanceOf(Date);
  });

  it('supersedes older active tokens when issuing a newer token', async () => {
    const { service, prisma } = createPasswordResetService();

    await service.requestPasswordReset({ email: 'reset@example.test' });
    await service.requestPasswordReset({ email: 'reset@example.test' });

    expect(deliveredTokens[0]).not.toBe(deliveredTokens[1]);
    const supersedeArg = prisma.passwordResetToken.updateMany.mock
      .calls[0][0] as SupersedeArgs;
    expect(supersedeArg.data?.supersededAt).toBeInstanceOf(Date);
  });

  it('fails closed and truthfully when delivery is unavailable', async () => {
    const { service } = createPasswordResetService({
      delivery: null,
    });

    const response = await service.requestPasswordReset({
      email: 'reset@example.test',
    });

    expect(response.delivery).toEqual({
      configured: false,
      status: 'DELIVERY_UNAVAILABLE',
    });
    expect(response.message).toContain('If delivery is configured');
  });

  it('marks reset tokens single-use and advances tokenVersion on completion', async () => {
    const token = {
      id: 'reset-token-1',
      userId: 'user-1',
      usedAt: null,
      supersededAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: 'user-1',
        accountStatus: 'ACTIVE',
      },
    };
    const { service, prisma } = createPasswordResetService({ token });
    const digest = resetDigest('plain-reset-token');
    prisma.passwordResetToken.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(where.tokenDigest === digest ? token : null),
    );

    await service.completePasswordReset({
      token: 'plain-reset-token',
      password: 'NewPassword1',
    });

    const markUsedArg = prisma.passwordResetToken.update.mock
      .calls[0][0] as MarkUsedArgs;
    expect(markUsedArg.where?.id).toBe('reset-token-1');
    expect(markUsedArg.data?.usedAt).toBeInstanceOf(Date);
    const passwordUpdateArg = prisma.user.update.mock
      .calls[0][0] as PasswordUpdateArgs;
    expect(passwordUpdateArg.data?.tokenVersion?.increment).toBe(1);
  });

  it.each([
    { usedAt: new Date(), supersededAt: null },
    { usedAt: null, supersededAt: new Date() },
    {
      usedAt: null,
      supersededAt: null,
      expiresAt: new Date(Date.now() - 60_000),
    },
  ])('rejects unusable reset token states', async (state) => {
    const token = {
      id: 'reset-token-1',
      userId: 'user-1',
      usedAt: state.usedAt,
      supersededAt: state.supersededAt,
      expiresAt: state.expiresAt ?? new Date(Date.now() + 60_000),
      user: { accountStatus: 'ACTIVE' },
    };
    const { service } = createPasswordResetService({ token });

    await expect(
      service.completePasswordReset({
        token: 'plain-reset-token',
        password: 'NewPassword1',
      }),
    ).rejects.toThrow('Authentication failed');
  });
});
