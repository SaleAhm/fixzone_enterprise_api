#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATION_SCRIPT="$REPO_ROOT/scripts/operations/fixzone_super_admin_email_migration.sh"
ROLLBACK_SCRIPT="$REPO_ROOT/scripts/operations/fixzone_super_admin_email_rollback.sh"
COMMON_SCRIPT="$REPO_ROOT/scripts/operations/fixzone_super_admin_email_common.sh"
TMP_ROOT="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

FAKE_BIN="$TMP_ROOT/bin"
mkdir -p "$FAKE_BIN"

cat >"$FAKE_BIN/curl" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$FAKE_BIN/curl"

cat >"$FAKE_BIN/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

cmd="${1:-}"
shift || true
for secret in "${FIXZONE_TEST_TARGET_EMAIL:-}" "${FIXZONE_TEST_FORMER_EMAIL:-}"; do
  if [ -n "$secret" ] && printf '%s\n' "$cmd" "$*" | grep -Fqi "$secret"; then
    printf 'hidden email leaked through docker arguments\n' >&2
    exit 91
  fi
done

case "$cmd" in
  ps)
    case "${FIXZONE_TEST_CONTAINER_COUNT:-1}" in
      0) exit 0 ;;
      1) printf 'pg-container-1\n' ;;
      2) printf 'pg-container-1\npg-container-2\n' ;;
      *) exit 2 ;;
    esac
    ;;
  exec)
    interactive=false
    if [ "${1:-}" = "-i" ]; then
      interactive=true
      shift
    fi
    container="${1:-}"
    shift || true
    [ "$container" = "pg-container-1" ] || exit 94
    case "${1:-}" in
      sh)
        if [ "${3:-}" = "command -v psql >/dev/null 2>&1" ]; then
          [ "${FIXZONE_TEST_CONTAINER_PSQL:-true}" = "true" ]
          exit $?
        fi
        [ "${3:-}" = "printenv POSTGRES_USER" ] && printf 'fixture_user\n' && exit 0
        [ "${3:-}" = "printenv POSTGRES_DB" ] && printf 'fixture_db\n' && exit 0
        exit 95
        ;;
      psql)
        [ "$interactive" = "true" ] || exit 96
        [ "${2:-}" = "-U" ] && [ "${3:-}" = "fixture_user" ] && [ "${4:-}" = "-d" ] && [ "${5:-}" = "fixture_db" ] || exit 97
        printf 'container psql used\n' >>"${FIXZONE_TEST_DOCKER_EXEC_MARKER:?}"
        sql="$(cat)"

        printf '%s' "$sql" | grep -q '\\if' && {
          printf 'psql if control flow is forbidden\n' >&2
          exit 40
        }
        printf '%s' "$sql" | grep -q 'CREATE TEMP TABLE' || {
          printf 'missing temp input\n' >&2
          exit 41
        }
        printf '%s' "$sql" | grep -q '\\copy' || {
          printf 'missing same-session copy\n' >&2
          exit 42
        }
        printf '%s' "$sql" | grep -q 'firebaseUid\|role = '\''CITIZEN'\''::"UserRole"\|role = '\''CITIZEN'\''' && {
          printf 'citizen/Firebase rows must not be touched\n' >&2
          exit 43
        }

        count_file="${FIXZONE_TEST_PSQL_COUNT_FILE:?}"
        count=0
        [ -f "$count_file" ] && count="$(cat "$count_file")"
        count=$((count + 1))
        printf '%s' "$count" >"$count_file"

        if [ "$count" -eq 1 ]; then
          printf '%s' "$sql" | grep -q 'BEGIN READ ONLY' || {
            printf 'Phase A must be read-only\n' >&2
            exit 44
          }
          printf '%s' "$sql" | grep -q 'UPDATE "\|INSERT INTO "\|DELETE FROM' && {
            printf 'Phase A contains persistent write SQL\n' >&2
            exit 45
          }
          case "${FIXZONE_TEST_PSQL_MODE:-ok}" in
            occupied)
              printf 'ACTIVE_SUPER_ADMIN_COUNT=1\n'
              printf 'ACTIVE_SUPER_ADMIN_PASSWORD_PRESENT=yes\n'
              printf 'TARGET_EMAIL_USER_COUNT=1\n'
              printf 'ACTIVE_SUPER_ADMIN_MFA_ENROLLMENT_COUNT=0\n'
              printf 'ACTIVE_SUPER_ADMIN_MFA_BACKUP_CODE_COUNT=0\n'
              printf 'PREFLIGHT_TARGET_GATE=FAIL\n'
              printf 'ERROR: target email is already owned by another user\n' >&2
              exit 20
              ;;
            mfa)
              printf 'ACTIVE_SUPER_ADMIN_COUNT=1\n'
              printf 'ACTIVE_SUPER_ADMIN_PASSWORD_PRESENT=yes\n'
              printf 'TARGET_EMAIL_USER_COUNT=0\n'
              printf 'ACTIVE_SUPER_ADMIN_MFA_ENROLLMENT_COUNT=1\n'
              printf 'ACTIVE_SUPER_ADMIN_MFA_BACKUP_CODE_COUNT=0\n'
              printf 'PREFLIGHT_TARGET_GATE=FAIL\n'
              printf 'ERROR: active SUPER_ADMIN privileged MFA shape changed\n' >&2
              exit 21
              ;;
            sql_error)
              printf 'ERROR: simulated database failure for %s\n' "${FIXZONE_TEST_TARGET_EMAIL:-secret}" >&2
              exit 22
              ;;
          esac
          printf 'ACTIVE_SUPER_ADMIN_COUNT=1\n'
          printf 'ACTIVE_SUPER_ADMIN_PASSWORD_PRESENT=yes\n'
          printf 'TARGET_EMAIL_USER_COUNT=0\n'
          printf 'ACTIVE_SUPER_ADMIN_MFA_ENROLLMENT_COUNT=0\n'
          printf 'ACTIVE_SUPER_ADMIN_MFA_BACKUP_CODE_COUNT=0\n'
          printf 'ACTIVE_SUPER_ADMIN_MFA_PRE_AUTH_SESSION_OPEN_COUNT=0\n'
          printf 'ACTIVE_SUPER_ADMIN_ACTIVE_PASSWORD_RESET_TOKEN_COUNT=0\n'
          printf 'PREFLIGHT_TARGET_GATE=PASS\n'
        else
          printf '%s' "$sql" | grep -q 'UPDATE "User"' || exit 50
          printf '%s' "$sql" | grep -q '"emailVerifiedAt" = NULL' || exit 51
          printf '%s' "$sql" | grep -q '"tokenVersion" = "tokenVersion" + 1' || exit 52
          printf '%s' "$sql" | grep -q 'AND u."passwordHash" = v_super_hash' || exit 53
          printf '%s' "$sql" | grep -q 'UPDATE "PasswordResetToken"' || {
            if [ "${FIXZONE_TEST_SCRIPT_KIND:-migration}" = "migration" ]; then exit 54; fi
          }
          printf '%s' "$sql" | grep -q 'UPDATE "PrivilegedMfaPreAuthSession"' || exit 55
          printf '%s' "$sql" | grep -q 'INSERT INTO "ComplianceAuditLog"' || exit 56
          printf '%s' "$sql" | grep -q 'INSERT INTO "ComplianceAuditLog" (id,' || exit 57
          printf '%s' "$sql" | grep -q "v_audit_id := 'c' || substr(md5" || exit 58
          if [ "${FIXZONE_TEST_SCRIPT_KIND:-migration}" = "rollback" ]; then
            printf 'ROLLBACK_APPLIED=PASS\n'
          else
            printf 'WRITE_APPLIED=PASS\n'
          fi
        fi
        ;;
      *) exit 98 ;;
    esac
    ;;
  *) exit 99 ;;
