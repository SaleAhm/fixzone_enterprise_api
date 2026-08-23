#!/usr/bin/env bash
set -uo pipefail

API_HEALTH_URL="${FIXZONE_API_HEALTH_URL:-https://api.securezonegroup.com/api/health}"
API_TIMEOUT_SECONDS="${FIXZONE_API_TIMEOUT_SECONDS:-10}"
API_CONTAINER_PATTERN="${FIXZONE_API_CONTAINER_PATTERN:-fixzone.*api|api.*fixzone}"
API_CONTAINER_NAME="${FIXZONE_API_CONTAINER_NAME:-}"
HOST_UPLOAD_PATH="${FIXZONE_HOST_UPLOAD_PATH:-/srv/securezone-data/fixzone/uploads}"
CONTAINER_UPLOAD_PATH="${FIXZONE_CONTAINER_UPLOAD_PATH:-/app/uploads}"
CONTAINER_UPLOAD_MIRROR="${FIXZONE_CONTAINER_UPLOAD_MIRROR:-}"
EXPECTED_MOUNT_TYPE="${FIXZONE_EXPECTED_MOUNT_TYPE:-bind}"
BACKUP_ROOT="${FIXZONE_BACKUP_ROOT:-/srv/securezone-backups/manual}"
DISK_WARNING_FREE_PERCENT="${FIXZONE_UPLOAD_DISK_WARNING_FREE_PERCENT:-15}"
DISK_CRITICAL_FREE_PERCENT="${FIXZONE_UPLOAD_DISK_CRITICAL_FREE_PERCENT:-5}"
BACKUP_WARNING_HOURS="${FIXZONE_BACKUP_FRESHNESS_WARNING_HOURS:-}"
BACKUP_CRITICAL_HOURS="${FIXZONE_BACKUP_FRESHNESS_CRITICAL_HOURS:-}"
VERIFY_BACKUP_CHECKSUMS="${FIXZONE_VERIFY_BACKUP_CHECKSUMS:-false}"
RESTORE_REHEARSED="${FIXZONE_RESTORE_REHEARSED:-unknown}"
MONITOR_STATE_DIR="${FIXZONE_MONITOR_STATE_DIR:-/srv/securezone-ops/fixzone/state}"
MONITOR_ENVIRONMENT="${FIXZONE_MONITOR_ENVIRONMENT:-production}"
TEST_EXIT_AFTER_START_HEARTBEAT="${FIXZONE_TEST_EXIT_AFTER_START_HEARTBEAT:-false}"

safe_monitor_version_identifier() {
  local candidate="$1"
  case "$candidate" in
    ""|"."|".."|current|operations|scripts|bin|tmp|temp)
      return 1
      ;;
  esac
  [[ "$candidate" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$ ]]
}

resolve_script_path() {
  local script_path="${BASH_SOURCE[0]}"
  if command -v realpath >/dev/null 2>&1; then
    realpath "$script_path" 2>/dev/null && return 0
  fi
  if command -v readlink >/dev/null 2>&1; then
    readlink -f "$script_path" 2>/dev/null && return 0
  fi
  printf '%s\n' "$script_path"
}

derive_monitor_version() {
  local explicit="${FIXZONE_MONITOR_VERSION:-}"
  local resolved version_dir candidate physical_workdir

  if [ -n "$explicit" ]; then
    if safe_monitor_version_identifier "$explicit"; then
      printf '%s\n' "$explicit"
    else
      printf 'unknown\n'
    fi
    return
  fi

  resolved="$(resolve_script_path)"
  version_dir="$(dirname "$resolved")"
  candidate="$(basename "$version_dir")"
  if [ "$candidate" = "current" ] && command -v readlink >/dev/null 2>&1; then
    version_dir="$(readlink -f "$version_dir" 2>/dev/null || printf '%s\n' "$version_dir")"
    candidate="$(basename "$version_dir")"
  fi
  if [ "$candidate" = "current" ] && [ "$(basename "${PWD:-}")" = "current" ]; then
    physical_workdir="$(pwd -P 2>/dev/null || printf '%s\n' "${PWD:-}")"
    candidate="$(basename "$physical_workdir")"
  fi
  if safe_monitor_version_identifier "$candidate"; then
    printf '%s\n' "$candidate"
  else
    printf 'local\n'
  fi
}

MONITOR_VERSION="$(derive_monitor_version)"

RESULT_LINES=()
RESULT_KEYS=()
RESULT_STATES=()
RESULT_SUMMARIES=()
DETAIL_KEYS=()
DETAIL_VALUES=()
ALERT_LINES=()
ALERT_KEYS=()
ALERT_STATES=()
ALERT_SUMMARIES=()
OVERALL_STATE="HEALTHY"
DISCOVERED_CONTAINER=""
STARTED_AT=""
STATE_START_WRITE_FAILED=false
STATE_COMPLETE_WRITE_FAILED=false

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

