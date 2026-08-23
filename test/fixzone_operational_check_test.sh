#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/operations/fixzone_operational_check.sh"
TMP_ROOT="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

FAKE_BIN="$TMP_ROOT/bin"
mkdir -p "$FAKE_BIN"

cat >"$FAKE_BIN/curl" <<'SH'
#!/usr/bin/env bash
if [ "${FIXZONE_TEST_API_OK:-true}" = "true" ]; then
  exit 0
fi
exit 22
SH
chmod +x "$FAKE_BIN/curl"
cp "$FAKE_BIN/curl" "$FAKE_BIN/curl.exe"

cat >"$FAKE_BIN/docker" <<'SH'
#!/usr/bin/env bash
cmd="${1:-}"
shift || true
case "$cmd" in
  ps)
    if [ "${FIXZONE_TEST_SERVICE_RUNNING:-true}" = "true" ]; then
      printf 'abc123 fixzone-api\n'
    fi
    ;;
  inspect)
    if [ "${1:-}" = "--format" ]; then
      if [ "${FIXZONE_TEST_MOUNT_PRESENT:-true}" = "true" ]; then
        printf '%s|%s|%s\n' "${FIXZONE_TEST_MOUNT_TYPE:-bind}" "${FIXZONE_TEST_MOUNT_SOURCE:-$FIXZONE_HOST_UPLOAD_PATH}" "${FIXZONE_TEST_MOUNT_DESTINATION:-/app/uploads}"
      fi
    else
      [ "${FIXZONE_TEST_SERVICE_RUNNING:-true}" = "true" ]
    fi
    ;;
  *)
    exit 1
    ;;
esac
SH
chmod +x "$FAKE_BIN/docker"
cp "$FAKE_BIN/docker" "$FAKE_BIN/docker.exe"

cat >"$FAKE_BIN/df" <<'SH'
#!/usr/bin/env bash
used="${FIXZONE_TEST_DF_USED_PERCENT:-50}"
cat <<OUT
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/test 100000 50000 50000 ${used}% /fixture
OUT
SH
chmod +x "$FAKE_BIN/df"
cp "$FAKE_BIN/df" "$FAKE_BIN/df.exe"

create_files() {
  local root="$1"
  local count="$2"
  rm -rf "$root"
  mkdir -p "$root"
  local i
  for i in $(seq 1 "$count"); do
    printf 'fixture-%s\n' "$i" >"$root/file-$i.txt"
  done
}

create_backup() {
  local root="$1"
  local set_dir="$root/fixzone-v1-baseline-2026-08-22_15-53-38"
  rm -rf "$root"
  mkdir -p "$set_dir"
  printf 'db\n' >"$set_dir/fixzone-postgres.dump"
  printf 'uploads\n' >"$set_dir/fixzone-uploads.tar.gz"
  printf 'manifest\nRecovery rehearsal: PASS\n' >"$set_dir/recovery-manifest.txt"
  (cd "$set_dir" && sha256sum fixzone-postgres.dump fixzone-uploads.tar.gz recovery-manifest.txt >checksums.sha256)
}

prepare_fixture() {
  HOST_UPLOAD="$TMP_ROOT/host-upload"
  CONTAINER_UPLOAD="$TMP_ROOT/container-upload"
  BACKUP_ROOT="$TMP_ROOT/backups"
  create_files "$HOST_UPLOAD" 3
  create_files "$CONTAINER_UPLOAD" 3
  create_backup "$BACKUP_ROOT"
}

