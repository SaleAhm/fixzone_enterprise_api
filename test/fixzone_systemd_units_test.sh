#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE="$REPO_ROOT/ops/systemd/fixzone-host-monitor.service"
TIMER="$REPO_ROOT/ops/systemd/fixzone-host-monitor.timer"

assert_contains() {
  local file="$1"
  local text="$2"
  if ! grep -Fqx "$text" "$file"; then
    printf 'Expected exact line in %s: %s\n' "$file" "$text" >&2
    exit 1
  fi
}

assert_not_contains_regex() {
  local file="$1"
  local pattern="$2"
  if grep -Eiq "$pattern" "$file"; then
    printf 'Unexpected pattern in %s: %s\n' "$file" "$pattern" >&2
    grep -Ein "$pattern" "$file" >&2
    exit 1
  fi
}

test -f "$SERVICE"
test -f "$TIMER"

assert_contains "$SERVICE" "Type=oneshot"
assert_contains "$SERVICE" "WorkingDirectory=/srv/securezone-ops/fixzone/current"
assert_contains "$SERVICE" "ExecStart=/srv/securezone-ops/fixzone/current/fixzone_operational_check.sh"
assert_contains "$SERVICE" "Environment=FIXZONE_MONITOR_STATE_DIR=/srv/securezone-ops/fixzone/state"
assert_contains "$SERVICE" "Environment=FIXZONE_MONITOR_VERSION=c3e37fb"
assert_contains "$SERVICE" "EnvironmentFile=-/etc/fixzone/host-monitor.env"
assert_contains "$SERVICE" "SuccessExitStatus=1 2 3"
assert_contains "$SERVICE" "TimeoutStartSec=120"
assert_contains "$SERVICE" "NoNewPrivileges=true"
assert_contains "$SERVICE" "PrivateTmp=true"
assert_contains "$SERVICE" "ProtectSystem=strict"
assert_contains "$SERVICE" "ProtectHome=true"
assert_contains "$SERVICE" "ReadWritePaths=/srv/securezone-ops/fixzone/state"

assert_contains "$TIMER" "OnBootSec=5min"
assert_contains "$TIMER" "OnUnitActiveSec=15min"
assert_contains "$TIMER" "AccuracySec=1min"
assert_contains "$TIMER" "Persistent=true"
assert_contains "$TIMER" "Unit=fixzone-host-monitor.service"

assert_not_contains_regex "$SERVICE" '^Restart=always$'
assert_not_contains_regex "$SERVICE" 'FIXZONE_BACKUP_(FRESHNESS_)?WARNING_HOURS=30|FIXZONE_BACKUP_(FRESHNESS_)?CRITICAL_HOURS=48'
assert_not_contains_regex "$TIMER" 'FIXZONE_BACKUP_(FRESHNESS_)?WARNING_HOURS=30|FIXZONE_BACKUP_(FRESHNESS_)?CRITICAL_HOURS=48'
assert_not_contains_regex "$SERVICE" 'Exec(StartPre|StartPost|StopPost)='
assert_not_contains_regex "$SERVICE" 'pg_restore|pg_dump|DROP DATABASE|DELETE FROM|TRUNCATE|docker[[:space:]]+(stop|restart|rm|service[[:space:]]+update)|systemctl[[:space:]]+(enable|start|restart)|rm[[:space:]]+-rf|tar[[:space:]]+-x'
assert_not_contains_regex "$SERVICE" 'DATABASE_URL|PASSWORD|TOKEN|SECRET|PRIVATE_KEY|SMTP|WEBHOOK|AUTHORIZATION|COOKIE'
assert_not_contains_regex "$TIMER" 'DATABASE_URL|PASSWORD|TOKEN|SECRET|PRIVATE_KEY|SMTP|WEBHOOK|AUTHORIZATION|COOKIE'

printf 'fixzone_systemd_units_test.sh: all checks passed\n'