state_rank() {
  case "$1" in
    CRITICAL) echo 3 ;;
    WARNING) echo 2 ;;
    UNKNOWN) echo 1 ;;
    *) echo 0 ;;
  esac
}

set_overall() {
  local state="$1"
  if [ "$(state_rank "$state")" -gt "$(state_rank "$OVERALL_STATE")" ]; then
    OVERALL_STATE="$state"
  fi
}

add_result() {
  local key="$1"
  local state="$2"
  local summary="$3"
  RESULT_LINES+=("${key}_state=${state}")
  RESULT_LINES+=("${key}_summary=${summary}")
  RESULT_KEYS+=("$key")
  RESULT_STATES+=("$state")
  RESULT_SUMMARIES+=("$summary")
  set_overall "$state"
}

add_detail() {
  RESULT_LINES+=("$1=$2")
  DETAIL_KEYS+=("$1")
  DETAIL_VALUES+=("$2")
}

add_alert() {
  local state="$1"
  local key="$2"
  local summary="$3"
  local i
  for i in "${!ALERT_KEYS[@]}"; do
    if [ "${ALERT_KEYS[$i]}" = "$key" ] && [ "${ALERT_STATES[$i]}" = "$state" ] && [ "${ALERT_SUMMARIES[$i]}" = "$summary" ]; then
      return
    fi
  done
  ALERT_KEYS+=("$key")
  ALERT_STATES+=("$state")
  ALERT_SUMMARIES+=("$summary")
  ALERT_LINES+=("alert=${state}:${key}:${summary}")
}

is_number() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

count_files() {
  local path="$1"
  if [ ! -d "$path" ]; then
    echo "0"
    return
  fi
  find "$path" -type f 2>/dev/null | wc -l | tr -d ' '
}

directory_size_bytes() {
  local path="$1"
  if [ ! -d "$path" ]; then
    echo "0"
    return
  fi
  du -sb "$path" 2>/dev/null | awk '{print $1}'
}

canary_count() {
  local path="$1"
  if [ ! -d "$path" ]; then
    echo "0"
    return
  fi
  find "$path" -type f -name '.fixzone-operational-health-canary-*' 2>/dev/null | wc -l | tr -d ' '
}

container_exec_count_files() {
  local container="$1"
  docker exec "$container" sh -c "find '$CONTAINER_UPLOAD_PATH' -type f 2>/dev/null | wc -l" 2>/dev/null | tr -d ' '
}

container_exec_size_bytes() {
  local container="$1"
  docker exec "$container" sh -c "du -sb '$CONTAINER_UPLOAD_PATH' 2>/dev/null | awk '{print \$1}'" 2>/dev/null | tr -d ' '
}

container_exec_canary_count() {
  local container="$1"
  docker exec "$container" sh -c "find '$CONTAINER_UPLOAD_PATH' -type f -name '.fixzone-operational-health-canary-*' 2>/dev/null | wc -l" 2>/dev/null | tr -d ' '
}

discover_container() {
  if [ -n "$API_CONTAINER_NAME" ]; then
    if docker inspect "$API_CONTAINER_NAME" >/dev/null 2>&1; then
      echo "$API_CONTAINER_NAME"
      return 0
    fi
    return 1
  fi

  docker ps --format '{{.ID}} {{.Names}}' 2>/dev/null |
    awk -v pattern="$API_CONTAINER_PATTERN" '$0 ~ pattern { print $1; exit }'
}

check_api() {
  if [ -n "${FIXZONE_TEST_API_OK+x}" ]; then
    if [ "$FIXZONE_TEST_API_OK" = "true" ]; then
      add_result "api" "HEALTHY" "public health endpoint reachable"
    else
      add_result "api" "CRITICAL" "public health endpoint unavailable"
      add_alert "CRITICAL" "api_unavailable" "API health endpoint unavailable"
    fi
    return
  fi

  if ! command_exists curl; then
    add_result "api" "UNKNOWN" "curl is unavailable"
    add_alert "UNKNOWN" "api_unavailable" "API health check unsupported because curl is unavailable"
    return
  fi
  if curl -fsS --max-time "$API_TIMEOUT_SECONDS" "$API_HEALTH_URL" >/dev/null 2>&1; then
    add_result "api" "HEALTHY" "public health endpoint reachable"
  else
    add_result "api" "CRITICAL" "public health endpoint unavailable"
    add_alert "CRITICAL" "api_unavailable" "API health endpoint unavailable"
  fi
}