run_check() {
  local output_file="$1"
  shift
  set +e
  env \
    PATH="$FAKE_BIN:$PATH" \
    FIXZONE_API_HEALTH_URL="https://example.invalid/api/health" \
    FIXZONE_HOST_UPLOAD_PATH="$HOST_UPLOAD" \
    FIXZONE_CONTAINER_UPLOAD_MIRROR="$CONTAINER_UPLOAD" \
    FIXZONE_BACKUP_ROOT="$BACKUP_ROOT" \
    FIXZONE_TEST_MOUNT_SOURCE="$HOST_UPLOAD" \
    FIXZONE_TEST_API_OK="${FIXZONE_TEST_API_OK:-true}" \
    FIXZONE_TEST_SERVICE_RUNNING="${FIXZONE_TEST_SERVICE_RUNNING:-true}" \
    FIXZONE_TEST_MOUNT_PRESENT="${FIXZONE_TEST_MOUNT_PRESENT:-true}" \
    FIXZONE_TEST_DF_USED_PERCENT="${FIXZONE_TEST_DF_USED_PERCENT:-50}" \
    FIXZONE_MONITOR_STATE_DIR="${FIXZONE_MONITOR_STATE_DIR:-$TMP_ROOT/state}" \
    FIXZONE_MONITOR_VERSION="${FIXZONE_MONITOR_VERSION:-test-version}" \
    FIXZONE_MONITOR_ENVIRONMENT="${FIXZONE_MONITOR_ENVIRONMENT:-test}" \
    "$@" "$SCRIPT" >"$output_file" 2>&1
  status=$?
  set -e
  return "$status"
}

assert_contains() {
  local file="$1"
  local text="$2"
  grep -Fq "$text" "$file" || {
    printf 'Expected to find %s in %s\n' "$text" "$file" >&2
    cat "$file" >&2
    exit 1
  }
}

assert_not_contains() {
  local file="$1"
  local text="$2"
  if grep -Fq "$text" "$file"; then
    printf 'Did not expect to find %s in %s\n' "$text" "$file" >&2
    cat "$file" >&2
    exit 1
  fi
}

expect_exit() {
  local expected="$1"
  local output="$2"
  shift 2
  prepare_fixture
  if run_check "$output" "$@"; then
    actual=0
  else
    actual=$?
  fi
  if [ "$actual" -ne "$expected" ]; then
    printf 'Expected exit %s, got %s\n' "$expected" "$actual" >&2
    cat "$output" >&2
    exit 1
  fi
}

json_eval() {
  local file="$1"
  local expression="$2"
  node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); const value = ($expression); if (value === null || value === undefined) { console.log(''); } else if (typeof value === 'object') { console.log(JSON.stringify(value)); } else { console.log(String(value)); }" "$file"
}

assert_json_eq() {
  local file="$1"
  local expression="$2"
  local expected="$3"
  local actual
  actual="$(json_eval "$file" "$expression")"
  if [ "$actual" != "$expected" ]; then
    printf 'Expected JSON %s in %s to equal %s, got %s\n' "$expression" "$file" "$expected" "$actual" >&2
    cat "$file" >&2
    exit 1
  fi
}

assert_json_parses() {
  local file="$1"
  node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$file"
}

assert_no_state_temp_files() {
  local state_dir="$1"
  if find "$state_dir" -maxdepth 1 -type f -name '.*.tmp' 2>/dev/null | grep -q .; then
    printf 'State temp files remained in %s\n' "$state_dir" >&2
    find "$state_dir" -maxdepth 1 -type f -name '.*.tmp' >&2
    exit 1
  fi
}

out="$TMP_ROOT/out.txt"
STATE_DIR="$TMP_ROOT/state"

