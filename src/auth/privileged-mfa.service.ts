import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import {
  AccountStatus,
  Prisma,
  PrivilegedMfaEnrollmentStatus,
  PrivilegedMfaPreAuthPurpose,
  User,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requiresPrivilegedMfa } from './privileged-mfa.policy';

type MfaUser = Pick<
  User,
  | 'id'
  | 'email'
  | 'phone'
  | 'fullName'
  | 'role'
  | 'organizationId'
  | 'providerId'
  | 'accountStatus'
  | 'tokenVersion'
  | 'phoneVerifiedAt'
  | 'emailVerifiedAt'
> & {
  secureZoneId?: string | null;
  identityVerificationStatus?: string;
  identityVerificationLevel?: number;
  trustScore?: number;
  identityType?: string;
};

type RequestContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type PreAuthValidation = {
  session: {
    id: string;
    userId: string;
    failedAttempts: number;
  };
  user: MfaUser;
};

const preAuthTtlMs = 10 * 60_000;
const maxAttempts = 5;
const backupCodeCount = 10;
const totpStepSeconds = 30;
const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

@Injectable()
export class PrivilegedMfaService {
  constructor(private readonly prisma: PrismaService) {}

  async createPreAuthSession(user: MfaUser, context?: RequestContext) {
    if (!requiresPrivilegedMfa(user.role)) {
      throw this.invalidMfaState();
    }

    const activeEnrollment = await this.activeEnrollment(user.id);
    const purpose = activeEnrollment
      ? PrivilegedMfaPreAuthPurpose.CHALLENGE
      : PrivilegedMfaPreAuthPurpose.ENROLLMENT;
    const rawToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + preAuthTtlMs);

    await this.prisma.privilegedMfaPreAuthSession.create({
      data: {
        userId: user.id,
        tokenDigest: this.digest(rawToken),
        purpose,
        expiresAt,
      },
    });

    await this.audit('Privileged Login Password Accepted MFA Pending', user, {
      purpose,
      ipAddress: context?.ipAddress ?? null,
      userAgent: context?.userAgent ?? null,
    });

    return {
      status:
        purpose === PrivilegedMfaPreAuthPurpose.ENROLLMENT
          ? 'MFA_ENROLLMENT_REQUIRED'
          : 'MFA_CHALLENGE_REQUIRED',
      mfaRequired: true,
      preAuthToken: rawToken,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async startEnrollment(preAuthToken: string, context?: RequestContext) {
    const { session, user } = await this.validatePreAuth(
      preAuthToken,
      PrivilegedMfaPreAuthPurpose.ENROLLMENT,
    );
    const secret = generateTotpSecret();
    const encryptedSecret = this.encrypt(secret);

    await this.prisma.$transaction(async (tx) => {
      await tx.privilegedMfaEnrollment.updateMany({
        where: {
          userId: user.id,
          status: PrivilegedMfaEnrollmentStatus.PENDING,
        },
        data: {
          status: PrivilegedMfaEnrollmentStatus.DISABLED,
          disabledAt: new Date(),
        },
      });
      await tx.privilegedMfaEnrollment.create({
        data: {
          userId: user.id,
          status: PrivilegedMfaEnrollmentStatus.PENDING,
          encryptedTotpSecret: encryptedSecret,
          secretFormatVersion: 1,
        },
      });
    });

    await this.audit('Privileged MFA Enrollment Started', user, {
      preAuthSessionId: session.id,
      ipAddress: context?.ipAddress ?? null,
      userAgent: context?.userAgent ?? null,
    });

    return {
      status: 'MFA_ENROLLMENT_STARTED',
      issuer: 'SecureZone FixZone Administration',
      accountName: user.email ?? user.id,
      secret,
      provisioningUri: this.provisioningUri(user.email ?? user.id, secret),
    };
  }

  async confirmEnrollment(
    preAuthToken: string,
    code: string,
    context?: RequestContext,
  ) {
    const { session, user } = await this.validatePreAuth(
      preAuthToken,
      PrivilegedMfaPreAuthPurpose.ENROLLMENT,
    );
    const enrollment = await this.pendingEnrollment(user.id);
    if (!enrollment) {
      await this.recordFailedAttempt(session.id, session.failedAttempts);
      throw this.invalidMfaState();
    }

    const secret = this.decrypt(enrollment.encryptedTotpSecret);
    if (!this.verifyTotp(code, secret)) {
      await this.recordFailedAttempt(session.id, session.failedAttempts);
      await this.audit('Privileged MFA Enrollment Confirmation Failed', user, {
        preAuthSessionId: session.id,
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
      });
      throw this.invalidMfaCode();
    }

    const recoveryCodes = this.generateRecoveryCodes();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.privilegedMfaEnrollment.update({
        where: { id: enrollment.id },
        data: {
          status: PrivilegedMfaEnrollmentStatus.ACTIVE,
          enabledAt: now,
          enforcedAt: now,
          lastVerifiedAt: now,
          lastVerifiedStep: null,
        },
      });
      await tx.privilegedMfaBackupCode.deleteMany({
        where: { userId: user.id },
      });
      await tx.privilegedMfaBackupCode.createMany({
        data: recoveryCodes.map((recoveryCode) => ({
          enrollmentId: enrollment.id,
          userId: user.id,
          codeDigest: this.digestRecoveryCode(recoveryCode),
        })),
      });
      await tx.privilegedMfaPreAuthSession.update({
        where: { id: session.id },
        data: { consumedAt: now },
      });
    });