check_service_and_mount() {
  if [ -n "${FIXZONE_TEST_SERVICE_RUNNING+x}" ] || [ -n "${FIXZONE_TEST_MOUNT_PRESENT+x}" ] || [ -n "${FIXZONE_TEST_MOUNT_SOURCE+x}" ]; then
    if [ "${FIXZONE_TEST_SERVICE_RUNNING:-true}" != "true" ]; then
      add_result "service" "CRITICAL" "FixZone API container/service not found"
      add_result "mount" "UNKNOWN" "mount identity unavailable without running API container"
      add_alert "CRITICAL" "service_missing" "FixZone API service not running or not discoverable"
      return
    fi

    DISCOVERED_CONTAINER="fixzone-api-test"
    add_result "service" "HEALTHY" "FixZone API container/service is running"
    if [ "${FIXZONE_TEST_MOUNT_PRESENT:-true}" = "true" ] &&
      [ "${FIXZONE_TEST_MOUNT_TYPE:-bind}" = "$EXPECTED_MOUNT_TYPE" ] &&
      [ "${FIXZONE_TEST_MOUNT_SOURCE:-$HOST_UPLOAD_PATH}" = "$HOST_UPLOAD_PATH" ] &&
      [ "${FIXZONE_TEST_MOUNT_DESTINATION:-$CONTAINER_UPLOAD_PATH}" = "$CONTAINER_UPLOAD_PATH" ]; then
      add_result "mount" "HEALTHY" "upload bind mount identity matches expected source and destination"
      add_detail "mount_source" "$HOST_UPLOAD_PATH"
      add_detail "mount_destination" "$CONTAINER_UPLOAD_PATH"
    else
      add_result "mount" "CRITICAL" "expected upload bind mount is missing or mismatched"
      add_alert "CRITICAL" "mount_invalid" "Upload bind mount identity mismatch"
    fi
    return
  fi

  if ! command_exists docker; then
    add_result "service" "UNKNOWN" "docker is unavailable"
    add_result "mount" "UNKNOWN" "docker mount identity check unavailable"
    add_alert "UNKNOWN" "service_unknown" "Docker access unavailable for service and mount checks"
    return
  fi

  local container
  container="$(discover_container)"
  if [ -z "$container" ]; then
    add_result "service" "CRITICAL" "FixZone API container/service not found"
    add_result "mount" "UNKNOWN" "mount identity unavailable without running API container"
    add_alert "CRITICAL" "service_missing" "FixZone API service not running or not discoverable"
    return
  fi

  DISCOVERED_CONTAINER="$container"
  add_result "service" "HEALTHY" "FixZone API container/service discovered"
  add_detail "service_container" "$container"

  local mounts
  mounts="$(docker inspect --format '{{range .Mounts}}{{printf "%s|%s|%s\n" .Type .Source .Destination}}{{end}}' "$container" 2>/dev/null)"
  if printf '%s\n' "$mounts" | awk -F'|' -v t="$EXPECTED_MOUNT_TYPE" -v s="$HOST_UPLOAD_PATH" -v d="$CONTAINER_UPLOAD_PATH" '$1 == t && $2 == s && $3 == d { found = 1 } END { exit found ? 0 : 1 }'; then
    add_result "mount" "HEALTHY" "expected upload bind mount is present"
    add_detail "mount_type" "$EXPECTED_MOUNT_TYPE"
    add_detail "mount_source" "$HOST_UPLOAD_PATH"
    add_detail "mount_destination" "$CONTAINER_UPLOAD_PATH"
  else
    add_result "mount" "CRITICAL" "expected upload bind mount is missing or mismatched"
    add_alert "CRITICAL" "mount_invalid" "Upload bind mount identity mismatch"
  fi

}

check_upload_consistency() {
  local container="$1"
  local host_count host_size container_count container_size
  host_count="$(count_files "$HOST_UPLOAD_PATH")"
  host_size="$(directory_size_bytes "$HOST_UPLOAD_PATH")"

  if [ -n "$CONTAINER_UPLOAD_MIRROR" ]; then
    container_count="$(count_files "$CONTAINER_UPLOAD_MIRROR")"
    container_size="$(directory_size_bytes "$CONTAINER_UPLOAD_MIRROR")"
  elif [ -n "$container" ]; then
    container_count="$(container_exec_count_files "$container")"
    container_size="$(container_exec_size_bytes "$container")"
  else
    container_count=""
    container_size=""
  fi

  add_detail "upload_host_count" "$host_count"
  add_detail "upload_host_size_bytes" "$host_size"
  add_detail "upload_container_count" "${container_count:-unknown}"
  add_detail "upload_container_size_bytes" "${container_size:-unknown}"

  if [ -z "$container_count" ] || [ -z "$container_size" ]; then
    add_result "upload_consistency" "UNKNOWN" "container upload view unavailable"
    add_alert "UNKNOWN" "upload_consistency_unknown" "Upload host/container comparison unavailable"
  elif [ "$host_count" = "$container_count" ] && [ "$host_size" = "$container_size" ]; then
    add_result "upload_consistency" "HEALTHY" "host and container upload counts and sizes match"
  else
    add_result "upload_consistency" "CRITICAL" "host and container upload counts or sizes differ"
    add_alert "CRITICAL" "upload_count_mismatch" "Host/container upload tree mismatch"
  fi
}

