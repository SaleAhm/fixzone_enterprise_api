import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountStatus, OrganizationType, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { CitizenRegisterDto } from './dto/citizen-register.dto';
import { OrganizationRegisterDto } from './dto/organization-register.dto';
import { ProviderAccessRequestDto } from './dto/provider-access-request.dto';

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async registerCitizen(dto: CitizenRegisterDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }
    if (!dto.acceptTerms) {
      throw new BadRequestException('Terms must be accepted');
    }

    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.email.toLowerCase().trim() },
          { phone: dto.phone.trim() },
        ],
      },
    });
    if (existing) throw new BadRequestException('User already exists');

    const organizationId = await this.resolveCitizenOrganization(dto);
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        fullName: dto.fullName.trim(),
        email: dto.email.toLowerCase().trim(),
        phone: dto.phone.trim(),
        passwordHash,
        role: UserRole.CITIZEN,
        accountStatus: AccountStatus.ACTIVE,
        organizationId,
        profileData: {
          address: dto.address?.trim() ?? null,
          lga: dto.lga?.trim() ?? null,
          state: dto.state?.trim() ?? null,
          preferredLanguage: dto.preferredLanguage?.trim() ?? 'English',
          notificationPreferences: dto.notificationPreferences ?? {
            email: true,
            sms: true,
            push: true,
          },
          gpsPermission: dto.gpsPermission ?? false,
          emergencyContact: dto.emergencyContact?.trim() ?? null,
          identityScopes: ['citizen'],
          onboardingSource: 'PUBLIC_CITIZEN_REGISTRATION',
        },
      },
    });

    return this.authService.issueTokensForOnboarding(user);
  }

  async requestProviderAccess(dto: ProviderAccessRequestDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.email.toLowerCase().trim() },
          { phone: dto.phone.trim() },
        ],
      },
    });
    if (existing) throw new BadRequestException('User already exists');

    const organizationId = await this.resolveProviderOrganization(dto);
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        fullName: dto.fullName.trim(),
        email: dto.email.toLowerCase().trim(),
        phone: dto.phone.trim(),
        passwordHash,
        role: UserRole.PENDING_PROVIDER,
        accountStatus: AccountStatus.PENDING_APPROVAL,
        organizationId,
        providerEngagementType:
          dto.applicantType === 'COMPANY'
            ? 'EXTERNAL_CONTRACTOR'
            : 'INTERNAL_STAFF',
        serviceCategories: dto.serviceCategories.map((item) => String(item)),
        coverageAreas: [dto.coverageArea.trim()],
        profileData: {
          applicantType: dto.applicantType,
          address: dto.address.trim(),
          yearsOfExperience: dto.yearsOfExperience,
          supportingDocuments: dto.supportingDocuments ?? null,
          requestedAt: new Date().toISOString(),
        },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        accountStatus: true,
        organizationId: true,
        serviceCategories: true,
        coverageAreas: true,
        profileData: true,
        createdAt: true,
      },
    });

    return {
      message:
        'Provider access request submitted. An organization administrator will review it.',
      request: user,
    };
  }

  async registerOrganization(dto: OrganizationRegisterDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const ownerEmail = dto.ownerEmail.toLowerCase().trim();
    const contactEmail = dto.contactEmail.toLowerCase().trim();
    const ownerPhone = dto.ownerPhone.trim();
    const contactPhone = dto.contactPhone.trim();

    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: ownerEmail }, { phone: ownerPhone }],
      },
    });
    if (existingUser) throw new BadRequestException('Owner already exists');

    const existingOrganization = await this.prisma.organization.findFirst({
      where: {
        OR: [{ name: dto.organizationName.trim() }, { contactEmail }],
      },
    });
    if (existingOrganization) {
      throw new BadRequestException('Organization already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const result = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: dto.organizationName.trim(),
          type: this.mapOrganizationClass(dto.organizationClass),
          contactEmail,
          contactPhone,
          country: dto.country.trim(),
          state: dto.state.trim(),
          billingStatus: 'TRIAL',
          subscriptionPlan: 'FREE',
          profileData: {
            organizationClass: dto.organizationClass,
            organizationType: dto.organizationType?.trim() ?? null,
            enabledModules: ['maintenance'],
            futureModuleReady: true,
            onboardingSource: 'PUBLIC_ORGANIZATION_REGISTRATION',
          },
          enabledModules: ['maintenance'],
        },
      });

      const owner = await tx.user.create({
        data: {
          fullName: dto.ownerFullName.trim(),
          email: ownerEmail,
          phone: ownerPhone,
          passwordHash,
          role: UserRole.ORG_ADMIN,
          accountStatus: AccountStatus.ACTIVE,
          organizationId: organization.id,
          profileData: {
            identityScopes: ['organization_admin'],
            onboardingSource: 'PUBLIC_ORGANIZATION_OWNER_REGISTRATION',
          },
        },
      });

      return { organization, owner };
    });

    return this.authService.issueTokensForOnboarding(result.owner);
  }

  private async resolveCitizenOrganization(dto: CitizenRegisterDto) {
    const organization = await this.prisma.organization.findFirst({
      where: {
        ...(dto.lga ? { lga: dto.lga.trim() } : {}),
        ...(dto.state ? { state: dto.state.trim() } : {}),
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (organization) return organization.id;

    const fallback = await this.prisma.organization.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (fallback) return fallback.id;

    const created = await this.prisma.organization.create({
      data: {
        name: dto.lga?.trim()
          ? `${dto.lga.trim()} Citizen Service Area`
          : 'FixZone Citizen Service Area',
        lga: dto.lga?.trim() || null,
        state: dto.state?.trim() || null,
        billingStatus: 'ACTIVE',
        subscriptionPlan: 'FREE',
      },
      select: { id: true },
    });
    return created.id;
  }

  private async resolveProviderOrganization(dto: ProviderAccessRequestDto) {
    if (!dto.organizationInviteCode) {
      const organization = await this.prisma.organization.findFirst({
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      return organization?.id ?? null;
    }

    const invitation = await this.prisma.invitation.findUnique({
      where: { inviteCode: dto.organizationInviteCode.trim() },
      select: { organizationId: true, status: true, role: true },
    });
    if (!invitation || invitation.status !== 'PENDING') {
      throw new NotFoundException('Invitation code is invalid or expired');
    }
    return invitation.organizationId;
  }

  private mapOrganizationClass(
    organizationClass: OrganizationRegisterDto['organizationClass'],
  ): OrganizationType {
    switch (organizationClass) {
      case 'GOVERNMENT':
        return OrganizationType.GOVERNMENT;
      case 'PRIVATE':
        return OrganizationType.CORPORATE;
      case 'NGO':
      default:
        return OrganizationType.OTHER;
    }
  }
}