esac
SH
chmod +x "$FAKE_BIN/docker"

pass() {
  printf 'PASS: %s\n' "$1"
}

fail_test() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

target_email() {
  printf 'info'
  printf '@'
  printf 'securezonegroup.com'
}

former_email() {
  printf 'former.super'
  printf '@'
  printf 'example.test'
}

assert_no_secret_output() {
  local file="$1"
  if grep -Fq "$(target_email)" "$file"; then
    fail_test "target email leaked"
  fi
  if grep -Fq "$(former_email)" "$file"; then
    fail_test "former email leaked"
  fi
}

run_case() {
  local script="$1"
  local name="$2"
  local input="$3"
  local expected="$4"
  local mode="${5:-ok}"
  local kind="${6:-migration}"
  local containers="${7:-1}"
  local container_psql="${8:-true}"
  local out="$TMP_ROOT/$name.out"
  local marker="$TMP_ROOT/$name.marker"
  local count_file="$TMP_ROOT/$name.count"

  set +e
  (
    cd "$REPO_ROOT"
    env \
      PATH="$FAKE_BIN:/usr/bin:/bin" \
      FIXZONE_DB_MODE=docker-swarm \
      FIXZONE_POSTGRES_SERVICE=securezoneinfrastructure-postgres-bhwgzt \
      FIXZONE_SKIP_EXTERNAL_PREFLIGHT=true \
      FIXZONE_TEST_TARGET_EMAIL="$(target_email)" \
      FIXZONE_TEST_FORMER_EMAIL="$(former_email)" \
      FIXZONE_TEST_DOCKER_EXEC_MARKER="$marker" \
      FIXZONE_TEST_PSQL_COUNT_FILE="$count_file" \
      FIXZONE_TEST_PSQL_MODE="$mode" \
      FIXZONE_TEST_SCRIPT_KIND="$kind" \
      FIXZONE_TEST_CONTAINER_COUNT="$containers" \
      FIXZONE_TEST_CONTAINER_PSQL="$container_psql" \
      "$script"
  ) >"$out" 2>&1 <<<"$input"
  local status=$?
  set -e

  [ "$status" -eq "$expected" ] || {
    sed 's/@/[at]/g' "$out" >&2
    fail_test "$name exited $status, expected $expected"
  }
  assert_no_secret_output "$out"
  printf '%s|%s|%s\n' "$out" "$marker" "$count_file"
}

