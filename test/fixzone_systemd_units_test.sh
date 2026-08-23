#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE="$REPO_ROOT/ops/systemd/fixzone-host-monitor.service"
TIMER="$REPO_ROOT/ops/systemd/fixzone-host-monitor.timer"
BACKUP_SERVICE="$REPO_ROOT/ops/systemd/fixzone-recovery-backup.service"
BACKUP_TIMER="$REPO_ROOT/ops/systemd/fixzone-recovery-backup.timer"
BACKUP_TIMER_TEMPLATE="$REPO_ROOT/ops/systemd/fixzone-recovery-backup.timer.example"
ENV_EXAMPLE="$REPO_ROOT/ops/systemd/host-monitor.env.example"
RECOVERY_ENV_EXAMPLE="$REPO_ROOT/ops/systemd/recovery-backup.env.example"
POLICY_DOC="$REPO_ROOT/docs/stabilization/phase8/FixZone_Pilot_Operational_Monitoring_Backup_and_Alert_Policy.md"
RUNBOOK_DOC="$REPO_ROOT/docs/stabilization/phase8/FixZone_Production_Operations_Runbook.md"

assert_contains() {
  local file="$1"
  local text="$2"
  if ! grep -Fqx -- "$text" "$file"; then
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

assert_before() {
  local file="$1"
  local first="$2"
  local second="$3"
  local first_line second_line
  first_line="$(grep -Fn -- "$first" "$file" | head -n 1 | cut -d: -f1)"
  second_line="$(grep -Fn -- "$second" "$file" | head -n 1 | cut -d: -f1)"
  if [ -z "$first_line" ] || [ -z "$second_line" ] || [ "$first_line" -ge "$second_line" ]; then
    printf 'Expected "%s" before "%s" in %s\n' "$first" "$second" "$file" >&2
    exit 1
  fi
}

test -f "$SERVICE"
test -f "$TIMER"
test -f "$BACKUP_SERVICE"
test ! -e "$BACKUP_TIMER"
test -f "$BACKUP_TIMER_TEMPLATE"
test -f "$ENV_EXAMPLE"
test -f "$RECOVERY_ENV_EXAMPLE"
test -f "$POLICY_DOC"
test -f "$RUNBOOK_DOC"

assert_contains "$SERVICE" "Type=oneshot"
assert_contains "$SERVICE" "WorkingDirectory=/srv/securezone-ops/fixzone/current"
assert_contains "$SERVICE" "ExecStart=/srv/securezone-ops/fixzone/current/fixzone_operational_check.sh"
assert_contains "$SERVICE" "Environment=FIXZONE_MONITOR_STATE_DIR=/srv/securezone-ops/fixzone/state"
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

assert_contains "$BACKUP_SERVICE" "Type=oneshot"
assert_contains "$BACKUP_SERVICE" "User=root"
assert_contains "$BACKUP_SERVICE" "Group=root"
assert_contains "$BACKUP_SERVICE" "WorkingDirectory=/srv/securezone-ops/fixzone-backup/current"
assert_contains "$BACKUP_SERVICE" "ExecStart=/srv/securezone-ops/fixzone-backup/current/fixzone_recovery_backup.sh"
assert_contains "$BACKUP_SERVICE" "EnvironmentFile=/etc/fixzone/recovery-backup.env"
assert_contains "$BACKUP_SERVICE" "TimeoutStartSec=6h"
assert_contains "$BACKUP_SERVICE" "StandardOutput=journal"
assert_contains "$BACKUP_SERVICE" "StandardError=journal"
assert_contains "$BACKUP_SERVICE" "UMask=0077"
assert_contains "$BACKUP_SERVICE" "NoNewPrivileges=true"
assert_contains "$BACKUP_SERVICE" "PrivateTmp=true"
assert_contains "$BACKUP_SERVICE" "ProtectSystem=strict"
assert_contains "$BACKUP_SERVICE" "ProtectHome=true"
assert_contains "$BACKUP_SERVICE" "ReadOnlyPaths=/srv/securezone-ops/fixzone-backup"
assert_contains "$BACKUP_SERVICE" "ReadOnlyPaths=/srv/securezone-data/fixzone/uploads"
assert_contains "$BACKUP_SERVICE" "ReadWritePaths=/srv/securezone-backups/manual"
assert_contains "$BACKUP_SERVICE" "ReadWritePaths=/run/docker.sock"
assert_contains "$BACKUP_SERVICE" "ReadWritePaths=/var/run/docker.sock"
assert_contains "$BACKUP_TIMER_TEMPLATE" "Unit=fixzone-recovery-backup.service"
assert_contains "$BACKUP_TIMER_TEMPLATE" "OnCalendar=FIXZONE_APPROVED_DAILY_BACKUP_TIME_REQUIRED"
assert_contains "$BACKUP_TIMER_TEMPLATE" "Persistent=true"
assert_contains "$BACKUP_TIMER_TEMPLATE" "AccuracySec=1min"
assert_contains "$BACKUP_TIMER_TEMPLATE" "WantedBy=timers.target"
assert_not_contains_regex "$BACKUP_TIMER_TEMPLATE" '^OnCalendar=([0-9]{2}:[0-9]{2}|[0-9]{2}:[0-9]{2}:[0-9]{2}|\*-[*0-9,-]+-[*0-9,-]+[[:space:]]+[0-9]{2}:[0-9]{2})'

assert_contains "$ENV_EXAMPLE" "FIXZONE_BACKUP_FRESHNESS_WARNING_HOURS=30"
assert_contains "$ENV_EXAMPLE" "FIXZONE_BACKUP_FRESHNESS_CRITICAL_HOURS=48"
assert_contains "$RECOVERY_ENV_EXAMPLE" "FIXZONE_POSTGRES_MODE=docker-swarm"
assert_contains "$RECOVERY_ENV_EXAMPLE" "FIXZONE_POSTGRES_SERVICE=<configured-fixzone-postgres-swarm-service>"
assert_contains "$RECOVERY_ENV_EXAMPLE" "FIXZONE_POSTGRES_DATABASE=<configured-database-name>"
assert_contains "$RECOVERY_ENV_EXAMPLE" "FIXZONE_POSTGRES_USER=<database-role>"
assert_contains "$RECOVERY_ENV_EXAMPLE" "FIXZONE_POSTGRES_EXPECTED_MAJOR=17"
assert_contains "$RECOVERY_ENV_EXAMPLE" "FIXZONE_BACKUP_ROOT=/srv/securezone-backups/manual"
assert_contains "$RECOVERY_ENV_EXAMPLE" "FIXZONE_UPLOAD_ROOT=/srv/securezone-data/fixzone/uploads"
assert_contains "$RECOVERY_ENV_EXAMPLE" "# Recommended ownership/mode: root:root 0640 or stricter."

assert_not_contains_regex "$SERVICE" '^Restart=always$'
assert_not_contains_regex "$BACKUP_SERVICE" '^Restart=always$'
assert_not_contains_regex "$BACKUP_SERVICE" '^SuccessExitStatus='
assert_not_contains_regex "$SERVICE" '^Documentation=docs/'
assert_not_contains_regex "$TIMER" '^Documentation=docs/'
assert_not_contains_regex "$BACKUP_SERVICE" '^Documentation=docs/'
assert_not_contains_regex "$BACKUP_TIMER_TEMPLATE" '^Documentation=docs/'
assert_not_contains_regex "$SERVICE" '^Environment=FIXZONE_MONITOR_VERSION='
assert_not_contains_regex "$SERVICE" '(^|[^A-Za-z0-9])c3e37fb([^A-Za-z0-9]|$)|(^|[^A-Za-z0-9])a38b2a5([^A-Za-z0-9]|$)'
assert_not_contains_regex "$BACKUP_SERVICE" '(^|[^A-Za-z0-9])c3e37fb([^A-Za-z0-9]|$)|(^|[^A-Za-z0-9])a38b2a5([^A-Za-z0-9]|$)|(^|[^A-Za-z0-9])ba7e816([^A-Za-z0-9]|$)'
assert_not_contains_regex "$BACKUP_TIMER_TEMPLATE" '(^|[^A-Za-z0-9])c3e37fb([^A-Za-z0-9]|$)|(^|[^A-Za-z0-9])a38b2a5([^A-Za-z0-9]|$)|(^|[^A-Za-z0-9])ba7e816([^A-Za-z0-9]|$)'
assert_not_contains_regex "$SERVICE" 'FIXZONE_BACKUP_(FRESHNESS_)?WARNING_HOURS=30|FIXZONE_BACKUP_(FRESHNESS_)?CRITICAL_HOURS=48'
assert_not_contains_regex "$TIMER" 'FIXZONE_BACKUP_(FRESHNESS_)?WARNING_HOURS=30|FIXZONE_BACKUP_(FRESHNESS_)?CRITICAL_HOURS=48'
assert_not_contains_regex "$SERVICE" 'Exec(StartPre|StartPost|StopPost)='
assert_not_contains_regex "$SERVICE" 'pg_restore|pg_dump|DROP DATABASE|DELETE FROM|TRUNCATE|docker[[:space:]]+(stop|restart|rm|service[[:space:]]+update)|systemctl[[:space:]]+(enable|start|restart)|rm[[:space:]]+-rf|tar[[:space:]]+-x'
assert_not_contains_regex "$BACKUP_SERVICE" 'DROP DATABASE|DELETE FROM|TRUNCATE|docker[[:space:]]+(stop|restart|rm|service[[:space:]]+update)|systemctl[[:space:]]+(enable|start|restart)|rm[[:space:]]+-rf|tar[[:space:]]+-x|prisma[[:space:]]+migrate|pg_restore|pg_dump'
assert_not_contains_regex "$BACKUP_TIMER_TEMPLATE" 'DROP DATABASE|DELETE FROM|TRUNCATE|docker[[:space:]]+(stop|restart|rm|service[[:space:]]+update)|systemctl[[:space:]]+(enable|start|restart)|rm[[:space:]]+-rf|tar[[:space:]]+-x|prisma[[:space:]]+migrate|pg_restore|pg_dump'
assert_not_contains_regex "$SERVICE" 'DATABASE_URL|PASSWORD|TOKEN|SECRET|PRIVATE_KEY|SMTP|WEBHOOK|AUTHORIZATION|COOKIE'
assert_not_contains_regex "$TIMER" 'DATABASE_URL|PASSWORD|TOKEN|SECRET|PRIVATE_KEY|SMTP|WEBHOOK|AUTHORIZATION|COOKIE'
assert_not_contains_regex "$BACKUP_SERVICE" 'DATABASE_URL|PASSWORD|TOKEN|SECRET|PRIVATE_KEY|SMTP|WEBHOOK|AUTHORIZATION|COOKIE'
assert_not_contains_regex "$BACKUP_TIMER_TEMPLATE" 'DATABASE_URL|PASSWORD|TOKEN|SECRET|PRIVATE_KEY|SMTP|WEBHOOK|AUTHORIZATION|COOKIE'
assert_not_contains_regex "$ENV_EXAMPLE" 'DATABASE_URL|PASSWORD|TOKEN|SECRET|PRIVATE_KEY|SMTP|WEBHOOK|AUTHORIZATION|COOKIE'
assert_not_contains_regex "$RECOVERY_ENV_EXAMPLE" 'DATABASE_URL|PASSWORD|TOKEN|SECRET|PRIVATE_KEY|SMTP|WEBHOOK|AUTHORIZATION|COOKIE'
assert_not_contains_regex "$RECOVERY_ENV_EXAMPLE" 'securezoneinfrastructure-postgres-bhwgzt|8351dc1921b0|rq4qc9hgyfwolf6pw870klcax'
assert_not_contains_regex "$SERVICE" 'systemctl[[:space:]]+(enable|start)|systemctl[[:space:]]+enable|systemctl[[:space:]]+start'
assert_not_contains_regex "$TIMER" 'systemctl[[:space:]]+(enable|start)|systemctl[[:space:]]+enable|systemctl[[:space:]]+start'
assert_not_contains_regex "$BACKUP_SERVICE" 'systemctl[[:space:]]+(enable|start)|systemctl[[:space:]]+enable|systemctl[[:space:]]+start'
assert_not_contains_regex "$BACKUP_TIMER_TEMPLATE" 'systemctl[[:space:]]+(enable|start)|systemctl[[:space:]]+enable|systemctl[[:space:]]+start'
assert_not_contains_regex "$ENV_EXAMPLE" 'pg_restore|pg_dump|DROP DATABASE|DELETE FROM|TRUNCATE|docker[[:space:]]+(stop|restart|rm|service[[:space:]]+update)|systemctl[[:space:]]+(enable|start|restart)|rm[[:space:]]+-rf|tar[[:space:]]+-x'
assert_not_contains_regex "$RECOVERY_ENV_EXAMPLE" 'pg_restore|pg_dump|DROP DATABASE|DELETE FROM|TRUNCATE|docker[[:space:]]+(stop|restart|rm|service[[:space:]]+update)|systemctl[[:space:]]+(enable|start|restart)|rm[[:space:]]+-rf|tar[[:space:]]+-x'

assert_contains "$POLICY_DOC" "VPS systemd validation attempt: BLOCKED SAFELY BEFORE INSTALLATION."
assert_contains "$POLICY_DOC" "- Removed invalid repository-relative \`Documentation=docs/...\` directives from the production unit files."
assert_contains "$POLICY_DOC" "Systemd host monitor production verification: PASS."
assert_contains "$POLICY_DOC" "Threshold activation package template: \`ops/systemd/host-monitor.env.example\`."
assert_contains "$POLICY_DOC" '- `FIXZONE_BACKUP_FRESHNESS_WARNING_HOURS=30`.'
assert_contains "$POLICY_DOC" '- `FIXZONE_BACKUP_FRESHNESS_CRITICAL_HOURS=48`.'
assert_contains "$POLICY_DOC" "install -o root -g root -m 0755 <verified-source> <versioned-target>"
assert_before "$POLICY_DOC" "3. Create or verify \`/srv/securezone-ops/fixzone/state\`." "6. Run \`systemd-analyze verify\` against the candidate unit files while the current symlink exists."
assert_before "$POLICY_DOC" "4. Create or verify \`/srv/securezone-ops/fixzone/current\` points to the approved version." "6. Run \`systemd-analyze verify\` against the candidate unit files while the current symlink exists."
assert_before "$POLICY_DOC" "5. Download or copy the candidate service and timer unit files into a review location." "6. Run \`systemd-analyze verify\` against the candidate unit files while the current symlink exists."
assert_before "$RUNBOOK_DOC" "3. Create or verify \`/srv/securezone-ops/fixzone/state\`." "6. Run \`systemd-analyze verify\` against the candidate unit files while the current symlink exists."
assert_before "$RUNBOOK_DOC" "4. Create or verify the \`/srv/securezone-ops/fixzone/current\` symlink." "6. Run \`systemd-analyze verify\` against the candidate unit files while the current symlink exists."
assert_before "$RUNBOOK_DOC" "5. Download or copy candidate unit files into a review location." "6. Run \`systemd-analyze verify\` against the candidate unit files while the current symlink exists."
assert_contains "$RUNBOOK_DOC" "install -o root -g root -m 0755 <verified-source> <versioned-target>"
assert_contains "$RUNBOOK_DOC" '4. Install approved `/etc/fixzone/host-monitor.env` with `root:root` ownership and mode `0644`.'
assert_contains "$POLICY_DOC" "Timer template: \`ops/systemd/fixzone-recovery-backup.timer.example\`."
assert_contains "$POLICY_DOC" "Materialized production candidate name: \`fixzone-recovery-backup.timer\`."
assert_contains "$POLICY_DOC" "Replace \`FIXZONE_APPROVED_DAILY_BACKUP_TIME_REQUIRED\` with the explicitly approved valid \`OnCalendar\` expression before running \`systemd-analyze verify\`."
assert_contains "$POLICY_DOC" "Daily backup policy: APPROVED; exact daily execution time: NOT YET APPROVED; backup timer: TEMPLATE ONLY / NOT INSTALLABLE UNTIL SCHEDULE APPROVAL."
assert_contains "$RUNBOOK_DOC" "Timer template: \`ops/systemd/fixzone-recovery-backup.timer.example\`."
assert_contains "$RUNBOOK_DOC" "The materialized production candidate must be named \`fixzone-recovery-backup.timer\` and must contain no unresolved \`FIXZONE_APPROVED_DAILY_BACKUP_TIME_REQUIRED\` token."

printf 'fixzone_systemd_units_test.sh: all checks passed\n'
