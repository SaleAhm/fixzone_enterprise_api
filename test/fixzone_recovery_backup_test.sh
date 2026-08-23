#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/operations/fixzone_recovery_backup.sh"
TMP_ROOT="$(mktemp -d)"
REAL_SHA256SUM="$(command -v sha256sum)"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

FAKE_BIN="$TMP_ROOT/bin"
mkdir -p "$FAKE_BIN"

cat >"$FAKE_BIN/pg_dump" <<'SH'
#!/usr/bin/env bash
if [ "${FIXZONE_TEST_PG_DUMP_FAIL:-false}" = "true" ]; then
  exit 1
fi
out=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --file)
      out="$2"
      shift 2
      ;;
    --file=*)
      out="${1#--file=}"
      shift
      ;;
    *)
      shift
      ;;
  esac
done
[ -n "$out" ] || exit 1
if [ "${FIXZONE_TEST_ZERO_DUMP:-false}" = "true" ]; then
  : >"$out"
else
  printf 'PGDMP fixture custom dump\n' >"$out"
fi
SH
chmod +x "$FAKE_BIN/pg_dump"

cat >"$FAKE_BIN/pg_restore" <<'SH'
#!/usr/bin/env bash
if [ "${FIXZONE_TEST_TOC_FAIL:-false}" = "true" ]; then
  exit 1
fi
if [ "${FIXZONE_TEST_TOC_EMPTY:-false}" = "true" ]; then
  exit 0
fi
cat <<OUT
;
; Archive created at fixture
;
1234; 1259 100 TABLE public users fixture
1235; 0 100 TABLE DATA public users fixture
OUT
SH
chmod +x "$FAKE_BIN/pg_restore"

cat >"$FAKE_BIN/tar" <<'SH'
#!/usr/bin/env bash
if [ "${FIXZONE_TEST_TAR_FAIL:-false}" = "true" ]; then
  exit 1
fi
exec "${FIXZONE_REAL_TAR:-tar}" "$@"
SH
chmod +x "$FAKE_BIN/tar"

cat >"$FAKE_BIN/sha256sum" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = "-c" ] && [ "${FIXZONE_TEST_CHECKSUM_VERIFY_FAIL:-false}" = "true" ]; then
  exit 1
fi
exec "$FIXZONE_REAL_SHA256SUM" "$@"
SH
chmod +x "$FAKE_BIN/sha256sum"

