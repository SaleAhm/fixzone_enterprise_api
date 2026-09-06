import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
  AccountStatus,
  IdentityVerificationStatus,
  Prisma,
  User,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrustService } from '../trust/trust.service';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import { getJwtAccessSecret } from './jwt-secret';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import {
  assertSupportedLocale,
  preferredLocaleFromProfile,
} from '../localization/supported-locales';
import {
  FirebaseAuthVerifierService,
  VerifiedFirebaseIdentity,
} from './firebase-auth-verifier.service';
import {
  CompletePasswordResetDto,
  RequestPasswordResetDto,
} from './dto/password-reset.dto';
import {
  PasswordResetDeliveryService,
  redactedResetIdentifier,
} from './password-reset-delivery.service';
import { PrivilegedMfaService } from './privileged-mfa.service';
import { requiresPrivilegedMfa } from './privileged-mfa.policy';

export type AuthUser = Pick<
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

@Injectable()
export class AuthService {
  private readonly defaultOrganizationName =
    process.env.DEFAULT_ORGANIZATION_NAME || 'FixZone Demo LGA';

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly trustService: TrustService,
    private readonly firebaseAuthVerifier: FirebaseAuthVerifierService,
    private readonly passwordResetDelivery?: PasswordResetDeliveryService,
    private readonly privilegedMfa?: PrivilegedMfaService,
  ) {}

  async register(dto: RegisterDto) {
    if (dto.role !== undefined) {
      await this.audit(
        'Public Registration Role Selection Rejected',
        'anonymous',
        {
          requestedRoleType:
            dto.role === null
              ? 'null'
              : Array.isArray(dto.role)
                ? 'array'
                : typeof dto.role,
          requestedRole:
            typeof dto.role === 'string'
              ? dto.role.trim().slice(0, 64)
              : undefined,
        },
      );
      throw new BadRequestException(
        'Role cannot be selected during public registration',
      );
    }

    if (!dto.email && !dto.phone) {
      throw new BadRequestException('Email or phone is required');
    }

    const orFilters = [
      dto.email ? { email: dto.email.toLowerCase().trim() } : null,
      dto.phone ? { phone: dto.phone.trim() } : null,
    ].filter(
      (value): value is { email: string } | { phone: string } => value !== null,
    );

    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: orFilters,
      },
    });

    if (existingUser) {
      throw new BadRequestException('User already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    let user = await this.prisma.user.create({
      data: {
        fullName: dto.fullName.trim(),
        email: dto.email ? dto.email.toLowerCase().trim() : null,
        phone: dto.phone ? dto.phone.trim() : null,
        passwordHash,
        role: UserRole.CITIZEN,
        organizationId: null,
      },
      select: {
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
      },
    });

    user = { ...user, ...(await this.trustService.ensureIdentity(user.id)) };

    return this.issueTokens(user);
  }

  async login(
    dto: LoginDto,
    context?: { ipAddress?: string | null; userAgent?: string | null },
  ) {
    if (!dto.email && !dto.phone && !dto.providerId) {
      throw new BadRequestException('Email, phone or provider ID is required');
    }

    const orFilters =
      dto.email || dto.phone
        ? [
            dto.email ? { email: dto.email.toLowerCase().trim() } : null,
            dto.phone ? { phone: dto.phone.trim() } : null,
          ].filter(
            (value): value is { email: string } | { phone: string } =>
              value !== null,
          )
        : [{ providerId: dto.providerId!.trim() }];

    const user = await this.prisma.user.findFirst({
      where: {
        OR: orFilters,
      },
    });

    if (!user || !user.passwordHash) {
      await this.audit('Failed Login', 'anonymous', {
        reason: 'user_not_found',
      });
      await this.trustService.recordLogin({
        success: false,
        failureReason: 'user_not_found',
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });
      throw this.genericAuthFailure();
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      await this.audit('Failed Login', user.id, {
        reason: 'invalid_password',
      });
      await this.trustService.recordLogin({
        userId: user.id,
        success: false,
        failureReason: 'invalid_password',
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });
      throw this.genericAuthFailure();
    }

    if (user.accountStatus !== AccountStatus.ACTIVE) {
      await this.audit('Inactive Login Blocked', user.id, {
        role: user.role,
        accountStatus: user.accountStatus,
      });
      await this.trustService.recordLogin({
        userId: user.id,
        success: false,
        failureReason: `account_${user.accountStatus.toLowerCase()}`,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });
      throw this.genericAuthFailure();
    }

    const requestedProviderId = dto.providerId?.trim();
    if (requestedProviderId) {
      if (
        user.role !== UserRole.PROVIDER ||
        user.providerId !== requestedProviderId
      ) {
        await this.audit('Provider Login ID Mismatch', user.id, {
          role: user.role,
          reason: 'provider_id_mismatch',
        });
        await this.trustService.recordLogin({
          userId: user.id,
          success: false,
          failureReason: 'provider_id_mismatch',
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
        });
        throw this.genericAuthFailure();
      }
    }

    const identityUser = await this.trustService.ensureIdentity(user.id);
    const authUser = {
      id: user.id,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
      providerId: user.providerId,
      accountStatus: user.accountStatus,
      tokenVersion: user.tokenVersion,
      phoneVerifiedAt: user.phoneVerifiedAt,
      emailVerifiedAt: user.emailVerifiedAt,
      secureZoneId: identityUser.secureZoneId,
      identityVerificationStatus: identityUser.identityVerificationStatus,
      identityVerificationLevel: identityUser.identityVerificationLevel,
      trustScore: identityUser.trustScore,
      identityType: identityUser.identityType,
    };

    if (requiresPrivilegedMfa(user.role)) {
      if (!this.privilegedMfa) {
        await this.audit('Privileged Login MFA Foundation Missing', user.id, {
          role: user.role,
        });
        throw this.genericAuthFailure();
      }
      await this.trustService.recordLogin({
        userId: user.id,
        success: false,
        failureReason: 'mfa_pending',
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });
      return this.privilegedMfa.createPreAuthSession(authUser, context);
    }

    await this.audit('Login', user.id, {
      role: user.role,
    });
    await this.trustService.recordLogin({
      userId: user.id,
      success: true,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return this.issueTokens(authUser);
  }

  async startMfaEnrollment(
    preAuthToken: string,
    context?: { ipAddress?: string | null; userAgent?: string | null },
  ) {
    return this.requiredPrivilegedMfa().startEnrollment(preAuthToken, context);
  }

  async confirmMfaEnrollment(
    preAuthToken: string,
    code: string,
    context?: { ipAddress?: string | null; userAgent?: string | null },
  ) {
    const result = await this.requiredPrivilegedMfa().confirmEnrollment(
      preAuthToken,
      code,
      context,
    );
    await this.audit('Login', result.user.id, {
      role: result.user.role,
      mfa: 'enrollment_confirmed',
    });
    await this.trustService.recordLogin({
      userId: result.user.id,
      success: true,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });
    return {
      status: 'MFA_ENROLLMENT_CONFIRMED',
      ...(await this.issueTokens(result.user)),
      recoveryCodes: result.recoveryCodes,
    };
  }

  async completeMfaChallenge(
    preAuthToken: string,
    method: 'totp' | 'recovery_code',
    code: string,
    context?: { ipAddress?: string | null; userAgent?: string | null },
  ) {
    const result = await this.requiredPrivilegedMfa().completeChallenge(
      preAuthToken,
      method,
      code,
      context,
    );
    await this.audit('Login', result.user.id, {
      role: result.user.role,
      mfa: result.recoveryCodeUsed ? 'recovery_code' : 'totp',
    });
    await this.trustService.recordLogin({
      userId: result.user.id,
      success: true,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });
    return {
      status: 'MFA_CHALLENGE_CONFIRMED',
      ...(await this.issueTokens(result.user)),
    };
  }

  async updateMe(user: AuthUser, dto: Record<string, unknown>) {
    const data: Prisma.UserUpdateInput = {};
    const existing = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        email: true,
        phone: true,
        phoneVerifiedAt: true,
        profileData: true,
      },
    });

    if (!existing) {
      throw new UnauthorizedException('User no longer exists');
    }

    if (typeof dto.fullName === 'string' && dto.fullName.trim().length >= 2) {
      data.fullName = dto.fullName.trim();
    }

    if (typeof dto.phone === 'string') {
      const requestedPhone = dto.phone.trim() || null;
      const existingPhone = existing.phone?.trim() || null;
      if (requestedPhone !== existingPhone) {
        throw new BadRequestException(
          'Phone changes require secure verification',
        );
      }
    }

    if (typeof dto.email === 'string') {
      const requestedEmail = dto.email.toLowerCase().trim() || null;
      const existingEmail = existing.email?.toLowerCase().trim() || null;
      if (requestedEmail !== existingEmail) {
        throw new BadRequestException(
          'Email changes require secure verification',
        );
      }
    }

    const profileData: Record<string, unknown> = {};
    for (const key of ['address', 'state', 'lga', 'emergencyContact']) {
      const value = dto[key];
      if (typeof value === 'string') {
        profileData[key] = value.trim() || null;
      }
    }

    if (
      dto.preferredLanguage !== undefined ||
      dto.preferredLocale !== undefined
    ) {
      profileData.preferredLanguage = assertSupportedLocale(
        dto.preferredLocale ?? dto.preferredLanguage,
      );
    }

    const notificationPreferences = dto.notificationPreferences;
    if (
      notificationPreferences &&
      typeof notificationPreferences === 'object' &&
      !Array.isArray(notificationPreferences)
    ) {
      profileData.notificationPreferences = notificationPreferences;
    }

    if (Object.keys(profileData).length > 0) {
      const existingProfile =
        existing?.profileData &&
        typeof existing.profileData === 'object' &&
        !Array.isArray(existing.profileData)
          ? (existing.profileData as Record<string, unknown>)
          : {};
      data.profileData = {
        ...existingProfile,
        ...profileData,
      } as Prisma.InputJsonValue;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No supported profile fields provided');
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data,
      select: {
        id: true,
        secureZoneId: true,
        email: true,
        phone: true,
        firebaseUid: true,
        fullName: true,
        role: true,
        organizationId: true,
        providerId: true,
        accountStatus: true,
        phoneVerifiedAt: true,
        emailVerifiedAt: true,
        providerEngagementType: true,
        serviceCategories: true,
        coverageAreas: true,
        profileData: true,
        subscriptionPlan: true,
        identityVerificationStatus: true,
        identityVerificationLevel: true,
        trustScore: true,
        identityType: true,
        createdAt: true,
        organization: {
          select: {
            id: true,
            name: true,
            type: true,
            subscriptionPlan: true,
            billingStatus: true,
          },
        },
      },
    });

    await this.audit('Profile Updated', user.id, {
      role: user.role,
      changes: Object.keys(data),
    });

    return {
      id: updated.id,
      secureZoneId: updated.secureZoneId,
      userId: updated.id,
      sub: updated.id,
      email: updated.email,
      phone: updated.phone,
      firebaseUid: updated.firebaseUid,
      fullName: updated.fullName,
      role: updated.role,
      organizationId: updated.organizationId,
      providerId: updated.providerId,
      accountStatus: updated.accountStatus,
      phoneVerifiedAt: updated.phoneVerifiedAt,
      emailVerifiedAt: updated.emailVerifiedAt,
      providerEngagementType: updated.providerEngagementType,
      serviceCategories: updated.serviceCategories,
      coverageAreas: updated.coverageAreas,
      profileData: updated.profileData,
      preferredLocale: preferredLocaleFromProfile(updated.profileData),
      subscriptionPlan: updated.subscriptionPlan,
      identityVerificationStatus: updated.identityVerificationStatus,
      identityVerificationLevel: updated.identityVerificationLevel,
      trustScore: updated.trustScore,
      identityType: updated.identityType,
      organization: updated.organization,
    };
  }

  async firebaseLogin(dto: FirebaseLoginDto) {
    let firebaseIdentity: VerifiedFirebaseIdentity;
    try {
      firebaseIdentity = await this.firebaseAuthVerifier.verifyIdToken(
        dto.idToken,
      );
    } catch {
      await this.audit('Firebase Login Rejected', 'anonymous', {
        reason: 'firebase_token_invalid',
      });
      throw this.genericAuthFailure();
    }
    const firebaseUid = firebaseIdentity.uid.trim();
    const phone = firebaseIdentity.phoneNumber?.trim() || null;
    const email = firebaseIdentity.email?.toLowerCase().trim() || null;
    const verifiedEmail = firebaseIdentity.emailVerified ? email : null;
    const hasVerifiedPhone = Boolean(phone);
    const hasVerifiedEmail = Boolean(verifiedEmail);
    const fullName =
      dto.fullName?.trim() ||
      firebaseIdentity.fullName?.trim() ||
      'Citizen User';

    if (!firebaseUid) {
      throw this.genericAuthFailure();
    }
    if (!hasVerifiedPhone && !hasVerifiedEmail) {
      await this.auditFirebaseLoginConflict(firebaseIdentity, 'unverified');
      throw this.genericAuthFailure();
    }
    const organizationId = await this.getDefaultCitizenOrganizationId();

    const [existingByFirebaseUid, existingByPhone, existingByEmail] =
      await Promise.all([
        this.prisma.user.findUnique({ where: { firebaseUid } }),
        phone ? this.prisma.user.findUnique({ where: { phone } }) : null,
        verifiedEmail
          ? this.prisma.user.findUnique({ where: { email: verifiedEmail } })
          : null,
      ]);

    await this.assertSameFirebaseCitizen(firebaseIdentity, [
      ['uid', existingByFirebaseUid],
      ['phone', existingByPhone],
      ['email', existingByEmail],
    ]);

    const existingUser =
      existingByFirebaseUid ?? existingByPhone ?? existingByEmail;

    if (existingUser && existingUser.role !== UserRole.CITIZEN) {
      await this.auditFirebaseLoginConflict(firebaseIdentity, 'role_boundary');
      throw this.genericAuthFailure();
    }

    if (existingUser && existingUser.accountStatus !== AccountStatus.ACTIVE) {
      await this.auditFirebaseLoginConflict(
        firebaseIdentity,
        `account_${existingUser.accountStatus.toLowerCase()}`,
      );
      throw this.genericAuthFailure();
    }

    if (existingUser?.firebaseUid && existingUser.firebaseUid !== firebaseUid) {
      await this.auditFirebaseLoginConflict(firebaseIdentity, 'uid_mismatch');
      throw this.genericAuthFailure();
    }

    if (
      dto.intent === 'registration' &&
      verifiedEmail &&
      existingByEmail &&
      existingByEmail.id === existingUser?.id &&
      !existingByEmail.firebaseUid &&
      !existingByFirebaseUid
    ) {
      await this.auditFirebaseLoginConflict(
        firebaseIdentity,
        'registration_email_recovery_required',
      );
      return {
        outcome: 'RECOVERY_REQUIRED',
        code: 'CITIZEN_EMAIL_RECOVERY_REQUIRED',
        message:
          'This verified email is associated with an existing FixZone account. Continue through secure account recovery.',
      };
    }

    if (existingUser?.phone && phone && existingUser.phone !== phone) {
      const phoneOwner = await this.prisma.user.findUnique({
        where: { phone },
      });
      if (phoneOwner && phoneOwner.id !== existingUser.id) {
        await this.auditFirebaseLoginConflict(firebaseIdentity, 'phone_owner');
        throw this.genericAuthFailure();
      }
    }

    if (
      existingUser?.email &&
      verifiedEmail &&
      existingUser.email !== verifiedEmail
    ) {
      const emailOwner = await this.prisma.user.findUnique({
        where: { email: verifiedEmail },
      });
      if (emailOwner && emailOwner.id !== existingUser.id) {
        await this.auditFirebaseLoginConflict(firebaseIdentity, 'email_owner');
        throw this.genericAuthFailure();
      }
    }

    const now = new Date();
    const nextStatus = this.nextFirebaseIdentityStatus(existingUser, {
      hasVerifiedEmail,
      hasVerifiedPhone,
    });
    const nextLevel = this.nextFirebaseIdentityLevel(existingUser, {
      hasVerifiedEmail,
      hasVerifiedPhone,
    });

    const user = existingUser
      ? await this.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            firebaseUid: existingUser.firebaseUid ?? firebaseUid,
            phone: phone ?? existingUser.phone,
            phoneVerifiedAt: phone
              ? (existingUser.phoneVerifiedAt ?? now)
              : existingUser.phoneVerifiedAt,
            identityVerificationStatus: nextStatus,
            identityVerificationLevel: nextLevel,
            email: verifiedEmail ?? existingUser.email,
            emailVerifiedAt: verifiedEmail
              ? (existingUser.emailVerifiedAt ?? now)
              : existingUser.emailVerifiedAt,
            fullName: dto.fullName?.trim() || existingUser.fullName || fullName,
            role: UserRole.CITIZEN,
            organizationId: existingUser.organizationId ?? organizationId,
          },
          select: {
            id: true,
            secureZoneId: true,
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
            identityVerificationStatus: true,
            identityVerificationLevel: true,
            trustScore: true,
            identityType: true,
          },
        })
      : await this.prisma.user.create({
          data: {
            firebaseUid,
            phone,
            phoneVerifiedAt: phone ? now : null,
            identityVerificationStatus: nextStatus,
            identityVerificationLevel: nextLevel,
            email: verifiedEmail,
            emailVerifiedAt: verifiedEmail ? now : null,
            fullName,
            role: UserRole.CITIZEN,
            organizationId,
          },
          select: {
            id: true,
            secureZoneId: true,
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
            identityVerificationStatus: true,
            identityVerificationLevel: true,
            trustScore: true,
            identityType: true,
          },
        });

    const identityUser = await this.trustService.ensureIdentity(user.id);

    return this.issueTokens({ ...identityUser, ...user });
  }

  private async auditFirebaseLoginConflict(
    identity: VerifiedFirebaseIdentity,
    reason: string,
  ) {
    await this.audit('Firebase Login Rejected', 'anonymous', {
      reason,
      uidHash: this.safeHash(identity.uid),
      hasPhoneClaim: Boolean(identity.phoneNumber),
      hasEmailClaim: Boolean(identity.email),
      emailVerified: identity.emailVerified,
      providerTypePresent: Boolean(identity.signInProvider),
    });
  }

  private async assertSameFirebaseCitizen(
    identity: VerifiedFirebaseIdentity,
    matches: Array<[string, User | null]>,
  ) {
    const existing = matches.filter(
      (match): match is [string, User] => match[1] !== null,
    );
    const first = existing[0]?.[1];
    const conflicting = existing.find(([, user]) => user.id !== first?.id);
    if (conflicting) {
      await this.auditFirebaseLoginConflict(
        identity,
        `${existing[0][0]}_${conflicting[0]}`,
      );
      throw this.genericAuthFailure();
    }
  }

  private nextFirebaseIdentityStatus(
    existingUser: User | null,
    verified: { hasVerifiedEmail: boolean; hasVerifiedPhone: boolean },
  ) {
    const current =
      existingUser?.identityVerificationStatus ??
      IdentityVerificationStatus.UNVERIFIED;
    if (current !== IdentityVerificationStatus.UNVERIFIED) return current;
    if (verified.hasVerifiedPhone) {
      return IdentityVerificationStatus.PHONE_VERIFIED;
    }
    if (verified.hasVerifiedEmail) {
      return IdentityVerificationStatus.EMAIL_VERIFIED;
    }
    return IdentityVerificationStatus.UNVERIFIED;
  }

  private nextFirebaseIdentityLevel(
    existingUser: User | null,
    verified: { hasVerifiedEmail: boolean; hasVerifiedPhone: boolean },
  ) {
    const current = existingUser?.identityVerificationLevel ?? 0;
    const firebaseLevel = verified.hasVerifiedPhone
      ? 2
      : verified.hasVerifiedEmail
        ? 1
        : 0;
    return Math.max(current, firebaseLevel);
  }

  async requestPasswordReset(dto: RequestPasswordResetDto) {
    const filters = [
      dto.email ? { email: dto.email.toLowerCase().trim() } : null,
      dto.phone ? { phone: dto.phone.trim() } : null,
    ].filter(
      (value): value is { email: string } | { phone: string } => value !== null,
    );
    if (!filters.length) {
      throw new BadRequestException('Email or phone is required');
    }

    const user = await this.prisma.user.findFirst({ where: { OR: filters } });
    if (
      !user ||
      !user.passwordHash ||
      user.accountStatus !== AccountStatus.ACTIVE
    ) {
      await this.audit('Password Reset Request', user?.id ?? 'anonymous', {
        outcome: 'accepted_without_delivery',
        reason: user ? 'ineligible_account' : 'identity_not_found',
        identifierHash: redactedResetIdentifier(dto.email ?? dto.phone),
      });
      return this.passwordResetRequestResponse('DELIVERY_UNAVAILABLE');
    }

    return this.createPasswordResetToken(user.id, null, dto.returnTo);
  }

  async issueAdministrativePasswordReset(
    targetUserId: string,
    actorUserId: string,
  ) {
    return this.createPasswordResetToken(targetUserId, actorUserId);
  }

  async completePasswordReset(dto: CompletePasswordResetDto) {
    const password = dto.password.trim();
    if (!this.isCompliantPassword(password)) {
      throw new BadRequestException('Password does not meet requirements');
    }

    const tokenDigest = this.hashResetToken(dto.token.trim());
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenDigest },
      include: { user: true },
    });
    const now = new Date();
    if (
      !record ||
      record.usedAt ||
      record.supersededAt ||
      record.expiresAt <= now ||
      record.user.accountStatus !== AccountStatus.ACTIVE
    ) {
      await this.audit(
        'Password Reset Rejected',
        record?.userId ?? 'anonymous',
        {
          reason: !record
            ? 'token_not_found'
            : record.usedAt
              ? 'token_reuse'
              : record.supersededAt
                ? 'token_superseded'
                : record.expiresAt <= now
                  ? 'token_expired'
                  : 'ineligible_account',
        },
      );
      throw this.genericAuthFailure();
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: now },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          tokenVersion: { increment: 1 },
        },
      }),
    ]);
    await this.audit('Password Reset Completed', record.userId, {
      resetTokenId: record.id,
      sessionVersionAdvanced: true,
    });
    return { message: 'Password reset completed.' };
  }

  async issueTokensForOnboarding(user: AuthUser) {
    return this.issueTokens(user);
  }

  private async audit(
    action: string,
    actorUserId: string,
    metadata: Record<string, unknown> = {},
  ) {
    await this.prisma.demoAuditLog.create({
      data: {
        action,
        actorUserId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  private async getDefaultCitizenOrganizationId() {
    const organization = await this.prisma.organization.findFirst({
      where: {
        name: this.defaultOrganizationName,
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
      },
    });

    if (organization) {
      return organization.id;
    }

    const createdOrganization = await this.prisma.organization.create({
      data: {
        name: this.defaultOrganizationName,
      },
      select: {
        id: true,
      },
    });

    return createdOrganization.id;
  }

  private async issueTokens(user: AuthUser) {
    const tokenVersion =
      Number.isInteger(user.tokenVersion) && user.tokenVersion >= 0
        ? user.tokenVersion
        : 0;
    const payload = {
      id: user.id,
      sub: user.id,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
      providerId: user.providerId,
      accountStatus: user.accountStatus,
      tokenVersion,
      phoneVerifiedAt: user.phoneVerifiedAt,
      emailVerifiedAt: user.emailVerifiedAt,
      secureZoneId: user.secureZoneId,
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: getJwtAccessSecret(),
      expiresIn: '1d',
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        fullName: user.fullName,
        role: user.role,
        organizationId: user.organizationId,
        providerId: user.providerId,
        accountStatus: user.accountStatus,
        tokenVersion,
        phoneVerifiedAt: user.phoneVerifiedAt,
        emailVerifiedAt: user.emailVerifiedAt,
        secureZoneId: user.secureZoneId,
        identityVerificationStatus: user.identityVerificationStatus,
        identityVerificationLevel: user.identityVerificationLevel,
        trustScore: user.trustScore,
        identityType: user.identityType,
      },
      accessToken,
    };
  }

  private safeHash(value: string) {
    return createHash('sha256').update(value).digest('hex').slice(0, 24);
  }

  private async createPasswordResetToken(
    targetUserId: string,
    actorUserId: string | null,
    returnTo?: string,
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        accountStatus: true,
      },
    });
    if (
      !target ||
      !target.passwordHash ||
      target.accountStatus !== AccountStatus.ACTIVE
    ) {
      await this.audit(
        'Password Reset Requested',
        actorUserId ?? targetUserId,
        {
          targetUserId,
          administrativeActor: actorUserId !== null,
          deliveryStatus: 'DELIVERY_UNAVAILABLE',
          outcome: target ? 'ineligible_account' : 'identity_not_found',
        },
      );
      return this.passwordResetRequestResponse('DELIVERY_UNAVAILABLE');
    }

    if (!this.passwordResetDelivery?.isEnabled() || !target.email) {
      await this.audit(
        'Password Reset Requested',
        actorUserId ?? targetUserId,
        {
          targetUserId,
          administrativeActor: actorUserId !== null,
          deliveryStatus: 'DELIVERY_UNAVAILABLE',
          outcome: target.email ? 'delivery_disabled' : 'email_unavailable',
        },
      );
      return this.passwordResetRequestResponse('DELIVERY_UNAVAILABLE');
    }

    const limited = await this.passwordResetRateLimited(targetUserId);
    if (limited) {
      await this.audit(
        'Password Reset Requested',
        actorUserId ?? targetUserId,
        {
          targetUserId,
          administrativeActor: actorUserId !== null,
          deliveryStatus: 'DELIVERY_UNAVAILABLE',
          outcome: limited,
        },
      );
      return this.passwordResetRequestResponse('DELIVERY_UNAVAILABLE');
    }

    const token = randomBytes(32).toString('base64url');
    const tokenDigest = this.hashResetToken(token);
    const expiresAt = new Date(Date.now() + this.passwordResetTtlMs());
    const now = new Date();
    let resetTokenId = '';

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: {
          userId: targetUserId,
          usedAt: null,
          supersededAt: null,
          expiresAt: { gt: now },
        },
        data: { supersededAt: now },
      });
      const created = await tx.passwordResetToken.create({
        data: {
          userId: targetUserId,
          tokenDigest,
          expiresAt,
          requestedById: actorUserId,
          deliveryStatus: 'DELIVERY_PENDING',
        },
      });
      resetTokenId = created.id;
    });

    const delivery = await this.passwordResetDelivery.deliver({
      userId: targetUserId,
      recipientEmail: target.email,
      token,
      expiresAt,
      ...(this.safePasswordResetReturnTo(returnTo)
        ? { returnTo: this.safePasswordResetReturnTo(returnTo) }
        : {}),
    });
    const deliveryStatus = delivery.status;

    await this.prisma.passwordResetToken.update({
      where: { id: resetTokenId },
      data: {
        deliveryStatus,
        ...(delivery.delivered ? {} : { supersededAt: new Date() }),
      },
    });

    await this.audit(
      'Password Reset Delivery Attempted',
      actorUserId ?? targetUserId,
      {
        targetUserId,
        administrativeActor: actorUserId !== null,
        deliveryStatus,
        attempts: delivery.attempts,
        errorCategory: delivery.errorCategory ?? null,
        recipientHash: redactedResetIdentifier(target.email),
      },
    );

    await this.audit('Password Reset Requested', actorUserId ?? targetUserId, {
      targetUserId,
      administrativeActor: actorUserId !== null,
      deliveryStatus,
      expiresAt: expiresAt.toISOString(),
    });
    return this.passwordResetRequestResponse(deliveryStatus);
  }

  private passwordResetRequestResponse(deliveryStatus: string) {
    void deliveryStatus;
    return {
      message:
        'If the account is eligible and delivery is available, recovery instructions will be sent. No password was changed.',
    };
  }

  private hashResetToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private safePasswordResetReturnTo(route: string | undefined) {
    const normalized = route?.trim();
    if (
      normalized === '/citizen-login' ||
      normalized === '/provider-login' ||
      normalized === '/admin-login'
    ) {
      return normalized;
    }
    return undefined;
  }

  private passwordResetTtlMs() {
    const minutes = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES ?? 15);
    const boundedMinutes =
      Number.isFinite(minutes) && minutes > 0 && minutes <= 60 ? minutes : 15;
    return boundedMinutes * 60_000;
  }

  private async passwordResetRateLimited(targetUserId: string) {
    const policy = this.passwordResetDelivery?.policy() ?? {
      cooldownSeconds: 120,
      dailyLimit: 5,
    };
    const now = Date.now();
    const cooldownSince = new Date(now - policy.cooldownSeconds * 1000);
    const daySince = new Date(now - 24 * 60 * 60 * 1000);
    const [recent, daily] = await Promise.all([
      this.prisma.passwordResetToken.count({
        where: {
          userId: targetUserId,
          createdAt: { gte: cooldownSince },
        },
      }),
      this.prisma.passwordResetToken.count({
        where: {
          userId: targetUserId,
          createdAt: { gte: daySince },
        },
      }),
    ]);
    if (recent > 0) return 'cooldown_limited';
    if (daily >= policy.dailyLimit) return 'daily_limited';
    return null;
  }

  private isCompliantPassword(password: string) {
    return (
      password.length >= 8 &&
      /[a-z]/.test(password) &&
      /[A-Z]/.test(password) &&
      /\d/.test(password)
    );
  }

  private genericAuthFailure() {
    return new UnauthorizedException('Authentication failed');
  }

  private requiredPrivilegedMfa() {
    if (!this.privilegedMfa) {
      throw new UnauthorizedException('MFA verification failed');
    }
    return this.privilegedMfa;
  }
}
