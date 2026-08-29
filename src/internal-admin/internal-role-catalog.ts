import { InternalScopeType, UserRole } from '@prisma/client';
import { enterpriseFlagEnabled } from '../enterprise-features/enterprise-feature.config';
import {
  InternalPermissionKey,
  InternalRoleDefinition,
} from './internal-admin.types';

export const internalAdminPermissionKeys: InternalPermissionKey[] = [
  'internal_admin.read',
  'internal_admin.invite',
  'internal_admin.assign_role',
  'internal_admin.change_scope',
  'internal_admin.suspend',
  'internal_admin.revoke_sessions',
  'internal_admin.view_audit',
  'organization.review',
  'organization.manage',
  'provider.review',
  'provider.manage',
  'report.operations',
  'support.account_assistance',
  'compliance.audit_read',
  'investigation.manage',
  'asset_intelligence.manage',
  'security.session_manage',
  'release.readiness_manage',
  'backup.verify',
  'backup.restore_request',
  'payment.plan_read',
  'payment.plan_manage',
  'payment.transaction_read',
  'payment.reconciliation_manage',
  'payment.refund_request',
  'payment.refund_approve',
  'payment.configuration_manage',
];

const allPermissions = internalAdminPermissionKeys;

export function internalRoleCatalog(): InternalRoleDefinition[] {
  return [
    {
      role: UserRole.PLATFORM_SUPER_ADMIN,
      canonicalName: 'PLATFORM_SUPER_ADMIN',
      displayName: 'Platform Super Admin',
      description:
        'Top-level internal administrator. Grants require dual approval.',
      permissions: allPermissions,
      defaultScopeType: InternalScopeType.PLATFORM,
      highRiskGrant: true,
      reusedExistingRole: UserRole.SUPER_ADMIN,
      version: 1,
    },
    {
      role: UserRole.OPERATIONS_ADMIN,
      canonicalName: 'OPERATIONS_ADMIN',
      displayName: 'Operations Admin',
      description: 'Manages report operations and routing readiness.',
      permissions: ['report.operations', 'organization.review'],
      defaultScopeType: InternalScopeType.MODULE,
      version: 1,
    },
    {
      role: UserRole.ORGANIZATION_ONBOARDING_ADMIN,
      canonicalName: 'ORGANIZATION_ONBOARDING_ADMIN',
      displayName: 'Organization Onboarding Admin',
      description: 'Reviews and manages customer organization onboarding.',
      permissions: ['organization.review', 'organization.manage'],
      defaultScopeType: InternalScopeType.ORGANIZATION,
      version: 1,
    },
    {
      role: UserRole.PROVIDER_ADMIN,
      canonicalName: 'PROVIDER_ADMIN',
      displayName: 'Provider Admin',
      description: 'Reviews and manages provider onboarding and records.',
      permissions: ['provider.review', 'provider.manage'],
      defaultScopeType: InternalScopeType.ORGANIZATION,
      version: 1,
    },
    {
      role: UserRole.FINANCE_BILLING_ADMIN,
      canonicalName: 'FINANCE_BILLING_ADMIN',
      displayName: 'Finance Billing Admin',
      description: 'Reads billing records and performs payment reconciliation.',
      permissions: [
        'payment.plan_read',
        'payment.transaction_read',
        'payment.reconciliation_manage',
        'payment.refund_request',
      ],
      defaultScopeType: InternalScopeType.PLATFORM,
      reusedExistingRole: UserRole.BILLING_ADMIN,
      version: 1,
    },
    {
      role: UserRole.SUPPORT_ADMIN,
      canonicalName: 'SUPPORT_ADMIN',
      displayName: 'Support Admin',
      description: 'Assists accounts without platform finance authority.',
      permissions: ['support.account_assistance', 'internal_admin.read'],
      defaultScopeType: InternalScopeType.PLATFORM,
      version: 1,
    },
    {
      role: UserRole.COMPLIANCE_AUDIT_ADMIN,
      canonicalName: 'COMPLIANCE_AUDIT_ADMIN',
      displayName: 'Compliance Audit Admin',
      description: 'Reads audit evidence and compliance history.',
      permissions: ['compliance.audit_read', 'internal_admin.view_audit'],
      defaultScopeType: InternalScopeType.PLATFORM,
      reusedExistingRole: UserRole.COMPLIANCE_ADMIN,
      version: 1,
    },
    {
      role: UserRole.SECURITY_ADMIN,
      canonicalName: 'SECURITY_ADMIN',
      displayName: 'Security Admin',
      description: 'Manages privileged sessions and security review actions.',
      permissions: [
        'security.session_manage',
        'internal_admin.revoke_sessions',
        'internal_admin.view_audit',
      ],
      defaultScopeType: InternalScopeType.PLATFORM,
      version: 1,
    },
    {
      role: UserRole.INVESTIGATION_ADMIN,
      canonicalName: 'INVESTIGATION_ADMIN',
      displayName: 'Investigation Admin',
      description: 'Reserved for the disabled investigation foundation.',
      permissions: ['investigation.manage'],
      defaultScopeType: InternalScopeType.MODULE,
      requiresEnterpriseFeature: 'investigation',
      version: 1,
    },
    {
      role: UserRole.ASSET_INTELLIGENCE_ADMIN,
      canonicalName: 'ASSET_INTELLIGENCE_ADMIN',
      displayName: 'Asset Intelligence Admin',
      description: 'Reserved for the disabled asset intelligence foundation.',
      permissions: ['asset_intelligence.manage'],
      defaultScopeType: InternalScopeType.MODULE,
      requiresEnterpriseFeature: 'asset_intelligence',
      reusedExistingRole: UserRole.ASSET_ADMIN,
      version: 1,
    },
    {
      role: UserRole.RELEASE_OPERATIONS_ADMIN,
      canonicalName: 'RELEASE_OPERATIONS_ADMIN',
      displayName: 'Release Operations Admin',
      description: 'Manages release readiness evidence, not deployments.',
      permissions: ['release.readiness_manage', 'backup.verify'],
      defaultScopeType: InternalScopeType.PLATFORM,
      version: 1,
    },
    {
      role: UserRole.BACKUP_RECOVERY_ADMIN,
      canonicalName: 'BACKUP_RECOVERY_ADMIN',
      displayName: 'Backup Recovery Admin',
      description: 'Verifies backups and requests restore authorization.',
      permissions: ['backup.verify', 'backup.restore_request'],
      defaultScopeType: InternalScopeType.PLATFORM,
      version: 1,
    },
  ];
}

export function internalRoleDefinitionsEnabledForThisRelease() {
  return internalRoleCatalog().map((definition) => ({
    ...definition,
    enabled: roleDefinitionEnabled(definition),
  }));
}

export function resolveInternalRoleDefinition(role: UserRole) {
  return (
    internalRoleCatalog().find((definition) => definition.role === role) ?? null
  );
}

export function roleDefinitionEnabled(definition: InternalRoleDefinition) {
  if (!definition.requiresEnterpriseFeature) return true;
  if (
    !enterpriseFlagEnabled(
      process.env.SECUREZONE_ENTERPRISE_FOUNDATIONS_ENABLED,
    )
  ) {
    return false;
  }
  const envName = `SECUREZONE_${definition.requiresEnterpriseFeature
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')}_ENABLED`;
  return enterpriseFlagEnabled(process.env[envName]);
}
