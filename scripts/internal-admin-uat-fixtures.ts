import 'dotenv/config';
import { createHash } from 'crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  AccountStatus,
  BillingStatus,
  InternalRoleAssignmentStatus,
  InternalScopeType,
  InvitationStatus,
  OrganizationStatus,
  OrganizationType,
  Prisma,
  PrismaClient,
  PrivilegedApprovalStatus,
  PrivilegedOperationType,
  SubscriptionPlan,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

export const fixtureBatch = 'internal-admin-uat-20260829-v1';
export const fixturePrefix = 'internal-admin-uat-';
export const fixtureDomain = 'internal-admin-uat.local.test';
export const passwordEnvName = 'FIXZONE_LOCAL_UAT_PASSWORD';
export const allowEnvName = 'FIXZONE_ALLOW_LOCAL_UAT_FIXTURES';

type GuardInput = {
  env: NodeJS.ProcessEnv;
  batch?: string;
};

type FixtureUser = {
  label: string;
  emailLocal: string;
  fullName: string;
  role: UserRole;
  status?: AccountStatus;
  organizationScoped?: boolean;
};

type FixtureAssignment = {
  label: string;
  userLabel: string;
  role: UserRole;
  permissions: string[];
  scopeType: InternalScopeType;
  organizationScoped?: boolean;
  moduleKey?: string;
  startsAt: Date;
  expiresAt?: Date | null;
  status?: InternalRoleAssignmentStatus;
};

type FixtureContext = {
  prisma: PrismaClient;
  now: Date;
  orgId: string;
  users: Record<string, { id: string; role: UserRole }>;
};

export const fixtureUsers: FixtureUser[] = [
  {
    label: 'platform-super-admin',
    emailLocal: 'platform-super-admin',
    fullName: 'Local UAT Platform Super Admin',
    role: UserRole.PLATFORM_SUPER_ADMIN,
  },
  {
    label: 'internal-reader',
    emailLocal: 'internal-reader',
    fullName: 'Local UAT Internal Reader',
    role: UserRole.SUPPORT_ADMIN,
  },
  {
    label: 'finance-billing-admin',
    emailLocal: 'finance-billing-admin',
    fullName: 'Local UAT Finance Billing Admin',
    role: UserRole.FINANCE_BILLING_ADMIN,
  },
  {
    label: 'org-scoped-internal-admin',
    emailLocal: 'org-scoped-internal-admin',
    fullName: 'Local UAT Organization Scoped Internal Admin',
    role: UserRole.SUPPORT_ADMIN,
    organizationScoped: true,
  },
  {
    label: 'ordinary-org-admin',
    emailLocal: 'ordinary-org-admin',
    fullName: 'Local UAT Ordinary Organization Admin',
    role: UserRole.ORG_ADMIN,
    organizationScoped: true,
  },
  {
    label: 'suspended-internal-admin',
    emailLocal: 'suspended-internal-admin',
    fullName: 'Local UAT Suspended Internal Admin',
    role: UserRole.SUPPORT_ADMIN,
    status: AccountStatus.SUSPENDED,
  },
  {
    label: 'expired-assignment-admin',
    emailLocal: 'expired-assignment-admin',
    fullName: 'Local UAT Expired Assignment Admin',
    role: UserRole.CITIZEN,
  },
  {
    label: 'independent-approver',
    emailLocal: 'independent-approver',
    fullName: 'Local UAT Independent Privileged Approver',
    role: UserRole.SUPPORT_ADMIN,
  },
  {
    label: 'privileged-requester',
    emailLocal: 'privileged-requester',
    fullName: 'Local UAT Privileged Request Creator',
    role: UserRole.SUPPORT_ADMIN,
  },
];

export function fixtureEmail(label: string) {
  const user = fixtureUsers.find((item) => item.label === label);
  if (!user) throw new Error(`Unknown fixture user label: ${label}`);
  return `${fixturePrefix}${user.emailLocal}@${fixtureDomain}`;
}

function marker(label: string) {
  return `${fixtureBatch}:${label}`;
}

