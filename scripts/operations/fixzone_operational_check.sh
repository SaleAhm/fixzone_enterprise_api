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

RESULT_LINES=()
ALERT_LINES=()
OVERALL_STATE="HEALTHY"
DISCOVERED_CONTAINER=""

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
  set_overall "$state"
}

add_detail() {
  RESULT_LINES+=("$1=$2")
}

add_alert() {
  local state="$1"
  local message="$2"
  ALERT_LINES+=("alert=${state}:${message}")
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
  if ! command_exists curl; then
    add_result "api" "UNKNOWN" "curl is unavailable"
    add_alert "UNKNOWN" "API health check unsupported because curl is unavailable"
    return
  fi
  if curl -fsS --max-time "$API_TIMEOUT_SECONDS" "$API_HEALTH_URL" >/dev/null 2>&1; then
    add_result "api" "HEALTHY" "public health endpoint reachable"
  else
    add_result "api" "CRITICAL" "public health endpoint unavailable"
    add_alert "CRITICAL" "API health endpoint unavailable"
  fi
}

check_service_and_mount() {
  if ! command_exists docker; then
    add_result "service" "UNKNOWN" "docker is unavailable"
    add_result "mount" "UNKNOWN" "docker mount identity check unavailable"
    add_alert "UNKNOWN" "Docker access unavailable for service and mount checks"
    return
  fi

  local container
  container="$(discover_container)"
  if [ -z "$container" ]; then
    add_result "service" "CRITICAL" "FixZone API container/service not found"
    add_result "mount" "UNKNOWN" "mount identity unavailable without running API container"
    add_alert "CRITICAL" "FixZone API service not running or not discoverable"
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
    add_alert "CRITICAL" "Upload bind mount identity mismatch"
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
    add_alert "UNKNOWN" "Upload host/container comparison unavailable"
  elif [ "$host_count" = "$container_count" ] && [ "$host_size" = "$container_size" ]; then
    add_result "upload_consistency" "HEALTHY" "host and container upload counts and sizes match"
  else
    add_result "upload_consistency" "CRITICAL" "host and container upload counts or sizes differ"
    add_alert "CRITICAL" "Host/container upload tree mismatch"
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
    add_alert "WARNING" "Operational-health canary residue requires review"
  fi
}

check_disk() {
  if ! command_exists df; then
    add_result "disk" "UNKNOWN" "df is unavailable"
    add_alert "UNKNOWN" "Host disk capacity check unsupported"
    return
  fi

  local used free
  used="$(df -P "$HOST_UPLOAD_PATH" 2>/dev/null | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
  if ! is_number "$used"; then
    add_result "disk" "UNKNOWN" "host disk capacity unavailable"
    add_alert "UNKNOWN" "Host disk capacity unavailable"
    return
  fi

  free=$((100 - used))
  add_detail "disk_free_percent" "$free"
  add_detail "disk_warning_free_percent" "$DISK_WARNING_FREE_PERCENT"
  add_detail "disk_critical_free_percent" "$DISK_CRITICAL_FREE_PERCENT"

  if [ "$free" -le "$DISK_CRITICAL_FREE_PERCENT" ]; then
    add_result "disk" "CRITICAL" "host upload filesystem free space is critical"
    add_alert "CRITICAL" "Host upload filesystem free space is critical"
  elif [ "$free" -le "$DISK_WARNING_FREE_PERCENT" ]; then
    add_result "disk" "WARNING" "host upload filesystem free space is near threshold"
    add_alert "WARNING" "Host upload filesystem free space is near warning threshold"
  else
    add_result "disk" "HEALTHY" "host upload filesystem free space is above configured thresholds"
  fi
}

