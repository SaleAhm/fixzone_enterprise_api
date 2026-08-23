#!/usr/bin/env bash
set -uo pipefail

BACKUP_ROOT="${FIXZONE_BACKUP_ROOT:-/srv/securezone-backups/manual}"
UPLOAD_ROOT="${FIXZONE_UPLOAD_ROOT:-/srv/securezone-data/fixzone/uploads}"
ENVIRONMENT="${FIXZONE_BACKUP_ENVIRONMENT:-production}"
APP_VERSION="${FIXZONE_APP_VERSION:-unknown}"
BACKEND_COMMIT="${FIXZONE_BACKEND_COMMIT:-unknown}"
FRONTEND_COMMIT="${FIXZONE_FRONTEND_COMMIT:-unknown}"
PG_DUMP_BIN="${FIXZONE_PG_DUMP_BIN:-pg_dump}"
PG_RESTORE_BIN="${FIXZONE_PG_RESTORE_BIN:-pg_restore}"
POSTGRES_MODE="${FIXZONE_POSTGRES_MODE:-host}"
POSTGRES_SERVICE="${FIXZONE_POSTGRES_SERVICE:-}"
POSTGRES_DATABASE="${FIXZONE_POSTGRES_DATABASE:-}"
POSTGRES_EXPECTED_MAJOR="${FIXZONE_POSTGRES_EXPECTED_MAJOR:-}"
DOCKER_BIN="${FIXZONE_DOCKER_BIN:-docker}"
TAR_BIN="${FIXZONE_TAR_BIN:-tar}"
SHA256SUM_BIN="${FIXZONE_SHA256SUM_BIN:-sha256sum}"
DF_BIN="${FIXZONE_DF_BIN:-df}"
DU_BIN="${FIXZONE_DU_BIN:-du}"
FIND_BIN="${FIXZONE_FIND_BIN:-find}"
FLOCK_BIN="${FIXZONE_FLOCK_BIN:-flock}"
MIN_FREE_KB="${FIXZONE_BACKUP_MIN_FREE_KB:-}"
SAFETY_MARGIN_KB="${FIXZONE_BACKUP_SAFETY_MARGIN_KB:-102400}"
LOCK_FILE="${FIXZONE_BACKUP_LOCK_FILE:-$BACKUP_ROOT/.fixzone_recovery_backup.lock}"

STARTED_AT=""
RECOVERY_SET_ID=""
IN_PROGRESS_DIR=""
FINAL_DIR=""
FAILED_DIR=""
LOCK_ACQUIRED=false
LOCK_MODE=""
LOCK_DIR=""
POSTGRES_CONTAINER=""
PG_DUMP_VERSION="unknown"
PG_RESTORE_VERSION="unknown"

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

timestamp_for_id() {
  date -u +"%Y-%m-%d_%H-%M-%S"
}