function secretToken(label: string) {
  return createHash('sha256').update(marker(label)).digest('hex');
}

export function validateLocalFixtureGuard(input: GuardInput) {
  const env = input.env;
  const batch = input.batch ?? fixtureBatch;
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing local UAT fixtures when NODE_ENV=production.');
  }
  if (env[allowEnvName] !== 'true') {
    throw new Error(
      `Refusing local UAT fixtures without ${allowEnvName}=true.`,
    );
  }
  if (!batch.startsWith(fixturePrefix)) {
    throw new Error('Refusing fixture batch without approved prefix.');
  }
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const parsed = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error('Refusing non-local database host.');
  }
  if (parsed.port !== '5432') {
    throw new Error('Refusing database port other than 5432.');
  }
  if (parsed.pathname.replace(/^\//, '') !== 'fixzone_enterprise') {
    throw new Error('Refusing database other than fixzone_enterprise.');
  }
  const riskyHostEnvNames = [
    'API_BASE_URL',
    'APP_BASE_URL',
    'FRONTEND_URL',
    'PUBLIC_URL',
    'CORS_ORIGINS',
    'PAYMENTS_CALLBACK_BASE_URL',
  ];
  const riskyHost = riskyHostEnvNames.find((name) => {
    const value = env[name]?.toLowerCase() ?? '';
    return (
      value.includes('fixzone.ng') ||
      value.includes('securezone') ||
      value.includes('dokploy')
    );
  });
  if (riskyHost) {
    throw new Error(`Refusing fixture run with production-like ${riskyHost}.`);
  }
  return {
    host: parsed.hostname,
    port: parsed.port,
    database: parsed.pathname.replace(/^\//, ''),
    schema: 'public',
    batch,
    confirmation: env[allowEnvName] === 'true',
  };
}

export function validateFixturePassword(env: NodeJS.ProcessEnv) {
  const password = env[passwordEnvName];
  if (!password || password.length < 12) {
    throw new Error(`${passwordEnvName} must be at least 12 characters.`);
  }
  return password;
}

function prismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

function safeJson(value: Prisma.InputJsonValue): Prisma.InputJsonValue {
  return value;
}

export function assignmentFixtures(now: Date): FixtureAssignment[] {
  const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return [
    {
      label: 'platform-reader',
      userLabel: 'internal-reader',
      role: UserRole.SUPPORT_ADMIN,
      permissions: ['internal_admin.read'],
      scopeType: InternalScopeType.PLATFORM,
      startsAt: past,
      expiresAt: future,
    },
    {
      label: 'finance-visibility',
      userLabel: 'finance-billing-admin',
      role: UserRole.FINANCE_BILLING_ADMIN,
      permissions: ['payment.configuration_manage', 'payment.refund_approve'],
      scopeType: InternalScopeType.PLATFORM,
      startsAt: past,
      expiresAt: future,
    },
    {
      label: 'organization-reader',
      userLabel: 'org-scoped-internal-admin',
      role: UserRole.SUPPORT_ADMIN,
      permissions: ['internal_admin.read'],
      scopeType: InternalScopeType.ORGANIZATION,
      organizationScoped: true,
      startsAt: past,
      expiresAt: future,
    },
    {
      label: 'suspended-reader',
      userLabel: 'suspended-internal-admin',
      role: UserRole.SUPPORT_ADMIN,
      permissions: ['internal_admin.read'],
      scopeType: InternalScopeType.PLATFORM,
      startsAt: past,
      expiresAt: future,
    },
    {
      label: 'expired-reader',
      userLabel: 'expired-assignment-admin',
      role: UserRole.SUPPORT_ADMIN,
      permissions: ['internal_admin.read'],
      scopeType: InternalScopeType.PLATFORM,
      startsAt: past,
      expiresAt: past,
    },
    {
      label: 'independent-approval-permissions',
      userLabel: 'independent-approver',
      role: UserRole.SUPPORT_ADMIN,
      permissions: [
        'internal_admin.assign_role',
        'payment.configuration_manage',
        'payment.refund_approve',
        'release.readiness_manage',
      ],
      scopeType: InternalScopeType.PLATFORM,
      startsAt: past,
      expiresAt: future,
    },
    {
      label: 'self-approval-permissions',
      userLabel: 'privileged-requester',
      role: UserRole.SUPPORT_ADMIN,
      permissions: [
        'internal_admin.assign_role',
        'payment.configuration_manage',
      ],
      scopeType: InternalScopeType.PLATFORM,
      startsAt: past,
      expiresAt: future,
    },
  ];
}

export function fixtureManifest(now = new Date('2026-08-29T00:00:00.000Z')) {
  const assignments = assignmentFixtures(now);
  return {
    batch: fixtureBatch,
    domain: fixtureDomain,
    requiredEnvironmentVariables: [
      'DATABASE_URL',
      allowEnvName,
      passwordEnvName,
    ],
    accounts: fixtureUsers.map((user) => ({
      label: user.label,
      email: fixtureEmail(user.label),
      role: user.role,
      status: user.status ?? AccountStatus.ACTIVE,
      organizationScoped: Boolean(user.organizationScoped),
    })),
    assignments: assignments.map((assignment) => ({
      label: assignment.label,
      userLabel: assignment.userLabel,
      role: assignment.role,
      permissions: assignment.permissions,
      scopeType: assignment.scopeType,
      organizationScoped: Boolean(assignment.organizationScoped),
      expired: Boolean(assignment.expiresAt && assignment.expiresAt <= now),
    })),
    invitations: [
      {
        label: 'pending-platform-reader',
        role: UserRole.SUPPORT_ADMIN,
        state: 'PENDING',
        scopeType: InternalScopeType.PLATFORM,
      },
      {
        label: 'accepted-finance',
        role: UserRole.FINANCE_BILLING_ADMIN,
        state: 'ACCEPTED',
        scopeType: InternalScopeType.PLATFORM,
      },
      {
        label: 'revoked-organization',
        role: UserRole.SUPPORT_ADMIN,
        state: 'REVOKED',
        scopeType: InternalScopeType.ORGANIZATION,
      },
      {
        label: 'expired-platform',
        role: UserRole.SUPPORT_ADMIN,
        state: 'EXPIRED_BY_TIME',
        scopeType: InternalScopeType.PLATFORM,
      },
    ],
    approvals: [
      {
        label: 'pending-super-admin-elevation',
        operationType: PrivilegedOperationType.PLATFORM_SUPER_ADMIN_GRANT,
        requesterLabel: 'privileged-requester',
        targetLabel: 'internal-reader',
        status: PrivilegedApprovalStatus.PENDING,
        executionBlocked: true,
      },
      {
        label: 'pending-payment-configuration',
        operationType: PrivilegedOperationType.PAYMENT_CONFIGURATION_CHANGE,
        requesterLabel: 'finance-billing-admin',
        status: PrivilegedApprovalStatus.PENDING,
        executionBlocked: true,
      },
      {
        label: 'pending-high-value-refund',
        operationType: PrivilegedOperationType.HIGH_VALUE_REFUND_APPROVAL,
        requesterLabel: 'finance-billing-admin',
        status: PrivilegedApprovalStatus.PENDING,
        executionBlocked: true,
      },
      {
        label: 'self-approval-prohibited',
        operationType: PrivilegedOperationType.PLATFORM_SUPER_ADMIN_GRANT,
        requesterLabel: 'privileged-requester',
        targetLabel: 'privileged-requester',
        status: PrivilegedApprovalStatus.PENDING,
        executionBlocked: true,
      },
      {
        label: 'rejected-role-change',
        operationType: PrivilegedOperationType.ROLE_DEFINITION_CHANGE,
        requesterLabel: 'privileged-requester',
        approverLabel: 'independent-approver',
        status: PrivilegedApprovalStatus.REJECTED,
        executionBlocked: true,
      },
      {
        label: 'approved-execution-blocked',
        operationType: PrivilegedOperationType.ENTERPRISE_FEATURE_ENABLEMENT,
        requesterLabel: 'privileged-requester',
        approverLabel: 'independent-approver',
        status: PrivilegedApprovalStatus.APPROVED,
        executionBlocked: true,
      },
    ],
    expectedCounts: {
      organizations: 1,
      users: fixtureUsers.length,
      assignments: assignments.length,
      invitations: 4,
      approvals: 6,
      suspendedUsers: 1,
      expiredAssignments: 1,
      organizationScopedAssignments: 1,
    },
  };
}

async function upsertOrganization(prisma: PrismaClient) {
  const existing = await prisma.organization.findFirst({
    where: { demoBatchId: fixtureBatch, demoScenario: marker('organization') },
    select: { id: true },
  });
  const data = {
    name: 'Local Internal Admin UAT Organization',
    type: OrganizationType.LOCAL_GOVERNMENT,
    status: OrganizationStatus.ACTIVE,
    tenantCode: 'LOCAL-IAG-UAT',
    contactEmail: `fixture-org@${fixtureDomain}`,
    country: 'Nigeria',
    subscriptionPlan: SubscriptionPlan.DEMO,
    billingStatus: BillingStatus.ACTIVE,
    enabledModules: safeJson(['maintenance']),
    isDemo: true,
    demoBatchId: fixtureBatch,
    demoScenario: marker('organization'),
    demoGeneratedAt: new Date(),
  };
  if (existing) {
    const updated = await prisma.organization.update({
      where: { id: existing.id },
      data,
      select: { id: true },
    });
    return updated.id;
  }
  const created = await prisma.organization.create({
    data,
    select: { id: true },
  });
  return created.id;
}

async function upsertUsers(
  prisma: PrismaClient,
  orgId: string,
  passwordHash: string,
) {
  const users: Record<string, { id: string; role: UserRole }> = {};
  for (const fixture of fixtureUsers) {
    const email = fixtureEmail(fixture.label);
    const data = {
      email,
      fullName: fixture.fullName,
      passwordHash,
      role: fixture.role,
      accountStatus: fixture.status ?? AccountStatus.ACTIVE,
      organizationId: fixture.organizationScoped ? orgId : null,
      profileData: safeJson({
        fixtureBatch,
        fixtureLabel: fixture.label,
        localOnly: true,
      }),
      isDemo: true,
      demoBatchId: fixtureBatch,
      demoScenario: marker(`user:${fixture.label}`),
      demoGeneratedAt: new Date(),
    };
    const user = await prisma.user.upsert({
      where: { email },
      update: data,
      create: data,
      select: { id: true, role: true },
    });
    users[fixture.label] = user;
  }
  return users;
}

async function upsertAssignments(context: FixtureContext) {
  for (const fixture of assignmentFixtures(context.now)) {
    const user = context.users[fixture.userLabel];
    const reason = marker(`assignment:${fixture.label}`);
    const data = {
      userId: user.id,
      role: fixture.role,
      status: fixture.status ?? InternalRoleAssignmentStatus.ACTIVE,
      scopeType: fixture.scopeType,
      scopeRef: fixture.organizationScoped ? context.orgId : null,
      organizationId: fixture.organizationScoped ? context.orgId : null,
      moduleKey: fixture.moduleKey ?? null,
      permissionsSnapshot: safeJson(fixture.permissions),
      roleDefinitionVersion: 1,
      assignedById: context.users['platform-super-admin'].id,
      reason,
      startsAt: fixture.startsAt,
      expiresAt: fixture.expiresAt ?? null,
    };
    const existing = await context.prisma.internalRoleAssignment.findFirst({
      where: { userId: user.id, reason },
      select: { id: true },
    });
    if (existing) {
      await context.prisma.internalRoleAssignment.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await context.prisma.internalRoleAssignment.create({ data });
    }
  }
}

async function upsertInvitation(
  context: FixtureContext,
  label: string,
  data: {
    email: string;
    fullName: string;
    role: UserRole;
    status: InvitationStatus;
    organizationId?: string | null;
    acceptedUserId?: string | null;
    expiresAt?: Date | null;
    acceptedAt?: Date | null;
    revokedAt?: Date | null;
    declinedAt?: Date | null;
    scope: Prisma.InputJsonObject;
  },
) {
  const inviteCode = secretToken(`invite-code:${label}`).slice(0, 32);
  const { scope, ...invitationData } = data;
  const payload = {
    ...invitationData,
    invitedById: context.users['platform-super-admin'].id,
    inviteCode,
    tokenHash: secretToken(`invite-token:${label}`),
    temporaryPasswordHash: null,
    metadata: safeJson({
      source: 'internal_admin_delegation',
      fixtureBatch,
      fixtureLabel: label,
      scope,
      localization: {
        key: 'internal_admin.invitation_pending',
        fallbackLocale: 'en',
        fallbackMessage: 'Local internal admin UAT invitation.',
      },
    }),
  };
  await context.prisma.invitation.upsert({
    where: { inviteCode },
    update: payload,
    create: payload,
  });
}

async function upsertInvitations(context: FixtureContext) {
  const now = context.now;
  const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  await upsertInvitation(context, 'pending-platform-reader', {
    email: `pending-reader@${fixtureDomain}`,
    fullName: 'Pending Platform Reader',
    role: UserRole.SUPPORT_ADMIN,
    status: InvitationStatus.PENDING,
    expiresAt: future,
    scope: { type: InternalScopeType.PLATFORM },
  });
  await upsertInvitation(context, 'accepted-finance', {
    email: fixtureEmail('finance-billing-admin'),
    fullName: 'Accepted Finance Admin',
    role: UserRole.FINANCE_BILLING_ADMIN,
    status: InvitationStatus.ACCEPTED,
    acceptedUserId: context.users['finance-billing-admin'].id,
    acceptedAt: past,
    expiresAt: future,
    scope: { type: InternalScopeType.PLATFORM },
  });
  await upsertInvitation(context, 'revoked-organization', {
    email: `revoked-org-reader@${fixtureDomain}`,
    fullName: 'Revoked Organization Reader',
    role: UserRole.SUPPORT_ADMIN,
    status: InvitationStatus.REVOKED,
    organizationId: context.orgId,
    revokedAt: past,
    expiresAt: future,
    scope: {
      type: InternalScopeType.ORGANIZATION,
      organizationId: context.orgId,
    },
  });
  await upsertInvitation(context, 'expired-platform', {
    email: `expired-reader@${fixtureDomain}`,
    fullName: 'Expired Platform Reader',
    role: UserRole.SUPPORT_ADMIN,
    status: InvitationStatus.PENDING,
    expiresAt: past,
    scope: { type: InternalScopeType.PLATFORM },
  });
}

async function upsertApproval(
  context: FixtureContext,
  label: string,
  data: {
    operationType: PrivilegedOperationType;
    status: PrivilegedApprovalStatus;
    requesterLabel: string;
    approverLabel?: string | null;
    targetLabel?: string | null;
    organizationId?: string | null;
    requestedRole?: UserRole | null;
    requestedScope?: Prisma.InputJsonObject;
    reason: string;
    decisionReason?: string | null;
    decidedAt?: Date | null;
    executionBlocked?: boolean;
  },
) {
  const requester = context.users[data.requesterLabel];
  const approver = data.approverLabel
    ? context.users[data.approverLabel]
    : null;
  const target = data.targetLabel ? context.users[data.targetLabel] : null;
  const payload = {
    operationType: data.operationType,
    status: data.status,
    requesterId: requester.id,
    approverId: approver?.id ?? null,
    targetUserId: target?.id ?? null,
    organizationId: data.organizationId ?? null,
    requestedRole: data.requestedRole ?? null,
    requestedScope: safeJson(data.requestedScope ?? { scopeType: 'PLATFORM' }),
    payload: safeJson({
      fixtureBatch,
      fixtureLabel: label,
      blockedReason: 'Local UAT fixture: execution remains blocked.',
    }),
    reason: data.reason,
    decisionReason: data.decisionReason ?? null,
    requestedAt: new Date(context.now.getTime() - 2 * 60 * 60 * 1000),
    decidedAt: data.decidedAt ?? null,
    executionBlocked: data.executionBlocked ?? true,
  };
  const existing = (
    await context.prisma.privilegedApprovalRequest.findMany({
      where: { requesterId: requester.id, operationType: data.operationType },
      select: { id: true, payload: true },
    })
  ).filter((item) => {
    const json = item.payload;
    return (
      json !== null &&
      typeof json === 'object' &&
      !Array.isArray(json) &&
      (json as Record<string, unknown>).fixtureBatch === fixtureBatch &&
      (json as Record<string, unknown>).fixtureLabel === label
    );
  });
  if (existing[0]) {
    await context.prisma.privilegedApprovalRequest.update({
      where: { id: existing[0].id },
      data: payload,
    });
  } else {
    await context.prisma.privilegedApprovalRequest.create({ data: payload });
  }
  for (const duplicate of existing.slice(1)) {
    await context.prisma.privilegedApprovalRequest.delete({
      where: { id: duplicate.id },
    });
  }
}

async function upsertApprovals(context: FixtureContext) {
  const decidedAt = new Date(context.now.getTime() - 60 * 60 * 1000);
  await upsertApproval(context, 'pending-super-admin-elevation', {
    operationType: PrivilegedOperationType.PLATFORM_SUPER_ADMIN_GRANT,
    status: PrivilegedApprovalStatus.PENDING,
    requesterLabel: 'privileged-requester',
    targetLabel: 'internal-reader',
    requestedRole: UserRole.PLATFORM_SUPER_ADMIN,
    reason: 'Local UAT super-admin elevation requires independent review.',
  });
  await upsertApproval(context, 'pending-payment-configuration', {
    operationType: PrivilegedOperationType.PAYMENT_CONFIGURATION_CHANGE,
    status: PrivilegedApprovalStatus.PENDING,
    requesterLabel: 'finance-billing-admin',
    reason: 'Local UAT payment configuration review without gateway secrets.',
  });
  await upsertApproval(context, 'pending-high-value-refund', {
    operationType: PrivilegedOperationType.HIGH_VALUE_REFUND_APPROVAL,
    status: PrivilegedApprovalStatus.PENDING,
    requesterLabel: 'finance-billing-admin',
    organizationId: context.orgId,
    requestedScope: {
      scopeType: InternalScopeType.ORGANIZATION,
      organizationId: context.orgId,
    },
    reason: 'Local UAT high-value refund approval without live transaction.',
  });
  await upsertApproval(context, 'self-approval-prohibited', {
    operationType: PrivilegedOperationType.PLATFORM_SUPER_ADMIN_GRANT,
    status: PrivilegedApprovalStatus.PENDING,
    requesterLabel: 'privileged-requester',
    targetLabel: 'privileged-requester',
    requestedRole: UserRole.PLATFORM_SUPER_ADMIN,
    reason: 'Local UAT requester must not approve own elevation.',
  });
  await upsertApproval(context, 'rejected-role-change', {
    operationType: PrivilegedOperationType.ROLE_DEFINITION_CHANGE,
    status: PrivilegedApprovalStatus.REJECTED,
    requesterLabel: 'privileged-requester',
    approverLabel: 'independent-approver',
    reason: 'Local UAT rejected role-definition request.',
    decisionReason: 'Rejected during local UAT fixture preparation.',
    decidedAt,
  });
  await upsertApproval(context, 'approved-execution-blocked', {
    operationType: PrivilegedOperationType.ENTERPRISE_FEATURE_ENABLEMENT,
    status: PrivilegedApprovalStatus.APPROVED,
    requesterLabel: 'privileged-requester',
    approverLabel: 'independent-approver',
    reason: 'Local UAT approved feature request with execution blocked.',
    decisionReason: 'Approved locally; execution intentionally blocked.',
    decidedAt,
    executionBlocked: true,
  });
}

export async function seedFixtures(prisma = prismaClient()) {
  const identity = validateLocalFixtureGuard({
    env: process.env,
    batch: fixtureBatch,
  });
  const password = validateFixturePassword(process.env);
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const orgId = await upsertOrganization(tx as PrismaClient);
    const users = await upsertUsers(tx as PrismaClient, orgId, passwordHash);
    const context: FixtureContext = {
      prisma: tx as PrismaClient,
      now,
      orgId,
      users,
    };
    await upsertAssignments(context);
    await upsertInvitations(context);
    await upsertApprovals(context);
    return verifyFixtures(tx as PrismaClient, false);
  });
  return { identity, result };
}

