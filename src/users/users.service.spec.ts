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
