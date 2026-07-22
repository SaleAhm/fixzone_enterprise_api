import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
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

    expect(result.invitation.status).toBe('PENDING');
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
});
