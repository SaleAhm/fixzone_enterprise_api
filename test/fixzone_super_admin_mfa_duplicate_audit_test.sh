#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AUDIT_SCRIPT="$REPO_ROOT/scripts/operations/fixzone_super_admin_mfa_duplicate_audit.sh"
TMP_ROOT="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

FAKE_BIN="$TMP_ROOT/bin"
mkdir -p "$FAKE_BIN"

cat >"$FAKE_BIN/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

cmd="${1:-}"
shift || true

case "$cmd" in
  ps)
    printf 'pg-container-1\n'
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
        [ "${3:-}" = "command -v psql >/dev/null 2>&1" ] && exit 0
        [ "${3:-}" = "printenv POSTGRES_USER" ] && printf 'fixture_user\n' && exit 0
        [ "${3:-}" = "printenv POSTGRES_DB" ] && printf 'fixture_db\n' && exit 0
        exit 95
        ;;
      psql)
        [ "$interactive" = "true" ] || exit 96
        [ "${2:-}" = "-U" ] && [ "${3:-}" = "fixture_user" ] && [ "${4:-}" = "-d" ] && [ "${5:-}" = "fixture_db" ] || exit 97
        sql="$(cat)"
        printf '%s' "$sql" | grep -q 'BEGIN READ ONLY' || {
          printf 'audit must be read-only\n' >&2
          exit 91
        }
        printf '%s' "$sql" | grep -q 'UPDATE \|DELETE \|INSERT \|ALTER \|DROP \|TRUNCATE ' && {
          printf 'audit contains persistent write SQL\n' >&2
          exit 92
        }
        printf '%s' "$sql" | grep -q 'encryptedTotpSecret' && {
          printf 'audit may test secret presence but must not select secret value\n' >>"${FIXZONE_TEST_MARKER:?}"
        }
        printf 'active_super_admin_count=1\n'
        printf 'total_enrollment_count=2\n'
        printf 'active_enabled_enrollment_count=2\n'
        printf 'pending_enabled_enrollment_count=0\n'
        printf 'disabled_or_revoked_enrollment_count=0\n'
        printf 'auth_capable_enrollment_count=2\n'
        printf 'application_selected_enrollment_count=1\n'
        printf 'non_selected_active_enrollment_count=1\n'
        printf 'selected_enrollment_has_successful_verification=yes\n'
        printf 'non_selected_active_verified_enrollment_count=1\n'
        printf 'backup_code_total_count=10\n'
        printf 'backup_code_unused_count=10\n'
        printf 'backup_code_used_count=0\n'
        printf 'selected_enrollment_backup_code_count=10\n'
        printf 'selected_enrollment_unused_backup_code_count=10\n'
        printf 'non_selected_enrollment_backup_code_count=0\n'
        printf 'open_super_admin_mfa_pre_auth_session_count=0\n'
        printf 'mfa_application_invariant_satisfied=no\n'
        printf 'recommendation_category=DUPLICATE_ACTIVE_ENROLLMENT_REQUIRES_SECRET_SAFE_IDENTIFICATION\n'
        ;;
      *) exit 98 ;;
    esac
    ;;
  *) exit 99 ;;
esac
SH
chmod +x "$FAKE_BIN/docker"

fail_test() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

out="$TMP_ROOT/audit.out"
marker="$TMP_ROOT/marker"
set +e
(
  cd "$REPO_ROOT"
  env \
    PATH="$FAKE_BIN:/usr/bin:/bin" \
    FIXZONE_DB_MODE=docker-swarm \
    FIXZONE_POSTGRES_SERVICE=securezoneinfrastructure-postgres-bhwgzt \
    FIXZONE_TEST_MARKER="$marker" \
    "$AUDIT_SCRIPT"
) >"$out" 2>&1
status=$?
set -e

[ "$status" -eq 0 ] || {
  cat "$out" >&2
  fail_test "audit exited $status"
}

grep -q 'active_super_admin_count=1' "$out" || fail_test "active super-admin count missing"
grep -q 'active_enabled_enrollment_count=2' "$out" || fail_test "active enrollment count missing"
grep -q 'application_selected_enrollment_count=1' "$out" || fail_test "application selection count missing"
grep -q 'backup_code_total_count=10' "$out" || fail_test "backup-code count missing"
grep -q 'recommendation_category=DUPLICATE_ACTIVE_ENROLLMENT_REQUIRES_SECRET_SAFE_IDENTIFICATION' "$out" ||
  fail_test "recommendation category missing"

if grep -Eq 'encryptedTotpSecret=|secret=|codeDigest=|tokenDigest=|User.id|userId=|enrollmentId=|email=|passwordHash=|firebaseUid=' "$out"; then
  fail_test "audit output leaked forbidden secret/id/PII labels"
fi

printf 'PASS: SUPER_ADMIN MFA duplicate audit is Docker-Swarm, read-only, and secret-safe locally.\n'