if grep -q '\\if' "$MIGRATION_SCRIPT" "$ROLLBACK_SCRIPT" "$COMMON_SCRIPT"; then
  fail_test "operator scripts must not use psql if control flow"
fi
pass "invalid psql if-style expressions cannot occur"

assert_no_out_of_scope_counts_cte() {
  local file
  for file in "$MIGRATION_SCRIPT" "$ROLLBACK_SCRIPT"; do
    awk '
      /DO \$\$/ { in_do=1; seen_with=0 }
      in_do && /^[[:space:]]*WITH[[:space:]]*$/ { seen_with=1 }
      in_do && /SELECT \* INTO c FROM counts;/ && !seen_with { exit 1 }
      in_do && /^\$\$;/ { in_do=0; seen_with=0 }
    ' "$file" || fail_test "out-of-scope counts CTE reference in $file"
  done
}
assert_no_out_of_scope_counts_cte
pass "no out-of-scope counts CTE reference remains"

if grep -q 'firebaseUid\|role = '\''CITIZEN'\''::"UserRole"\|role = '\''CITIZEN'\''' "$MIGRATION_SCRIPT" "$ROLLBACK_SCRIPT"; then
  fail_test "citizen/Firebase SQL must not be present in corporate package"
fi
pass "citizen/Firebase rows are not referenced by migration SQL"

target="$(target_email)"
former="$(former_email)"

result="$(run_case "$MIGRATION_SCRIPT" unused-target "$(printf '%s\n%s\nMIGRATE\n' "$target" "$target")" 0)"
out="${result%%|*}"
rest="${result#*|}"
marker="${rest%%|*}"
count_file="${rest##*|}"
grep -q 'ACTIVE_SUPER_ADMIN_COUNT=1' "$out" || fail_test "active SUPER_ADMIN count missing"
grep -q 'ACTIVE_SUPER_ADMIN_PASSWORD_PRESENT=yes' "$out" || fail_test "passwordHash gate missing"
grep -q 'TARGET_EMAIL_USER_COUNT=0' "$out" || fail_test "unused target count missing"
grep -q 'ACTIVE_SUPER_ADMIN_MFA_ENROLLMENT_COUNT=0' "$out" || fail_test "MFA enrollment gate missing"
grep -q 'ACTIVE_SUPER_ADMIN_MFA_BACKUP_CODE_COUNT=0' "$out" || fail_test "MFA backup-code gate missing"
grep -q 'ACTIVE_SUPER_ADMIN_MFA_PRE_AUTH_SESSION_OPEN_COUNT=0' "$out" || fail_test "MFA pre-auth gate missing"
grep -q 'ACTIVE_SUPER_ADMIN_ACTIVE_PASSWORD_RESET_TOKEN_COUNT=0' "$out" || fail_test "active reset-token gate missing"
grep -q 'PREFLIGHT_TARGET_GATE=PASS' "$out" || fail_test "unused target did not pass"
grep -q 'WRITE_APPLIED=PASS' "$out" || fail_test "MIGRATE did not write"
grep -q 'container psql used' "$marker" || fail_test "container psql not used"
[ "$(cat "$count_file")" = "2" ] || fail_test "migration did not use exactly Phase A and Phase B sessions"
pass "target corporate email unused -> PASS"
pass "Docker-Swarm mode works without host psql and uses container psql"
pass "target email moves atomically with passwordHash/User.id guards and tokenVersion advancement"