latest_recovery_set() {
  if [ ! -d "$BACKUP_ROOT" ]; then
    return 1
  fi
  find "$BACKUP_ROOT" -maxdepth 1 -type d -name 'fixzone-v1-baseline-*' -printf '%T@ %p\n' 2>/dev/null |
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

check_backup() {
  local latest
  latest="$(latest_recovery_set)"
  if [ -z "$latest" ]; then
    add_result "backup_presence" "CRITICAL" "no FixZone recovery set found"
    add_result "backup_freshness" "UNKNOWN" "freshness unavailable because no recovery set was found"
    add_result "backup_verification" "UNKNOWN" "verification unavailable because no recovery set was found"
    add_result "restore_rehearsed" "UNKNOWN" "restore rehearsal evidence unavailable"
    add_alert "CRITICAL" "No FixZone recovery set found"
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
    add_alert "CRITICAL" "Latest recovery set missing required artifacts"
  fi

  local age
  age="$(file_age_hours "$latest")"
  add_detail "backup_age_hours" "${age:-unknown}"
  if [ -z "$BACKUP_WARNING_HOURS" ] && [ -z "$BACKUP_CRITICAL_HOURS" ]; then
    add_result "backup_freshness" "UNKNOWN" "no approved backup freshness threshold is configured"
    add_alert "UNKNOWN" "Backup freshness threshold not configured"
  elif [ -z "$age" ]; then
    add_result "backup_freshness" "UNKNOWN" "backup age could not be determined"
    add_alert "UNKNOWN" "Backup age could not be determined"
  elif [ -n "$BACKUP_CRITICAL_HOURS" ] && [ "$age" -ge "$BACKUP_CRITICAL_HOURS" ]; then
    add_result "backup_freshness" "CRITICAL" "latest recovery set exceeds configured critical freshness threshold"
    add_alert "CRITICAL" "Backup critical freshness threshold exceeded"
  elif [ -n "$BACKUP_WARNING_HOURS" ] && [ "$age" -ge "$BACKUP_WARNING_HOURS" ]; then
    add_result "backup_freshness" "WARNING" "latest recovery set exceeds configured warning freshness threshold"
    add_alert "WARNING" "Backup warning freshness threshold exceeded"
  else
    add_result "backup_freshness" "HEALTHY" "latest recovery set is within configured freshness thresholds"
  fi

  if [ -z "$checksum" ]; then
    add_result "backup_verification" "UNKNOWN" "checksum verification unavailable without checksum manifest"
    add_alert "UNKNOWN" "Recovery-set checksum manifest unavailable"
  elif [ "$VERIFY_BACKUP_CHECKSUMS" = "true" ]; then
    if command_exists sha256sum && (cd "$latest" && sha256sum -c "$checksum" >/dev/null 2>&1); then
      add_result "backup_verification" "HEALTHY" "checksum verification passed"
    else
      add_result "backup_verification" "CRITICAL" "checksum verification failed or sha256sum unavailable"
      add_alert "CRITICAL" "Recovery-set checksum verification failed"
    fi
  else
    add_result "backup_verification" "UNKNOWN" "checksum manifest is present but verification was not requested"
    add_alert "UNKNOWN" "Recovery-set checksum verification not executed in this monitoring cycle"
  fi

  if [ "$RESTORE_REHEARSED" = "true" ]; then
    add_result "restore_rehearsed" "HEALTHY" "restore rehearsal evidence explicitly supplied"
  elif [ -n "$manifest" ] && grep -Eiq 'RESTORE_REHEARSED=(true|pass)|Recovery rehearsal:[[:space:]]*PASS' "$latest/$manifest"; then
    add_result "restore_rehearsed" "HEALTHY" "restore rehearsal evidence found in recovery manifest"
  else
    add_result "restore_rehearsed" "UNKNOWN" "restore rehearsal evidence not available to this script"
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
}

exit_for_state() {
  case "$OVERALL_STATE" in
    HEALTHY) exit 0 ;;
    WARNING) exit 1 ;;
    CRITICAL) exit 2 ;;
    UNKNOWN) exit 3 ;;
    *) exit 3 ;;
  esac
}

main() {
  check_api
  check_service_and_mount
  check_upload_consistency "$DISCOVERED_CONTAINER"
  check_canary_residue "$DISCOVERED_CONTAINER"
  check_disk
  check_backup
  emit_output
  exit_for_state
}

main "$@"