expect_exit 3 "$out" FIXZONE_MONITOR_STATE_DIR="$STATE_DIR"
assert_contains "$out" "api_state=HEALTHY"
assert_contains "$out" "service_state=HEALTHY"
assert_contains "$out" "mount_state=HEALTHY"
assert_contains "$out" "upload_consistency_state=HEALTHY"
assert_contains "$out" "canary_residue_state=HEALTHY"
assert_contains "$out" "disk_state=HEALTHY"
assert_contains "$out" "backup_presence_state=HEALTHY"
assert_contains "$out" "backup_freshness_state=UNKNOWN"
assert_contains "$out" "backup_verification_state=UNKNOWN"
assert_contains "$out" "restore_rehearsed_state=HEALTHY"
test -f "$STATE_DIR/latest-status.json"
test -f "$STATE_DIR/heartbeat.json"
assert_json_parses "$STATE_DIR/latest-status.json"
assert_json_parses "$STATE_DIR/heartbeat.json"
assert_json_eq "$STATE_DIR/latest-status.json" "data.overallState" "UNKNOWN"
assert_json_eq "$STATE_DIR/latest-status.json" "data.exitCode" "3"
assert_json_eq "$STATE_DIR/latest-status.json" "data.monitorVersion" "test-version"
assert_json_eq "$STATE_DIR/latest-status.json" "data.environment" "test"
assert_json_eq "$STATE_DIR/latest-status.json" "data.checks.api.state" "HEALTHY"
assert_json_eq "$STATE_DIR/latest-status.json" "data.checks.backupFreshness.state" "UNKNOWN"
assert_json_eq "$STATE_DIR/latest-status.json" "data.alerts.some((alert) => alert.key === 'backup_freshness_unknown')" "true"
assert_json_eq "$STATE_DIR/heartbeat.json" "Boolean(data.lastStartedAt)" "true"
assert_json_eq "$STATE_DIR/heartbeat.json" "Boolean(data.lastCompletedAt)" "true"
assert_json_eq "$STATE_DIR/heartbeat.json" "data.lastExitCode" "3"
assert_json_eq "$STATE_DIR/heartbeat.json" "data.lastOverallState" "UNKNOWN"
assert_json_eq "$STATE_DIR/heartbeat.json" "Boolean(data.lastUnknownAt)" "true"
assert_no_state_temp_files "$STATE_DIR"

prepare_fixture
STATE_DIR="$TMP_ROOT/state-preserve"
mkdir -p "$STATE_DIR"
printf 'keep me\n' >"$STATE_DIR/operator-note.txt"
if run_check "$out" FIXZONE_MONITOR_STATE_DIR="$STATE_DIR"; then actual=0; else actual=$?; fi
[ "$actual" -eq 3 ]
assert_contains "$STATE_DIR/operator-note.txt" "keep me"

expect_exit 2 "$out" FIXZONE_TEST_API_OK=false
assert_contains "$out" "api_state=CRITICAL"
assert_json_eq "$TMP_ROOT/state/latest-status.json" "data.checks.api.state" "CRITICAL"
assert_json_eq "$TMP_ROOT/state/latest-status.json" "data.exitCode" "2"

expect_exit 2 "$out" FIXZONE_TEST_SERVICE_RUNNING=false
assert_contains "$out" "service_state=CRITICAL"

expect_exit 2 "$out" FIXZONE_TEST_MOUNT_PRESENT=false
assert_contains "$out" "mount_state=CRITICAL"

expect_exit 2 "$out" FIXZONE_TEST_MOUNT_SOURCE=/wrong/source
assert_contains "$out" "mount_state=CRITICAL"

prepare_fixture
printf 'extra\n' >"$CONTAINER_UPLOAD/extra.txt"
if run_check "$out"; then actual=0; else actual=$?; fi
[ "$actual" -eq 2 ]
assert_contains "$out" "upload_consistency_state=CRITICAL"

prepare_fixture
printf 'canary\n' >"$HOST_UPLOAD/.fixzone-operational-health-canary-test.tmp"
printf 'canary\n' >"$CONTAINER_UPLOAD/.fixzone-operational-health-canary-test.tmp"
if run_check "$out"; then actual=0; else actual=$?; fi
[ "$actual" -eq 1 ]
assert_contains "$out" "canary_residue_state=WARNING"
assert_json_eq "$TMP_ROOT/state/latest-status.json" "data.overallState" "WARNING"

expect_exit 1 "$out" FIXZONE_TEST_DF_USED_PERCENT=90
assert_contains "$out" "disk_state=WARNING"

expect_exit 2 "$out" FIXZONE_TEST_DF_USED_PERCENT=96
assert_contains "$out" "disk_state=CRITICAL"
assert_json_eq "$TMP_ROOT/state/latest-status.json" "data.overallState" "CRITICAL"