result="$(run_case "$MIGRATION_SCRIPT" occupied-target "$(printf '%s\n%s\nMIGRATE\n' "$target" "$target")" 20 occupied)"
out="${result%%|*}"
grep -q 'TARGET_EMAIL_USER_COUNT=1' "$out" || fail_test "occupied target count missing"
grep -q 'Type MIGRATE' "$out" && fail_test "occupied target reached MIGRATE"
pass "target email occupied -> fail closed"

result="$(run_case "$MIGRATION_SCRIPT" mfa-unexpected "$(printf '%s\n%s\nMIGRATE\n' "$target" "$target")" 21 mfa)"
out="${result%%|*}"
grep -q 'ACTIVE_SUPER_ADMIN_MFA_ENROLLMENT_COUNT=1' "$out" || fail_test "MFA count missing"
grep -q 'Type MIGRATE' "$out" && fail_test "MFA failure reached MIGRATE"
pass "SUPER_ADMIN MFA unexpected -> fail closed"

result="$(run_case "$MIGRATION_SCRIPT" sql-error "$(printf '%s\n%s\nMIGRATE\n' "$target" "$target")" 22 sql_error)"
out="${result%%|*}"
grep -q 'Type MIGRATE' "$out" && fail_test "SQL error reached MIGRATE"
pass "SQL error aborts before MIGRATE prompt"
pass "hidden email is absent from stdout/stderr and failure paths"

result="$(run_case "$MIGRATION_SCRIPT" no-migrate "$(printf '%s\n%s\nNOPE\n' "$target" "$target")" 1)"
out="${result%%|*}"
count_file="${result##*|}"
[ "$(cat "$count_file")" = "1" ] || fail_test "non-MIGRATE reached Phase B"
grep -q 'WRITE_APPLIED=PASS' "$out" && fail_test "non-MIGRATE wrote"
pass "MIGRATE is required before any write"

result="$(run_case "$MIGRATION_SCRIPT" eof "$(printf '%s\n%s\n' "$target" "$target")" 1)"
count_file="${result##*|}"
[ "$(cat "$count_file")" = "1" ] || fail_test "EOF reached Phase B"
pass "EOF fails closed"

result="$(run_case "$MIGRATION_SCRIPT" zero-container "" 1 ok migration 0 true)"
out="${result%%|*}"
grep -q 'No running PostgreSQL container' "$out" || fail_test "zero containers did not fail closed"
pass "zero DB containers fail closed"

result="$(run_case "$MIGRATION_SCRIPT" multi-container "" 1 ok migration 2 true)"
out="${result%%|*}"
grep -q 'Multiple running PostgreSQL containers' "$out" || fail_test "multiple containers did not fail closed"
pass "multiple DB containers fail closed"

result="$(run_case "$MIGRATION_SCRIPT" missing-container-psql "" 1 ok migration 1 false)"
out="${result%%|*}"
grep -q 'psql is not available inside the PostgreSQL container' "$out" || fail_test "missing container psql did not fail closed"
pass "missing container psql fails closed"

rollback_input="$(printf '%s\n%s\n%s\n%s\nMIGRATE\n' "$target" "$target" "$former" "$former")"
result="$(run_case "$ROLLBACK_SCRIPT" rollback "$rollback_input" 0 ok rollback)"
out="${result%%|*}"
grep -q 'ROLLBACK_APPLIED=PASS' "$out" || fail_test "rollback did not apply after MIGRATE"
pass "rollback follows two-hidden-email Docker-Swarm safety rules"

printf 'All corporate SUPER_ADMIN email migration safety tests passed.\n'