check_canary_residue() {
  local container="$1"
  local host_residue container_residue total
  host_residue="$(canary_count "$HOST_UPLOAD_PATH")"

  if [ -n "$CONTAINER_UPLOAD_MIRROR" ]; then
    container_residue="$(canary_count "$CONTAINER_UPLOAD_MIRROR")"
  elif [ -n "$container" ]; then
    container_residue="$(container_exec_canary_count "$container")"
  else
    container_residue="0"
  fi

  total=$((host_residue + container_residue))
  add_detail "canary_residue_host" "$host_residue"
  add_detail "canary_residue_container" "$container_residue"
  if [ "$total" -eq 0 ]; then
    add_result "canary_residue" "HEALTHY" "no operational-health canary residue found"
  else
    add_result "canary_residue" "WARNING" "operational-health canary residue found"
    add_alert "WARNING" "canary_residue" "Operational-health canary residue requires review"
  fi
}

check_disk() {
  if [ -n "${FIXZONE_TEST_DF_USED_PERCENT+x}" ]; then
    local used free
    used="$FIXZONE_TEST_DF_USED_PERCENT"
    if ! is_number "$used"; then
      add_result "disk" "UNKNOWN" "host disk capacity unavailable"
      add_alert "UNKNOWN" "disk_unknown" "Host disk capacity unavailable"
      return
    fi
    free=$((100 - used))
    add_detail "disk_free_percent" "$free"

    if [ "$free" -le "$DISK_CRITICAL_FREE_PERCENT" ]; then
      add_result "disk" "CRITICAL" "host upload filesystem free space is critical"
      add_alert "CRITICAL" "disk_critical" "Host upload filesystem free space is critical"
    elif [ "$free" -le "$DISK_WARNING_FREE_PERCENT" ]; then
      add_result "disk" "WARNING" "host upload filesystem free space is near threshold"
      add_alert "WARNING" "disk_warning" "Host upload filesystem free space is near warning threshold"
    else
      add_result "disk" "HEALTHY" "host upload filesystem free space is above configured thresholds"
    fi
    return
  fi

  if ! command_exists df; then
    add_result "disk" "UNKNOWN" "df is unavailable"
    add_alert "UNKNOWN" "disk_unknown" "Host disk capacity check unsupported"
    return
  fi

  local used free
  used="$(df -P "$HOST_UPLOAD_PATH" 2>/dev/null | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
  if ! is_number "$used"; then
    add_result "disk" "UNKNOWN" "host disk capacity unavailable"
    add_alert "UNKNOWN" "disk_unknown" "Host disk capacity unavailable"
    return
  fi

  free=$((100 - used))
  add_detail "disk_free_percent" "$free"
  add_detail "disk_warning_free_percent" "$DISK_WARNING_FREE_PERCENT"
  add_detail "disk_critical_free_percent" "$DISK_CRITICAL_FREE_PERCENT"

  if [ "$free" -le "$DISK_CRITICAL_FREE_PERCENT" ]; then
    add_result "disk" "CRITICAL" "host upload filesystem free space is critical"
    add_alert "CRITICAL" "disk_critical" "Host upload filesystem free space is critical"
  elif [ "$free" -le "$DISK_WARNING_FREE_PERCENT" ]; then
    add_result "disk" "WARNING" "host upload filesystem free space is near threshold"
    add_alert "WARNING" "disk_warning" "Host upload filesystem free space is near warning threshold"
  else
    add_result "disk" "HEALTHY" "host upload filesystem free space is above configured thresholds"
  fi
}

latest_recovery_set() {
  if [ ! -d "$BACKUP_ROOT" ]; then
    return 1
  fi
  find "$BACKUP_ROOT" -maxdepth 1 -type d \( -name 'fixzone-v1-baseline-*' -o -name 'fixzone-v1-backup-*' \) -printf '%T@ %p\n' 2>/dev/null |
    sort -nr |
    awk 'NR == 1 { sub(/^[^ ]+ /, ""); print }'
}