log() {
  printf '%s\n' "$*"
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

json_string() {
  printf '"%s"' "$(json_escape "$1")"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

release_lock() {
  if [ "$LOCK_ACQUIRED" != "true" ]; then
    return
  fi
  if [ "$LOCK_MODE" = "mkdir" ] && [ -n "$LOCK_DIR" ] && [ -d "$LOCK_DIR" ]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}

trap release_lock EXIT

is_number() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

path_is_absolute() {
  case "$1" in
    /*|[A-Za-z]:/*|[A-Za-z]:\\*) return 0 ;;
    *) return 1 ;;
  esac
}

validate_root_path() {
  local path="$1"
  if [ -z "$path" ] || [ "$path" = "/" ] || [ "$path" = "." ] || [ "$path" = ".." ]; then
    fail "backup root path is unsafe"
    return 1
  fi
  if ! path_is_absolute "$path"; then
    fail "backup root path must be absolute"
    return 1
  fi
}

validate_set_paths() {
  local root="$1"
  local in_progress="$2"
  local final="$3"
  case "$(basename "$in_progress")" in
    .fixzone-v1-backup-*.in-progress) ;;
    *)
      fail "in-progress directory name is unsafe"
      return 1
      ;;
  esac
  case "$(basename "$final")" in
    fixzone-v1-backup-*) ;;
    *)
      fail "final recovery-set directory name is unsafe"
      return 1
      ;;
  esac
  case "$in_progress" in
    "$root"/*) ;;
    *)
      fail "in-progress path escapes backup root"
      return 1
      ;;
  esac
  case "$final" in
    "$root"/*) ;;
    *)
      fail "final path escapes backup root"
      return 1
      ;;
  esac
}

file_size_bytes() {
  local path="$1"
  wc -c <"$path" 2>/dev/null | tr -d ' '
}

file_count_excluding_canary() {
  if [ ! -d "$UPLOAD_ROOT" ]; then
    echo "0"
    return
  fi
  "$FIND_BIN" "$UPLOAD_ROOT" -type f ! -name '.fixzone-operational-health-canary-*' 2>/dev/null |
    wc -l |
    tr -d ' '
}

canary_residue_count() {
  if [ ! -d "$UPLOAD_ROOT" ]; then
    echo "0"
    return
  fi
  "$FIND_BIN" "$UPLOAD_ROOT" -type f -name '.fixzone-operational-health-canary-*' 2>/dev/null |
    wc -l |
    tr -d ' '
}

write_upload_listing() {
  local target="$1"
  if [ ! -d "$UPLOAD_ROOT" ]; then
    return 1
  fi
  (
    cd "$UPLOAD_ROOT" &&
      "$FIND_BIN" . -type f ! -name '.fixzone-operational-health-canary-*' -print 2>/dev/null |
      sed 's#^\./##' |
      LC_ALL=C sort
  ) >"$target"
}

ensure_capacity() {
  local backup_root="$1"
  local upload_kb free_kb required_kb

  if [ ! -d "$UPLOAD_ROOT" ]; then
    fail "upload source does not exist: $UPLOAD_ROOT"
    return 1
  fi

  upload_kb="$("$DU_BIN" -sk "$UPLOAD_ROOT" 2>/dev/null | awk '{print $1}')"
  free_kb="$("$DF_BIN" -Pk "$backup_root" 2>/dev/null | awk 'NR == 2 {print $4}')"
  if ! is_number "$upload_kb" || ! is_number "$free_kb"; then
    fail "unable to determine upload size or backup filesystem free space"
    return 1
  fi

  if [ -n "$MIN_FREE_KB" ]; then
    if ! is_number "$MIN_FREE_KB"; then
      fail "FIXZONE_BACKUP_MIN_FREE_KB must be numeric"
      return 1
    fi
    required_kb="$MIN_FREE_KB"
  else
    required_kb=$((upload_kb * 2 + SAFETY_MARGIN_KB))
  fi

  if [ "$free_kb" -lt "$required_kb" ]; then
    fail "insufficient free space for backup preflight: required ${required_kb}KB, available ${free_kb}KB"
    return 1
  fi

  log "capacity_preflight=PASS required_kb=$required_kb available_kb=$free_kb upload_kb=$upload_kb"
}

write_failure_status() {
  local reason="$1"
  local completed_at
  completed_at="$(timestamp)"
  if [ -n "$IN_PROGRESS_DIR" ] && [ -d "$IN_PROGRESS_DIR" ]; then
    {
      printf '{\n'
      printf '  "schemaVersion": 1,\n'
      printf '  "recoverySetId": %s,\n' "$(json_string "$RECOVERY_SET_ID")"
      printf '  "verifiedAt": %s,\n' "$(json_string "$completed_at")"
      printf '  "state": "CRITICAL",\n'
      printf '  "checksumAlgorithm": "sha256",\n'
      printf '  "reason": %s,\n' "$(json_string "$reason")"
      printf '  "artifacts": []\n'
      printf '}\n'
    } >"$IN_PROGRESS_DIR/verification-status.json" 2>/dev/null || true
    {
      printf 'recoverySetId=%s\n' "$RECOVERY_SET_ID"
      printf 'startedAt=%s\n' "$STARTED_AT"
      printf 'completedAt=%s\n' "$completed_at"
      printf 'state=CRITICAL\n'
      printf 'reason=%s\n' "$reason"
      printf 'published=false\n'
    } >"$IN_PROGRESS_DIR/failure-summary.txt" 2>/dev/null || true
    if validate_set_paths "$BACKUP_ROOT" "$IN_PROGRESS_DIR" "$FINAL_DIR" >/dev/null 2>&1; then
      FAILED_DIR="$BACKUP_ROOT/.$RECOVERY_SET_ID.failed"
      if [ ! -e "$FAILED_DIR" ]; then
        mv "$IN_PROGRESS_DIR" "$FAILED_DIR" 2>/dev/null || true
      fi
    fi
  fi
}

die() {
  local message="$1"
  fail "$message"
  write_failure_status "$message"
  exit 1
}

acquire_lock() {
  if command_exists "$FLOCK_BIN"; then
    exec 9>"$LOCK_FILE" || die "unable to open backup lock file"
    if ! "$FLOCK_BIN" -n 9; then
      fail "another FixZone recovery backup is already running"
      exit 75
    fi
    LOCK_ACQUIRED=true
    LOCK_MODE="flock"
    return
  fi

  LOCK_DIR="$LOCK_FILE.lockdir"
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    LOCK_ACQUIRED=true
    LOCK_MODE="mkdir"
    return
  fi

  fail "another FixZone recovery backup is already running"
  exit 75
}

require_supported_postgres_mode() {
  case "$POSTGRES_MODE" in
    host|docker-swarm) ;;
    *)
      die "unsupported FIXZONE_POSTGRES_MODE: $POSTGRES_MODE"
      ;;
  esac
}

read_command_version() {
  local mode="$1"
  local container="$2"
  local tool="$3"
  local version

  if [ "$mode" = "docker-swarm" ]; then
    version="$("$DOCKER_BIN" exec "$container" "/usr/bin/$tool" --version 2>/dev/null || true)"
  else
    version="$("$tool" --version 2>/dev/null || true)"
  fi
  printf '%s' "${version:-unknown}"
}

postgres_major_from_version() {
  printf '%s\n' "$1" | sed -n 's/.*PostgreSQL) \([0-9][0-9]*\).*/\1/p' | head -n 1
}

validate_postgres_version_if_configured() {
  local version="$1"
  local major
  if [ -z "$POSTGRES_EXPECTED_MAJOR" ]; then
    return
  fi
  if ! is_number "$POSTGRES_EXPECTED_MAJOR"; then
    die "FIXZONE_POSTGRES_EXPECTED_MAJOR must be numeric"
  fi
  major="$(postgres_major_from_version "$version")"
  if [ "$major" != "$POSTGRES_EXPECTED_MAJOR" ]; then
    die "PostgreSQL tool major version mismatch"
  fi
}

resolve_swarm_postgres_container() {
  if [ -z "$POSTGRES_SERVICE" ]; then
    die "FIXZONE_POSTGRES_SERVICE is required for docker-swarm mode"
  fi
  if ! command_exists "$DOCKER_BIN"; then
    die "docker is unavailable for docker-swarm PostgreSQL mode"
  fi

  local matches count container label
  matches="$("$DOCKER_BIN" ps \
    --filter "label=com.docker.swarm.service.name=$POSTGRES_SERVICE" \
    --filter "status=running" \
    --format '{{.ID}}' 2>/dev/null || true)"
  count="$(printf '%s\n' "$matches" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')"
  if [ "$count" -eq 0 ]; then
    die "no running PostgreSQL task found for configured Swarm service"
  fi
  if [ "$count" -gt 1 ]; then
    die "multiple running PostgreSQL tasks found for configured Swarm service"
  fi

  container="$(printf '%s\n' "$matches" | sed '/^[[:space:]]*$/d' | head -n 1)"
  label="$("$DOCKER_BIN" inspect --format '{{ index .Config.Labels "com.docker.swarm.service.name" }}' "$container" 2>/dev/null || true)"
  if [ "$label" != "$POSTGRES_SERVICE" ]; then
    die "resolved PostgreSQL task service-name label mismatch"
  fi

  POSTGRES_CONTAINER="$container"
}

prepare_postgres_execution() {
  require_supported_postgres_mode
  if [ "$POSTGRES_MODE" = "docker-swarm" ]; then
    resolve_swarm_postgres_container
    PG_DUMP_VERSION="$(read_command_version "$POSTGRES_MODE" "$POSTGRES_CONTAINER" "pg_dump")"
    PG_RESTORE_VERSION="$(read_command_version "$POSTGRES_MODE" "$POSTGRES_CONTAINER" "pg_restore")"
  else
    PG_DUMP_VERSION="$(read_command_version "$POSTGRES_MODE" "" "$PG_DUMP_BIN")"
    PG_RESTORE_VERSION="$(read_command_version "$POSTGRES_MODE" "" "$PG_RESTORE_BIN")"
  fi
  validate_postgres_version_if_configured "$PG_DUMP_VERSION"
}

run_pg_dump_to_host_file() {
  local dump_path="$1"
  if [ "$POSTGRES_MODE" = "docker-swarm" ]; then
    if [ -n "$POSTGRES_DATABASE" ]; then
      "$DOCKER_BIN" exec "$POSTGRES_CONTAINER" /usr/bin/pg_dump --format=custom --dbname "$POSTGRES_DATABASE" >"$dump_path"
    else
      "$DOCKER_BIN" exec "$POSTGRES_CONTAINER" /usr/bin/pg_dump --format=custom >"$dump_path"
    fi
    return
  fi

  if [ -n "$POSTGRES_DATABASE" ]; then
    "$PG_DUMP_BIN" --format=custom --file "$dump_path" --dbname "$POSTGRES_DATABASE"
  else
    "$PG_DUMP_BIN" --format=custom --file "$dump_path"
  fi
}

run_pg_restore_list_to_host_file() {
  local dump_path="$1"
  local toc_path="$2"
  if [ "$POSTGRES_MODE" = "docker-swarm" ]; then
    "$DOCKER_BIN" exec -i "$POSTGRES_CONTAINER" /usr/bin/pg_restore --list <"$dump_path" >"$toc_path"
    return
  fi

  "$PG_RESTORE_BIN" --list "$dump_path" >"$toc_path"
}

write_manifest() {
  local target="$1"
  local completed_at="$2"
  local dump_size="$3"
  local uploads_size="$4"
  local upload_count="$5"
  local canary_count="$6"
  {
    printf '{\n'
    printf '  "schemaVersion": 1,\n'
    printf '  "recoverySetId": %s,\n' "$(json_string "$RECOVERY_SET_ID")"
    printf '  "startedAt": %s,\n' "$(json_string "$STARTED_AT")"
    printf '  "completedAt": %s,\n' "$(json_string "$completed_at")"
    printf '  "environment": %s,\n' "$(json_string "$ENVIRONMENT")"
    printf '  "state": "SUCCESS",\n'
    printf '  "backupState": "SUCCESS",\n'
    printf '  "checksumVerificationState": "SUCCESS",\n'
    printf '  "appVersion": %s,\n' "$(json_string "$APP_VERSION")"
    printf '  "backendCommit": %s,\n' "$(json_string "$BACKEND_COMMIT")"
    printf '  "frontendCommit": %s,\n' "$(json_string "$FRONTEND_COMMIT")"
    printf '  "postgresMode": %s,\n' "$(json_string "$POSTGRES_MODE")"
    printf '  "postgresService": %s,\n' "$(json_string "$POSTGRES_SERVICE")"
    printf '  "postgresDatabase": %s,\n' "$(json_string "$POSTGRES_DATABASE")"
    printf '  "pgDumpVersion": %s,\n' "$(json_string "$PG_DUMP_VERSION")"
    printf '  "pgRestoreVersion": %s,\n' "$(json_string "$PG_RESTORE_VERSION")"
    printf '  "uploadSource": %s,\n' "$(json_string "$UPLOAD_ROOT")"
    printf '  "containerUploadDestination": "/app/uploads",\n'
    printf '  "uploadFileCount": %s,\n' "$upload_count"
    printf '  "canaryResidueCount": %s,\n' "$canary_count"
    if [ "$canary_count" -gt 0 ]; then
      printf '  "canaryResidueState": "WARNING",\n'
    else
      printf '  "canaryResidueState": "HEALTHY",\n'
    fi
    printf '  "artifacts": [\n'
    printf '    {"name": "fixzone-postgres.dump", "type": "postgres-custom-dump", "sizeBytes": %s},\n' "$dump_size"
    printf '    {"name": "fixzone-uploads.tar.gz", "type": "uploads-archive", "sizeBytes": %s},\n' "$uploads_size"
    printf '    {"name": "database-toc.txt", "type": "postgres-toc"},\n'
    printf '    {"name": "uploads-list.txt", "type": "uploads-list"},\n'
    printf '    {"name": "checksums.sha256", "type": "checksum-manifest"},\n'
    printf '    {"name": "verification-status.json", "type": "durable-verification-status"}\n'
    printf '  ]\n'
    printf '}\n'
  } >"$target"
}

write_verification_status() {
  local target="$1"
  local verified_at="$2"
  {
    printf '{\n'
    printf '  "schemaVersion": 1,\n'
    printf '  "recoverySetId": %s,\n' "$(json_string "$RECOVERY_SET_ID")"
    printf '  "verifiedAt": %s,\n' "$(json_string "$verified_at")"
    printf '  "state": "SUCCESS",\n'
    printf '  "checksumAlgorithm": "sha256",\n'
    printf '  "artifacts": [\n'
    printf '    {"name": "fixzone-postgres.dump", "state": "SUCCESS"},\n'
    printf '    {"name": "fixzone-uploads.tar.gz", "state": "SUCCESS"},\n'
    printf '    {"name": "database-toc.txt", "state": "SUCCESS"},\n'
    printf '    {"name": "uploads-list.txt", "state": "SUCCESS"},\n'
    printf '    {"name": "recovery-manifest.txt", "state": "SUCCESS"}\n'
    printf '  ]\n'
    printf '}\n'
  } >"$target"
}

main() {
  STARTED_AT="$(timestamp)"
  local id_timestamp
  id_timestamp="${FIXZONE_BACKUP_TIMESTAMP:-$(timestamp_for_id)}"
  RECOVERY_SET_ID="${FIXZONE_BACKUP_ID:-fixzone-v1-backup-$id_timestamp}"
  IN_PROGRESS_DIR="$BACKUP_ROOT/.$RECOVERY_SET_ID.in-progress"
  FINAL_DIR="$BACKUP_ROOT/$RECOVERY_SET_ID"

  case "$RECOVERY_SET_ID" in
    fixzone-v1-backup-*) ;;
    *) die "recovery set id must start with fixzone-v1-backup-" ;;
  esac

  validate_root_path "$BACKUP_ROOT" || exit 1
  mkdir -p "$BACKUP_ROOT" || die "unable to create backup root"
  validate_set_paths "$BACKUP_ROOT" "$IN_PROGRESS_DIR" "$FINAL_DIR" || exit 1

  acquire_lock

  if [ -e "$FINAL_DIR" ] || [ -e "$IN_PROGRESS_DIR" ] || [ -e "$BACKUP_ROOT/.$RECOVERY_SET_ID.failed" ]; then
    die "recovery set path already exists; refusing to overwrite"
  fi

  ensure_capacity "$BACKUP_ROOT" || exit 1

  mkdir "$IN_PROGRESS_DIR" || die "unable to create in-progress recovery set"

  local dump_path uploads_path toc_path upload_list manifest_path checksums_path verification_path
  dump_path="$IN_PROGRESS_DIR/fixzone-postgres.dump"
  uploads_path="$IN_PROGRESS_DIR/fixzone-uploads.tar.gz"
  toc_path="$IN_PROGRESS_DIR/database-toc.txt"
  upload_list="$IN_PROGRESS_DIR/uploads-list.txt"
  manifest_path="$IN_PROGRESS_DIR/recovery-manifest.txt"
  checksums_path="$IN_PROGRESS_DIR/checksums.sha256"
  verification_path="$IN_PROGRESS_DIR/verification-status.json"

  prepare_postgres_execution

  run_pg_dump_to_host_file "$dump_path" || die "pg_dump failed"
  if [ ! -s "$dump_path" ]; then
    die "PostgreSQL dump is missing or zero bytes"
  fi

  run_pg_restore_list_to_host_file "$dump_path" "$toc_path" || die "pg_restore TOC listing failed"
  if [ ! -s "$toc_path" ]; then
    die "database TOC listing is missing or zero bytes"
  fi
  if ! grep -Eiq 'TABLE|TABLE DATA|SCHEMA|DATABASE|EXTENSION' "$toc_path"; then
    die "database TOC listing lacks expected structural indicators"
  fi

  write_upload_listing "$upload_list" || die "unable to list upload source"
  "$TAR_BIN" -czf "$uploads_path" --exclude='.fixzone-operational-health-canary-*' -C "$UPLOAD_ROOT" . ||
    die "uploads archive creation failed"
  if [ ! -s "$uploads_path" ]; then
    die "uploads archive is missing or zero bytes"
  fi

  local completed_at dump_size uploads_size upload_count canary_count
  completed_at="$(timestamp)"
  dump_size="$(file_size_bytes "$dump_path")"
  uploads_size="$(file_size_bytes "$uploads_path")"
  upload_count="$(file_count_excluding_canary)"
  canary_count="$(canary_residue_count)"
  write_manifest "$manifest_path" "$completed_at" "$dump_size" "$uploads_size" "$upload_count" "$canary_count" ||
    die "unable to write recovery manifest"

  (
    cd "$IN_PROGRESS_DIR" &&
      "$SHA256SUM_BIN" fixzone-postgres.dump fixzone-uploads.tar.gz database-toc.txt uploads-list.txt recovery-manifest.txt >checksums.sha256
  ) || die "checksum manifest generation failed"

  if ! (cd "$IN_PROGRESS_DIR" && "$SHA256SUM_BIN" -c "$(basename "$checksums_path")" >/dev/null); then
    die "checksum verification failed"
  fi

  write_verification_status "$verification_path" "$(timestamp)" || die "unable to write verification status"
  mv "$IN_PROGRESS_DIR" "$FINAL_DIR" || die "unable to publish completed recovery set"
  log "recovery_backup_state=SUCCESS"
  log "recovery_set=$FINAL_DIR"
}

main "$@"
