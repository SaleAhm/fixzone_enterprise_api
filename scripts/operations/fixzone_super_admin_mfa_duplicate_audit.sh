#!/usr/bin/env bash
set -Eeuo pipefail

IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=fixzone_super_admin_email_common.sh
source "$SCRIPT_DIR/fixzone_super_admin_email_common.sh"

build_mfa_duplicate_audit_sql() {
  cat <<'SQL'
\pset format unaligned
\pset tuples_only on
BEGIN READ ONLY;
WITH
active_super_admin AS (
  SELECT u.id
  FROM "User" AS u
  WHERE u.role = 'SUPER_ADMIN'::"UserRole"
    AND u."accountStatus" = 'ACTIVE'::"AccountStatus"
),
ranked_active_enrollments AS (
  SELECT
    e.id,
    e."enabledAt",
    e."lastVerifiedAt",
    row_number() OVER (
      ORDER BY e."enabledAt" DESC NULLS LAST, e."createdAt" DESC, e.id DESC
    ) AS app_selection_rank
  FROM "PrivilegedMfaEnrollment" AS e
  WHERE e."userId" IN (SELECT id FROM active_super_admin)
    AND e.status = 'ACTIVE'::"PrivilegedMfaEnrollmentStatus"
    AND e."disabledAt" IS NULL
),
selected_active_enrollment AS (
  SELECT r.id
  FROM ranked_active_enrollments AS r
  WHERE r.app_selection_rank = 1
),
counts AS (
  SELECT
    (SELECT count(*) FROM active_super_admin)::int AS active_super_admin_count,
    (SELECT count(*) FROM "PrivilegedMfaEnrollment" AS e WHERE e."userId" IN (SELECT id FROM active_super_admin))::int AS total_enrollment_count,
    (SELECT count(*) FROM "PrivilegedMfaEnrollment" AS e WHERE e."userId" IN (SELECT id FROM active_super_admin) AND e.status = 'ACTIVE'::"PrivilegedMfaEnrollmentStatus" AND e."disabledAt" IS NULL)::int AS active_enabled_enrollment_count,
    (SELECT count(*) FROM "PrivilegedMfaEnrollment" AS e WHERE e."userId" IN (SELECT id FROM active_super_admin) AND e.status = 'PENDING'::"PrivilegedMfaEnrollmentStatus" AND e."disabledAt" IS NULL)::int AS pending_enabled_enrollment_count,
    (SELECT count(*) FROM "PrivilegedMfaEnrollment" AS e WHERE e."userId" IN (SELECT id FROM active_super_admin) AND (e.status = 'DISABLED'::"PrivilegedMfaEnrollmentStatus" OR e."disabledAt" IS NOT NULL))::int AS disabled_or_revoked_enrollment_count,
    (SELECT count(*) FROM "PrivilegedMfaEnrollment" AS e WHERE e."userId" IN (SELECT id FROM active_super_admin) AND e.status = 'ACTIVE'::"PrivilegedMfaEnrollmentStatus" AND e."disabledAt" IS NULL AND e."enabledAt" IS NOT NULL AND e."encryptedTotpSecret" IS NOT NULL AND e."encryptedTotpSecret" <> '')::int AS auth_capable_enrollment_count,
    (SELECT count(*) FROM ranked_active_enrollments AS r WHERE r.app_selection_rank = 1)::int AS application_selected_enrollment_count,
    (SELECT count(*) FROM ranked_active_enrollments AS r WHERE r.app_selection_rank > 1)::int AS non_selected_active_enrollment_count,
    (SELECT count(*) FROM ranked_active_enrollments AS r WHERE r.app_selection_rank = 1 AND r."lastVerifiedAt" IS NOT NULL)::int AS selected_enrollment_has_successful_verification_count,
    (SELECT count(*) FROM ranked_active_enrollments AS r WHERE r.app_selection_rank > 1 AND r."lastVerifiedAt" IS NOT NULL)::int AS non_selected_active_verified_enrollment_count,
    (SELECT count(*) FROM "PrivilegedMfaBackupCode" AS b WHERE b."userId" IN (SELECT id FROM active_super_admin))::int AS backup_code_total_count,
    (SELECT count(*) FROM "PrivilegedMfaBackupCode" AS b WHERE b."userId" IN (SELECT id FROM active_super_admin) AND b."usedAt" IS NULL)::int AS backup_code_unused_count,
    (SELECT count(*) FROM "PrivilegedMfaBackupCode" AS b WHERE b."userId" IN (SELECT id FROM active_super_admin) AND b."usedAt" IS NOT NULL)::int AS backup_code_used_count,
    (SELECT count(*) FROM "PrivilegedMfaBackupCode" AS b WHERE b."enrollmentId" IN (SELECT id FROM selected_active_enrollment))::int AS selected_enrollment_backup_code_count,
    (SELECT count(*) FROM "PrivilegedMfaBackupCode" AS b WHERE b."enrollmentId" IN (SELECT id FROM selected_active_enrollment) AND b."usedAt" IS NULL)::int AS selected_enrollment_unused_backup_code_count,
    (SELECT count(*) FROM "PrivilegedMfaBackupCode" AS b WHERE b."userId" IN (SELECT id FROM active_super_admin) AND b."enrollmentId" NOT IN (SELECT id FROM selected_active_enrollment))::int AS non_selected_enrollment_backup_code_count,
    (SELECT count(*) FROM "PrivilegedMfaPreAuthSession" AS s WHERE s."userId" IN (SELECT id FROM active_super_admin) AND s."consumedAt" IS NULL AND s."lockedAt" IS NULL AND s."expiresAt" > now())::int AS open_super_admin_mfa_pre_auth_session_count
)
SELECT 'active_super_admin_count=' || active_super_admin_count FROM counts
UNION ALL SELECT 'total_enrollment_count=' || total_enrollment_count FROM counts
UNION ALL SELECT 'active_enabled_enrollment_count=' || active_enabled_enrollment_count FROM counts
UNION ALL SELECT 'pending_enabled_enrollment_count=' || pending_enabled_enrollment_count FROM counts
UNION ALL SELECT 'disabled_or_revoked_enrollment_count=' || disabled_or_revoked_enrollment_count FROM counts
UNION ALL SELECT 'auth_capable_enrollment_count=' || auth_capable_enrollment_count FROM counts
UNION ALL SELECT 'application_selected_enrollment_count=' || application_selected_enrollment_count FROM counts
UNION ALL SELECT 'non_selected_active_enrollment_count=' || non_selected_active_enrollment_count FROM counts
UNION ALL SELECT 'selected_enrollment_has_successful_verification=' || CASE WHEN selected_enrollment_has_successful_verification_count = 1 THEN 'yes' ELSE 'no' END FROM counts
UNION ALL SELECT 'non_selected_active_verified_enrollment_count=' || non_selected_active_verified_enrollment_count FROM counts
UNION ALL SELECT 'backup_code_total_count=' || backup_code_total_count FROM counts
UNION ALL SELECT 'backup_code_unused_count=' || backup_code_unused_count FROM counts
UNION ALL SELECT 'backup_code_used_count=' || backup_code_used_count FROM counts
UNION ALL SELECT 'selected_enrollment_backup_code_count=' || selected_enrollment_backup_code_count FROM counts
UNION ALL SELECT 'selected_enrollment_unused_backup_code_count=' || selected_enrollment_unused_backup_code_count FROM counts
UNION ALL SELECT 'non_selected_enrollment_backup_code_count=' || non_selected_enrollment_backup_code_count FROM counts
UNION ALL SELECT 'open_super_admin_mfa_pre_auth_session_count=' || open_super_admin_mfa_pre_auth_session_count FROM counts
UNION ALL SELECT 'mfa_application_invariant_satisfied=' || CASE
  WHEN active_super_admin_count = 1
   AND active_enabled_enrollment_count = 1
   AND application_selected_enrollment_count = 1
   AND backup_code_total_count = 10
   AND selected_enrollment_backup_code_count = 10
   AND non_selected_enrollment_backup_code_count = 0
  THEN 'yes'
  ELSE 'no'
END FROM counts
UNION ALL SELECT 'recommendation_category=' || CASE
  WHEN active_super_admin_count <> 1 THEN 'STOP_ACTIVE_SUPER_ADMIN_CARDINALITY'
  WHEN active_enabled_enrollment_count = 0 THEN 'STOP_NO_ACTIVE_MFA_ENROLLMENT'
  WHEN active_enabled_enrollment_count = 1
   AND backup_code_total_count = 10
   AND selected_enrollment_backup_code_count = 10
   AND non_selected_enrollment_backup_code_count = 0 THEN 'NO_DUPLICATE_CLEANUP_NEEDED'
  WHEN active_enabled_enrollment_count > 1 THEN 'DUPLICATE_ACTIVE_ENROLLMENT_REQUIRES_SECRET_SAFE_IDENTIFICATION'
  ELSE 'MFA_STATE_REQUIRES_MANUAL_REVIEW'
END FROM counts;
DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM "User" AS u
    WHERE u.role = 'SUPER_ADMIN'::"UserRole"
      AND u."accountStatus" = 'ACTIVE'::"AccountStatus"
  ) <> 1 THEN
    RAISE EXCEPTION 'active SUPER_ADMIN cardinality gate failed';
  END IF;
END
$$;
ROLLBACK;
SQL
}

main() {
  local psql_cmd=()
  fz_prepare_psql_command psql_cmd

  fz_info "Read-only SUPER_ADMIN MFA duplicate audit starting."
  build_mfa_duplicate_audit_sql | fz_sanitized_psql_multi -- "${psql_cmd[@]}"
  fz_info "Read-only SUPER_ADMIN MFA duplicate audit completed."
}

main "$@"