first_existing_file() {
  local root="$1"
  shift
  local name
  for name in "$@"; do
    if [ -s "$root/$name" ]; then
      echo "$name"
      return 0
    fi
  done
  return 1
}

file_age_hours() {
  local path="$1"
  local now modified
  now="$(date +%s)"
  modified="$(stat -c %Y "$path" 2>/dev/null || echo "")"
  if ! is_number "$modified"; then
    echo ""
    return
  fi
  echo $(((now - modified) / 3600))
}

check_durable_backup_verification() {
  local latest="$1"
  local status_file="$latest/verification-status.json"
  local expected_id actual_id schema_version state algorithm

  expected_id="$(basename "$latest")"
  add_detail "backup_recovery_set_id" "$expected_id"

  if [ ! -s "$status_file" ]; then
    add_result "backup_verification" "UNKNOWN" "durable verification status unavailable"
    add_alert "UNKNOWN" "backup_verification_unknown" "Recovery-set durable verification status unavailable"
    return
  fi

  schema_version="$(read_json_number_field "$status_file" "schemaVersion")"
  actual_id="$(read_json_string_field "$status_file" "recoverySetId")"
  state="$(read_json_string_field "$status_file" "state")"
  algorithm="$(read_json_string_field "$status_file" "checksumAlgorithm")"

  add_detail "backup_verification_status_artifact" "verification-status.json"
  add_detail "backup_verification_status_state" "${state:-unknown}"
  add_detail "backup_verification_checksum_algorithm" "${algorithm:-unknown}"

  if [ "$schema_version" != "1" ] || [ -z "$actual_id" ] || [ -z "$state" ]; then
    add_result "backup_verification" "WARNING" "durable verification status is malformed"
    add_alert "WARNING" "backup_verification_malformed" "Recovery-set durable verification status is malformed"
    return
  fi

  if [ "$actual_id" != "$expected_id" ]; then
    add_result "backup_verification" "CRITICAL" "durable verification status recovery-set id mismatch"
    add_alert "CRITICAL" "backup_verification_mismatch" "Recovery-set durable verification status id mismatch"
    return
  fi

  case "$state" in
    SUCCESS)
      if [ "$algorithm" = "sha256" ]; then
        add_result "backup_verification" "HEALTHY" "durable checksum verification metadata reports success"
      else
        add_result "backup_verification" "WARNING" "durable verification status uses unexpected checksum algorithm"
        add_alert "WARNING" "backup_verification_algorithm" "Recovery-set durable verification algorithm unexpected"
      fi
      ;;
    CRITICAL|INVALID|FAILED|PARTIAL_INVALID)
      add_result "backup_verification" "CRITICAL" "durable checksum verification metadata reports failure"
      add_alert "CRITICAL" "backup_verification_critical" "Recovery-set durable verification status failed"
      ;;
    UNKNOWN|"")
      add_result "backup_verification" "UNKNOWN" "durable checksum verification metadata is unknown"
      add_alert "UNKNOWN" "backup_verification_unknown" "Recovery-set durable verification status unknown"
      ;;
    *)
      add_result "backup_verification" "WARNING" "durable verification status is unrecognized"
      add_alert "WARNING" "backup_verification_unrecognized" "Recovery-set durable verification status unrecognized"
      ;;
  esac
}

