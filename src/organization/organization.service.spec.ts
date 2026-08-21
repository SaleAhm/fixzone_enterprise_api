import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SubscriptionPlan } from '@prisma/client';
import type { PlatformModulesService } from '../platform-modules/platform-modules.service';
import type { PrismaService } from '../prisma/prisma.service';
import { OrganizationService } from './organization.service';

type OrganizationServiceInternals = Pick<
  OrganizationService,
  'createJurisdictionZone' | 'updateJurisdictionZone'
> & {
  parsePlan(plan: string): SubscriptionPlan;
  defaultQuotaUpdateForPlan(plan: SubscriptionPlan): {
    allowedUsers: number;
    allowedProviders: number;
    allowedReportsPerMonth: number;
  };
};

function serviceWithMocks(
  prisma: unknown = {},
  platformModules: unknown = {},
): OrganizationServiceInternals {
  return new OrganizationService(
    prisma as PrismaService,
    platformModules as PlatformModulesService,
  ) as OrganizationServiceInternals;
}

describe('OrganizationService monetization helpers', () => {
  const service = serviceWithMocks();

  it('normalizes valid requested plans', () => {
    expect(service.parsePlan('professional')).toBe(
      SubscriptionPlan.PROFESSIONAL,
    );
  });

  it('rejects invalid requested plans', () => {
    expect(() => service.parsePlan('gold')).toThrow(BadRequestException);
  });

  it('maps approved plan defaults to organization quotas', () => {
    expect(
      service.defaultQuotaUpdateForPlan(SubscriptionPlan.STARTER),
    ).toMatchObject({
      allowedUsers: 25,
      allowedProviders: 10,
      allowedReportsPerMonth: 500,
    });
  });
});

describe('OrganizationService jurisdiction zones', () => {
  const platformModules = {
    organizationModuleSummary: jest.fn().mockReturnValue({
      maintenanceActive: true,
    }),
  };

  it('allows an org admin to manage only their own jurisdiction zones', async () => {
    const prisma = {
      jurisdictionZone: {
        create: jest.fn().mockResolvedValue({
          id: 'zone-1',
          organizationId: 'org-1',
          zoneType: 'LGA',
          country: 'Nigeria',
          state: 'FCT',
          lga: 'Gwagwalada',
          active: true,
        }),
      },
      demoAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = serviceWithMocks(prisma, platformModules);

    await expect(
      service.createJurisdictionZone(
        'org-1',
        {
          zoneType: 'LGA',
          country: 'Nigeria',
          state: 'FCT',
          lga: 'Gwagwalada',
        },
        { sub: 'admin-1', role: 'ORG_ADMIN', organizationId: 'org-1' },
      ),
    ).resolves.toMatchObject({ id: 'zone-1' });

    await expect(
      service.createJurisdictionZone(
        'org-2',
        {
          zoneType: 'LGA',
          country: 'Nigeria',
          state: 'FCT',
          lga: 'Gwagwalada',
        },
        { sub: 'admin-1', role: 'ORG_ADMIN', organizationId: 'org-1' },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('updates active state only for a zone owned by the target organization', async () => {
    const prisma = {
      jurisdictionZone: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'zone-1',
          organizationId: 'org-1',
          zoneType: 'LGA',
          country: 'Nigeria',
          state: 'FCT',
          lga: 'Gwagwalada',
          active: true,
        }),
        update: jest.fn().mockResolvedValue({
          id: 'zone-1',
          organizationId: 'org-1',
          active: false,
        }),
      },
      demoAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = serviceWithMocks(prisma, platformModules);

    await expect(
      service.updateJurisdictionZone(
        'org-1',
        'zone-1',
        { active: false },
        { sub: 'admin-1', role: 'ORG_ADMIN', organizationId: 'org-1' },
      ),
    ).resolves.toMatchObject({ active: false });

    await expect(
      service.updateJurisdictionZone(
        'org-2',
        'zone-1',
        { active: false },
        { sub: 'super-1', role: 'SUPER_ADMIN' },
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
