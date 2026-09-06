/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { PrivilegedMfaEnrollmentStatus, UserRole } from '@prisma/client';
import {
  generateTotpCode,
  generateTotpCodeForStep,
  PrivilegedMfaService,
} from './privileged-mfa.service';
import { PrismaService } from '../prisma/prisma.service';

type Store = {
  sessions: any[];
  enrollments: any[];
  backupCodes: any[];
  audit: any[];
};

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 'priv-user-1',
    email: 'admin@example.test',
    phone: null,
    fullName: 'Privileged User',
    role: UserRole.SUPER_ADMIN,
    organizationId: null,
    providerId: null,
    accountStatus: 'ACTIVE',
    tokenVersion: 3,
    phoneVerifiedAt: null,
    emailVerifiedAt: null,
    secureZoneId: 'SZ-1',
    identityVerificationStatus: 'EMAIL_VERIFIED',
    identityVerificationLevel: 1,
    trustScore: 0,
    identityType: 'GOVERNMENT_REPRESENTATIVE',
    ...overrides,
  };
}

function createPrisma(store: Store, currentUser = user()) {
  const prisma = {
    privilegedMfaPreAuthSession: {
      create: jest.fn(({ data }) => {
        const session = {
          id: `session-${store.sessions.length + 1}`,
          failedAttempts: 0,
          consumedAt: null,
          lockedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        store.sessions.push(session);
        return Promise.resolve(session);
      }),
      findUnique: jest.fn(({ where }) => {
        const session = store.sessions.find(
          (item) =>
            item.tokenDigest === where.tokenDigest || item.id === where.id,
        );
        return Promise.resolve(
          session ? { ...session, user: currentUser } : null,
        );
      }),
      update: jest.fn(({ where, data }) => {
        const session = store.sessions.find((item) => item.id === where.id);
        Object.assign(session, {
          ...data,
          failedAttempts:
            data.failedAttempts?.increment !== undefined
              ? session.failedAttempts + data.failedAttempts.increment
              : (data.failedAttempts ?? session.failedAttempts),
        });
        return Promise.resolve(session);
      }),
    },
    privilegedMfaEnrollment: {
      create: jest.fn(({ data }) => {
        const enrollment = {
          id: `enrollment-${store.enrollments.length + 1}`,
          enabledAt: null,
          enforcedAt: null,
          disabledAt: null,
          lastVerifiedAt: null,
          lastVerifiedStep: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        store.enrollments.push(enrollment);
        return Promise.resolve(enrollment);
      }),
      findFirst: jest.fn(({ where }) => {
        const found = [...store.enrollments].reverse().find((item) => {
          if (where.userId && item.userId !== where.userId) return false;
          if (where.status && item.status !== where.status) return false;
          if (where.disabledAt === null && item.disabledAt !== null)
            return false;
          return true;
        });
        return Promise.resolve(found ?? null);
      }),
      update: jest.fn(({ where, data }) => {
        const enrollment = store.enrollments.find(
          (item) => item.id === where.id,
        );
        Object.assign(enrollment, data);
        return Promise.resolve(enrollment);
      }),
      updateMany: jest.fn(({ where, data }) => {
        let count = 0;
        for (const enrollment of store.enrollments) {
          const matchesPendingEnrollment =
            where.userId !== undefined &&
            where.status !== undefined &&
            enrollment.userId === where.userId &&
            enrollment.status === where.status;
          const matchesMonotonicStep =
            where.id !== undefined &&
            enrollment.id === where.id &&
            where.OR?.some((condition: any) => {
              if ('lastVerifiedStep' in condition) {
                if (condition.lastVerifiedStep === null) {
                  return enrollment.lastVerifiedStep === null;
                }
                if (condition.lastVerifiedStep?.lt !== undefined) {
                  return (
                    enrollment.lastVerifiedStep !== null &&
                    BigInt(enrollment.lastVerifiedStep) <
                      condition.lastVerifiedStep.lt
                  );
                }
              }
              return false;
            });
          if (matchesPendingEnrollment || matchesMonotonicStep) {
            Object.assign(enrollment, data);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      }),
    },
    privilegedMfaBackupCode: {
      createMany: jest.fn(({ data }) => {
        store.backupCodes.push(
          ...data.map((item: any, index: number) => ({
            id: `backup-${store.backupCodes.length + index + 1}`,
            usedAt: null,
            createdAt: new Date(),
            ...item,
          })),
        );
        return Promise.resolve({ count: data.length });
      }),
      deleteMany: jest.fn(({ where }) => {
        const before = store.backupCodes.length;
        store.backupCodes = store.backupCodes.filter(
          (item) => item.userId !== where.userId,
        );
        return Promise.resolve({ count: before - store.backupCodes.length });
      }),
      findUnique: jest.fn(({ where }) =>
        Promise.resolve(
          store.backupCodes.find(
            (item) => item.codeDigest === where.codeDigest,
          ) ?? null,
        ),
      ),
      updateMany: jest.fn(({ where, data }) => {
        let count = 0;
        for (const backup of store.backupCodes) {
          if (
            backup.id === where.id &&
            backup.codeDigest === where.codeDigest &&
            backup.userId === where.userId &&
            backup.enrollmentId === where.enrollmentId &&
            backup.usedAt === where.usedAt
          ) {
            Object.assign(backup, data);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      }),
    },
    complianceAuditLog: {
      create: jest.fn(({ data }) => {
        store.audit.push(data);
        return Promise.resolve(data);
      }),
    },
    $transaction: jest.fn((arg) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
    ),
  };
  return prisma as unknown as PrismaService;
}

describe('PrivilegedMfaService', () => {
  let store: Store;
  let service: PrivilegedMfaService;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.PRIVILEGED_MFA_ENCRYPTION_KEY;
    store = { sessions: [], enrollments: [], backupCodes: [], audit: [] };
    service = new PrivilegedMfaService(createPrisma(store));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function confirmedEnrollment() {
    const preAuth = await service.createPreAuthSession(user());
    const started = await service.startEnrollment(preAuth.preAuthToken);
    await service.confirmEnrollment(
      preAuth.preAuthToken,
      generateTotpCode(started.secret),
    );
    return started.secret;
  }

  function currentTotpStep() {
    return BigInt(Math.floor(Date.now() / 1000 / 30));
  }

  it('creates short-lived pre-auth state without storing the raw token', async () => {
    const response = await service.createPreAuthSession(user());

    expect(response.status).toBe('MFA_ENROLLMENT_REQUIRED');
    expect(response.preAuthToken).toHaveLength(43);
    expect(store.sessions[0].tokenDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(store.sessions[0].tokenDigest).not.toBe(response.preAuthToken);
    expect(store.sessions[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('starts enrollment with encrypted secret storage and returns provisioning data once', async () => {
    const preAuth = await service.createPreAuthSession(user());

    const started = await service.startEnrollment(preAuth.preAuthToken);

    expect(started.status).toBe('MFA_ENROLLMENT_STARTED');
    expect(started.secret).toBeTruthy();
    expect(started.provisioningUri).toContain('otpauth://totp/');
    expect(store.enrollments[0].encryptedTotpSecret).not.toContain(
      started.secret,
    );
    expect(store.enrollments[0].encryptedTotpSecret).toMatch(/^v1:/);
  });

  it('confirms enrollment with valid TOTP and stores only recovery-code digests', async () => {
    const preAuth = await service.createPreAuthSession(user());
    const started = await service.startEnrollment(preAuth.preAuthToken);
    const code = generateTotpCode(started.secret);

    const confirmed = await service.confirmEnrollment(
      preAuth.preAuthToken,
      code,
    );

    expect(confirmed.user.id).toBe('priv-user-1');
    expect(confirmed.recoveryCodes).toHaveLength(10);
    expect(store.enrollments[0].status).toBe(
      PrivilegedMfaEnrollmentStatus.ACTIVE,
    );
    expect(store.backupCodes).toHaveLength(10);
    expect(store.backupCodes[0].codeDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(store.backupCodes[0].codeDigest).not.toBe(
      confirmed.recoveryCodes[0],
    );
    expect(store.sessions[0].consumedAt).toBeInstanceOf(Date);
  });

  it('rejects invalid TOTP and locks pre-auth state after bounded attempts', async () => {
    const preAuth = await service.createPreAuthSession(user());
    await service.startEnrollment(preAuth.preAuthToken);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        service.confirmEnrollment(preAuth.preAuthToken, '000000'),
      ).rejects.toThrow('MFA verification failed');
    }

    expect(store.sessions[0].failedAttempts).toBe(5);
    expect(store.sessions[0].lockedAt).toBeInstanceOf(Date);
  });

  it('issues challenge success for valid TOTP and rejects same-step replay', async () => {
    jest.useFakeTimers().setSystemTime(new Date(1_000_000_000_000));
    const secret = await confirmedEnrollment();
    const step = currentTotpStep();
    const challenge = await service.createPreAuthSession(user());
    const code = generateTotpCodeForStep(secret, step);

    await service.completeChallenge(challenge.preAuthToken, 'totp', code);

    expect(store.enrollments[0].lastVerifiedStep).toBe(step);
    const replay = await service.createPreAuthSession(user());
    await expect(
      service.completeChallenge(replay.preAuthToken, 'totp', code),
    ).rejects.toThrow('MFA verification failed');

    jest.setSystemTime(new Date(Number(step + 1n) * 30_000));
    const nextChallenge = await service.createPreAuthSession(user());
    await service.completeChallenge(
      nextChallenge.preAuthToken,
      'totp',
      generateTotpCodeForStep(secret, step + 1n),
    );
    expect(store.enrollments[0].lastVerifiedStep).toBe(step + 1n);
  });

  it('records previous-step TOTP matches, rejects replay, and accepts greater current step', async () => {
    jest.useFakeTimers().setSystemTime(new Date(1_000_000_000_000));
    const secret = await confirmedEnrollment();
    const previousStep = currentTotpStep() - 1n;
    const code = generateTotpCodeForStep(secret, previousStep);
    const challenge = await service.createPreAuthSession(user());

    await service.completeChallenge(challenge.preAuthToken, 'totp', code);

    expect(store.enrollments[0].lastVerifiedStep).toBe(previousStep);
    const replay = await service.createPreAuthSession(user());
    await expect(
      service.completeChallenge(replay.preAuthToken, 'totp', code),
    ).rejects.toThrow('MFA verification failed');

    const currentChallenge = await service.createPreAuthSession(user());
    await service.completeChallenge(
      currentChallenge.preAuthToken,
      'totp',
      generateTotpCodeForStep(secret, previousStep + 1n),
    );
    expect(store.enrollments[0].lastVerifiedStep).toBe(previousStep + 1n);
  });

  it('records future-step TOTP matches and monotonically rejects lower and replayed steps', async () => {
    jest.useFakeTimers().setSystemTime(new Date(1_000_000_000_000));
    const secret = await confirmedEnrollment();
    const currentStep = currentTotpStep();
    const futureStep = currentStep + 1n;
    const code = generateTotpCodeForStep(secret, futureStep);
    const challenge = await service.createPreAuthSession(user());

    await service.completeChallenge(challenge.preAuthToken, 'totp', code);

    expect(store.enrollments[0].lastVerifiedStep).toBe(futureStep);
    const immediateReplay = await service.createPreAuthSession(user());
    await expect(
      service.completeChallenge(immediateReplay.preAuthToken, 'totp', code),
    ).rejects.toThrow('MFA verification failed');
    expect(store.enrollments[0].lastVerifiedStep).toBe(futureStep);

    const lowerCurrent = await service.createPreAuthSession(user());
    await expect(
      service.completeChallenge(
        lowerCurrent.preAuthToken,
        'totp',
        generateTotpCodeForStep(secret, currentStep),
      ),
    ).rejects.toThrow('MFA verification failed');
    expect(store.enrollments[0].lastVerifiedStep).toBe(futureStep);

    const lowerPrevious = await service.createPreAuthSession(user());
    await expect(
      service.completeChallenge(
        lowerPrevious.preAuthToken,
        'totp',
        generateTotpCodeForStep(secret, currentStep - 1n),
      ),
    ).rejects.toThrow('MFA verification failed');
    expect(store.enrollments[0].lastVerifiedStep).toBe(futureStep);

    jest.setSystemTime(new Date(Number(futureStep) * 30_000));
    const laterReplay = await service.createPreAuthSession(user());
    await expect(
      service.completeChallenge(laterReplay.preAuthToken, 'totp', code),
    ).rejects.toThrow('MFA verification failed');
    expect(store.enrollments[0].lastVerifiedStep).toBe(futureStep);

    jest.setSystemTime(new Date(Number(futureStep + 1n) * 30_000));
    const laterChallenge = await service.createPreAuthSession(user());
    await service.completeChallenge(
      laterChallenge.preAuthToken,
      'totp',
      generateTotpCodeForStep(secret, futureStep + 1n),
    );
    expect(store.enrollments[0].lastVerifiedStep).toBe(futureStep + 1n);
  });

  it('rejects the future-lower-future replay sequence without decreasing lastVerifiedStep', async () => {
    jest.useFakeTimers().setSystemTime(new Date(1_000_000_000_000));
    const secret = await confirmedEnrollment();
    const currentStep = currentTotpStep();
    const futureStep = currentStep + 1n;
    const futureCode = generateTotpCodeForStep(secret, futureStep);
    const earlyFuture = await service.createPreAuthSession(user());

    await service.completeChallenge(
      earlyFuture.preAuthToken,
      'totp',
      futureCode,
    );

    expect(store.enrollments[0].lastVerifiedStep).toBe(futureStep);
    const lowerAttempt = await service.createPreAuthSession(user());
    await expect(
      service.completeChallenge(
        lowerAttempt.preAuthToken,
        'totp',
        generateTotpCodeForStep(secret, currentStep),
      ),
    ).rejects.toThrow('MFA verification failed');
    expect(store.enrollments[0].lastVerifiedStep).toBe(futureStep);

    jest.setSystemTime(new Date(Number(futureStep) * 30_000));
    const replayAtFuture = await service.createPreAuthSession(user());
    await expect(
      service.completeChallenge(
        replayAtFuture.preAuthToken,
        'totp',
        futureCode,
      ),
    ).rejects.toThrow('MFA verification failed');
    expect(store.enrollments[0].lastVerifiedStep).toBe(futureStep);
  });

  it('accepts one recovery code once and leaves other codes unused', async () => {
    const preAuth = await service.createPreAuthSession(user());
    const started = await service.startEnrollment(preAuth.preAuthToken);
    const confirmed = await service.confirmEnrollment(
      preAuth.preAuthToken,
      generateTotpCode(started.secret),
    );
    const challenge = await service.createPreAuthSession(user());

    await service.completeChallenge(
      challenge.preAuthToken,
      'recovery_code',
      confirmed.recoveryCodes[0],
    );

    expect(store.backupCodes[0].usedAt).toBeInstanceOf(Date);
    expect(
      store.backupCodes.slice(1).every((item) => item.usedAt === null),
    ).toBe(true);
    const reuse = await service.createPreAuthSession(user());
    await expect(
      service.completeChallenge(
        reuse.preAuthToken,
        'recovery_code',
        confirmed.recoveryCodes[0],
      ),
    ).rejects.toThrow('MFA verification failed');
  });

  it('atomically rejects concurrent duplicate recovery-code consumption', async () => {
    const preAuth = await service.createPreAuthSession(user());
    const started = await service.startEnrollment(preAuth.preAuthToken);
    const confirmed = await service.confirmEnrollment(
      preAuth.preAuthToken,
      generateTotpCode(started.secret),
    );
    const firstChallenge = await service.createPreAuthSession(user());
    const secondChallenge = await service.createPreAuthSession(user());

    const results = await Promise.allSettled([
      service.completeChallenge(
        firstChallenge.preAuthToken,
        'recovery_code',
        confirmed.recoveryCodes[0],
      ),
      service.completeChallenge(
        secondChallenge.preAuthToken,
        'recovery_code',
        confirmed.recoveryCodes[0],
      ),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(store.backupCodes[0].usedAt).toBeInstanceOf(Date);
    expect(
      store.backupCodes.slice(1).every((item) => item.usedAt === null),
    ).toBe(true);
    expect(
      store.backupCodes.filter((item) => item.usedAt !== null),
    ).toHaveLength(1);
  });

  it('rejects expired, consumed, and tampered pre-auth tokens', async () => {
    const preAuth = await service.createPreAuthSession(user());
    store.sessions[0].expiresAt = new Date(Date.now() - 1);
    await expect(service.startEnrollment(preAuth.preAuthToken)).rejects.toThrow(
      'MFA verification failed',
    );

    store.sessions[0].expiresAt = new Date(Date.now() + 60_000);
    store.sessions[0].consumedAt = new Date();
    await expect(service.startEnrollment(preAuth.preAuthToken)).rejects.toThrow(
      'MFA verification failed',
    );
    await expect(
      service.startEnrollment(`${preAuth.preAuthToken}x`),
    ).rejects.toThrow('MFA verification failed');
  });

  it('fails closed outside tests when encryption key is missing', async () => {
    process.env.NODE_ENV = 'production';
    const productionService = new PrivilegedMfaService(createPrisma(store));
    const preAuth = await productionService.createPreAuthSession(user());

    await expect(
      productionService.startEnrollment(preAuth.preAuthToken),
    ).rejects.toThrow('Privileged MFA encryption is not configured');
  });
});
