import { UserRole } from '@prisma/client';
import {
  privilegedMfaRoles,
  requiresPrivilegedMfa,
} from './privileged-mfa.policy';

describe('privileged MFA role policy', () => {
  it('requires MFA for SUPER_ADMIN and every internal administration role', () => {
    expect(requiresPrivilegedMfa(UserRole.SUPER_ADMIN)).toBe(true);
    expect(privilegedMfaRoles).toEqual([
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
    ]);
  });

  it('does not require MFA for ORG_ADMIN, provider, pending provider, or citizen in this tranche', () => {
    expect(requiresPrivilegedMfa(UserRole.ORG_ADMIN)).toBe(false);
    expect(requiresPrivilegedMfa(UserRole.DISPATCH_OFFICER)).toBe(false);
    expect(requiresPrivilegedMfa(UserRole.PROVIDER)).toBe(false);
    expect(requiresPrivilegedMfa(UserRole.PENDING_PROVIDER)).toBe(false);
    expect(requiresPrivilegedMfa(UserRole.CITIZEN)).toBe(false);
  });
});
