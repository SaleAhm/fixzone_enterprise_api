import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
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

type AuthUser = Pick<
  User,
  | 'id'
  | 'email'
  | 'phone'
  | 'fullName'
  | 'role'
  | 'organizationId'
  | 'providerId'
  | 'accountStatus'
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
  ) {}

  async register(dto: RegisterDto) {
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
    const prismaRole = this.mapApiRoleToPrismaRole(dto.role);

    let organizationId: string | null = dto.organizationId?.trim() || null;

    if (prismaRole === UserRole.ORG_ADMIN) {
      if (organizationId && dto.organizationName?.trim()) {
        throw new BadRequestException(
          'Provide either organizationId or organizationName, not both',
        );
      }

      if (!organizationId && !dto.organizationName?.trim()) {
        throw new BadRequestException(
          'organizationName or organizationId is required for ORG_ADMIN',
        );
      }

      if (!organizationId && dto.organizationName?.trim()) {
        const organization = await this.prisma.organization.create({
          data: {
            name: dto.organizationName.trim(),
          },
        });

        organizationId = organization.id;
      }
    }

    let user = await this.prisma.user.create({
      data: {
        fullName: dto.fullName.trim(),
        email: dto.email ? dto.email.toLowerCase().trim() : null,
        phone: dto.phone ? dto.phone.trim() : null,
        passwordHash,
        role: prismaRole,
        organizationId,
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
        phoneVerifiedAt: true,
        emailVerifiedAt: true,
        secureZoneId: true,
      },
    });

    user = await this.trustService.ensureIdentity(user.id);

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
        email: dto.email?.toLowerCase().trim() ?? null,
        phone: dto.phone?.trim() ?? null,
        reason: 'user_not_found',
      });
      await this.trustService.recordLogin({
        email: dto.email,
        success: false,
        failureReason: 'user_not_found',
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });
      throw new UnauthorizedException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      await this.audit('Failed Login', user.id, {
        email: user.email,
        reason: 'invalid_password',
      });
      await this.trustService.recordLogin({
        userId: user.id,
        email: user.email,
        success: false,
        failureReason: 'invalid_password',
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });
      throw new UnauthorizedException('Incorrect password');
    }

    if (user.accountStatus !== 'ACTIVE') {
      await this.audit('Inactive Login Blocked', user.id, {
        email: user.email,
        role: user.role,
        accountStatus: user.accountStatus,
      });
      await this.trustService.recordLogin({
        userId: user.id,
        email: user.email,
        success: false,
        failureReason: `account_${user.accountStatus.toLowerCase()}`,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });
      throw new UnauthorizedException(
        user.accountStatus === 'PENDING_INVITE'
          ? 'Invitation has not been accepted'
          : user.accountStatus === 'PENDING_APPROVAL'
            ? 'Account is pending approval'
            : user.accountStatus === 'DEACTIVATED'
              ? 'Account is inactive'
              : 'Account is suspended',
      );
    }

    const requestedProviderId = dto.providerId?.trim();
    if (requestedProviderId) {
      if (
        user.role !== UserRole.PROVIDER ||
        user.providerId !== requestedProviderId
      ) {
        await this.audit('Provider Login ID Mismatch', user.id, {
          email: user.email,
          requestedProviderId,
          actualProviderId: user.providerId,
          role: user.role,
        });
        await this.trustService.recordLogin({
          userId: user.id,
          email: user.email,
          success: false,
          failureReason: 'provider_id_mismatch',
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
        });
        throw new UnauthorizedException('Invalid provider credentials');
      }
    }

    await this.audit('Login', user.id, {
      email: user.email,
      role: user.role,
    });
    const identityUser = await this.trustService.ensureIdentity(user.id);
    await this.trustService.recordLogin({
      userId: user.id,
      email: user.email,
      success: true,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return this.issueTokens({
      id: user.id,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
      providerId: user.providerId,
      accountStatus: user.accountStatus,
      phoneVerifiedAt: user.phoneVerifiedAt,
      emailVerifiedAt: user.emailVerifiedAt,
      secureZoneId: identityUser.secureZoneId,
      identityVerificationStatus: identityUser.identityVerificationStatus,
      identityVerificationLevel: identityUser.identityVerificationLevel,
      trustScore: identityUser.trustScore,
      identityType: identityUser.identityType,
    });
  }

  async updateMe(user: AuthUser, dto: Record<string, unknown>) {
    const data: Prisma.UserUpdateInput = {};

    if (typeof dto.fullName === 'string' && dto.fullName.trim().length >= 2) {
      data.fullName = dto.fullName.trim();
    }

    if (typeof dto.phone === 'string') {
      data.phone = dto.phone.trim() || null;
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
      const existing = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { profileData: true },
      });
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
    const firebaseIdentity = await this.firebaseAuthVerifier.verifyIdToken(
      dto.idToken,
    );
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
      throw new UnauthorizedException('External authentication failed');
    }
    if (!hasVerifiedPhone && !hasVerifiedEmail) {
      await this.auditFirebaseLoginConflict(firebaseIdentity, 'unverified');
      throw new UnauthorizedException('External authentication failed');
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
      throw new UnauthorizedException('External authentication failed');
    }

    if (existingUser?.firebaseUid && existingUser.firebaseUid !== firebaseUid) {
      await this.auditFirebaseLoginConflict(firebaseIdentity, 'uid_mismatch');
      throw new UnauthorizedException('External authentication failed');
    }

    if (existingUser?.phone && phone && existingUser.phone !== phone) {
      const phoneOwner = await this.prisma.user.findUnique({
        where: { phone },
      });
      if (phoneOwner && phoneOwner.id !== existingUser.id) {
        await this.auditFirebaseLoginConflict(firebaseIdentity, 'phone_owner');
        throw new UnauthorizedException('External authentication failed');
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
        throw new UnauthorizedException('External authentication failed');
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
            phoneVerifiedAt: true,
            emailVerifiedAt: true,
            identityVerificationStatus: true,
            identityVerificationLevel: true,
            trustScore: true,
            identityType: true,
          },
        });

    const identityUser = await this.trustService.ensureIdentity(user.id);

    return this.issueTokens({ ...user, ...identityUser });
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
      signInProvider: identity.signInProvider ?? null,
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
      throw new UnauthorizedException('External authentication failed');
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

  private mapApiRoleToPrismaRole(role?: string): UserRole {
    const normalizedRole = String(role ?? '')
      .trim()
      .toUpperCase();

    switch (normalizedRole) {
      case 'SUPER_ADMIN':
        return UserRole.SUPER_ADMIN;
      case 'ORG_ADMIN':
      case 'ADMIN':
        return UserRole.ORG_ADMIN;
      case 'DISPATCH_OFFICER':
        return UserRole.DISPATCH_OFFICER;
      case 'PROVIDER':
        return UserRole.PROVIDER;
      case 'PENDING_PROVIDER':
        return UserRole.PENDING_PROVIDER;
      case 'CITIZEN':
        return UserRole.CITIZEN;
      default:
        throw new BadRequestException(`Unsupported role: ${role}`);
    }
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
}
