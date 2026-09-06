import { UserRole } from '@prisma/client';

export const privilegedMfaRoles = [
  UserRole.SUPER_ADMIN,
  UserRole.PLATFORM_SUPER_ADMIN,
  UserRole.PLATFORM_OWNER,
  UserRole.EXECUTIVE_SUPER_ADMIN,
  UserRole.TECHNICAL_ADMIN,
  UserRole.OPERATIONS_ADMIN,
  UserRole.ORGANIZATION_ONBOARDING_ADMIN,
  UserRole.PROVIDER_ADMIN,
  UserRole.FINANCE_BILLING_ADMIN,
  UserRole.BILLING_ADMIN,
  UserRole.LEGAL_ADMIN,
  UserRole.ASSIGNMENT_ADMIN,
  UserRole.ASSET_ADMIN,
  UserRole.ASSET_INTELLIGENCE_ADMIN,
  UserRole.COMPLIANCE_ADMIN,
  UserRole.COMPLIANCE_AUDIT_ADMIN,
  UserRole.REGULATORY_ADMIN,
  UserRole.SECURITY_ADMIN,
  UserRole.INVESTIGATION_ADMIN,
  UserRole.RELEASE_OPERATIONS_ADMIN,
  UserRole.BACKUP_RECOVERY_ADMIN,
  UserRole.SUPPORT_ADMIN,
] as const satisfies readonly UserRole[];

const privilegedMfaRoleSet = new Set<UserRole>(privilegedMfaRoles);

export function requiresPrivilegedMfa(role: unknown) {
  return typeof role === 'string' && privilegedMfaRoleSet.has(role as UserRole);
}
