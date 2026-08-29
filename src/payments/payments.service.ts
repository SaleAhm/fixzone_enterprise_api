import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  BillingStatus,
  OrganizationSubscriptionStatus,
  PaymentEnvironment,
  PaymentProvider,
  PaymentReceiptStatus,
  PaymentTransaction,
  PaymentTransactionStatus,
  Prisma,
  SubscriptionPlan,
  UpgradeRequestStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InternalAdminService } from '../internal-admin/internal-admin.service';
import { PaystackPaymentAdapter } from './paystack.adapter';
import { paymentPlanCatalog, resolvePaymentPlan } from './plan-catalog';
import {
  CommercialPlan,
  NormalizedProviderTransaction,
  NormalizedWebhookEvent,
  PaymentProviderAdapter,
  RequestUser,
} from './payment.types';

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackPaymentAdapter,
    private readonly internalAdmin: InternalAdminService,
  ) {}

  listPlans() {
    return {
      provider: PaymentProvider.PAYSTACK,
      environment: this.provider.environment,
      paymentsEnabled: process.env.PAYMENTS_ENABLED === 'true',
      fallbackLocale: 'en',
      plans: paymentPlanCatalog().map((plan) => this.publicPlan(plan)),
    };
  }

  async initializeOrganizationPayment(
    organizationId: string,
    planCode: string,
    user: RequestUser,
  ) {
    await this.assertBillingAuthority(organizationId, user);
    const plan = this.resolveActivePlan(planCode);
    this.assertPlanUsableInEnvironment(plan);
    this.provider.assertReady();

    const [organization, actor] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          subscriptionPlan: true,
          billingStatus: true,
        },
      }),
      this.prisma.user.findUnique({
        where: { id: user.sub },
        select: { id: true, email: true },
      }),
    ]);

    if (!organization) throw new NotFoundException('Organization not found');
    if (!actor?.email) {
      throw new BadRequestException({
        code: 'BILLING_EMAIL_REQUIRED',
        message: 'A billing email is required before payment can start.',
      });
    }

    const reusable = await this.findReusablePendingTransaction(
      organization.id,
      plan,
    );
    if (reusable) return this.checkoutResponse(reusable);

    const internalReference = this.createReference(organization.id);
    const callbackUrl = this.callbackUrl(internalReference);
    const transaction = await this.prisma.paymentTransaction.create({
      data: {
        organizationId: organization.id,
        requestingUserId: actor.id,
        provider: this.provider.provider,
        environment: this.provider.environment,
        internalReference,
        planCode: plan.code,
        amountMinor: plan.amountMinor,
        currency: plan.currency,
        status: PaymentTransactionStatus.INITIALIZED,
        sanitizedMetadata: this.transactionMetadata(organization.id, plan),
      },
    });

    try {
      const initialized = await this.provider.initializeTransaction({
        email: actor.email,
        amountMinor: plan.amountMinor,
        currency: plan.currency,
        reference: internalReference,
        callbackUrl,
        planReference: plan.providerReferences[this.provider.environment],
        metadata: {
          organizationId: organization.id,
          planCode: plan.code,
          internalReference,
        },
      });

      const updated = await this.prisma.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: PaymentTransactionStatus.PENDING,
          providerReference: initialized.providerReference,
          providerAccessCode: initialized.accessCode,
          providerAuthorizationUrl: initialized.authorizationUrl,
        },
      });

      await this.audit('Payment Transaction Initialized', user, {
        organizationId: organization.id,
        transactionId: updated.id,
        planCode: plan.code,
        provider: updated.provider,
        reference: this.maskReference(updated.internalReference),
      });

      return this.checkoutResponse(updated);
    } catch (error) {
      await this.prisma.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: PaymentTransactionStatus.FAILED,
          failedAt: new Date(),
          reviewReason: 'Provider initialization failed.',
        },
      });
      await this.audit('Payment Provider Initialization Failed', user, {
        organizationId: organization.id,
        transactionId: transaction.id,
        planCode: plan.code,
      });
      throw error;
    }
  }

  async getOrganizationSubscription(organizationId: string, user: RequestUser) {
    await this.assertBillingReader(organizationId, user);
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        subscriptionPlan: true,
        billingStatus: true,
        subscriptionStartAt: true,
        subscriptionEndAt: true,
        allowedUsers: true,
        allowedProviders: true,
        allowedReportsPerMonth: true,
        allowedStorageMb: true,
        enabledModules: true,
      },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    const subscription = await this.prisma.organizationSubscription.findFirst({
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return {
      organizationId,
      authoritativePlan: organization.subscriptionPlan,
      billingStatus: organization.billingStatus,
      subscription,
      entitlements: {
        allowedUsers: organization.allowedUsers,
        allowedProviders: organization.allowedProviders,
        allowedReportsPerMonth: organization.allowedReportsPerMonth,
        allowedStorageMb: organization.allowedStorageMb,
        enabledModules: organization.enabledModules,
      },
    };
  }

  async getTransactionStatus(
    organizationId: string,
    reference: string,
    user: RequestUser,
  ) {
    await this.assertBillingReader(organizationId, user);
    const transaction = await this.prisma.paymentTransaction.findFirst({
      where: { organizationId, internalReference: reference },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');
    return this.safeTransaction(transaction);
  }

  async listPaymentHistory(organizationId: string, user: RequestUser) {
    await this.assertBillingReader(organizationId, user);
    const transactions = await this.prisma.paymentTransaction.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return transactions.map((transaction) => this.safeTransaction(transaction));
  }

  async getReceipt(
    organizationId: string,
    receiptNumber: string,
    user: RequestUser,
  ) {
    await this.assertBillingReader(organizationId, user);
    const receipt = await this.prisma.paymentReceipt.findFirst({
      where: { organizationId, receiptNumber },
    });
    if (!receipt) throw new NotFoundException('Receipt not found');
    return {
      id: receipt.id,
      receiptNumber: receipt.receiptNumber,
      paidAt: receipt.paidAt,
      organizationName: receipt.organizationName,
      planCode: receipt.planCode,
      planNameKey: receipt.planNameKey,
      amountMinor: receipt.amountMinor,
      currency: receipt.currency,
      provider: receipt.provider,
      providerReference: this.maskReference(receipt.providerReference),
      status: receipt.status,
      note: 'Payment receipt facts only. This is not a statutory tax invoice.',
    };
  }

  async handlePaystackWebhook(rawBody: Buffer, signature?: string) {
    if (!this.provider.validateWebhookSignature(rawBody, signature)) {
      await this.audit('Payment Webhook Rejected', null, {
        provider: PaymentProvider.PAYSTACK,
        reason: 'invalid_signature',
      });
      throw new ForbiddenException('Invalid webhook signature');
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as unknown;
    const event = this.provider.parseWebhookEvent(payload);
    if (!event.transaction) {
      return { received: true, ignored: true, event: event.event };
    }
    const result = await this.processTrustedProviderTransaction(
      event.transaction,
      event,
    );
    return { received: true, status: result.status };
  }

  async verifyTransaction(
    organizationId: string,
    reference: string,
    user: RequestUser,
  ) {
    await this.assertBillingReader(organizationId, user);
    const transaction = await this.prisma.paymentTransaction.findFirst({
      where: { organizationId, internalReference: reference },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');
    const trusted = await this.provider.verifyTransaction(
      transaction.providerReference ?? transaction.internalReference,
    );
    const result = await this.processTrustedProviderTransaction(trusted);
    return this.safeTransaction(result);
  }

  async reconcilePending(user: RequestUser, limit?: number) {
    await this.internalAdmin.assertPermission(
      user,
      'payment.reconciliation_manage',
    );
    const batchSize = Math.min(
      Math.max(
        1,
        limit ?? Number(process.env.PAYMENTS_RECONCILIATION_BATCH_SIZE ?? 25),
      ),
      100,
    );
    const minAgeMinutes = Math.max(
      1,
      Number(process.env.PAYMENTS_RECONCILIATION_MIN_AGE_MINUTES ?? 30),
    );
    const olderThan = new Date(Date.now() - minAgeMinutes * 60_000);
    const candidates = await this.prisma.paymentTransaction.findMany({
      where: {
        status: {
          in: [
            PaymentTransactionStatus.INITIALIZED,
            PaymentTransactionStatus.PENDING,
            PaymentTransactionStatus.PROCESSING,
          ],
        },
        createdAt: { lte: olderThan },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
    });
    let recovered = 0;
    let reviewRequired = 0;
    let providerFailed = 0;
    for (const candidate of candidates) {
      try {
        const trusted = await this.provider.retrieveTransactionStatus(
          candidate.providerReference ?? candidate.internalReference,
        );
        const result = await this.processTrustedProviderTransaction(trusted);
        if (
          result.status === PaymentTransactionStatus.PAID ||
          result.status === PaymentTransactionStatus.VERIFIED
        ) {
          recovered += 1;
        }
        if (result.status === PaymentTransactionStatus.REVIEW_REQUIRED) {
          reviewRequired += 1;
        }
      } catch {
        providerFailed += 1;
      }
    }
    await this.audit('Payment Reconciliation Performed', user, {
      scanned: candidates.length,
      recovered,
      reviewRequired,
      providerFailed,
    });
    return {
      scanned: candidates.length,
      recovered,
      reviewRequired,
      providerFailed,
    };
  }

  async processTrustedProviderTransaction(
    trusted: NormalizedProviderTransaction,
    event?: NormalizedWebhookEvent,
  ) {
    const existing = await this.prisma.paymentTransaction.findFirst({
      where: {
        OR: [
          { internalReference: trusted.internalReference },
          { providerReference: trusted.providerReference },
        ],
      },
    });
    if (!existing) {
      throw new NotFoundException('Transaction not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.paymentTransaction.findUnique({
        where: { id: existing.id },
      });
      if (!transaction) throw new NotFoundException('Transaction not found');
      if (
        transaction.status === PaymentTransactionStatus.PAID ||
        transaction.status === PaymentTransactionStatus.VERIFIED
      ) {
        return transaction;
      }

      const mismatch = this.paymentMismatch(transaction, trusted);
      if (mismatch) {
        const reviewed = await tx.paymentTransaction.update({
          where: { id: transaction.id },
          data: {
            status: PaymentTransactionStatus.REVIEW_REQUIRED,
            providerEventReference: event?.eventId ?? trusted.eventId ?? null,
            reviewReason: mismatch,
            lastReconciledAt: new Date(),
          },
        });
        await this.auditWithClient(tx, 'Payment Review Required', null, {
          organizationId: transaction.organizationId,
          transactionId: transaction.id,
          reason: mismatch,
        });
        return reviewed;
      }

      if (trusted.status === PaymentTransactionStatus.PAID) {
        return this.fulfillPayment(tx, transaction, trusted, event);
      }

      const failedStatus =
        trusted.status === PaymentTransactionStatus.REFUNDED
          ? PaymentTransactionStatus.REFUNDED
          : trusted.status === PaymentTransactionStatus.FAILED
            ? PaymentTransactionStatus.FAILED
            : PaymentTransactionStatus.PROCESSING;
      return tx.paymentTransaction.update({
        where: { id: transaction.id },
        data: {
          status: failedStatus,
          failedAt:
            failedStatus === PaymentTransactionStatus.FAILED
              ? new Date()
              : transaction.failedAt,
          refundedAt:
            failedStatus === PaymentTransactionStatus.REFUNDED
              ? new Date()
              : transaction.refundedAt,
          providerEventReference: event?.eventId ?? trusted.eventId ?? null,
          sanitizedMetadata: this.safeJson(trusted.metadata),
          lastReconciledAt: new Date(),
        },
      });
    });
  }

  private async fulfillPayment(
    tx: TransactionClient,
    transaction: PaymentTransaction,
    trusted: NormalizedProviderTransaction,
    event?: NormalizedWebhookEvent,
  ) {
    if (!transaction) throw new NotFoundException('Transaction not found');
    const now = new Date();
    const plan = this.resolveActivePlan(transaction.planCode);
    const periodEnd = this.addBillingPeriod(now, plan.billingInterval);
    const organization = await tx.organization.update({
      where: { id: transaction.organizationId },
      data: {
        subscriptionPlan: plan.code,
        billingStatus: BillingStatus.ACTIVE,
        subscriptionStartAt: now,
        subscriptionEndAt: periodEnd,
        allowedUsers: plan.entitlements.allowedUsers,
        allowedProviders: plan.entitlements.allowedProviders,
        allowedReportsPerMonth: plan.entitlements.allowedReportsPerMonth,
        allowedStorageMb: plan.entitlements.allowedStorageMb,
        enabledModules: { modules: plan.entitlements.enabledModules },
      },
    });

    const paid = await tx.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: PaymentTransactionStatus.PAID,
        paidAt: trusted.paidAt ?? now,
        verifiedAt: now,
        providerEventReference: event?.eventId ?? trusted.eventId ?? null,
        sanitizedMetadata: this.safeJson(trusted.metadata),
        lastReconciledAt: now,
      },
    });

    await tx.organizationSubscription.upsert({
      where: { sourceTransactionId: paid.id },
      create: {
        organizationId: organization.id,
        planCode: plan.code,
        status: OrganizationSubscriptionStatus.ACTIVE,
        currentPeriodStartAt: now,
        currentPeriodEndAt: periodEnd,
        sourceTransactionId: paid.id,
        entitlementAppliedAt: now,
      },
      update: { entitlementAppliedAt: now },
    });

    await tx.paymentReceipt.upsert({
      where: { transactionId: paid.id },
      create: {
        transactionId: paid.id,
        organizationId: organization.id,
        receiptNumber: this.receiptNumber(paid.internalReference),
        paidAt: paid.paidAt ?? now,
        organizationName: organization.name,
        planCode: plan.code,
        planNameKey: plan.displayNameKey,
        amountMinor: plan.amountMinor,
        currency: plan.currency,
        provider: paid.provider,
        providerReference: paid.providerReference,
        status: PaymentReceiptStatus.ISSUED,
      },
      update: {},
    });

    await tx.organizationUpgradeRequest.updateMany({
      where: {
        organizationId: organization.id,
        requestedPlan: plan.code,
        status: UpgradeRequestStatus.PENDING,
      },
      data: {
        status: UpgradeRequestStatus.COMPLETED,
        completedAt: now,
        reviewNote: 'Completed by verified subscription payment.',
      },
    });

    const admins = await tx.user.findMany({
      where: {
        organizationId: organization.id,
        role: { in: [UserRole.ORG_ADMIN, UserRole.BILLING_ADMIN] },
      },
      select: { id: true },
      take: 50,
    });
    await tx.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        type: 'payment.subscription_activated',
        title: 'Subscription activated',
        message: `${organization.name} subscription is active.`,
      })),
      skipDuplicates: true,
    });

    await this.auditWithClient(tx, 'Payment Fulfillment Completed', null, {
      organizationId: organization.id,
      transactionId: paid.id,
      planCode: plan.code,
      localization: {
        key: 'payment.subscription_activated',
        params: { organizationId: organization.id, planCode: plan.code },
        fallbackLocale: 'en',
      },
    });
    return paid;
  }

  private paymentMismatch(
    transaction: {
      internalReference: string;
      providerReference: string | null;
      amountMinor: number;
      currency: string;
    },
    trusted: NormalizedProviderTransaction,
  ) {
    if (trusted.amountMinor !== transaction.amountMinor)
      return 'amount_mismatch';
    if (trusted.currency !== transaction.currency) return 'currency_mismatch';
    if (
      trusted.internalReference !== transaction.internalReference &&
      trusted.providerReference !== transaction.providerReference
    ) {
      return 'reference_mismatch';
    }
    return null;
  }

  private async findReusablePendingTransaction(
    organizationId: string,
    plan: CommercialPlan,
  ) {
    const expiry = new Date(Date.now() - 20 * 60_000);
    return this.prisma.paymentTransaction.findFirst({
      where: {
        organizationId,
        planCode: plan.code,
        amountMinor: plan.amountMinor,
        currency: plan.currency,
        status: { in: [PaymentTransactionStatus.PENDING] },
        initializedAt: { gte: expiry },
        providerAuthorizationUrl: { not: null },
      },
      orderBy: [{ initializedAt: 'desc' }, { id: 'desc' }],
    });
  }

  private publicPlan(plan: CommercialPlan) {
    return {
      code: plan.code,
      displayNameKey: plan.displayNameKey,
      descriptionKey: plan.descriptionKey,
      billingInterval: plan.billingInterval,
      currency: plan.currency,
      amountMinor: plan.amountMinor,
      active: plan.active,
      entitlements: plan.entitlements,
      provider: PaymentProvider.PAYSTACK,
      providerConfigured:
        Boolean(plan.providerReferences[this.provider.environment]) ||
        this.provider.environment === PaymentEnvironment.TEST,
      pricingNotice:
        this.provider.environment === PaymentEnvironment.TEST
          ? 'Placeholder test pricing. Not commercial release pricing.'
          : null,
    };
  }

  private checkoutResponse(transaction: {
    internalReference: string;
    providerAuthorizationUrl: string | null;
    providerAccessCode: string | null;
    status: PaymentTransactionStatus;
    amountMinor: number;
    currency: string;
    planCode: SubscriptionPlan;
  }) {
    return {
      reference: transaction.internalReference,
      authorizationUrl: transaction.providerAuthorizationUrl,
      accessCode: transaction.providerAccessCode,
      status: transaction.status,
      amountMinor: transaction.amountMinor,
      currency: transaction.currency,
      planCode: transaction.planCode,
      messageKey: 'payment.initialized',
      fallbackMessage: 'Payment initialized. Complete checkout to continue.',
    };
  }

  private safeTransaction(transaction: {
    internalReference: string;
    provider: PaymentProvider;
    environment: PaymentEnvironment;
    planCode: SubscriptionPlan;
    amountMinor: number;
    currency: string;
    status: PaymentTransactionStatus;
    initializedAt: Date;
    paidAt: Date | null;
    verifiedAt: Date | null;
    failedAt: Date | null;
    reviewReason: string | null;
  }) {
    return {
      reference: transaction.internalReference,
      provider: transaction.provider,
      environment: transaction.environment,
      planCode: transaction.planCode,
      amountMinor: transaction.amountMinor,
      currency: transaction.currency,
      status: transaction.status,
      initializedAt: transaction.initializedAt,
      paidAt: transaction.paidAt,
      verifiedAt: transaction.verifiedAt,
      failedAt: transaction.failedAt,
      reviewReason: transaction.reviewReason,
      localization: this.localizationForStatus(transaction.status),
    };
  }

  private localizationForStatus(status: PaymentTransactionStatus) {
    const key = `payment.${status.toLowerCase()}`;
    const fallback: Record<PaymentTransactionStatus, string> = {
      INITIALIZED: 'Payment initialized.',
      PENDING: 'Awaiting payment.',
      PROCESSING: 'Payment verification is processing.',
      PAID: 'Payment successful.',
      VERIFIED: 'Payment verified.',
      FAILED: 'Payment failed.',
      ABANDONED: 'Payment abandoned or expired.',
      EXPIRED: 'Payment abandoned or expired.',
      REFUNDED: 'Refund recorded.',
      REVIEW_REQUIRED: 'Payment requires review.',
    };
    return { key, fallbackLocale: 'en', fallbackMessage: fallback[status] };
  }

  private async assertBillingAuthority(
    organizationId: string,
    user: RequestUser,
  ) {
    await this.assertBillingReader(organizationId, user);
    if (
      (user.role === UserRole.ORG_ADMIN ||
        user.role === UserRole.BILLING_ADMIN) &&
      user.organizationId === organizationId
    ) {
      return;
    }
    if (
      await this.internalAdmin.hasPermission(
        user,
        'payment.plan_read',
        organizationId,
      )
    ) {
      return;
    }
    await this.audit('Payment Authorization Denied', user, {
      organizationId,
      reason: 'payment_initialization_permission_denied',
      permission: 'payment.plan_read',
    });
    throw new ForbiddenException('Unauthorized billing action');
  }

  private async assertBillingReader(organizationId: string, user: RequestUser) {
    if (
      (user.role === UserRole.ORG_ADMIN ||
        user.role === UserRole.BILLING_ADMIN) &&
      user.organizationId === organizationId
    ) {
      return;
    }
    if (
      await this.internalAdmin.hasPermission(
        user,
        'payment.transaction_read',
        organizationId,
      )
    ) {
      return;
    }
    await this.audit('Payment Authorization Denied', user, {
      organizationId,
      reason: 'payment_read_permission_denied',
      permission: 'payment.transaction_read',
    });
    throw new ForbiddenException('Access denied');
  }

  private resolveActivePlan(planCode: string) {
    const plan = resolvePaymentPlan(planCode);
    if (!plan || !plan.active) {
      throw new BadRequestException({
        code: 'INVALID_PLAN',
        message: 'The requested plan is not available for payment.',
      });
    }
    return plan;
  }

  private assertPlanUsableInEnvironment(plan: CommercialPlan) {
    if (
      this.provider.environment === PaymentEnvironment.LIVE &&
      plan.amountMinor < 1
    ) {
      throw new ServiceUnavailableException({
        code: 'LIVE_PRICE_NOT_CONFIGURED',
        message: 'Live plan pricing is not configured.',
      });
    }
  }

  private get provider(): PaymentProviderAdapter {
    return this.paystack;
  }

  private transactionMetadata(organizationId: string, plan: CommercialPlan) {
    return this.safeJson({
      organizationId,
      planCode: plan.code,
      planNameKey: plan.displayNameKey,
      source: 'organization_subscription_payment',
    });
  }

  private safeJson(value: Record<string, unknown>): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private createReference(organizationId: string) {
    const random = randomBytes(16).toString('hex');
    return `fz_${organizationId.slice(0, 8)}_${random}`;
  }

  private callbackUrl(reference: string) {
    const base = process.env.PAYMENTS_CALLBACK_BASE_URL?.trim();
    if (!base) {
      throw new ServiceUnavailableException({
        code: 'PAYMENTS_CALLBACK_MISSING',
        message: 'Payment callback URL is not configured.',
      });
    }
    const url = new URL('/billing/payment-callback', base);
    url.searchParams.set('reference', reference);
    return url.toString();
  }

  private addBillingPeriod(start: Date, interval: 'month' | 'year') {
    const next = new Date(start);
    if (interval === 'year') next.setUTCFullYear(next.getUTCFullYear() + 1);
    else next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }

  private receiptNumber(reference: string) {
    return `RCPT-${reference.slice(-12).toUpperCase()}`;
  }

  private maskReference(reference?: string | null) {
    if (!reference) return null;
    if (reference.length <= 8) return '****';
    return `${reference.slice(0, 4)}...${reference.slice(-4)}`;
  }

  private async audit(
    action: string,
    user: RequestUser | null,
    metadata: Record<string, unknown>,
  ) {
    await this.auditWithClient(this.prisma, action, user, metadata);
  }

  private async auditWithClient(
    client: Pick<TransactionClient, 'complianceAuditLog'>,
    action: string,
    user: RequestUser | null,
    metadata: Record<string, unknown>,
  ) {
    await client.complianceAuditLog.create({
      data: {
        actorId: user?.sub ?? null,
        actorRole: user?.role ?? null,
        organizationId:
          typeof metadata.organizationId === 'string'
            ? metadata.organizationId
            : null,
        action,
        entityType: 'PAYMENT',
        entityId:
          typeof metadata.transactionId === 'string'
            ? metadata.transactionId
            : null,
        metadata: this.safeJson(metadata),
      },
    });
  }
}
