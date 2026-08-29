import { ForbiddenException } from '@nestjs/common';
import {
  PaymentEnvironment,
  PaymentProvider,
  PaymentTransactionStatus,
  SubscriptionPlan,
  UserRole,
} from '@prisma/client';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      PAYMENTS_ENABLED: 'true',
      PAYSTACK_MODE: 'test',
      PAYSTACK_SECRET_KEY: 'sk_test_unit_only',
      PAYMENTS_CALLBACK_BASE_URL: 'https://billing.example.test',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('initializes checkout using server-controlled plan amount only', async () => {
    const paymentTransaction = {
      id: 'txn-1',
      organizationId: 'org-1',
      requestingUserId: 'user-1',
      provider: PaymentProvider.PAYSTACK,
      environment: PaymentEnvironment.TEST,
      internalReference: 'fz_org_abc',
      providerReference: null,
      providerAccessCode: null,
      providerAuthorizationUrl: null,
      planCode: SubscriptionPlan.PROFESSIONAL,
      amountMinor: 2500000,
      currency: 'NGN',
      status: PaymentTransactionStatus.INITIALIZED,
      initializedAt: new Date(),
      paidAt: null,
      verifiedAt: null,
      failedAt: null,
      reviewReason: null,
    };
    const prisma = mockPrisma({
      reusable: null,
      created: paymentTransaction,
      updated: {
        ...paymentTransaction,
        providerReference: 'fz_org_abc',
        providerAccessCode: 'access_test',
        providerAuthorizationUrl: 'https://checkout.example.test',
        status: PaymentTransactionStatus.PENDING,
      },
    });
    const provider = mockProvider();
    const service = new PaymentsService(prisma as never, provider as never);

    const response = await service.initializeOrganizationPayment(
      'org-1',
      'PROFESSIONAL',
      {
        sub: 'user-1',
        role: UserRole.ORG_ADMIN,
        organizationId: 'org-1',
      },
    );

    expect(provider.initializeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: 2500000,
        currency: 'NGN',
        reference: expect.stringMatching(/^fz_org-1_/) as string,
      }),
    );
    expect(response).toEqual(
      expect.objectContaining({
        authorizationUrl: 'https://checkout.example.test',
        amountMinor: 2500000,
        planCode: SubscriptionPlan.PROFESSIONAL,
      }),
    );
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('denies unrelated tenant initialization', async () => {
    const service = new PaymentsService(
      mockPrisma() as never,
      mockProvider() as never,
    );

    await expect(
      service.initializeOrganizationPayment('org-1', 'STARTER', {
        sub: 'user-2',
        role: UserRole.ORG_ADMIN,
        organizationId: 'org-2',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('reuses an equivalent fresh pending checkout instead of creating a duplicate charge', async () => {
    const reusable = {
      internalReference: 'fz_reusable',
      providerAuthorizationUrl: 'https://checkout.example.test/reuse',
      providerAccessCode: 'access_reuse',
      status: PaymentTransactionStatus.PENDING,
      amountMinor: 500000,
      currency: 'NGN',
      planCode: SubscriptionPlan.STARTER,
    };
    const prisma = mockPrisma({ reusable });
    const provider = mockProvider();
    const service = new PaymentsService(prisma as never, provider as never);

    const response = await service.initializeOrganizationPayment(
      'org-1',
      'STARTER',
      {
        sub: 'user-1',
        role: UserRole.ORG_ADMIN,
        organizationId: 'org-1',
      },
    );

    expect(response.reference).toBe('fz_reusable');
    expect(prisma.paymentTransaction.create).not.toHaveBeenCalled();
    expect(provider.initializeTransaction).not.toHaveBeenCalled();
  });

  it('marks trusted amount mismatches for manual review instead of activation', async () => {
    const existing = {
      id: 'txn-1',
      organizationId: 'org-1',
      internalReference: 'fz_ref',
      providerReference: 'fz_ref',
      amountMinor: 2500000,
      currency: 'NGN',
      status: PaymentTransactionStatus.PENDING,
      failedAt: null,
      refundedAt: null,
      planCode: SubscriptionPlan.PROFESSIONAL,
    };
    const reviewed = {
      ...existing,
      status: PaymentTransactionStatus.REVIEW_REQUIRED,
      reviewReason: 'amount_mismatch',
    };
    const prisma = mockPrisma({
      existing,
      transactionInTx: existing,
      reviewUpdated: reviewed,
    });
    const service = new PaymentsService(
      prisma as never,
      mockProvider() as never,
    );

    const result = await service.processTrustedProviderTransaction({
      provider: PaymentProvider.PAYSTACK,
      environment: PaymentEnvironment.TEST,
      providerReference: 'fz_ref',
      internalReference: 'fz_ref',
      status: PaymentTransactionStatus.PAID,
      amountMinor: 1,
      currency: 'NGN',
      metadata: {},
    });

    expect(result.status).toBe(PaymentTransactionStatus.REVIEW_REQUIRED);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
});

function mockProvider() {
  return {
    provider: PaymentProvider.PAYSTACK,
    environment: PaymentEnvironment.TEST,
    assertReady: jest.fn(),
    initializeTransaction: jest.fn().mockResolvedValue({
      authorizationUrl: 'https://checkout.example.test',
      accessCode: 'access_test',
      providerReference: 'fz_org_abc',
    }),
    verifyTransaction: jest.fn(),
    retrieveTransactionStatus: jest.fn(),
    validateWebhookSignature: jest.fn(),
    parseWebhookEvent: jest.fn(),
  };
}

function mockPrisma(options: Record<string, unknown> = {}) {
  const tx = {
    paymentTransaction: {
      findUnique: jest.fn().mockResolvedValue(options.transactionInTx),
      update: jest.fn().mockResolvedValue(options.reviewUpdated),
    },
    organization: { update: jest.fn() },
    organizationSubscription: { upsert: jest.fn() },
    paymentReceipt: { upsert: jest.fn() },
    organizationUpgradeRequest: { updateMany: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { createMany: jest.fn() },
    complianceAuditLog: { create: jest.fn() },
  };
  return {
    organization: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'org-1',
        name: 'SecureZone Test Org',
        subscriptionPlan: SubscriptionPlan.FREE,
        billingStatus: 'TRIAL',
      }),
      update: tx.organization.update,
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'billing@example.test',
      }),
    },
    paymentTransaction: {
      findFirst: jest
        .fn()
        .mockResolvedValue(options.reusable ?? options.existing ?? null),
      create: jest.fn().mockResolvedValue(options.created),
      update: jest.fn().mockResolvedValue(options.updated),
    },
    organizationSubscription: { findFirst: jest.fn() },
    paymentReceipt: { findFirst: jest.fn() },
    complianceAuditLog: { create: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
}