export function isFixturePayload(value: Prisma.JsonValue | null) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).fixtureBatch === fixtureBatch
  );
}

export async function verifyFixtures(prisma = prismaClient(), guarded = true) {
  const identity = guarded
    ? validateLocalFixtureGuard({ env: process.env, batch: fixtureBatch })
    : null;
  const users = await prisma.user.findMany({
    where: { demoBatchId: fixtureBatch },
    select: { id: true, role: true, accountStatus: true, email: true },
  });
  const userIds = users.map((user) => user.id);
  const orgs = await prisma.organization.count({
    where: { demoBatchId: fixtureBatch },
  });
  const assignmentRows = await prisma.internalRoleAssignment.findMany({
    where: { userId: { in: userIds } },
    select: {
      status: true,
      expiresAt: true,
      scopeType: true,
      organizationId: true,
    },
  });
  const invitations = await prisma.invitation.findMany({
    where: { metadata: { path: ['fixtureBatch'], equals: fixtureBatch } },
    select: { status: true, expiresAt: true, organizationId: true },
  });
  const approvals = (
    await prisma.privilegedApprovalRequest.findMany({
      select: {
        status: true,
        operationType: true,
        executionBlocked: true,
        requesterId: true,
        approverId: true,
        payload: true,
      },
    })
  ).filter((approval) => isFixturePayload(approval.payload));
  const now = new Date();
  const byInvitationState = invitations.reduce<Record<string, number>>(
    (accumulator, invitation) => {
      const key =
        invitation.status === InvitationStatus.PENDING &&
        invitation.expiresAt &&
        invitation.expiresAt <= now
          ? 'EXPIRED_BY_TIME'
          : invitation.status;
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    },
    {},
  );
  const byApprovalStatus = approvals.reduce<Record<string, number>>(
    (accumulator, approval) => {
      const key = `${approval.status}:${approval.executionBlocked ? 'BLOCKED' : 'UNBLOCKED'}`;
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    },
    {},
  );
  const activeAssignments = assignmentRows.filter(
    (assignment) =>
      assignment.status === InternalRoleAssignmentStatus.ACTIVE &&
      (!assignment.expiresAt || assignment.expiresAt > now),
  ).length;
  const expiredAssignments = assignmentRows.filter(
    (assignment) => assignment.expiresAt && assignment.expiresAt <= now,
  ).length;
  const suspendedUsers = users.filter(
    (user) => user.accountStatus === AccountStatus.SUSPENDED,
  ).length;
  const missing: string[] = [];
  if (orgs !== 1) missing.push('fixture organization');
  if (users.length !== fixtureUsers.length) missing.push('fixture users');
  if (invitations.length !== 4) missing.push('invitation scenarios');
  if (approvals.length !== 6) missing.push('approval scenarios');
  if (suspendedUsers !== 1) missing.push('suspended identity');
  if (expiredAssignments < 1) missing.push('expired assignment');
  return {
    identity,
    batch: fixtureBatch,
    counts: {
      organizations: orgs,
      users: users.length,
      activeAssignments,
      suspendedUsers,
      expiredAssignments,
      invitations: invitations.length,
      approvals: approvals.length,
    },
    invitationStates: byInvitationState,
    approvalStates: byApprovalStatus,
    scopeRelationships: {
      organizationScopedAssignments: assignmentRows.filter(
        (assignment) =>
          assignment.scopeType === InternalScopeType.ORGANIZATION &&
          Boolean(assignment.organizationId),
      ).length,
    },
    missingPrerequisites: missing,
    pass: missing.length === 0,
  };
}

