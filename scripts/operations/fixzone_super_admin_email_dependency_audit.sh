#!/usr/bin/env bash
set -Eeuo pipefail

IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=fixzone_super_admin_email_common.sh
source "$SCRIPT_DIR/fixzone_super_admin_email_common.sh"

build_dependency_audit_sql() {
  local target_email="$1"
  fz_copy_target_email_sql "$target_email"
  cat <<'SQL'
\pset format unaligned
\pset tuples_only on
BEGIN READ ONLY;
WITH
target_user AS (
  SELECT id, role, "accountStatus", "isDemo", "firebaseUid", "providerId", "passwordHash", phone, email
  FROM "User"
  WHERE lower(email) = (SELECT target_email FROM __fz_input)
),
active_super_admin AS (
  SELECT id, email, "passwordHash"
  FROM "User"
  WHERE role = 'SUPER_ADMIN'::"UserRole"
    AND "accountStatus" = 'ACTIVE'::"AccountStatus"
),
counts AS (
  SELECT
    (SELECT count(*) FROM target_user) AS target_account_count,
    (SELECT count(*) FROM target_user WHERE role = 'CITIZEN'::"UserRole") AS target_citizen_count,
    (SELECT count(*) FROM target_user WHERE "accountStatus" = 'ACTIVE'::"AccountStatus") AS target_active_count,
    (SELECT count(*) FROM target_user WHERE "isDemo") AS target_demo_count,
    (SELECT count(*) FROM active_super_admin) AS active_super_admin_count,
    (SELECT count(*) FROM active_super_admin WHERE "passwordHash" IS NOT NULL AND "passwordHash" <> '') AS active_super_admin_password_hash_present_count,
    (SELECT count(*) FROM active_super_admin WHERE email IS NOT NULL AND email <> '') AS active_super_admin_email_present_count,
    (SELECT count(*) FROM "PasswordResetToken" WHERE "userId" IN (SELECT id FROM target_user)) AS target_password_reset_token_count,
    (SELECT count(*) FROM "PasswordResetToken" WHERE "userId" IN (SELECT id FROM active_super_admin)) AS active_super_admin_password_reset_token_count,
    (SELECT count(*) FROM "PrivilegedMfaEnrollment" WHERE "userId" IN (SELECT id FROM target_user)) AS target_mfa_enrollment_count,
    (SELECT count(*) FROM "PrivilegedMfaEnrollment" WHERE "userId" IN (SELECT id FROM active_super_admin)) AS active_super_admin_mfa_enrollment_count,
    (SELECT count(*) FROM "PrivilegedMfaBackupCode" WHERE "userId" IN (SELECT id FROM target_user)) AS target_mfa_backup_code_count,
    (SELECT count(*) FROM "PrivilegedMfaBackupCode" WHERE "userId" IN (SELECT id FROM active_super_admin)) AS active_super_admin_mfa_backup_code_count,
    (SELECT count(*) FROM "PrivilegedMfaPreAuthSession" WHERE "userId" IN (SELECT id FROM target_user)) AS target_mfa_pre_auth_session_count,
    (SELECT count(*) FROM "PrivilegedMfaPreAuthSession" WHERE "userId" IN (SELECT id FROM active_super_admin)) AS active_super_admin_mfa_pre_auth_session_count,
    (SELECT count(*) FROM "KycSubmission" WHERE "userId" IN (SELECT id FROM target_user)) AS target_kyc_submission_count,
    (SELECT count(*) FROM "KycSubmission" WHERE "reviewedById" IN (SELECT id FROM target_user)) AS target_kyc_reviewed_by_count,
    (SELECT count(*) FROM "LoginHistory" WHERE "userId" IN (SELECT id FROM target_user)) AS target_login_history_user_count,
    (SELECT count(*) FROM "LoginHistory" WHERE lower(email) = (SELECT target_email FROM __fz_input)) AS target_login_history_email_count,
    (SELECT count(*) FROM "EvidenceRecord" WHERE "ownerUserId" IN (SELECT id FROM target_user)) AS target_evidence_owner_count,
    (SELECT count(*) FROM "EvidenceRecord" WHERE "uploadedById" IN (SELECT id FROM target_user)) AS target_evidence_uploaded_by_count,
    (SELECT count(*) FROM "EvidenceRecord" WHERE "relatedEntityType" = 'USER'::"EvidenceRelatedEntityType" AND "relatedEntityId" IN (SELECT id FROM target_user)) AS target_evidence_related_user_count,
    (SELECT count(*) FROM "DisputeCase" WHERE "openedById" IN (SELECT id FROM target_user)) AS target_dispute_opened_by_count,
    (SELECT count(*) FROM "DisputeCase" WHERE "againstUserId" IN (SELECT id FROM target_user)) AS target_dispute_against_user_count,
    (SELECT count(*) FROM "DisputeCase" WHERE "closedById" IN (SELECT id FROM target_user)) AS target_dispute_closed_by_count,
    (SELECT count(*) FROM "DisputeCase" WHERE "assignedAdminId" IN (SELECT id FROM target_user)) AS target_dispute_assigned_admin_count,
    (SELECT count(*) FROM "DisputeMessage" WHERE "authorId" IN (SELECT id FROM target_user)) AS target_dispute_message_author_count,
    (SELECT count(*) FROM "DisputeTimeline" WHERE "actorId" IN (SELECT id FROM target_user)) AS target_dispute_timeline_actor_count,
    (SELECT count(*) FROM "DisputeEvidence" WHERE "uploadedById" IN (SELECT id FROM target_user)) AS target_dispute_evidence_uploaded_by_count,
    (SELECT count(*) FROM "DisputeDecision" WHERE "decidedById" IN (SELECT id FROM target_user)) AS target_dispute_decision_decided_by_count,
    (SELECT count(*) FROM "UserEntitlement" WHERE "userId" IN (SELECT id FROM target_user)) AS target_user_entitlement_count,
    (SELECT count(*) FROM "ComplianceAuditLog" WHERE "actorId" IN (SELECT id FROM target_user)) AS target_compliance_audit_actor_count,
    (SELECT count(*) FROM "ComplianceAuditLog" WHERE "entityType" = 'User' AND "entityId" IN (SELECT id FROM target_user)) AS target_compliance_audit_entity_user_count,
    (SELECT count(*) FROM "AdminScope" WHERE "userId" IN (SELECT id FROM target_user)) AS target_admin_scope_user_count,
    (SELECT count(*) FROM "AdminScope" WHERE "createdById" IN (SELECT id FROM target_user)) AS target_admin_scope_created_by_count,
    (SELECT count(*) FROM "DelegatedAuthority" WHERE "userId" IN (SELECT id FROM target_user)) AS target_delegated_authority_user_count,
    (SELECT count(*) FROM "DelegatedAuthority" WHERE "delegatedById" IN (SELECT id FROM target_user)) AS target_delegated_authority_delegated_by_count,
    (SELECT count(*) FROM "InternalRoleAssignment" WHERE "userId" IN (SELECT id FROM target_user)) AS target_internal_role_assignment_user_count,
    (SELECT count(*) FROM "InternalRoleAssignment" WHERE "assignedById" IN (SELECT id FROM target_user)) AS target_internal_role_assignment_assigned_by_count,
    (SELECT count(*) FROM "InternalRoleAssignment" WHERE "revokedById" IN (SELECT id FROM target_user)) AS target_internal_role_assignment_revoked_by_count,
    (SELECT count(*) FROM "PrivilegedApprovalRequest" WHERE "requesterId" IN (SELECT id FROM target_user)) AS target_privileged_approval_requester_count,
    (SELECT count(*) FROM "PrivilegedApprovalRequest" WHERE "approverId" IN (SELECT id FROM target_user)) AS target_privileged_approval_approver_count,
    (SELECT count(*) FROM "PrivilegedApprovalRequest" WHERE "targetUserId" IN (SELECT id FROM target_user)) AS target_privileged_approval_target_user_count,
    (SELECT count(*) FROM "RegulatoryCase" WHERE "createdById" IN (SELECT id FROM target_user)) AS target_regulatory_case_created_by_count,
    (SELECT count(*) FROM "RegulatoryExport" WHERE "requestedById" IN (SELECT id FROM target_user)) AS target_regulatory_export_requested_by_count,
    (SELECT count(*) FROM "RegulatoryExport" WHERE "reviewedById" IN (SELECT id FROM target_user)) AS target_regulatory_export_reviewed_by_count,
    (SELECT count(*) FROM "EvidencePackage" WHERE "createdById" IN (SELECT id FROM target_user)) AS target_evidence_package_created_by_count,
    (SELECT count(*) FROM "EvidencePackage" WHERE "sealedById" IN (SELECT id FROM target_user)) AS target_evidence_package_sealed_by_count,
    (SELECT count(*) FROM "EvidenceAudit" WHERE "actorId" IN (SELECT id FROM target_user)) AS target_evidence_audit_actor_count,
    (SELECT count(*) FROM "EvidenceAccessLog" WHERE "actorId" IN (SELECT id FROM target_user)) AS target_evidence_access_actor_count,
    (SELECT count(*) FROM "Invitation" WHERE "invitedById" IN (SELECT id FROM target_user)) AS target_invitation_invited_by_count,
    (SELECT count(*) FROM "Invitation" WHERE "acceptedUserId" IN (SELECT id FROM target_user)) AS target_invitation_accepted_user_count,
    (SELECT count(*) FROM "Invitation" WHERE lower(email) = (SELECT target_email FROM __fz_input)) AS target_invitation_email_count,
    (SELECT count(*) FROM "ProviderOrganization" WHERE "providerId" IN (SELECT id FROM target_user)) AS target_provider_organization_count,
    (SELECT count(*) FROM "OrganizationUpgradeRequest" WHERE "requestedByUserId" IN (SELECT id FROM target_user)) AS target_org_upgrade_requested_by_count,
    (SELECT count(*) FROM "OrganizationUpgradeRequest" WHERE "reviewedByUserId" IN (SELECT id FROM target_user)) AS target_org_upgrade_reviewed_by_count,
    (SELECT count(*) FROM "PaymentTransaction" WHERE "requestingUserId" IN (SELECT id FROM target_user)) AS target_payment_requesting_user_count,
    (SELECT count(*) FROM "JurisdictionZone" WHERE "createdById" IN (SELECT id FROM target_user)) AS target_jurisdiction_zone_created_by_count,
    (SELECT count(*) FROM "OwnershipRecommendation" WHERE "createdById" IN (SELECT id FROM target_user)) AS target_ownership_recommendation_created_by_count,
    (SELECT count(*) FROM "AssetClaim" WHERE "claimantUserId" IN (SELECT id FROM target_user)) AS target_asset_claim_claimant_count,
    (SELECT count(*) FROM "AssetClaim" WHERE "reviewedById" IN (SELECT id FROM target_user)) AS target_asset_claim_reviewed_by_count,
    (SELECT count(*) FROM "AssetOwnershipHistory" WHERE "changedById" IN (SELECT id FROM target_user)) AS target_asset_ownership_history_changed_by_count,
    (SELECT count(*) FROM "Report" WHERE "citizenId" IN (SELECT id FROM target_user)) AS target_report_citizen_count,
    (SELECT count(*) FROM "Report" WHERE "assignedProviderId" IN (SELECT id FROM target_user)) AS target_report_assigned_provider_count,
    (SELECT count(*) FROM "Report" WHERE "organizationAssignedById" IN (SELECT id FROM target_user)) AS target_report_organization_assigned_by_count,
    (SELECT count(*) FROM "Report" WHERE "lastAssignmentProviderId" IN (SELECT id FROM target_user)) AS target_report_last_assignment_provider_count,
    (SELECT count(*) FROM "Report" WHERE "organizationCompletionDecidedById" IN (SELECT id FROM target_user)) AS target_report_organization_completion_decided_by_count,
    (SELECT count(*) FROM "Report" WHERE "completionFinalizedById" IN (SELECT id FROM target_user)) AS target_report_completion_finalized_by_count,
    (SELECT count(*) FROM "Report" WHERE "createdBySuperAdminId" IN (SELECT id FROM target_user)) AS target_report_created_by_super_admin_count,
    (SELECT count(*) FROM "ReportMessage" WHERE "authorId" IN (SELECT id FROM target_user)) AS target_report_message_author_count,
    (SELECT count(*) FROM "ReportActivity" WHERE "actorUserId" IN (SELECT id FROM target_user)) AS target_report_activity_actor_count,
    (SELECT count(*) FROM "ReportActivity" WHERE "providerId" IN (SELECT id FROM target_user)) AS target_report_activity_provider_count,
    (SELECT count(*) FROM "PublicSuccessStory" WHERE "approvedBy" IN (SELECT id FROM target_user)) AS target_public_success_story_approved_by_count,
    (SELECT count(*) FROM "Notification" WHERE "userId" IN (SELECT id FROM target_user)) AS target_notification_user_count,
    (SELECT count(*) FROM "Notification" WHERE "createdBySuperAdminId" IN (SELECT id FROM target_user)) AS target_notification_created_by_super_admin_count,
    (SELECT count(*) FROM "DemoAuditLog" WHERE "actorUserId" IN (SELECT id FROM target_user)) AS target_demo_audit_actor_count,
    (SELECT count(*) FROM "PlatformBackup" WHERE "createdById" IN (SELECT id FROM target_user)) AS target_platform_backup_created_by_count,
    (SELECT count(*) FROM "PlatformBackup" WHERE "restoredById" IN (SELECT id FROM target_user)) AS target_platform_backup_restored_by_count,
    (SELECT count(*) FROM "Organization" WHERE "createdBySuperAdminId" IN (SELECT id FROM target_user)) AS target_organization_created_by_super_admin_count
)
SELECT 'target_account_count=' || target_account_count FROM counts
UNION ALL SELECT 'target_is_citizen=' || CASE WHEN target_citizen_count = 1 THEN 'yes' ELSE 'no' END FROM counts
UNION ALL SELECT 'target_is_active=' || CASE WHEN target_active_count = 1 THEN 'yes' ELSE 'no' END FROM counts
UNION ALL SELECT 'target_is_demo=' || CASE WHEN target_demo_count > 0 THEN 'yes' ELSE 'no' END FROM counts
UNION ALL SELECT 'target_has_email=' || CASE WHEN EXISTS (SELECT 1 FROM target_user WHERE email IS NOT NULL AND email <> '') THEN 'yes' ELSE 'no' END
UNION ALL SELECT 'target_has_phone=' || CASE WHEN EXISTS (SELECT 1 FROM target_user WHERE phone IS NOT NULL AND phone <> '') THEN 'yes' ELSE 'no' END
UNION ALL SELECT 'target_has_firebase_uid=' || CASE WHEN EXISTS (SELECT 1 FROM target_user WHERE "firebaseUid" IS NOT NULL AND "firebaseUid" <> '') THEN 'yes' ELSE 'no' END
UNION ALL SELECT 'target_has_provider_id=' || CASE WHEN EXISTS (SELECT 1 FROM target_user WHERE "providerId" IS NOT NULL AND "providerId" <> '') THEN 'yes' ELSE 'no' END
UNION ALL SELECT 'target_has_password_hash=' || CASE WHEN EXISTS (SELECT 1 FROM target_user WHERE "passwordHash" IS NOT NULL AND "passwordHash" <> '') THEN 'yes' ELSE 'no' END
UNION ALL SELECT 'active_super_admin_count=' || active_super_admin_count FROM counts
UNION ALL SELECT 'active_super_admin_password_hash_present_count=' || active_super_admin_password_hash_present_count FROM counts
UNION ALL SELECT 'active_super_admin_email_present_count=' || active_super_admin_email_present_count FROM counts
UNION ALL SELECT 'active_super_admin_mfa_enrollment_count=' || active_super_admin_mfa_enrollment_count FROM counts
UNION ALL SELECT 'active_super_admin_mfa_backup_code_count=' || active_super_admin_mfa_backup_code_count FROM counts
UNION ALL SELECT 'active_super_admin_mfa_pre_auth_session_count=' || active_super_admin_mfa_pre_auth_session_count FROM counts
UNION ALL SELECT 'active_super_admin_password_reset_token_count=' || active_super_admin_password_reset_token_count FROM counts
UNION ALL SELECT 'target_password_reset_token_count=' || target_password_reset_token_count FROM counts
UNION ALL SELECT 'target_mfa_enrollment_count=' || target_mfa_enrollment_count FROM counts
UNION ALL SELECT 'target_mfa_backup_code_count=' || target_mfa_backup_code_count FROM counts
UNION ALL SELECT 'target_mfa_pre_auth_session_count=' || target_mfa_pre_auth_session_count FROM counts
UNION ALL SELECT 'target_kyc_submission_count=' || target_kyc_submission_count FROM counts
UNION ALL SELECT 'target_kyc_reviewed_by_count=' || target_kyc_reviewed_by_count FROM counts
UNION ALL SELECT 'target_login_history_user_count=' || target_login_history_user_count FROM counts
UNION ALL SELECT 'target_login_history_email_count=' || target_login_history_email_count FROM counts
UNION ALL SELECT 'target_evidence_owner_count=' || target_evidence_owner_count FROM counts
UNION ALL SELECT 'target_evidence_uploaded_by_count=' || target_evidence_uploaded_by_count FROM counts
UNION ALL SELECT 'target_evidence_related_user_count=' || target_evidence_related_user_count FROM counts
UNION ALL SELECT 'target_dispute_opened_by_count=' || target_dispute_opened_by_count FROM counts
UNION ALL SELECT 'target_dispute_against_user_count=' || target_dispute_against_user_count FROM counts
UNION ALL SELECT 'target_dispute_closed_by_count=' || target_dispute_closed_by_count FROM counts
UNION ALL SELECT 'target_dispute_assigned_admin_count=' || target_dispute_assigned_admin_count FROM counts
UNION ALL SELECT 'target_dispute_message_author_count=' || target_dispute_message_author_count FROM counts
UNION ALL SELECT 'target_dispute_timeline_actor_count=' || target_dispute_timeline_actor_count FROM counts
UNION ALL SELECT 'target_dispute_evidence_uploaded_by_count=' || target_dispute_evidence_uploaded_by_count FROM counts
UNION ALL SELECT 'target_dispute_decision_decided_by_count=' || target_dispute_decision_decided_by_count FROM counts
UNION ALL SELECT 'target_user_entitlement_count=' || target_user_entitlement_count FROM counts
UNION ALL SELECT 'target_compliance_audit_actor_count=' || target_compliance_audit_actor_count FROM counts
UNION ALL SELECT 'target_compliance_audit_entity_user_count=' || target_compliance_audit_entity_user_count FROM counts
UNION ALL SELECT 'target_admin_scope_user_count=' || target_admin_scope_user_count FROM counts
UNION ALL SELECT 'target_admin_scope_created_by_count=' || target_admin_scope_created_by_count FROM counts
UNION ALL SELECT 'target_delegated_authority_user_count=' || target_delegated_authority_user_count FROM counts
UNION ALL SELECT 'target_delegated_authority_delegated_by_count=' || target_delegated_authority_delegated_by_count FROM counts
UNION ALL SELECT 'target_internal_role_assignment_user_count=' || target_internal_role_assignment_user_count FROM counts
UNION ALL SELECT 'target_internal_role_assignment_assigned_by_count=' || target_internal_role_assignment_assigned_by_count FROM counts
UNION ALL SELECT 'target_internal_role_assignment_revoked_by_count=' || target_internal_role_assignment_revoked_by_count FROM counts
UNION ALL SELECT 'target_privileged_approval_requester_count=' || target_privileged_approval_requester_count FROM counts
UNION ALL SELECT 'target_privileged_approval_approver_count=' || target_privileged_approval_approver_count FROM counts
UNION ALL SELECT 'target_privileged_approval_target_user_count=' || target_privileged_approval_target_user_count FROM counts
UNION ALL SELECT 'target_regulatory_case_created_by_count=' || target_regulatory_case_created_by_count FROM counts
UNION ALL SELECT 'target_regulatory_export_requested_by_count=' || target_regulatory_export_requested_by_count FROM counts
UNION ALL SELECT 'target_regulatory_export_reviewed_by_count=' || target_regulatory_export_reviewed_by_count FROM counts
UNION ALL SELECT 'target_evidence_package_created_by_count=' || target_evidence_package_created_by_count FROM counts
UNION ALL SELECT 'target_evidence_package_sealed_by_count=' || target_evidence_package_sealed_by_count FROM counts
UNION ALL SELECT 'target_evidence_audit_actor_count=' || target_evidence_audit_actor_count FROM counts
UNION ALL SELECT 'target_evidence_access_actor_count=' || target_evidence_access_actor_count FROM counts
UNION ALL SELECT 'target_invitation_invited_by_count=' || target_invitation_invited_by_count FROM counts
UNION ALL SELECT 'target_invitation_accepted_user_count=' || target_invitation_accepted_user_count FROM counts
UNION ALL SELECT 'target_invitation_email_count=' || target_invitation_email_count FROM counts
UNION ALL SELECT 'target_provider_organization_count=' || target_provider_organization_count FROM counts
UNION ALL SELECT 'target_org_upgrade_requested_by_count=' || target_org_upgrade_requested_by_count FROM counts
UNION ALL SELECT 'target_org_upgrade_reviewed_by_count=' || target_org_upgrade_reviewed_by_count FROM counts
UNION ALL SELECT 'target_payment_requesting_user_count=' || target_payment_requesting_user_count FROM counts
UNION ALL SELECT 'target_jurisdiction_zone_created_by_count=' || target_jurisdiction_zone_created_by_count FROM counts
UNION ALL SELECT 'target_ownership_recommendation_created_by_count=' || target_ownership_recommendation_created_by_count FROM counts
UNION ALL SELECT 'target_asset_claim_claimant_count=' || target_asset_claim_claimant_count FROM counts
UNION ALL SELECT 'target_asset_claim_reviewed_by_count=' || target_asset_claim_reviewed_by_count FROM counts
UNION ALL SELECT 'target_asset_ownership_history_changed_by_count=' || target_asset_ownership_history_changed_by_count FROM counts
UNION ALL SELECT 'target_report_citizen_count=' || target_report_citizen_count FROM counts
UNION ALL SELECT 'target_report_assigned_provider_count=' || target_report_assigned_provider_count FROM counts
UNION ALL SELECT 'target_report_organization_assigned_by_count=' || target_report_organization_assigned_by_count FROM counts
UNION ALL SELECT 'target_report_last_assignment_provider_count=' || target_report_last_assignment_provider_count FROM counts
UNION ALL SELECT 'target_report_organization_completion_decided_by_count=' || target_report_organization_completion_decided_by_count FROM counts
UNION ALL SELECT 'target_report_completion_finalized_by_count=' || target_report_completion_finalized_by_count FROM counts
UNION ALL SELECT 'target_report_created_by_super_admin_count=' || target_report_created_by_super_admin_count FROM counts
UNION ALL SELECT 'target_report_message_author_count=' || target_report_message_author_count FROM counts
UNION ALL SELECT 'target_report_activity_actor_count=' || target_report_activity_actor_count FROM counts
UNION ALL SELECT 'target_report_activity_provider_count=' || target_report_activity_provider_count FROM counts
UNION ALL SELECT 'target_public_success_story_approved_by_count=' || target_public_success_story_approved_by_count FROM counts
UNION ALL SELECT 'target_notification_user_count=' || target_notification_user_count FROM counts
UNION ALL SELECT 'target_notification_created_by_super_admin_count=' || target_notification_created_by_super_admin_count FROM counts
UNION ALL SELECT 'target_demo_audit_actor_count=' || target_demo_audit_actor_count FROM counts
UNION ALL SELECT 'target_platform_backup_created_by_count=' || target_platform_backup_created_by_count FROM counts
UNION ALL SELECT 'target_platform_backup_restored_by_count=' || target_platform_backup_restored_by_count FROM counts
UNION ALL SELECT 'target_organization_created_by_super_admin_count=' || target_organization_created_by_super_admin_count FROM counts
UNION ALL SELECT 'audit_recommendation_input_ready=' || CASE WHEN target_account_count = 1 AND active_super_admin_count = 1 THEN 'yes' ELSE 'no' END FROM counts;
ROLLBACK;
SQL
}

main() {
  local psql_cmd=()
  fz_prepare_psql_command psql_cmd

  local target_email
  target_email="$(fz_read_hidden_email_pair "target collision-audit")"

  fz_info "Read-only target email dependency audit starting."
  build_dependency_audit_sql "$target_email" | fz_sanitized_psql "$target_email" "${psql_cmd[@]}"
  fz_info "Read-only target email dependency audit completed."
}

main "$@"
