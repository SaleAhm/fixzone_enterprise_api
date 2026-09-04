import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AccountStatus, UserRole } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService identity helpers', () => {
  const service = new UsersService({} as any);

  it('normalizes provider email edits', () => {
    expect((service as any).normalizeEmail(' Provider@Example.COM ')).toBe(
      'provider@example.com',
    );
  });

  it('rejects malformed provider email edits', () => {
    expect(() => (service as any).normalizeEmail('provider')).toThrow(
      BadRequestException,
    );
  });

  it('scopes org admins to primary users and provider memberships', () => {
    const scope = (service as any).buildAdminScope({
      role: UserRole.ORG_ADMIN,
      organizationId: 'org-1',
    });

    expect(scope.OR).toEqual([
      { organizationId: 'org-1' },
      {
        role: UserRole.PROVIDER,
        providerOrganizations: {
          some: { organizationId: 'org-1', active: true },
        },
      },
    ]);
  });
});

describe('UsersService lifecycle controls', () => {
  it('blocks deactivation of the final active Super Admin', async () => {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'super-1',
          role: UserRole.SUPER_ADMIN,
          accountStatus: AccountStatus.ACTIVE,
        }),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      },
    };
    const service = new UsersService(prisma as any);

    await expect(
      service.setUserStatus('super-1', AccountStatus.SUSPENDED, {
        sub: 'super-2',
        role: UserRole.SUPER_ADMIN,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('does not return plaintext passwords tokens or reset URLs from admin reset', async () => {
    const target = {
      id: 'provider-1',
      fullName: 'Provider User',
      email: 'provider@example.test',
      phone: null,
      providerId: 'PRV-1',
      role: UserRole.PROVIDER,
      accountStatus: AccountStatus.ACTIVE,
      serviceCategories: [],
      coverageAreas: [],
      profileData: null,
      subscriptionPlan: null,
      providerEngagementType: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      organizationId: 'org-1',
      organization: { id: 'org-1', name: 'Org', type: 'AGENCY' },
    };
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(target),
      },
      demoAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };
    const authService = {
      issueAdministrativePasswordReset: jest.fn().mockResolvedValue({
        message:
          'If delivery is configured, reset instructions will be sent. No password was changed.',
        delivery: {
          configured: false,
          status: 'DELIVERY_UNAVAILABLE',
        },
      }),
    };
    const service = new UsersService(
      prisma as unknown as PrismaService,
      authService as unknown as AuthService,
    );

    const result = await service.resetPassword(
      'provider-1',
      { password: 'IgnoredPassword1' },
      { sub: 'admin-1', role: UserRole.ORG_ADMIN, organizationId: 'org-1' },
    );

    const body = JSON.stringify(result);
    expect(body).not.toMatch(/temporaryPassword|IgnoredPassword1|resetUrl/i);
    expect(body).not.toMatch(/"token"\s*:/i);
    expect(authService.issueAdministrativePasswordReset).toHaveBeenCalledWith(
      'provider-1',
      'admin-1',
    );
  });
});

