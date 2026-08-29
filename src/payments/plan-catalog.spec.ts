import { PaymentEnvironment, SubscriptionPlan } from '@prisma/client';
import { paymentPlanCatalog, resolvePaymentPlan } from './plan-catalog';

describe('payment plan catalog', () => {
  it('resolves active server-controlled plans with integer minor-unit amounts', () => {
    const starter = resolvePaymentPlan('starter');

    expect(starter?.code).toBe(SubscriptionPlan.STARTER);
    expect(starter?.active).toBe(true);
    expect(Number.isInteger(starter?.amountMinor)).toBe(true);
    expect(starter?.currency).toBe('NGN');
    expect(starter?.displayNameKey).toBe('billing.plan.starter.name');
  });

  it('does not expose unfinished enterprise plan for payment activation', () => {
    const enterprise = resolvePaymentPlan('ENTERPRISE');

    expect(enterprise?.active).toBe(false);
    expect(enterprise?.entitlements.enabledModules).toEqual([
      'MAINTENANCE_SERVICES',
    ]);
  });

  it('stores provider references separately by environment', () => {
    process.env.PAYSTACK_PLAN_STARTER_TEST_REF = 'PLN_test_starter';

    const starter = paymentPlanCatalog().find(
      (plan) => plan.code === SubscriptionPlan.STARTER,
    );

    expect(starter?.providerReferences[PaymentEnvironment.TEST]).toBe(
      'PLN_test_starter',
    );
    expect(
      starter?.providerReferences[PaymentEnvironment.LIVE],
    ).toBeUndefined();
  });
});