assert_contains() {
  local file="$1"
  local text="$2"
  grep -Fq "$text" "$file" || {
    printf 'Expected to find %s in %s\n' "$text" "$file" >&2
    [ -f "$file" ] && cat "$file" >&2
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

assert_json_eq() {
  local file="$1"
  local expression="$2"
  local expected="$3"
  local actual
  actual="$(node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); const value = ($expression); console.log(value === undefined || value === null ? '' : String(value));" "$file")"
  if [ "$actual" != "$expected" ]; then
    printf 'Expected JSON %s in %s to equal %s, got %s\n' "$expression" "$file" "$expected" "$actual" >&2
    cat "$file" >&2
    exit 1
  fi
}

prepare_fixture() {
  TEST_ROOT="$(mktemp -d "$TMP_ROOT/case.XXXXXX")"
  BACKUP_ROOT="$TEST_ROOT/backups"
  UPLOAD_ROOT="$TEST_ROOT/uploads"
  mkdir -p "$BACKUP_ROOT" "$UPLOAD_ROOT/nested"
  printf 'a\n' >"$UPLOAD_ROOT/a.txt"
  printf 'b\n' >"$UPLOAD_ROOT/nested/b.txt"
}

run_backup() {
  local output="$1"
  shift
  set +e
  env \
    PATH="$FAKE_BIN:$PATH" \
    FIXZONE_REAL_SHA256SUM="$REAL_SHA256SUM" \
    FIXZONE_REAL_TAR="${FIXZONE_REAL_TAR:-$(command -v tar)}" \
    FIXZONE_BACKUP_ROOT="$BACKUP_ROOT" \
    FIXZONE_UPLOAD_ROOT="$UPLOAD_ROOT" \
    FIXZONE_BACKUP_ENVIRONMENT="test" \
    FIXZONE_APP_VERSION="fixture-app" \
    FIXZONE_BACKEND_COMMIT="fixture-backend" \
    FIXZONE_FRONTEND_COMMIT="fixture-frontend" \
    FIXZONE_BACKUP_TIMESTAMP="${FIXZONE_BACKUP_TIMESTAMP:-2026-08-23_12-00-00}" \
    "$@" "$SCRIPT" >"$output" 2>&1
  status=$?
  set -e
  return "$status"
}

expect_exit() {
  local expected="$1"
  local output="$2"
  shift 2
  prepare_fixture
  if run_backup "$output" "$@"; then
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

final_dir() {
  printf '%s/fixzone-v1-backup-2026-08-23_12-00-00' "$BACKUP_ROOT"
}

failed_dir() {
  printf '%s/.fixzone-v1-backup-2026-08-23_12-00-00.failed' "$BACKUP_ROOT"
}

out="$TMP_ROOT/out.txt"

expect_exit 0 "$out"
SET_DIR="$(final_dir)"
test -d "$SET_DIR"
test -s "$SET_DIR/fixzone-postgres.dump"
test -s "$SET_DIR/fixzone-uploads.tar.gz"
test -s "$SET_DIR/checksums.sha256"
test -s "$SET_DIR/database-toc.txt"
test -f "$SET_DIR/uploads-list.txt"
test -s "$SET_DIR/recovery-manifest.txt"
test -s "$SET_DIR/verification-status.json"
assert_contains "$out" "recovery_backup_state=SUCCESS"
assert_contains "$SET_DIR/checksums.sha256" "fixzone-postgres.dump"
assert_contains "$SET_DIR/checksums.sha256" "fixzone-uploads.tar.gz"
assert_contains "$SET_DIR/checksums.sha256" "database-toc.txt"
assert_contains "$SET_DIR/checksums.sha256" "uploads-list.txt"
assert_contains "$SET_DIR/checksums.sha256" "recovery-manifest.txt"
(cd "$SET_DIR" && "$REAL_SHA256SUM" -c checksums.sha256 >/dev/null)
assert_json_eq "$SET_DIR/recovery-manifest.txt" "data.state" "SUCCESS"
assert_json_eq "$SET_DIR/recovery-manifest.txt" "data.uploadFileCount" "2"
assert_json_eq "$SET_DIR/recovery-manifest.txt" "data.backendCommit" "fixture-backend"
assert_json_eq "$SET_DIR/verification-status.json" "data.state" "SUCCESS"
assert_json_eq "$SET_DIR/verification-status.json" "data.checksumAlgorithm" "sha256"

prepare_fixture
printf 'old\n' >"$BACKUP_ROOT/operator-preserved.txt"
mkdir -p "$BACKUP_ROOT/fixzone-v1-backup-2026-08-22_00-00-00"
printf 'keep\n' >"$BACKUP_ROOT/fixzone-v1-backup-2026-08-22_00-00-00/marker.txt"
if run_backup "$out"; then actual=0; else actual=$?; fi
[ "$actual" -eq 0 ]
assert_contains "$BACKUP_ROOT/operator-preserved.txt" "old"
assert_contains "$BACKUP_ROOT/fixzone-v1-backup-2026-08-22_00-00-00/marker.txt" "keep"

expect_exit 1 "$out" FIXZONE_TEST_PG_DUMP_FAIL=true
test ! -d "$(final_dir)"
test -d "$(failed_dir)"
assert_contains "$(failed_dir)/failure-summary.txt" "pg_dump failed"
assert_json_eq "$(failed_dir)/verification-status.json" "data.state" "CRITICAL"

expect_exit 1 "$out" FIXZONE_TEST_ZERO_DUMP=true
test ! -d "$(final_dir)"
assert_contains "$(failed_dir)/failure-summary.txt" "zero bytes"

expect_exit 1 "$out" FIXZONE_TEST_TOC_FAIL=true
test ! -d "$(final_dir)"
assert_contains "$(failed_dir)/failure-summary.txt" "TOC"

expect_exit 1 "$out" FIXZONE_TEST_TOC_EMPTY=true
test ! -d "$(final_dir)"
assert_contains "$(failed_dir)/failure-summary.txt" "TOC listing is missing"

expect_exit 1 "$out" FIXZONE_TEST_TAR_FAIL=true
test ! -d "$(final_dir)"
assert_contains "$(failed_dir)/failure-summary.txt" "uploads archive creation failed"

prepare_fixture
rm -rf "$UPLOAD_ROOT"
if run_backup "$out"; then actual=0; else actual=$?; fi
[ "$actual" -eq 1 ]
test ! -d "$(final_dir)"
assert_contains "$out" "upload source does not exist"

prepare_fixture
rm -rf "$UPLOAD_ROOT"
mkdir -p "$UPLOAD_ROOT"
if run_backup "$out"; then actual=0; else actual=$?; fi
[ "$actual" -eq 0 ]
assert_json_eq "$(final_dir)/recovery-manifest.txt" "data.uploadFileCount" "0"

expect_exit 1 "$out" FIXZONE_TEST_CHECKSUM_VERIFY_FAIL=true
test ! -d "$(final_dir)"
assert_contains "$(failed_dir)/failure-summary.txt" "checksum verification failed"
assert_json_eq "$(failed_dir)/verification-status.json" "data.state" "CRITICAL"

prepare_fixture
printf 'canary\n' >"$UPLOAD_ROOT/.fixzone-operational-health-canary-fixture"
if run_backup "$out"; then actual=0; else actual=$?; fi
[ "$actual" -eq 0 ]
assert_json_eq "$(final_dir)/recovery-manifest.txt" "data.canaryResidueState" "WARNING"
assert_json_eq "$(final_dir)/recovery-manifest.txt" "data.uploadFileCount" "2"
assert_not_contains "$(final_dir)/uploads-list.txt" ".fixzone-operational-health-canary"

prepare_fixture
if command -v flock >/dev/null 2>&1; then
  exec 8>"$BACKUP_ROOT/.fixzone_recovery_backup.lock"
  flock -n 8
else
  mkdir "$BACKUP_ROOT/.fixzone_recovery_backup.lock.lockdir"
fi
if run_backup "$out"; then actual=0; else actual=$?; fi
[ "$actual" -eq 75 ]
test ! -d "$(final_dir)"
if command -v flock >/dev/null 2>&1; then
  exec 8>&-
else
  rmdir "$BACKUP_ROOT/.fixzone_recovery_backup.lock.lockdir"
fi
assert_contains "$out" "already running"

prepare_fixture
BACKUP_ROOT="/"
if run_backup "$out"; then actual=0; else actual=$?; fi
[ "$actual" -eq 1 ]
assert_contains "$out" "backup root path is unsafe"

prepare_fixture
if run_backup "$out" FIXZONE_BACKUP_MIN_FREE_KB=999999999999; then actual=0; else actual=$?; fi
[ "$actual" -eq 1 ]
test ! -d "$(final_dir)"
assert_contains "$out" "insufficient free space"

prepare_fixture
if run_backup "$out" FIXZONE_BACKUP_ID=unsafe-id; then actual=0; else actual=$?; fi
[ "$actual" -eq 1 ]
assert_contains "$out" "recovery set id must start"

prepare_fixture
if run_backup "$out" DATABASE_URL=fixture_database_url_value JWT_ACCESS_SECRET=fixture_secret_value; then actual=0; else actual=$?; fi
[ "$actual" -eq 0 ]
if grep -R -F 'fixture_database_url_value\|fixture_secret_value' "$(final_dir)" "$out" 2>/dev/null; then
  printf 'Secret-like fixture values appeared in artifacts or output\n' >&2
  exit 1
fi

prepare_fixture
printf 'c\n' >"$UPLOAD_ROOT/c.txt"
printf 'd\n' >"$UPLOAD_ROOT/nested/d.txt"
if run_backup "$out"; then actual=0; else actual=$?; fi
[ "$actual" -eq 0 ]
assert_json_eq "$(final_dir)/recovery-manifest.txt" "data.uploadFileCount" "4"

if grep -E '\b(rm[[:space:]]+-rf[[:space:]]+"\$BACKUP_ROOT"|rm[[:space:]]+-rf[[:space:]]+\$BACKUP_ROOT|pg_restore[[:space:]].*>|tar[[:space:]]+-x|docker[[:space:]]+(stop|restart|rm|service[[:space:]]+update)|systemctl[[:space:]]+(enable|start|restart)|DELETE FROM|TRUNCATE|DROP DATABASE)\b' "$SCRIPT"; then
  printf 'Recovery backup script contains a prohibited destructive command pattern\n' >&2
  exit 1
fi

if grep -E 'uploadFileCount[" ]*[:=][" ]*28|row_count|expected_rows' "$SCRIPT"; then
  printf 'Recovery backup script appears to hard-code production counts or row counts\n' >&2
  exit 1
fi

printf 'fixzone_recovery_backup_test.sh: all checks passed\n'