check_backup() {
  local latest
  latest="$(latest_recovery_set)"
  if [ -z "$latest" ]; then
    add_result "backup_presence" "CRITICAL" "no FixZone recovery set found"
    add_result "backup_freshness" "UNKNOWN" "freshness unavailable because no recovery set was found"
    add_result "backup_verification" "UNKNOWN" "verification unavailable because no recovery set was found"
    add_result "restore_rehearsed" "UNKNOWN" "restore rehearsal evidence unavailable"
    add_alert "CRITICAL" "backup_missing" "No FixZone recovery set found"
    return
  fi

  add_detail "backup_latest_recovery_set" "$(basename "$latest")"

  local dump uploads checksum manifest missing
  dump="$(first_existing_file "$latest" "fixzone-postgres.dump" "fixzone-production.dump" || true)"
  uploads="$(first_existing_file "$latest" "fixzone-uploads.tar.gz" || true)"
  checksum="$(first_existing_file "$latest" "checksums.sha256" "SHA256SUMS" || true)"
  manifest="$(first_existing_file "$latest" "recovery-manifest.txt" "BACKUP_INFO.txt" || true)"
  missing=()
  [ -n "$dump" ] || missing+=("postgres_dump")
  [ -n "$uploads" ] || missing+=("uploads_archive")
  [ -n "$checksum" ] || missing+=("checksum_manifest")
  [ -n "$manifest" ] || missing+=("recovery_manifest")

  if [ "${#missing[@]}" -eq 0 ]; then
    add_result "backup_presence" "HEALTHY" "latest recovery set contains required V1 artifacts"
    add_detail "backup_dump_artifact" "$dump"
    add_detail "backup_uploads_artifact" "$uploads"
    add_detail "backup_checksum_artifact" "$checksum"
    add_detail "backup_manifest_artifact" "$manifest"
  else
    add_result "backup_presence" "CRITICAL" "latest recovery set is missing required artifacts: ${missing[*]}"
    add_alert "CRITICAL" "backup_missing" "Latest recovery set missing required artifacts"
  fi

  local age
  age="$(file_age_hours "$latest")"
  add_detail "backup_age_hours" "${age:-unknown}"
  if [ -z "$BACKUP_WARNING_HOURS" ] && [ -z "$BACKUP_CRITICAL_HOURS" ]; then
    add_result "backup_freshness" "UNKNOWN" "no approved backup freshness threshold is configured"
    add_alert "UNKNOWN" "backup_freshness_unknown" "Backup freshness threshold not configured"
  elif [ -z "$age" ]; then
    add_result "backup_freshness" "UNKNOWN" "backup age could not be determined"
    add_alert "UNKNOWN" "backup_freshness_unknown" "Backup age could not be determined"
  elif [ -n "$BACKUP_CRITICAL_HOURS" ] && [ "$age" -ge "$BACKUP_CRITICAL_HOURS" ]; then
    add_result "backup_freshness" "CRITICAL" "latest recovery set exceeds configured critical freshness threshold"
    add_alert "CRITICAL" "backup_freshness_critical" "Backup critical freshness threshold exceeded"
  elif [ -n "$BACKUP_WARNING_HOURS" ] && [ "$age" -ge "$BACKUP_WARNING_HOURS" ]; then
    add_result "backup_freshness" "WARNING" "latest recovery set exceeds configured warning freshness threshold"
    add_alert "WARNING" "backup_freshness_warning" "Backup warning freshness threshold exceeded"
  else
    add_result "backup_freshness" "HEALTHY" "latest recovery set is within configured freshness thresholds"
  fi

  if [ -z "$checksum" ]; then
    add_result "backup_verification" "UNKNOWN" "checksum verification unavailable without checksum manifest"
    add_alert "UNKNOWN" "backup_verification_unknown" "Recovery-set checksum manifest unavailable"
  else
    if [ "$VERIFY_BACKUP_CHECKSUMS" = "true" ]; then
      add_detail "backup_verification_runtime_rehash" "disabled"
    fi
    check_durable_backup_verification "$latest"
  fi

  if [ "$RESTORE_REHEARSED" = "true" ]; then
    add_result "restore_rehearsed" "HEALTHY" "restore rehearsal evidence explicitly supplied"
  elif [ -n "$manifest" ] && grep -Eiq 'RESTORE_REHEARSED=(true|pass)|Recovery rehearsal:[[:space:]]*PASS' "$latest/$manifest"; then
    add_result "restore_rehearsed" "HEALTHY" "restore rehearsal evidence found in recovery manifest"
  else
    add_result "restore_rehearsed" "UNKNOWN" "restore rehearsal evidence not available to this script"
  fi
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

json_field_or_null() {
  local name="$1"
  local value="$2"
  printf '  "%s": ' "$name"
  if [ -n "$value" ]; then
    json_string "$value"
  else
    printf 'null'
  fi
}

atomic_write_state_file() {
  local filename="$1"
  local target tmp
  if ! mkdir -p "$MONITOR_STATE_DIR" 2>/dev/null; then
    printf 'state_persistence_error=unable_to_create_state_directory\n' >&2
    return 1
  fi

  target="$MONITOR_STATE_DIR/$filename"
  tmp="$MONITOR_STATE_DIR/.$filename.$$.$RANDOM.tmp"
  if ! cat >"$tmp"; then
    rm -f "$tmp" 2>/dev/null || true
    printf 'state_persistence_error=unable_to_write_temp_file\n' >&2
    return 1
  fi
  chmod 0644 "$tmp" 2>/dev/null || true
  if ! mv -f "$tmp" "$target"; then
    rm -f "$tmp" 2>/dev/null || true
    printf 'state_persistence_error=unable_to_replace_state_file\n' >&2
    return 1
  fi
}

read_json_string_field() {
  local file="$1"
  local field="$2"
  if [ ! -f "$file" ]; then
    return
  fi
  sed -n "s/.*\"$field\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" "$file" 2>/dev/null | head -n 1
}

read_json_number_field() {
  local file="$1"
  local field="$2"
  if [ ! -f "$file" ]; then
    return
  fi
  sed -n "s/.*\"$field\"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p" "$file" 2>/dev/null | head -n 1
}

heartbeat_field() {
  local field="$1"
  read_json_string_field "$MONITOR_STATE_DIR/heartbeat.json" "$field"
}

heartbeat_number_field() {
  local field="$1"
  read_json_number_field "$MONITOR_STATE_DIR/heartbeat.json" "$field"
}

write_heartbeat() {
  local completed_at="${1:-}"
  local exit_code="${2:-}"
  local overall_state="${3:-}"
  local last_healthy last_warning last_critical last_unknown
  last_healthy="$(heartbeat_field "lastHealthyAt")"
  last_warning="$(heartbeat_field "lastWarningAt")"
  last_critical="$(heartbeat_field "lastCriticalAt")"
  last_unknown="$(heartbeat_field "lastUnknownAt")"

  if [ -z "$completed_at" ]; then
    completed_at="$(heartbeat_field "lastCompletedAt")"
  fi
  if [ -z "$exit_code" ]; then
    exit_code="$(heartbeat_number_field "lastExitCode")"
  fi
  if [ -z "$overall_state" ]; then
    overall_state="$(heartbeat_field "lastOverallState")"
  fi

  case "$overall_state" in
    HEALTHY) last_healthy="${completed_at:-$last_healthy}" ;;
    WARNING) last_warning="${completed_at:-$last_warning}" ;;
    CRITICAL) last_critical="${completed_at:-$last_critical}" ;;
    UNKNOWN) last_unknown="${completed_at:-$last_unknown}" ;;
  esac

  {
    printf '{\n'
    printf '  "schemaVersion": 1,\n'
    json_field_or_null "lastStartedAt" "$STARTED_AT"; printf ',\n'
    json_field_or_null "lastCompletedAt" "$completed_at"; printf ',\n'
    if [ -n "$exit_code" ]; then
      printf '  "lastExitCode": %s,\n' "$exit_code"
    else
      printf '  "lastExitCode": null,\n'
    fi
    json_field_or_null "lastOverallState" "$overall_state"; printf ',\n'
    json_field_or_null "monitorVersion" "$MONITOR_VERSION"; printf ',\n'
    json_field_or_null "lastHealthyAt" "$last_healthy"; printf ',\n'
    json_field_or_null "lastWarningAt" "$last_warning"; printf ',\n'
    json_field_or_null "lastCriticalAt" "$last_critical"; printf ',\n'
    json_field_or_null "lastUnknownAt" "$last_unknown"; printf '\n'
    printf '}\n'
  } | atomic_write_state_file "heartbeat.json"
}

