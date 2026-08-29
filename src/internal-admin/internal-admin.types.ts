import {
  InternalScopeType,
  PrivilegedOperationType,
  UserRole,
} from '@prisma/client';

export type InternalPermissionKey =
  | 'internal_admin.read'
  | 'internal_admin.invite'
  | 'internal_admin.assign_role'
  | 'internal_admin.change_scope'
  | 'internal_admin.suspend'
  | 'internal_admin.revoke_sessions'
  | 'internal_admin.view_audit'
  | 'organization.review'
  | 'organization.manage'
  | 'provider.review'
  | 'provider.manage'
  | 'report.operations'
  | 'support.account_assistance'
  | 'compliance.audit_read'
  | 'investigation.manage'
  | 'asset_intelligence.manage'
  | 'security.session_manage'
  | 'release.readiness_manage'
  | 'backup.verify'
  | 'backup.restore_request'
  | 'payment.plan_read'
  | 'payment.plan_manage'
  | 'payment.transaction_read'
  | 'payment.reconciliation_manage'
  | 'payment.refund_request'
  | 'payment.refund_approve'
  | 'payment.configuration_manage';

export type InternalAdminUser = {
  id?: string;
  userId?: string;
  sub?: string;
  email?: string | null;
  fullName?: string | null;
  role?: UserRole;
  organizationId?: string | null;
  accountStatus?: string | null;
  preferredLocale?: string | null;
};

export type InternalScope = {
  type: InternalScopeType;
  ref?: string | null;
  organizationId?: string | null;
  moduleKey?: string | null;
  jurisdiction?: Record<string, unknown> | null;
};

export type InternalRoleDefinition = {
  role: UserRole;
  canonicalName: string;
  displayName: string;
  description: string;
  permissions: InternalPermissionKey[];
  defaultScopeType: InternalScopeType;
  requiresEnterpriseFeature?: string;
  highRiskGrant?: boolean;
  reusedExistingRole?: UserRole;
  version: number;
};

export type EffectivePermissionResult = {
  userId: string;
  role: UserRole | undefined;
  permissions: InternalPermissionKey[];
  scopes: InternalScope[];
  mfa: {
    required: boolean;
    enforced: boolean;
    state: 'blocked_until_mfa_foundation' | 'not_required';
    fallbackMessage: string;
  };
};

export type RequestContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export const highRiskOperationPermissions: Record<
  PrivilegedOperationType,
  InternalPermissionKey
> = {
  PLATFORM_SUPER_ADMIN_GRANT: 'internal_admin.assign_role',
  ROLE_DEFINITION_CHANGE: 'internal_admin.assign_role',
  PRODUCTION_RESTORE_AUTHORIZATION: 'backup.restore_request',
  ENTERPRISE_FEATURE_ENABLEMENT: 'release.readiness_manage',
  PAYMENT_CONFIGURATION_CHANGE: 'payment.configuration_manage',
  HIGH_VALUE_REFUND_APPROVAL: 'payment.refund_approve',
};
