#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AUDIT_SCRIPT="$REPO_ROOT/scripts/operations/fixzone_super_admin_email_dependency_audit.sh"
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
target="${FIXZONE_TEST_TARGET_EMAIL:-__absent__}"
if [ "$target" != "__absent__" ] && printf '%s\n' "$cmd" "$*" | grep -Fqi "$target"; then
  printf 'target email leaked through docker arguments\n' >&2
  exit 91
fi

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
        sql="$(cat)"
        [ "${2:-}" = "-U" ] && [ "${3:-}" = "fixture_user" ] && [ "${4:-}" = "-d" ] && [ "${5:-}" = "fixture_db" ] || exit 97
        case "$sql" in
          *"CREATE TEMP TABLE __fz_input"*"\copy __fz_input(target_email) FROM stdin"* ) ;;
          *) printf 'missing hidden temp input stream\n' >&2; exit 92 ;;
        esac
        printf '%s' "$sql" | grep -q 'BEGIN READ ONLY' || {
          printf 'audit must use read-only transaction\n' >&2
          exit 93
        }
        printf '%s' "$sql" | grep -q 'UPDATE\\|DELETE\\|INSERT INTO "User"\\|DROP TABLE' && {
          printf 'persistent write SQL is forbidden\n' >&2
          exit 98
        }
        printf 'target_account_count=1\n'
        printf 'target_is_citizen=yes\n'
        printf 'target_is_active=yes\n'
        printf 'target_is_demo=no\n'
        printf 'target_has_firebase_uid=yes\n'
        printf 'active_super_admin_count=1\n'
        printf 'active_super_admin_password_hash_present_count=1\n'
        printf 'active_super_admin_mfa_enrollment_count=1\n'
        printf 'target_report_citizen_count=2\n'
        printf 'target_notification_user_count=3\n'
        printf 'target_payment_requesting_user_count=0\n'
        printf 'audit_recommendation_input_ready=yes\n'
        ;;
      *) exit 99 ;;
    esac
    ;;
  *) exit 99 ;;
esac
SH
chmod +x "$FAKE_BIN/docker"

target_email() {
  printf 'fixture.audit'
  printf '@'
  printf 'example.test'
}

fail_test() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

target="$(target_email)"
out="$TMP_ROOT/audit.out"
set +e
(
  cd "$REPO_ROOT"
  env \
    PATH="$FAKE_BIN:/usr/bin:/bin" \
    FIXZONE_DB_MODE=docker-swarm \
    FIXZONE_POSTGRES_SERVICE=securezoneinfrastructure-postgres-bhwgzt \
    FIXZONE_TEST_TARGET_EMAIL="$target" \
    "$AUDIT_SCRIPT"
) >"$out" 2>&1 <<<"$(printf '%s\n%s\n' "$target" "$target")"
status=$?
set -e

[ "$status" -eq 0 ] || {
  sed 's/@/[at]/g' "$out" >&2
  fail_test "audit exited $status"
}

grep -q 'target_account_count=1' "$out" || fail_test "target account count missing"
grep -q 'target_report_citizen_count=2' "$out" || fail_test "citizen report dependency count missing"
grep -q 'active_super_admin_password_hash_present_count=1' "$out" || fail_test "super-admin auth count missing"
grep -Fq "$target" "$out" && fail_test "target email leaked to stdout/stderr"
grep -Eq 'User.id|phone=|firebaseUid=' "$out" && fail_test "PII/id label leaked"

printf 'PASS: dependency audit script is Docker-Swarm, read-only, and secret-safe locally.\n'