start_heartbeat() {
  STARTED_AT="$(timestamp)"
  if ! write_heartbeat "" "" ""; then
    STATE_START_WRITE_FAILED=true
  fi
}

result_state_for() {
  local key="$1"
  local i
  for i in "${!RESULT_KEYS[@]}"; do
    if [ "${RESULT_KEYS[$i]}" = "$key" ]; then
      printf '%s' "${RESULT_STATES[$i]}"
      return
    fi
  done
  printf 'UNKNOWN'
}

result_summary_for() {
  local key="$1"
  local i
  for i in "${!RESULT_KEYS[@]}"; do
    if [ "${RESULT_KEYS[$i]}" = "$key" ]; then
      printf '%s' "${RESULT_SUMMARIES[$i]}"
      return
    fi
  done
  printf 'not checked'
}

json_check_name() {
  case "$1" in
    upload_consistency) printf 'uploadConsistency' ;;
    canary_residue) printf 'canaryResidue' ;;
    backup_presence) printf 'backupPresence' ;;
    backup_freshness) printf 'backupFreshness' ;;
    backup_verification) printf 'backupVerification' ;;
    restore_rehearsed) printf 'restoreRehearsal' ;;
    *) printf '%s' "$1" ;;
  esac
}

write_check_json() {
  local key="$1"
  local name state summary
  name="$(json_check_name "$key")"
  state="$(result_state_for "$key")"
  summary="$(result_summary_for "$key")"
  printf '    "%s": { "state": ' "$name"
  json_string "$state"
  printf ', "summary": '
  json_string "$summary"
  printf ' }'
}