prepare_fixture
rm "$BACKUP_ROOT"/fixzone-v1-baseline-2026-08-22_15-53-38/fixzone-uploads.tar.gz
if run_check "$out"; then actual=0; else actual=$?; fi
[ "$actual" -eq 2 ]
assert_contains "$out" "backup_presence_state=CRITICAL"

expect_exit 1 "$out" FIXZONE_BACKUP_FRESHNESS_WARNING_HOURS=0 FIXZONE_BACKUP_FRESHNESS_CRITICAL_HOURS=9999
assert_contains "$out" "backup_freshness_state=WARNING"

expect_exit 2 "$out" FIXZONE_BACKUP_FRESHNESS_WARNING_HOURS=0 FIXZONE_BACKUP_FRESHNESS_CRITICAL_HOURS=0
assert_contains "$out" "backup_freshness_state=CRITICAL"

expect_exit 0 "$out" FIXZONE_BACKUP_FRESHNESS_WARNING_HOURS=9999 FIXZONE_BACKUP_FRESHNESS_CRITICAL_HOURS=99999 FIXZONE_VERIFY_BACKUP_CHECKSUMS=true
assert_contains "$out" "overall_state=HEALTHY"
assert_contains "$out" "backup_verification_state=HEALTHY"

expect_exit 3 "$out" DATABASE_URL=fixture_database_url_value JWT_ACCESS_SECRET=fixture_access_secret_value
assert_not_contains "$out" "fixture_database_url_value"
assert_not_contains "$out" "fixture_access_secret_value"
assert_not_contains "$TMP_ROOT/state/latest-status.json" "fixture_database_url_value"
assert_not_contains "$TMP_ROOT/state/latest-status.json" "fixture_access_secret_value"

assert_json_eq "$TMP_ROOT/state/latest-status.json" "new Set(data.alerts.map((alert) => alert.key + '|' + alert.state + '|' + alert.summary)).size === data.alerts.length" "true"

prepare_fixture
STATE_DIR="$TMP_ROOT/state-failure-parent"
printf 'not a directory\n' >"$STATE_DIR"
if run_check "$out" FIXZONE_MONITOR_STATE_DIR="$STATE_DIR/child" FIXZONE_BACKUP_FRESHNESS_WARNING_HOURS=9999 FIXZONE_BACKUP_FRESHNESS_CRITICAL_HOURS=99999 FIXZONE_VERIFY_BACKUP_CHECKSUMS=true; then actual=0; else actual=$?; fi
[ "$actual" -eq 1 ]
assert_contains "$out" "overall_state=HEALTHY"
assert_contains "$out" "state_persistence_state=WARNING"

prepare_fixture
STATE_DIR="$TMP_ROOT/state-interrupted"
mkdir -p "$STATE_DIR"
if run_check "$out" FIXZONE_MONITOR_STATE_DIR="$STATE_DIR" FIXZONE_TEST_EXIT_AFTER_START_HEARTBEAT=true; then actual=0; else actual=$?; fi
[ "$actual" -eq 130 ]
test -f "$STATE_DIR/heartbeat.json"
assert_json_parses "$STATE_DIR/heartbeat.json"
assert_json_eq "$STATE_DIR/heartbeat.json" "Boolean(data.lastStartedAt)" "true"
assert_json_eq "$STATE_DIR/heartbeat.json" "data.lastCompletedAt" ""
if [ -f "$STATE_DIR/latest-status.json" ]; then
  printf 'Interrupted run should not write latest-status.json\n' >&2
  cat "$STATE_DIR/latest-status.json" >&2
  exit 1
fi
assert_no_state_temp_files "$STATE_DIR"

if grep -E '\b(rm|rmdir|unlink|docker[[:space:]]+(restart|service[[:space:]]+update|rm)|pg_restore|pg_dump|tar[[:space:]]+-x|prisma[[:space:]]+migrate)\b' "$SCRIPT" |
  grep -Ev 'rm -f "\$tmp" 2>/dev/null \|\| true'; then
  printf 'Script contains a destructive command pattern\n' >&2
  exit 1
fi

printf 'fixzone_operational_check_test.sh: all checks passed\n'
