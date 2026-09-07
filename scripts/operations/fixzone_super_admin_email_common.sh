#!/usr/bin/env bash

fz_timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

fz_info() {
  printf '[%s] %s\n' "$(fz_timestamp)" "$*"
}

fz_fail() {
  printf '[%s] ERROR: %s\n' "$(fz_timestamp)" "$*" >&2
  exit 1
}

fz_require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fz_fail "Required command not found: $1"
}

fz_resolve_docker_swarm_postgres_container() {
  local service="$1"
  local containers=()

  mapfile -t containers < <(
    docker ps \
      --filter "label=com.docker.swarm.service.name=$service" \
      --filter "status=running" \
      --format '{{.ID}}'
  )

  if ((${#containers[@]} == 0)); then
    fz_fail "No running PostgreSQL container found for configured Docker Swarm service."
  fi
  if ((${#containers[@]} > 1)); then
    fz_fail "Multiple running PostgreSQL containers found for configured Docker Swarm service."
  fi

  printf '%s' "${containers[0]}"
}

fz_read_container_env_value() {
  local container="$1"
  local key="$2"
  local value

  value="$(docker exec "$container" sh -c "printenv $key" 2>/dev/null || true)"
  [[ -n "$value" ]] || fz_fail "Required PostgreSQL container environment value is missing."
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] ||
    fz_fail "Required PostgreSQL container environment value is malformed."
  printf '%s' "$value"
}

fz_prepare_psql_command() {
  local -n out_cmd="$1"
  local mode="${FIXZONE_DB_MODE:-docker-swarm}"

  case "$mode" in
    docker-swarm)
      local service="${FIXZONE_POSTGRES_SERVICE:-securezoneinfrastructure-postgres-bhwgzt}"
      fz_require_cmd docker

      local container
      container="$(fz_resolve_docker_swarm_postgres_container "$service")"

      docker exec "$container" sh -c 'command -v psql >/dev/null 2>&1' ||
        fz_fail "psql is not available inside the PostgreSQL container."

      local pg_user pg_db
      pg_user="$(fz_read_container_env_value "$container" POSTGRES_USER)"
      pg_db="$(fz_read_container_env_value "$container" POSTGRES_DB)"

      out_cmd=(docker exec -i "$container" psql -U "$pg_user" -d "$pg_db")
      ;;
    host)
      local psql_bin="${FIXZONE_PSQL_BIN:-psql}"
      fz_require_cmd "$psql_bin"
      out_cmd=("$psql_bin")
      ;;
    *)
      fz_fail "Unsupported FIXZONE_DB_MODE."
      ;;
  esac
}

fz_normalize_email() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "${value,,}"
}

fz_validate_email() {
  local value="$1"
  [[ ${#value} -le 254 ]] || return 1
  [[ "$value" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$ ]] || return 1
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* && "$value" != *$'\t'* ]] || return 1
}

fz_validate_user_role() {
  case "$1" in
    PLATFORM_SUPER_ADMIN|SUPER_ADMIN|PLATFORM_OWNER|EXECUTIVE_SUPER_ADMIN|TECHNICAL_ADMIN|OPERATIONS_ADMIN|ORGANIZATION_ONBOARDING_ADMIN|PROVIDER_ADMIN|FINANCE_BILLING_ADMIN|BILLING_ADMIN|LEGAL_ADMIN|ASSIGNMENT_ADMIN|ASSET_ADMIN|ASSET_INTELLIGENCE_ADMIN|COMPLIANCE_ADMIN|COMPLIANCE_AUDIT_ADMIN|REGULATORY_ADMIN|SECURITY_ADMIN|INVESTIGATION_ADMIN|RELEASE_OPERATIONS_ADMIN|BACKUP_RECOVERY_ADMIN|SUPPORT_ADMIN|ORG_ADMIN|DISPATCH_OFFICER|PROVIDER|PENDING_PROVIDER|CITIZEN)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

fz_read_hidden_email_pair() {
  local label="${1:-target}"
  local first second

  set +x
  printf 'Enter %s email: ' "$label" >&2
  IFS= read -rs first || fz_fail "Input ended before first hidden email entry."
  printf '\nRe-enter %s email: ' "$label" >&2
  IFS= read -rs second || fz_fail "Input ended before second hidden email entry."
  printf '\n' >&2

  first="$(fz_normalize_email "$first")"
  second="$(fz_normalize_email "$second")"

  if [[ "$first" != "$second" ]]; then
    fz_fail "Hidden email entries did not match."
  fi
  fz_validate_email "$first" || fz_fail "Hidden email input is malformed."

  printf '%s' "$first"
}

fz_sanitized_psql() {
  local target_email="$1"
  shift

  set +x
  "$@" -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse \
    2> >(
      while IFS= read -r line; do
        printf '%s\n' "${line//"$target_email"/'[REDACTED_EMAIL]'}" >&2
      done
    )
}

fz_sanitized_psql_multi() {
  local redact_values=()
  while (($# > 0)); do
    if [[ "$1" == "--" ]]; then
      shift
      break
    fi
    redact_values+=("$1")
    shift
  done

  set +x
  "$@" -X -v ON_ERROR_STOP=1 -v VERBOSITY=terse \
    2> >(
      while IFS= read -r line; do
        local redacted="$line"
        local value
        for value in "${redact_values[@]}"; do
          if [[ -n "$value" ]]; then
            redacted="${redacted//"$value"/'[REDACTED_EMAIL]'}"
          fi
        done
        printf '%s\n' "$redacted" >&2
      done
    )
}

fz_copy_target_email_sql() {
  local target_email="$1"
  cat <<SQL
CREATE TEMP TABLE __fz_input (
  target_email text NOT NULL
) ON COMMIT PRESERVE ROWS;
\\copy __fz_input(target_email) FROM stdin WITH (FORMAT text)
$target_email
\\.
DO \$\$
BEGIN
  IF (SELECT count(*) FROM __fz_input) <> 1 THEN
    RAISE EXCEPTION 'target input cardinality check failed';
  END IF;
END
\$\$;
SQL
}

fz_operator_gate() {
  local key="$1"
  local state="$2"
  printf '%s=%s\n' "$key" "$state"
  [[ "$state" == "PASS" ]]
}

fz_run_external_preflight_gates() {
  if [[ "${FIXZONE_SKIP_EXTERNAL_PREFLIGHT:-false}" == "true" ]]; then
    fz_operator_gate "EXTERNAL_PREFLIGHT_SKIPPED" "PASS"
    return 0
  fi

  fz_require_cmd curl

  local backup_dir="${FIXZONE_BACKUP_DIR:-}"
  [[ -n "$backup_dir" && -d "$backup_dir" ]]
  fz_operator_gate "BACKUP_DIR_EXISTS" "$([[ -n "$backup_dir" && -d "$backup_dir" ]] && printf PASS || printf FAIL)" || return 1

  [[ -f "$backup_dir/SHA256SUMS" || -f "$backup_dir/checksums.sha256" ]]
  fz_operator_gate "BACKUP_CHECKSUMS_EXISTS" "$([[ -f "$backup_dir/SHA256SUMS" || -f "$backup_dir/checksums.sha256" ]] && printf PASS || printf FAIL)" || return 1

  [[ -f "$backup_dir/verification-status.json" ]]
  fz_operator_gate "BACKUP_VERIFICATION_STATUS_EXISTS" "$([[ -f "$backup_dir/verification-status.json" ]] && printf PASS || printf FAIL)" || return 1

  local api_replicas="${FIXZONE_API_REPLICAS:-}"
  fz_operator_gate "API_REPLICAS_1_OF_1" "$([[ "$api_replicas" == "1/1" ]] && printf PASS || printf FAIL)" || return 1

  local api_health_url="${FIXZONE_API_HEALTH_URL:-}"
  [[ -n "$api_health_url" ]] || return 1
  if curl -fsS --max-time "${FIXZONE_API_TIMEOUT_SECONDS:-10}" "$api_health_url" >/dev/null; then
    fz_operator_gate "API_HEALTH" "PASS" || return 1
  else
    fz_operator_gate "API_HEALTH" "FAIL" || return 1
  fi

  [[ "${FIXZONE_PRIVILEGED_MFA_ENCRYPTION_KEY_VALID:-}" == "true" ]]
  fz_operator_gate "PRIVILEGED_MFA_ENCRYPTION_KEY_VALID" "$([[ "${FIXZONE_PRIVILEGED_MFA_ENCRYPTION_KEY_VALID:-}" == "true" ]] && printf PASS || printf FAIL)" || return 1
}
