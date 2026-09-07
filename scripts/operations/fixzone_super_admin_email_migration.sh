#!/usr/bin/env bash
set -Eeuo pipefail

IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=fixzone_super_admin_email_common.sh
source "$SCRIPT_DIR/fixzone_super_admin_email_common.sh"

build_preflight_sql() {
  local target_email="$1"
  fz_copy_target_email_sql "$target_email"
  cat <<'SQL'
\pset format unaligned
\pset tuples_only on
BEGIN READ ONLY;
WITH
active_super_admin AS (
  SELECT id, email, "passwordHash"
  FROM "User"
  WHERE role = 'SUPER_ADMIN'::"UserRole"
    AND "accountStatus" = 'ACTIVE'::"AccountStatus"
),
counts AS (
  SELECT
    (SELECT count(*) FROM active_super_admin)::int AS active_super_admin_count,
    (SELECT count(*) FROM active_super_admin WHERE "passwordHash" IS NOT NULL AND "passwordHash" <> '')::int AS active_super_admin_password_hash_present_count,
    (SELECT count(*) FROM "User" WHERE lower(email) = (SELECT target_email FROM __fz_input))::int AS target_email_user_count,
    (SELECT count(*) FROM "PrivilegedMfaEnrollment" WHERE "userId" IN (SELECT id FROM active_super_admin))::int AS active_super_admin_mfa_enrollment_count,
    (SELECT count(*) FROM "PrivilegedMfaBackupCode" WHERE "userId" IN (SELECT id FROM active_super_admin))::int AS active_super_admin_mfa_backup_code_count,
    (SELECT count(*) FROM "PrivilegedMfaPreAuthSession" WHERE "userId" IN (SELECT id FROM active_super_admin) AND "consumedAt" IS NULL)::int AS active_super_admin_mfa_pre_auth_session_open_count,
    (SELECT count(*) FROM "PasswordResetToken" WHERE "userId" IN (SELECT id FROM active_super_admin) AND "usedAt" IS NULL AND "supersededAt" IS NULL)::int AS active_super_admin_active_password_reset_token_count
)
SELECT 'ACTIVE_SUPER_ADMIN_COUNT=' || active_super_admin_count FROM counts
UNION ALL SELECT 'ACTIVE_SUPER_ADMIN_PASSWORD_PRESENT=' || CASE WHEN active_super_admin_password_hash_present_count = 1 THEN 'yes' ELSE 'no' END FROM counts
UNION ALL SELECT 'TARGET_EMAIL_USER_COUNT=' || target_email_user_count FROM counts
UNION ALL SELECT 'ACTIVE_SUPER_ADMIN_MFA_ENROLLMENT_COUNT=' || active_super_admin_mfa_enrollment_count FROM counts
UNION ALL SELECT 'ACTIVE_SUPER_ADMIN_MFA_BACKUP_CODE_COUNT=' || active_super_admin_mfa_backup_code_count FROM counts
UNION ALL SELECT 'ACTIVE_SUPER_ADMIN_MFA_PRE_AUTH_SESSION_OPEN_COUNT=' || active_super_admin_mfa_pre_auth_session_open_count FROM counts
UNION ALL SELECT 'ACTIVE_SUPER_ADMIN_ACTIVE_PASSWORD_RESET_TOKEN_COUNT=' || active_super_admin_active_password_reset_token_count FROM counts
UNION ALL SELECT 'PREFLIGHT_TARGET_GATE=' || CASE
  WHEN active_super_admin_count = 1
   AND active_super_admin_password_hash_present_count = 1
   AND target_email_user_count = 0
   AND active_super_admin_mfa_enrollment_count = 0
   AND active_super_admin_mfa_backup_code_count = 0
   AND active_super_admin_mfa_pre_auth_session_open_count = 0
   AND active_super_admin_active_password_reset_token_count = 0
  THEN 'PASS'
  ELSE 'FAIL'
END FROM counts;
DO $$
DECLARE
  c record;
BEGIN
  WITH
  active_super_admin AS (
    SELECT id, email, "passwordHash"
    FROM "User"
    WHERE role = 'SUPER_ADMIN'::"UserRole"
      AND "accountStatus" = 'ACTIVE'::"AccountStatus"
  ),
  counts AS (
    SELECT
      (SELECT count(*) FROM active_super_admin)::int AS active_super_admin_count,
      (SELECT count(*) FROM active_super_admin WHERE "passwordHash" IS NOT NULL AND "passwordHash" <> '')::int AS active_super_admin_password_hash_present_count,
      (SELECT count(*) FROM "User" WHERE lower(email) = (SELECT target_email FROM __fz_input))::int AS target_email_user_count,
      (SELECT count(*) FROM "PrivilegedMfaEnrollment" WHERE "userId" IN (SELECT id FROM active_super_admin))::int AS active_super_admin_mfa_enrollment_count,
      (SELECT count(*) FROM "PrivilegedMfaBackupCode" WHERE "userId" IN (SELECT id FROM active_super_admin))::int AS active_super_admin_mfa_backup_code_count,
      (SELECT count(*) FROM "PrivilegedMfaPreAuthSession" WHERE "userId" IN (SELECT id FROM active_super_admin) AND "consumedAt" IS NULL)::int AS active_super_admin_mfa_pre_auth_session_open_count,
      (SELECT count(*) FROM "PasswordResetToken" WHERE "userId" IN (SELECT id FROM active_super_admin) AND "usedAt" IS NULL AND "supersededAt" IS NULL)::int AS active_super_admin_active_password_reset_token_count
  )
  SELECT * INTO c FROM counts;
  IF c.active_super_admin_count <> 1 THEN
    RAISE EXCEPTION 'active SUPER_ADMIN cardinality gate failed';
  END IF;
  IF c.active_super_admin_password_hash_present_count <> 1 THEN
    RAISE EXCEPTION 'active SUPER_ADMIN passwordHash gate failed';
  END IF;
  IF c.target_email_user_count <> 0 THEN
    RAISE EXCEPTION 'target email is already owned by another user';
  END IF;
  IF c.active_super_admin_mfa_enrollment_count <> 0 OR c.active_super_admin_mfa_backup_code_count <> 0 THEN
    RAISE EXCEPTION 'active SUPER_ADMIN privileged MFA shape changed';
  END IF;
  IF c.active_super_admin_mfa_pre_auth_session_open_count <> 0 THEN
    RAISE EXCEPTION 'active SUPER_ADMIN pre-auth session gate failed';
  END IF;
  IF c.active_super_admin_active_password_reset_token_count <> 0 THEN
    RAISE EXCEPTION 'active SUPER_ADMIN password reset token gate failed';
  END IF;
END
$$;
ROLLBACK;
SQL
}

