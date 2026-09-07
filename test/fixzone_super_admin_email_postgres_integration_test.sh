#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATION_SCRIPT="$REPO_ROOT/scripts/operations/fixzone_super_admin_email_migration.sh"
ROLLBACK_SCRIPT="$REPO_ROOT/scripts/operations/fixzone_super_admin_email_rollback.sh"
PSQL_BIN="${FIXZONE_TEST_PSQL_BIN:-/c/Program Files/PostgreSQL/17/bin/psql.exe}"
INITDB_BIN="${FIXZONE_TEST_INITDB_BIN:-/c/Progra~1/PostgreSQL/17/bin/initdb.exe}"
PG_CTL_BIN="${FIXZONE_TEST_PG_CTL_BIN:-/c/Progra~1/PostgreSQL/17/bin/pg_ctl.exe}"
TEMP_PG_ROOT=""
TEMP_PG_STARTED=false

if [ ! -x "$PSQL_BIN" ]; then
  if command -v psql >/dev/null 2>&1; then
    PSQL_BIN="$(command -v psql)"
  else
    printf 'SKIP: local psql is not available for PostgreSQL integration test.\n'
    exit 0
  fi
fi

if [ -z "${DATABASE_URL:-}" ] && [ -f "$REPO_ROOT/.env" ]; then
  DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' "$REPO_ROOT/.env" | head -n1)"
  DATABASE_URL="${DATABASE_URL%\"}"
  DATABASE_URL="${DATABASE_URL#\"}"
  DATABASE_URL="${DATABASE_URL%\'}"
  DATABASE_URL="${DATABASE_URL#\'}"
  export DATABASE_URL
fi

if [ -z "${DATABASE_URL:-}" ]; then
  printf 'SKIP: DATABASE_URL is not available for PostgreSQL integration test.\n'
  exit 0
fi

if ! "$PSQL_BIN" -w -X "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c 'SELECT 1' >/dev/null 2>&1; then
  if [ ! -x "$INITDB_BIN" ] || [ ! -x "$PG_CTL_BIN" ]; then
    printf 'SKIP: local PostgreSQL connection failed and temporary cluster tools are unavailable.\n'
    exit 0
  fi
  TEMP_PG_ROOT="$(mktemp -d)"
  "$INITDB_BIN" -D "$TEMP_PG_ROOT/pgdata" -A trust >/dev/null 2>&1 || {
    printf 'SKIP: temporary PostgreSQL cluster initialization failed.\n'
    rm -rf "$TEMP_PG_ROOT"
    exit 0
  }
  {
    printf '\n'
    printf 'port = 55432\n'
    printf "listen_addresses = 'localhost'\n"
  } >>"$TEMP_PG_ROOT/pgdata/postgresql.conf"
  "$PG_CTL_BIN" start -D "$TEMP_PG_ROOT/pgdata" -l "$TEMP_PG_ROOT/server.log" -w >/dev/null 2>&1 || {
    printf 'SKIP: temporary PostgreSQL cluster start failed.\n'
    rm -rf "$TEMP_PG_ROOT"
    exit 0
  }
  TEMP_PG_STARTED=true
  DATABASE_URL="postgresql://${USERNAME:-USER}@localhost:55432/postgres"
  export DATABASE_URL
fi

# shellcheck source=../scripts/operations/fixzone_super_admin_email_migration.sh
source "$MIGRATION_SCRIPT"
# shellcheck source=../scripts/operations/fixzone_super_admin_email_rollback.sh
source "$ROLLBACK_SCRIPT"

SCHEMA_NAME="fz_email_migration_it_$$"
TARGET_EMAIL="corp-target-$$@example.test"
FORMER_EMAIL="fake-super-$$@example.test"
OCCUPIED_EMAIL="occupied-$$@example.test"

psql_exec() {
  "$PSQL_BIN" -w -X "$DATABASE_URL" -v ON_ERROR_STOP=1 -q "$@"
}

run_sql_in_schema() {
  local sql="$1"
  printf 'SET search_path TO %s;\n%s\n' "$SCHEMA_NAME" "$sql" |
    psql_exec >/dev/null
}

fetch_value() {
  local query="$1"
  psql_exec -At -c "SET search_path TO $SCHEMA_NAME; $query"
}