export async function cleanupFixtures(prisma = prismaClient()) {
  const identity = validateLocalFixtureGuard({
    env: process.env,
    batch: fixtureBatch,
  });
  const users = await prisma.user.findMany({
    where: { demoBatchId: fixtureBatch },
    select: { id: true, email: true },
  });
  const userIds = users.map((user) => user.id);
  const orgs = await prisma.organization.findMany({
    where: { demoBatchId: fixtureBatch },
    select: { id: true },
  });
  const orgIds = orgs.map((org) => org.id);
  const unsafeCounts = {
    reports: await prisma.report.count({
      where: {
        OR: [
          { citizenId: { in: userIds } },
          { organizationId: { in: orgIds } },
        ],
      },
    }),
    evidence: await prisma.evidenceRecord.count({
      where: {
        OR: [
          { ownerUserId: { in: userIds } },
          { uploadedById: { in: userIds } },
          { organizationId: { in: orgIds } },
        ],
      },
    }),
    disputes: await prisma.disputeCase.count({
      where: {
        OR: [
          { openedById: { in: userIds } },
          { againstUserId: { in: userIds } },
          { organizationId: { in: orgIds } },
        ],
      },
    }),
    payments: await prisma.paymentTransaction.count({
      where: {
        OR: [
          { requestingUserId: { in: userIds } },
          { organizationId: { in: orgIds } },
        ],
      },
    }),
    providerLinks: await prisma.providerOrganization.count({
      where: {
        OR: [
          { providerId: { in: userIds } },
          { organizationId: { in: orgIds } },
        ],
      },
    }),
  };
  const unsafe = Object.entries(unsafeCounts).filter(([, count]) => count > 0);
  if (unsafe.length) {
    throw new Error(
      `Refusing cleanup due to unexpected fixture relationships: ${unsafe
        .map(([name, count]) => `${name}=${count}`)
        .join(', ')}`,
    );
  }
  const result = await prisma.$transaction(async (tx) => {
    const approvals = await tx.privilegedApprovalRequest.findMany({
      select: { id: true, payload: true },
    });
    const approvalIds = approvals
      .filter((approval) => isFixturePayload(approval.payload))
      .map((approval) => approval.id);
    const deletedApprovals = approvalIds.length
      ? await tx.privilegedApprovalRequest.deleteMany({
          where: { id: { in: approvalIds } },
        })
      : { count: 0 };
    const deletedInvitations = await tx.invitation.deleteMany({
      where: { metadata: { path: ['fixtureBatch'], equals: fixtureBatch } },
    });
    const deletedAssignments = await tx.internalRoleAssignment.deleteMany({
      where: { userId: { in: userIds } },
    });
    const deletedAuditLogs = await tx.complianceAuditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: userIds } },
          { entityId: { in: [...userIds, ...orgIds, ...approvalIds] } },
        ],
      },
    });
    const deletedLoginHistory = await tx.loginHistory.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          {
            email: {
              in: users.map((user) => user.email).filter(Boolean) as string[],
            },
          },
        ],
      },
    });
    const deletedUsers = await tx.user.deleteMany({
      where: { id: { in: userIds } },
    });
    const deletedOrganizations = await tx.organization.deleteMany({
      where: { id: { in: orgIds } },
    });
    return {
      approvals: deletedApprovals.count,
      invitations: deletedInvitations.count,
      assignments: deletedAssignments.count,
      auditLogs: deletedAuditLogs.count,
      loginHistory: deletedLoginHistory.count,
      users: deletedUsers.count,
      organizations: deletedOrganizations.count,
    };
  });
  return { identity, unsafeCounts, deleted: result };
}

function printSafe(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const command = process.argv[2];
  const prisma = prismaClient();
  try {
    if (command === 'seed') {
      const result = await seedFixtures(prisma);
      printSafe(result);
      return;
    }
    if (command === 'verify') {
      const result = await verifyFixtures(prisma);
      printSafe(result);
      process.exitCode = result.pass ? 0 : 1;
      return;
    }
    if (command === 'cleanup') {
      const result = await cleanupFixtures(prisma);
      printSafe(result);
      return;
    }
    throw new Error(
      'Usage: ts-node scripts/internal-admin-uat-fixtures.ts <seed|verify|cleanup>',
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Fixture command failed.',
    );
    process.exit(1);
  });
}
