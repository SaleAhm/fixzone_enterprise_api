import { BadRequestException } from '@nestjs/common';
import { SubscriptionPlan } from '@prisma/client';
import { OrganizationService } from './organization.service';

describe('OrganizationService monetization helpers', () => {
  const service = new OrganizationService({} as any, {} as any);

  it('normalizes valid requested plans', () => {
    expect((service as any).parsePlan('professional')).toBe(
      SubscriptionPlan.PROFESSIONAL,
    );
  });

  it('rejects invalid requested plans', () => {
    expect(() => (service as any).parsePlan('gold')).toThrow(
      BadRequestException,
    );
  });

  it('maps approved plan defaults to organization quotas', () => {
    expect(
      (service as any).defaultQuotaUpdateForPlan(SubscriptionPlan.STARTER),
    ).toMatchObject({
      allowedUsers: 25,
      allowedProviders: 10,
      allowedReportsPerMonth: 500,
    });
  });
});