describe('UsersService invitation lifecycle', () => {
  it('creates a pending invitation instead of an active membership for existing providers', async () => {
    const prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'org-1',
          name: 'Demo Org',
          allowedUsers: null,
          allowedProviders: null,
        }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'provider-1',
          role: UserRole.PROVIDER,
          accountStatus: 'ACTIVE',
          organizationId: 'other-org',
          email: 'provider@example.com',
          phone: null,
          fullName: 'Existing Provider',
          providerId: 'PRV-1',
        }),
      },
      providerOrganization: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      invitation: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'inv-1',
          inviteCode: 'INV-123',
          email: 'provider@example.com',
          phone: null,
          fullName: 'Existing Provider',
          role: UserRole.PROVIDER,
          status: 'PENDING',
          organizationId: 'org-1',
          organization: { id: 'org-1', name: 'Demo Org', type: 'AGENCY' },
          invitedBy: {
            id: 'admin-1',
            fullName: 'Admin User',
            role: UserRole.SUPER_ADMIN,
          },
          acceptedUser: null,
          expiresAt: new Date(Date.now() + 1000),
          acceptedAt: null,
          declinedAt: null,
          revokedAt: null,
          resentAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: {
            delivery: 'EMAIL_NOT_CONFIGURED',
            invitationPurpose: 'PROVIDER_MEMBERSHIP_ACTIVATION',
          },
        }),
      },
      notification: {
        create: jest.fn().mockResolvedValue({ id: 'notification-1' }),
      },
      demoAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };
    const service = new UsersService(prisma as any);

    const result = await service.inviteUser(
      {
        role: UserRole.PROVIDER,
        organizationId: 'org-1',
        email: 'provider@example.com',
        fullName: 'Existing Provider',
        confirmExistingUser: true,
      },
      { sub: 'admin-1', role: UserRole.SUPER_ADMIN },
    );

    expect((result as any).invitation.status).toBe('PENDING');
    expect(prisma.providerOrganization.create).not.toHaveBeenCalled();
    expect(prisma.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            existingUserId: 'provider-1',
            invitationPurpose: 'PROVIDER_MEMBERSHIP_ACTIVATION',
          }),
        }),
      }),
    );
  });

  it('blocks duplicate pending provider invitations with a stable code', async () => {
    const prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'org-1',
          name: 'Demo Org',
          allowedUsers: null,
          allowedProviders: null,
        }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'provider-1',
          role: UserRole.PROVIDER,
          accountStatus: 'ACTIVE',
          organizationId: 'other-org',
          email: 'provider@example.com',
          phone: null,
          fullName: 'Existing Provider',
          providerId: 'PRV-1',
        }),
      },
      providerOrganization: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      invitation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'inv-existing' }),
      },
    };
    const service = new UsersService(prisma as any);

    await expect(
      service.inviteUser(
        {
          role: UserRole.PROVIDER,
          organizationId: 'org-1',
          email: 'provider@example.com',
          fullName: 'Existing Provider',
          confirmExistingUser: true,
        },
        { sub: 'admin-1', role: UserRole.SUPER_ADMIN },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DUPLICATE_PENDING_INVITATION',
      }),
    });
  });

  it('reports an active provider membership with the membership code', async () => {
    const prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'org-1',
          name: 'Demo Org',
          allowedUsers: null,
          allowedProviders: null,
        }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'provider-1',
          role: UserRole.PROVIDER,
          accountStatus: 'ACTIVE',
          organizationId: 'other-org',
          email: 'provider@example.com',
          phone: null,
          fullName: 'Existing Provider',
          providerId: 'PRV-1',
        }),
      },
      providerOrganization: {
        findUnique: jest.fn().mockResolvedValue({
          active: true,
          isPrimary: false,
        }),
      },
    };
    const service = new UsersService(prisma as any);

    const result = await service.inviteUser(
      {
        role: UserRole.PROVIDER,
        organizationId: 'org-1',
        email: 'provider@example.com',
        fullName: 'Existing Provider',
      },
      { sub: 'admin-1', role: UserRole.SUPER_ADMIN },
    );

    expect((result as any).code).toBe('MEMBERSHIP_ALREADY_ACTIVE');
  });
});

describe('UsersService provider discovery', () => {
  it('ranks providers with verified citizen ratings and hides private contact data', async () => {
    const prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'org-1',
          name: 'Hunslow International Ltd',
          type: 'UTILITY_COMPANY',
          state: 'Abuja',
          lga: 'Hunslow',
          country: 'Nigeria',
          profileData: { serviceNeeds: ['Electricity'] },
        }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'provider-1',
            fullName: 'Abdul Kareem',
            providerId: 'PRV-1',
            serviceCategories: ['Electricity', 'Water'],
            coverageAreas: ['Hunslow', 'Abuja'],
            profileData: {},
            identityVerificationStatus: 'ID_VERIFIED',
            trustScore: 60,
            createdAt: new Date(),
            organizationId: 'demo-org',
            organization: {
              id: 'demo-org',
              name: 'FixZone Demo LGA',
              type: 'LOCAL_GOVERNMENT',
            },
            providerOrganizations: [
              {
                organizationId: 'demo-org',
                isPrimary: true,
                createdAt: new Date(),
                organization: {
                  id: 'demo-org',
                  name: 'FixZone Demo LGA',
                  type: 'LOCAL_GOVERNMENT',
                },
              },
            ],
            assignedReports: [
              {
                id: 'report-1',
                status: 'CLOSED',
                organizationId: 'demo-org',
                category: 'Electricity',
                citizenRating: 5,
                citizenFeedback: 'Good',
                completionRejectionReason: null,
                assignedAt: new Date(),
                completedByProviderAt: new Date(),
                updatedAt: new Date(),
              },
              {
                id: 'report-2',
                status: 'CLOSED',
                organizationId: 'demo-org',
                category: 'Electricity',
                citizenRating: 4,
                citizenFeedback: 'Resolved',
                completionRejectionReason: null,
                assignedAt: new Date(),
                completedByProviderAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          },
        ]),
      },
      invitation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      demoAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };
    const service = new UsersService(prisma as any);

    const result = await service.discoverProviders(
      { role: UserRole.ORG_ADMIN, organizationId: 'org-1', sub: 'admin-1' },
      { serviceCategory: 'Electricity' },
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      providerName: 'Abdul Kareem',
      publicProviderId: 'PRV-1',
      ratingSummary: {
        verifiedCitizenAverage: 4.5,
        verifiedRatingCount: 2,
      },
    });
    expect(result.results[0]).not.toHaveProperty('email');
    expect(result.results[0]).not.toHaveProperty('phone');
    expect(result.results[0].recommendationReasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Matches Electricity'),
        expect.stringContaining('verified citizen rating'),
      ]),
    );
    expect(result.scoringModel.formula).toContain('verified citizen rating 25');
  });

  it('requires a concrete organization for super admin discovery', async () => {
    const service = new UsersService({} as any);

    await expect(
      service.discoverProviders({ role: UserRole.SUPER_ADMIN }, {}),
    ).rejects.toThrow('Organization is required for discovery');
  });
});
