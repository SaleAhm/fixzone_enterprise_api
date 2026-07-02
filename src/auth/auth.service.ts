import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Prisma, User, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

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
>;

@Injectable()
export class AuthService {
  private readonly defaultOrganizationName =
    process.env.DEFAULT_ORGANIZATION_NAME || 'FixZone Demo LGA';

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
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

    const user = await this.prisma.user.create({
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
      },
    });

    return this.issueTokens(user);
  }

  async login(dto: LoginDto) {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('Email or phone is required');
    }

    const orFilters = [
      dto.email ? { email: dto.email.toLowerCase().trim() } : null,
      dto.phone ? { phone: dto.phone.trim() } : null,
    ].filter(
      (value): value is { email: string } | { phone: string } => value !== null,
    );

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
      throw new UnauthorizedException('Incorrect password');
    }

    if (user.accountStatus !== 'ACTIVE') {
      await this.audit('Inactive Login Blocked', user.id, {
        email: user.email,
        role: user.role,
        accountStatus: user.accountStatus,
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
        throw new UnauthorizedException('Invalid provider credentials');
      }
    }

    await this.audit('Login', user.id, {
      email: user.email,
      role: user.role,
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
    for (const key of [
      'address',
      'state',
      'lga',
      'preferredLanguage',
      'emergencyContact',
    ]) {
      const value = dto[key];
      if (typeof value === 'string') {
        profileData[key] = value.trim() || null;
      }
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
        email: true,
        phone: true,
        firebaseUid: true,
        fullName: true,
        role: true,
        organizationId: true,
        providerId: true,
        accountStatus: true,
        providerEngagementType: true,
        serviceCategories: true,
        coverageAreas: true,
        profileData: true,
        subscriptionPlan: true,
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
      providerEngagementType: updated.providerEngagementType,
      serviceCategories: updated.serviceCategories,
      coverageAreas: updated.coverageAreas,
      profileData: updated.profileData,
      subscriptionPlan: updated.subscriptionPlan,
      organization: updated.organization,
    };
  }

  async firebaseLogin(dto: FirebaseLoginDto) {
    const role = this.mapApiRoleToPrismaRole(dto.role);

    if (role !== UserRole.CITIZEN) {
      throw new BadRequestException(
        'Firebase citizen login only supports CITIZEN role',
      );
    }

    const firebaseUid = dto.firebaseUid.trim();
    const phone = dto.phone?.trim() || null;
    const email = dto.email?.toLowerCase().trim() || null;
    const fullName = dto.fullName?.trim() || 'Citizen User';
    const organizationId = await this.getDefaultCitizenOrganizationId();

    const existingByFirebaseUid = await this.prisma.user.findUnique({
      where: { firebaseUid },
    });

    const existingByPhone = phone
      ? await this.prisma.user.findUnique({
          where: { phone },
        })
      : null;
    const existingByEmail = email
      ? await this.prisma.user.findUnique({
          where: { email },
        })
      : null;

    if (
      existingByFirebaseUid &&
      existingByPhone &&
      existingByFirebaseUid.id !== existingByPhone.id
    ) {
      throw new BadRequestException(
        'Firebase UID and phone belong to different users',
      );
    }

    if (
      existingByFirebaseUid &&
      existingByEmail &&
      existingByFirebaseUid.id !== existingByEmail.id
    ) {
      throw new BadRequestException(
        'Firebase UID and email belong to different users',
      );
    }

    if (
      existingByPhone &&
      existingByEmail &&
      existingByPhone.id !== existingByEmail.id
    ) {
      throw new BadRequestException(
        'Phone and email belong to different users',
      );
    }

    const existingUser =
      existingByFirebaseUid ?? existingByPhone ?? existingByEmail;

    if (existingUser && existingUser.role !== UserRole.CITIZEN) {
      throw new BadRequestException(
        'Firebase citizen login cannot be used for provider or admin users',
      );
    }

    const user = existingUser
      ? await this.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            firebaseUid: existingUser.firebaseUid ?? firebaseUid,
            phone: phone ?? existingUser.phone,
            email: email ?? existingUser.email,
            fullName: dto.fullName?.trim() || existingUser.fullName || fullName,
            role: UserRole.CITIZEN,
            organizationId: existingUser.organizationId ?? organizationId,
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
          },
        })
      : await this.prisma.user.create({
          data: {
            firebaseUid,
            phone,
            email,
            fullName,
            role: UserRole.CITIZEN,
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
          },
        });

    return this.issueTokens(user);
  }

  async issueTokensForOnboarding(user: AuthUser) {
    return this.issueTokens(user);
  }

  private async audit(
    action: string,
    actorUserId: string,
    metadata: Record<string, unknown> = {},
  ) {
    const audit = (this.prisma as any).demoAuditLog;
    if (!audit?.create) return;
    await audit.create({
      data: {
        action,
        actorUserId,
        metadata,
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
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET || 'fixzone_access_secret',
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
      },
      accessToken,
    };
  }
}