reset_fixture() {
  local with_occupied="${1:-false}"
  local with_mfa="${2:-false}"
  psql_exec >/dev/null <<SQL
DROP SCHEMA IF EXISTS "$SCHEMA_NAME" CASCADE;
CREATE SCHEMA "$SCHEMA_NAME";
SET search_path TO "$SCHEMA_NAME";
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'CITIZEN');
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');
CREATE TABLE "User" (
  id text PRIMARY KEY,
  email text UNIQUE,
  "passwordHash" text,
  role "UserRole" NOT NULL,
  "accountStatus" "AccountStatus" NOT NULL,
  "firebaseUid" text UNIQUE,
  "emailVerifiedAt" timestamp,
  "tokenVersion" integer NOT NULL DEFAULT 0,
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE "PasswordResetToken" (
  id text PRIMARY KEY,
  "userId" text NOT NULL,
  "usedAt" timestamp,
  "supersededAt" timestamp,
  "deliveryStatus" text NOT NULL
);
CREATE TABLE "PrivilegedMfaEnrollment" (
  id text PRIMARY KEY,
  "userId" text NOT NULL
);
CREATE TABLE "PrivilegedMfaBackupCode" (
  id text PRIMARY KEY,
  "userId" text NOT NULL
);
CREATE TABLE "PrivilegedMfaPreAuthSession" (
  id text PRIMARY KEY,
  "userId" text NOT NULL,
  "consumedAt" timestamp,
  "lockedAt" timestamp,
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE TABLE "ComplianceAuditLog" (
  id text NOT NULL PRIMARY KEY,
  "actorId" text,
  "actorRole" "UserRole",
  "organizationId" text,
  action text NOT NULL,
  "entityType" text,
  "entityId" text,
  metadata jsonb,
  "createdAt" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "User" (id, email, "passwordHash", role, "accountStatus", "firebaseUid", "emailVerifiedAt", "tokenVersion")
VALUES
  ('super-1', '$FORMER_EMAIL', 'hash-super', 'SUPER_ADMIN', 'ACTIVE', NULL, now(), 5),
  ('citizen-1', 'citizen-$$@example.test', 'hash-citizen', 'CITIZEN', 'ACTIVE', 'firebase-citizen-1', now(), 3);
INSERT INTO "PasswordResetToken" (id, "userId", "usedAt", "supersededAt", "deliveryStatus")
VALUES ('reset-1', 'super-1', NULL, NULL, 'SENT');
INSERT INTO "PrivilegedMfaPreAuthSession" (id, "userId", "consumedAt", "lockedAt")
VALUES ('preauth-1', 'super-1', NULL, NULL);
SQL
  if [ "$with_occupied" = "true" ]; then
    psql_exec >/dev/null <<SQL
SET search_path TO "$SCHEMA_NAME";
INSERT INTO "User" (id, email, "passwordHash", role, "accountStatus", "firebaseUid", "emailVerifiedAt", "tokenVersion")
VALUES ('other-1', '$OCCUPIED_EMAIL', 'hash-other', 'CITIZEN', 'ACTIVE', 'firebase-other-1', now(), 1);
SQL
  fi
  if [ "$with_mfa" = "true" ]; then
    psql_exec >/dev/null <<SQL
SET search_path TO "$SCHEMA_NAME";
INSERT INTO "PrivilegedMfaEnrollment" (id, "userId")
VALUES ('mfa-1', 'super-1');
SQL
  fi
}

assert_eq() {
  local actual="$1"
  local expected="$2"
  local message="$3"
  if [ "$actual" != "$expected" ]; then
    printf 'FAIL: %s (got %s expected %s)\n' "$message" "$actual" "$expected" >&2
    exit 1
  fi
}

cleanup() {
  psql_exec -c "DROP SCHEMA IF EXISTS \"$SCHEMA_NAME\" CASCADE;" >/dev/null 2>&1 || true
  if [ "$TEMP_PG_STARTED" = "true" ]; then
    "$PG_CTL_BIN" stop -D "$TEMP_PG_ROOT/pgdata" -m fast -w >/dev/null 2>&1 || true
    rm -rf "$TEMP_PG_ROOT"
  fi
}
trap cleanup EXIT

reset_fixture false false
run_sql_in_schema "$(build_write_sql "$TARGET_EMAIL")"
assert_eq "$(fetch_value "SELECT count(*) FROM \"User\" WHERE id = 'super-1' AND lower(email) = lower('$TARGET_EMAIL') AND \"passwordHash\" = 'hash-super' AND role = 'SUPER_ADMIN'::\"UserRole\" AND \"accountStatus\" = 'ACTIVE'::\"AccountStatus\" AND \"emailVerifiedAt\" IS NULL AND \"tokenVersion\" = 6;")" "1" "SUPER_ADMIN migration invariant"
assert_eq "$(fetch_value "SELECT count(*) FROM \"User\" WHERE id = 'citizen-1' AND email = 'citizen-$$@example.test' AND \"firebaseUid\" = 'firebase-citizen-1' AND \"passwordHash\" = 'hash-citizen' AND \"tokenVersion\" = 3;")" "1" "citizen/Firebase row unchanged"
assert_eq "$(fetch_value "SELECT count(*) FROM \"PasswordResetToken\" WHERE id = 'reset-1' AND \"supersededAt\" IS NOT NULL;")" "1" "active reset token superseded"
assert_eq "$(fetch_value "SELECT count(*) FROM \"PrivilegedMfaPreAuthSession\" WHERE id = 'preauth-1' AND \"consumedAt\" IS NOT NULL AND \"lockedAt\" IS NOT NULL;")" "1" "pre-auth session cleared"
assert_eq "$(fetch_value "SELECT count(*) FROM \"ComplianceAuditLog\" WHERE action = 'SUPER_ADMIN_CORPORATE_EMAIL_MIGRATION' AND metadata->>'redacted' = 'true';")" "1" "audit event created"
assert_eq "$(fetch_value "SELECT count(*) FROM \"ComplianceAuditLog\" WHERE action = 'SUPER_ADMIN_CORPORATE_EMAIL_MIGRATION' AND id ~ '^c[0-9a-f]{24}$' AND \"createdAt\" IS NOT NULL AND \"entityId\" IS NULL;")" "1" "migration audit id/default semantics"