    await this.audit('Privileged MFA Enrollment Completed', user, {
      preAuthSessionId: session.id,
      recoveryCodeCount: recoveryCodes.length,
      ipAddress: context?.ipAddress ?? null,
      userAgent: context?.userAgent ?? null,
    });

    return { user, recoveryCodes };
  }

  async completeChallenge(
    preAuthToken: string,
    method: 'totp' | 'recovery_code',
    code: string,
    context?: RequestContext,
  ) {
    const { session, user } = await this.validatePreAuth(
      preAuthToken,
      PrivilegedMfaPreAuthPurpose.CHALLENGE,
    );
    const enrollment = await this.activeEnrollment(user.id);
    if (!enrollment) {
      await this.recordFailedAttempt(session.id, session.failedAttempts);
      throw this.invalidMfaState();
    }

    if (method === 'totp') {
      await this.completeTotpChallenge(
        session,
        user,
        enrollment,
        code,
        context,
      );
      return { user, recoveryCodeUsed: false };
    }

    await this.completeRecoveryCodeChallenge(
      session,
      user,
      enrollment.id,
      code,
      context,
    );
    return { user, recoveryCodeUsed: true };
  }

  private async completeTotpChallenge(
    session: PreAuthValidation['session'],
    user: MfaUser,
    enrollment: {
      id: string;
      encryptedTotpSecret: string;
      lastVerifiedStep: bigint | number | null;
    },
    code: string,
    context?: RequestContext,
  ) {
    const secret = this.decrypt(enrollment.encryptedTotpSecret);
    const matchedStep = this.matchTotpStep(code, secret);
    if (
      matchedStep !== null &&
      enrollment.lastVerifiedStep !== null &&
      matchedStep <= BigInt(enrollment.lastVerifiedStep)
    ) {
      await this.recordFailedAttempt(session.id, session.failedAttempts);
      throw this.invalidMfaCode();
    }
    if (matchedStep === null) {
      await this.recordFailedAttempt(session.id, session.failedAttempts);
      await this.audit('Privileged MFA Challenge Failed', user, {
        method: 'totp',
        preAuthSessionId: session.id,
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
      });
      throw this.invalidMfaCode();
    }

    const now = new Date();
    const consumed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.privilegedMfaEnrollment.updateMany({
        where: {
          id: enrollment.id,
          OR: [
            { lastVerifiedStep: null },
            { lastVerifiedStep: { lt: matchedStep } },
          ],
        },
        data: { lastVerifiedAt: now, lastVerifiedStep: matchedStep },
      });
      if (result.count !== 1) return false;
      await tx.privilegedMfaPreAuthSession.update({
        where: { id: session.id },
        data: { consumedAt: now },
      });
      return true;
    });
    if (!consumed) {
      await this.recordFailedAttempt(session.id, session.failedAttempts);
      throw this.invalidMfaCode();
    }
    await this.audit('Privileged MFA Challenge Succeeded', user, {
      method: 'totp',
      preAuthSessionId: session.id,
      ipAddress: context?.ipAddress ?? null,
      userAgent: context?.userAgent ?? null,
    });
  }

  private async completeRecoveryCodeChallenge(
    session: PreAuthValidation['session'],
    user: MfaUser,
    enrollmentId: string,
    code: string,
    context?: RequestContext,
  ) {
    const codeDigest = this.digestRecoveryCode(code);
    const backupCode = await this.prisma.privilegedMfaBackupCode.findUnique({
      where: { codeDigest },
    });
    if (
      !backupCode ||
      backupCode.userId !== user.id ||
      backupCode.enrollmentId !== enrollmentId ||
      backupCode.usedAt
    ) {
      await this.recordFailedAttempt(session.id, session.failedAttempts);
      await this.audit('Privileged MFA Challenge Failed', user, {
        method: 'recovery_code',
        preAuthSessionId: session.id,
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
      });
      throw this.invalidMfaCode();
    }

    const now = new Date();
    const consumed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.privilegedMfaBackupCode.updateMany({
        where: {
          id: backupCode.id,
          codeDigest,
          userId: user.id,
          enrollmentId,
          usedAt: null,
        },
        data: { usedAt: now },
      });
      if (result.count !== 1) return false;
      await tx.privilegedMfaPreAuthSession.update({
        where: { id: session.id },
        data: { consumedAt: now },
      });
      return true;
    });
    if (!consumed) {
      await this.recordFailedAttempt(session.id, session.failedAttempts);
      await this.audit('Privileged MFA Challenge Failed', user, {
        method: 'recovery_code',
        preAuthSessionId: session.id,
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
      });
      throw this.invalidMfaCode();
    }
    await this.audit('Privileged MFA Recovery Code Used', user, {
      preAuthSessionId: session.id,
      backupCodeId: backupCode.id,
      ipAddress: context?.ipAddress ?? null,
      userAgent: context?.userAgent ?? null,
    });
  }

  private async validatePreAuth(
    preAuthToken: string,
    purpose: PrivilegedMfaPreAuthPurpose,
  ): Promise<PreAuthValidation> {
    const tokenDigest = this.digest(preAuthToken.trim());
    const session = await this.prisma.privilegedMfaPreAuthSession.findUnique({
      where: { tokenDigest },
      include: {
        user: {
          select: this.userSelect(),
        },
      },
    });
    if (
      !session ||
      session.purpose !== purpose ||
      session.consumedAt ||
      session.lockedAt ||
      session.expiresAt <= new Date() ||
      session.failedAttempts >= maxAttempts ||
      session.user.accountStatus !== AccountStatus.ACTIVE ||
      !requiresPrivilegedMfa(session.user.role)
    ) {
      throw this.invalidMfaState();
    }
    return {
      session: {
        id: session.id,
        userId: session.userId,
        failedAttempts: session.failedAttempts,
      },
      user: session.user,
    };
  }

  private async activeEnrollment(userId: string) {
    return this.prisma.privilegedMfaEnrollment.findFirst({
      where: {
        userId,
        status: PrivilegedMfaEnrollmentStatus.ACTIVE,
        disabledAt: null,
      },
      orderBy: { enabledAt: 'desc' },
    });
  }

  private async pendingEnrollment(userId: string) {
    return this.prisma.privilegedMfaEnrollment.findFirst({
      where: {
        userId,
        status: PrivilegedMfaEnrollmentStatus.PENDING,
        disabledAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async recordFailedAttempt(sessionId: string, failedAttempts: number) {
    const nextAttempts = failedAttempts + 1;
    await this.prisma.privilegedMfaPreAuthSession.update({
      where: { id: sessionId },
      data: {
        failedAttempts: { increment: 1 },
        ...(nextAttempts >= maxAttempts ? { lockedAt: new Date() } : {}),
      },
    });
  }

  private verifyTotp(code: string, secret: string): boolean {
    return this.matchTotpStep(code, secret) !== null;
  }

  private matchTotpStep(code: string, secret: string): bigint | null {
    const normalized = code.trim();
    if (!/^\d{6}$/.test(normalized)) return null;
    const currentStep = this.currentTotpStep();
    for (const offset of [-1n, 0n, 1n]) {
      const candidateStep = currentStep + offset;
      if (candidateStep < 0n) continue;
      const candidate = generateTotpCodeForStep(secret, candidateStep);
      if (timingSafeEqual(Buffer.from(candidate), Buffer.from(normalized))) {
        return candidateStep;
      }
    }
    return null;
  }

  private currentTotpStep() {
    return BigInt(Math.floor(Date.now() / 1000 / totpStepSeconds));
  }

  private generateRecoveryCodes() {
    return Array.from({ length: backupCodeCount }, () =>
      randomBytes(10)
        .toString('base64url')
        .replace(/[^A-Z0-9]/gi, '')
        .toUpperCase()
        .slice(0, 12)
        .replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3'),
    );
  }

  private provisioningUri(accountName: string, secret: string) {
    const issuer = 'SecureZone FixZone Administration';
    return `otpauth://totp/${encodeURIComponent(
      issuer,
    )}:${encodeURIComponent(accountName)}?secret=${encodeURIComponent(
      secret,
    )}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${totpStepSeconds}`;
  }

  private digestRecoveryCode(code: string) {
    return this.digest(code.replace(/[^A-Z0-9]/gi, '').toUpperCase());
  }

  private digest(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private encrypt(plaintext: string) {
    const iv = randomBytes(12);
    const key = this.encryptionKey();
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64url')}:${tag.toString(
      'base64url',
    )}:${ciphertext.toString('base64url')}`;
  }

  private decrypt(payload: string) {
    const [version, iv, tag, ciphertext] = payload.split(':');
    if (version !== 'v1' || !iv || !tag || !ciphertext) {
      throw new InternalServerErrorException('MFA secret payload is invalid');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey(),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private encryptionKey() {
    const raw = process.env.PRIVILEGED_MFA_ENCRYPTION_KEY?.trim();
    const key = raw ? this.parseEncryptionKey(raw) : null;
    if (key) return key;
    if (process.env.NODE_ENV === 'test') {
      return createHash('sha256').update('fixzone-test-mfa-key').digest();
    }
    throw new InternalServerErrorException(
      'Privileged MFA encryption is not configured',
    );
  }

  private parseEncryptionKey(raw: string) {
    const fromHex = /^[a-f0-9]{64}$/i.test(raw)
      ? Buffer.from(raw, 'hex')
      : null;
    if (fromHex?.length === 32) return fromHex;
    try {
      const fromBase64 = Buffer.from(raw, 'base64');
      return fromBase64.length === 32 ? fromBase64 : null;
    } catch {
      return null;
    }
  }

  private userSelect() {
    return {
      id: true,
      email: true,
      phone: true,
      fullName: true,
      role: true,
      organizationId: true,
      providerId: true,
      accountStatus: true,
      tokenVersion: true,
      phoneVerifiedAt: true,
      emailVerifiedAt: true,
      secureZoneId: true,
      identityVerificationStatus: true,
      identityVerificationLevel: true,
      trustScore: true,
      identityType: true,
    } satisfies Prisma.UserSelect;
  }

  private async audit(
    action: string,
    user: MfaUser,
    metadata: Record<string, unknown> = {},
  ) {
    await this.prisma.complianceAuditLog.create({
      data: {
        actorId: user.id,
        actorRole: user.role,
        organizationId: user.organizationId ?? null,
        action,
        entityType: 'PrivilegedMfa',
        entityId: user.id,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  private invalidMfaCode() {
    return new UnauthorizedException('MFA verification failed');
  }

  private invalidMfaState() {
    return new UnauthorizedException('MFA verification failed');
  }
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function generateTotpCode(secret: string, timeMs = Date.now()) {
  return generateTotpCodeForStep(
    secret,
    BigInt(Math.floor(timeMs / 1000 / totpStepSeconds)),
  );
}

export function generateTotpCodeForStep(secret: string, counter: bigint) {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(counter);
  const hmac = createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binary % 1_000_000).toString().padStart(6, '0');
}

function base32Encode(input: Buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += base32Alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string) {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input.replace(/=+$/g, '').toUpperCase()) {
    const index = base32Alphabet.indexOf(char);
    if (index === -1) throw new Error('Invalid TOTP secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