build_write_sql() {
  local target_email="$1"
  fz_copy_target_email_sql "$target_email"
  cat <<'SQL'
\pset format unaligned
\pset tuples_only on
BEGIN;
DO $$
DECLARE
  v_super_id text;
  v_super_hash text;
  v_target_email text;
  v_audit_id text;
BEGIN
  SELECT i.target_email INTO v_target_email
  FROM __fz_input AS i;

  PERFORM 1
  FROM "User" AS u
  WHERE u.role = 'SUPER_ADMIN'::"UserRole"
    AND u."accountStatus" = 'ACTIVE'::"AccountStatus"
  FOR UPDATE;
  PERFORM 1
  FROM "User" AS u
  WHERE lower(u.email) = v_target_email
  FOR UPDATE;

  SELECT u.id, u."passwordHash" INTO v_super_id, v_super_hash
  FROM "User" AS u
  WHERE u.role = 'SUPER_ADMIN'::"UserRole"
    AND u."accountStatus" = 'ACTIVE'::"AccountStatus";

  IF v_super_id IS NULL OR v_super_hash IS NULL OR v_super_hash = '' THEN
    RAISE EXCEPTION 'active SUPER_ADMIN invariant failed';
  END IF;
  IF (SELECT count(*) FROM "User" AS u WHERE u.role = 'SUPER_ADMIN'::"UserRole" AND u."accountStatus" = 'ACTIVE'::"AccountStatus") <> 1 THEN
    RAISE EXCEPTION 'active SUPER_ADMIN cardinality gate failed';
  END IF;
  IF (SELECT count(*) FROM "User" AS u WHERE lower(u.email) = v_target_email) <> 0 THEN
    RAISE EXCEPTION 'target email is already owned by another user';
  END IF;
  IF (SELECT count(*) FROM "PrivilegedMfaEnrollment" AS e WHERE e."userId" = v_super_id) <> 0 THEN
    RAISE EXCEPTION 'active SUPER_ADMIN privileged MFA enrollment shape changed';
  END IF;
  IF (SELECT count(*) FROM "PrivilegedMfaBackupCode" AS b WHERE b."userId" = v_super_id) <> 0 THEN
    RAISE EXCEPTION 'active SUPER_ADMIN privileged MFA backup-code shape changed';
  END IF;

  UPDATE "PasswordResetToken"
  SET "supersededAt" = COALESCE("supersededAt", now()),
      "deliveryStatus" = 'SUPERSEDED_SUPER_ADMIN_EMAIL_MIGRATION'
  WHERE "userId" = v_super_id
    AND "usedAt" IS NULL
    AND "supersededAt" IS NULL;

  UPDATE "PrivilegedMfaPreAuthSession"
  SET "consumedAt" = COALESCE("consumedAt", now()),
      "lockedAt" = COALESCE("lockedAt", now()),
      "updatedAt" = now()
  WHERE "userId" = v_super_id
    AND "consumedAt" IS NULL;

  UPDATE "User" AS u
  SET email = v_target_email,
      "emailVerifiedAt" = NULL,
      "tokenVersion" = "tokenVersion" + 1
  WHERE u.id = v_super_id
    AND u.role = 'SUPER_ADMIN'::"UserRole"
    AND u."accountStatus" = 'ACTIVE'::"AccountStatus"
    AND u."passwordHash" = v_super_hash;

  LOOP
    v_audit_id := 'c' || substr(md5(clock_timestamp()::text || random()::text || v_super_id), 1, 24);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM "ComplianceAuditLog" AS a WHERE a.id = v_audit_id);
  END LOOP;

  INSERT INTO "ComplianceAuditLog" (id, "actorId", "actorRole", action, "entityType", "entityId", metadata)
  VALUES (
    v_audit_id,
    v_super_id,
    'SUPER_ADMIN'::"UserRole",
    'SUPER_ADMIN_CORPORATE_EMAIL_MIGRATION',
    'User',
    NULL,
    jsonb_build_object(
      'redacted', true,
      'superAdminIdPreserved', true,
      'superAdminPasswordHashPreserved', true,
      'superAdminRolePreserved', true,
      'superAdminAccountStatusPreserved', true,
      'emailVerifiedAtLeftNull', true,
      'citizenFirebaseUntouched', true
    )
  );

  IF (SELECT count(*) FROM "User" AS u WHERE u.id = v_super_id AND lower(u.email) = v_target_email AND u."emailVerifiedAt" IS NULL AND u."passwordHash" = v_super_hash AND u.role = 'SUPER_ADMIN'::"UserRole" AND u."accountStatus" = 'ACTIVE'::"AccountStatus") <> 1 THEN
    RAISE EXCEPTION 'post-update SUPER_ADMIN invariant failed';
  END IF;
  IF (SELECT count(*) FROM "User" AS u WHERE lower(u.email) = v_target_email AND u.id <> v_super_id) <> 0 THEN
    RAISE EXCEPTION 'post-update target email collision failed';
  END IF;
END
$$;
SELECT 'WRITE_APPLIED=PASS';
COMMIT;
SQL
}

main() {
  local psql_cmd=()
  fz_prepare_psql_command psql_cmd

  local target_email
  target_email="$(fz_read_hidden_email_pair "target corporate SUPER_ADMIN")"

  fz_info "Phase A read-only preflight starting."
  fz_run_external_preflight_gates || fz_fail "External preflight gate failed."
  build_preflight_sql "$target_email" | fz_sanitized_psql "$target_email" "${psql_cmd[@]}"
  fz_info "Phase A read-only preflight completed."

  local confirmation
  printf 'Type MIGRATE to apply Phase B transactional write: ' >&2
  IFS= read -r confirmation || fz_fail "Input ended before MIGRATE confirmation."
  if [[ "$confirmation" != "MIGRATE" ]]; then
    fz_fail "MIGRATE confirmation was not provided. No write executed."
  fi

  fz_info "Phase B transactional write starting."
  build_write_sql "$target_email" | fz_sanitized_psql "$target_email" "${psql_cmd[@]}"
  fz_info "Phase B transactional write completed."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