write_details_json() {
  local i
  printf '  "details": {\n'
  for i in "${!DETAIL_KEYS[@]}"; do
    printf '    "%s": ' "${DETAIL_KEYS[$i]}"
    json_string "${DETAIL_VALUES[$i]}"
    if [ "$i" -lt $((${#DETAIL_KEYS[@]} - 1)) ]; then
      printf ','
    fi
    printf '\n'
  done
  printf '  }'
}

exit_code_for_state() {
  case "$1" in
    HEALTHY) printf '0' ;;
    WARNING) printf '1' ;;
    CRITICAL) printf '2' ;;
    UNKNOWN) printf '3' ;;
    *) printf '3' ;;
  esac
}

write_latest_status() {
  local completed_at="$1"
  local exit_code="$2"
  local checks=(api service mount upload_consistency canary_residue disk backup_presence backup_freshness backup_verification restore_rehearsed)
  local i key
  {
    printf '{\n'
    printf '  "schemaVersion": 1,\n'
    json_field_or_null "timestamp" "$completed_at"; printf ',\n'
    json_field_or_null "completedAt" "$completed_at"; printf ',\n'
    json_field_or_null "monitorVersion" "$MONITOR_VERSION"; printf ',\n'
    json_field_or_null "environment" "$MONITOR_ENVIRONMENT"; printf ',\n'
    json_field_or_null "overallState" "$OVERALL_STATE"; printf ',\n'
    printf '  "exitCode": %s,\n' "$exit_code"
    printf '  "checks": {\n'
    for i in "${!checks[@]}"; do
      key="${checks[$i]}"
      write_check_json "$key"
      if [ "$i" -lt $((${#checks[@]} - 1)) ]; then
        printf ','
      fi
      printf '\n'
    done
    printf '  },\n'
    write_details_json
    printf ',\n'
    printf '  "alerts": [\n'
    for i in "${!ALERT_KEYS[@]}"; do
      printf '    { "state": '
      json_string "${ALERT_STATES[$i]}"
      printf ', "key": '
      json_string "${ALERT_KEYS[$i]}"
      printf ', "summary": '
      json_string "${ALERT_SUMMARIES[$i]}"
      printf ' }'
      if [ "$i" -lt $((${#ALERT_KEYS[@]} - 1)) ]; then
        printf ','
      fi
      printf '\n'
    done
    printf '  ]\n'
    printf '}\n'
  } | atomic_write_state_file "latest-status.json"
}

persist_completed_state() {
  local completed_at exit_code
  completed_at="$(timestamp)"
  exit_code="$(exit_code_for_state "$OVERALL_STATE")"

  if ! write_latest_status "$completed_at" "$exit_code"; then
    STATE_COMPLETE_WRITE_FAILED=true
  fi
  if ! write_heartbeat "$completed_at" "$exit_code" "$OVERALL_STATE"; then
    STATE_COMPLETE_WRITE_FAILED=true
  fi
}

emit_output() {
  local now
  now="$(timestamp)"
  printf 'FixZone external operational host check\n'
  printf 'timestamp=%s\n' "$now"
  printf 'overall_state=%s\n' "$OVERALL_STATE"
  printf 'auto_remediation=false\n'
  printf 'backup_semantics=BACKUP_PRESENT,BACKUP_STRUCTURALLY_VERIFIED,RESTORE_REHEARSED\n'
  local line
  for line in "${RESULT_LINES[@]}"; do
    printf '%s\n' "$line"
  done
  if [ "${#ALERT_LINES[@]}" -eq 0 ]; then
    printf 'alerts=none\n'
  else
    for line in "${ALERT_LINES[@]}"; do
      printf '%s\n' "$line"
    done
  fi
  if [ "$STATE_START_WRITE_FAILED" = "true" ] || [ "$STATE_COMPLETE_WRITE_FAILED" = "true" ]; then
    printf 'state_persistence_state=WARNING\n'
    printf 'state_persistence_summary=monitor state file persistence failed; latest completed heartbeat may be unavailable\n'
  fi
}

exit_for_state() {
  if { [ "$STATE_START_WRITE_FAILED" = "true" ] || [ "$STATE_COMPLETE_WRITE_FAILED" = "true" ]; } && [ "$OVERALL_STATE" = "HEALTHY" ]; then
    exit 1
  fi
  case "$OVERALL_STATE" in
    HEALTHY) exit 0 ;;
    WARNING) exit 1 ;;
    CRITICAL) exit 2 ;;
    UNKNOWN) exit 3 ;;
    *) exit 3 ;;
  esac
}

main() {
  start_heartbeat
  if [ "$TEST_EXIT_AFTER_START_HEARTBEAT" = "true" ]; then
    exit 130
  fi
  check_api
  check_service_and_mount
  check_upload_consistency "$DISCOVERED_CONTAINER"
  check_canary_residue "$DISCOVERED_CONTAINER"
  check_disk
  check_backup
  persist_completed_state
  emit_output
  exit_for_state
}

main "$@"
