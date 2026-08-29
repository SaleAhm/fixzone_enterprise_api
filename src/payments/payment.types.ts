import {
  PaymentEnvironment,
  PaymentProvider,
  PaymentTransactionStatus,
  SubscriptionPlan,
  UserRole,
} from '@prisma/client';

export type RequestUser = {
  sub: string;
  email?: string | null;
  role?: UserRole;
  organizationId?: string | null;
};

export type BillingInterval = 'month' | 'year';

export type PlanEntitlements = {
  allowedUsers: number | null;
  allowedProviders: number | null;
  allowedReportsPerMonth: number | null;
  allowedStorageMb: number | null;
  enabledModules: string[];
};

export type CommercialPlan = {
  code: SubscriptionPlan;
  displayNameKey: string;
  descriptionKey: string;
  billingInterval: BillingInterval;
  currency: string;
  amountMinor: number;
  active: boolean;
  entitlements: PlanEntitlements;
  providerReferences: Partial<Record<PaymentEnvironment, string>>;
};

export type PaymentInitializationRequest = {
  email: string;
  amountMinor: number;
  currency: string;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, string | number | boolean | null>;
  planReference?: string;
};

export type PaymentInitializationResult = {
  authorizationUrl: string;
  accessCode: string;
  providerReference: string;
};

export type NormalizedProviderTransaction = {
  provider: PaymentProvider;
  environment: PaymentEnvironment;
  providerReference: string;
  internalReference: string;
  status: PaymentTransactionStatus;
  amountMinor: number;
  currency: string;
  paidAt?: Date | null;
  eventId?: string | null;
  metadata: Record<string, unknown>;
};

export type NormalizedWebhookEvent = {
  event: string;
  eventId: string;
  transaction?: NormalizedProviderTransaction;
};

export interface PaymentProviderAdapter {
  readonly provider: PaymentProvider;
  readonly environment: PaymentEnvironment;
  assertReady(): void;
  initializeTransaction(
    request: PaymentInitializationRequest,
  ): Promise<PaymentInitializationResult>;
  verifyTransaction(reference: string): Promise<NormalizedProviderTransaction>;
  retrieveTransactionStatus(
    reference: string,
  ): Promise<NormalizedProviderTransaction>;
  validateWebhookSignature(rawBody: Buffer, signature?: string): boolean;
  parseWebhookEvent(payload: unknown): NormalizedWebhookEvent;
}