run_sql_in_schema "$(build_rollback_write_sql "$TARGET_EMAIL" "$FORMER_EMAIL")"
assert_eq "$(fetch_value "SELECT count(*) FROM \"User\" WHERE id = 'super-1' AND lower(email) = lower('$FORMER_EMAIL') AND \"passwordHash\" = 'hash-super' AND role = 'SUPER_ADMIN'::\"UserRole\" AND \"accountStatus\" = 'ACTIVE'::\"AccountStatus\" AND \"emailVerifiedAt\" IS NULL AND \"tokenVersion\" = 7;")" "1" "rollback restored former email and advanced tokenVersion"
assert_eq "$(fetch_value "SELECT count(*) FROM \"ComplianceAuditLog\" WHERE action = 'SUPER_ADMIN_CORPORATE_EMAIL_MIGRATION_ROLLBACK' AND metadata->>'redacted' = 'true';")" "1" "rollback audit event created"
assert_eq "$(fetch_value "SELECT count(*) FROM \"ComplianceAuditLog\" WHERE action = 'SUPER_ADMIN_CORPORATE_EMAIL_MIGRATION_ROLLBACK' AND id ~ '^c[0-9a-f]{24}$' AND \"createdAt\" IS NOT NULL AND \"entityId\" IS NULL;")" "1" "rollback audit id/default semantics"

reset_fixture true false
set +e
run_sql_in_schema "$(build_write_sql "$OCCUPIED_EMAIL")" >/dev/null 2>&1
status=$?
set -e
[ "$status" -ne 0 ] || {
  printf 'FAIL: occupied target migration unexpectedly succeeded\n' >&2
  exit 1
}
assert_eq "$(fetch_value "SELECT count(*) FROM \"User\" WHERE id = 'super-1' AND email = '$FORMER_EMAIL' AND \"tokenVersion\" = 5;")" "1" "occupied target rolled back SUPER_ADMIN"
assert_eq "$(fetch_value "SELECT count(*) FROM \"ComplianceAuditLog\";")" "0" "occupied target created no audit event"

reset_fixture false true
set +e
run_sql_in_schema "$(build_write_sql "$TARGET_EMAIL")" >/dev/null 2>&1
status=$?
set -e
[ "$status" -ne 0 ] || {
  printf 'FAIL: unexpected MFA migration unexpectedly succeeded\n' >&2
  exit 1
}
assert_eq "$(fetch_value "SELECT count(*) FROM \"User\" WHERE id = 'super-1' AND email = '$FORMER_EMAIL' AND \"tokenVersion\" = 5;")" "1" "MFA failure rolled back SUPER_ADMIN"
assert_eq "$(fetch_value "SELECT count(*) FROM \"ComplianceAuditLog\";")" "0" "MFA failure created no audit event"

printf 'PASS: real PostgreSQL Phase-B migration/rollback integration test passed.\n'
