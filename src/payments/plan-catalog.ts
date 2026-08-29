import { PaymentEnvironment, SubscriptionPlan } from '@prisma/client';
import { CommercialPlan } from './payment.types';

const maintenanceOnlyModules = ['MAINTENANCE_SERVICES'];

export function paymentPlanCatalog(): CommercialPlan[] {
  return [
    {
      code: SubscriptionPlan.STARTER,
      displayNameKey: 'billing.plan.starter.name',
      descriptionKey: 'billing.plan.starter.description',
      billingInterval: 'month',
      currency: 'NGN',
      amountMinor: 500000,
      active: true,
      entitlements: {
        allowedUsers: 10,
        allowedProviders: 5,
        allowedReportsPerMonth: 200,
        allowedStorageMb: 1024,
        enabledModules: maintenanceOnlyModules,
      },
      providerReferences: {
        [PaymentEnvironment.TEST]:
          process.env.PAYSTACK_PLAN_STARTER_TEST_REF?.trim() || undefined,
      },
    },
    {
      code: SubscriptionPlan.PROFESSIONAL,
      displayNameKey: 'billing.plan.professional.name',
      descriptionKey: 'billing.plan.professional.description',
      billingInterval: 'month',
      currency: 'NGN',
      amountMinor: 2500000,
      active: true,
      entitlements: {
        allowedUsers: 50,
        allowedProviders: 25,
        allowedReportsPerMonth: 2000,
        allowedStorageMb: 10240,
        enabledModules: maintenanceOnlyModules,
      },
      providerReferences: {
        [PaymentEnvironment.TEST]:
          process.env.PAYSTACK_PLAN_PROFESSIONAL_TEST_REF?.trim() || undefined,
      },
    },
    {
      code: SubscriptionPlan.GOVERNMENT,
      displayNameKey: 'billing.plan.government.name',
      descriptionKey: 'billing.plan.government.description',
      billingInterval: 'month',
      currency: 'NGN',
      amountMinor: 10000000,
      active: true,
      entitlements: {
        allowedUsers: 250,
        allowedProviders: 100,
        allowedReportsPerMonth: 10000,
        allowedStorageMb: 102400,
        enabledModules: maintenanceOnlyModules,
      },
      providerReferences: {
        [PaymentEnvironment.TEST]:
          process.env.PAYSTACK_PLAN_GOVERNMENT_TEST_REF?.trim() || undefined,
      },
    },
    {
      code: SubscriptionPlan.ENTERPRISE,
      displayNameKey: 'billing.plan.enterprise.name',
      descriptionKey: 'billing.plan.enterprise.description',
      billingInterval: 'month',
      currency: 'NGN',
      amountMinor: 25000000,
      active: false,
      entitlements: {
        allowedUsers: null,
        allowedProviders: null,
        allowedReportsPerMonth: null,
        allowedStorageMb: null,
        enabledModules: maintenanceOnlyModules,
      },
      providerReferences: {
        [PaymentEnvironment.TEST]:
          process.env.PAYSTACK_PLAN_ENTERPRISE_TEST_REF?.trim() || undefined,
      },
    },
  ];
}

export function resolvePaymentPlan(code: string): CommercialPlan | null {
  const normalized = code.trim().toUpperCase();
  return paymentPlanCatalog().find((plan) => plan.code === normalized) ?? null;
}
