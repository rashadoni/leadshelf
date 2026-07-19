#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

prod_root="${LEADSHELF_PROD_ROOT:-/opt/leadshelf/prod}"
backup_root="${LEADSHELF_BACKUP_ROOT:-/opt/leadshelf/backups}"
backup_env="${LEADSHELF_BACKUP_ENV:-$prod_root/.env.backup}"
receipt="${LEADSHELF_BACKUP_RECEIPT:-$backup_root/LAST_SUCCESS_RECEIPT}"
expected_host="${COMPOSE_PROJECT_NAME:-leadshelf-prod}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/backup-receipt.sh
source "$script_dir/backup-receipt.sh"

fail() { echo "[backup-verify] $*" >&2; exit 1; }
expected_uid="${LEADSHELF_BACKUP_CONFIG_UID:-$(id -u)}"
for command_name in jq restic stat; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command is missing: $command_name"
done
[[ "$expected_uid" =~ ^[0-9]+$ ]] || fail "LEADSHELF_BACKUP_CONFIG_UID must be numeric"
[[ -f "$backup_env" && ! -L "$backup_env" ]] || fail "backup env must be a regular non-symlink file"
[[ "$(stat -c '%a' -- "$backup_env")" == "600" ]] || fail "backup env must have mode 0600"
[[ "$(stat -c '%u' -- "$backup_env")" == "$expected_uid" ]] || fail "backup env has unexpected owner"
set -a
source "$backup_env"
set +a
[ -n "${RESTIC_REPOSITORY:-}" ] || fail "RESTIC_REPOSITORY is required"
[ -n "${RESTIC_PASSWORD:-}" ] || fail "RESTIC_PASSWORD is required"
[[ "$expected_host" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || fail "COMPOSE_PROJECT_NAME is invalid"
read_backup_receipt "$receipt" "${LEADSHELF_BACKUP_RECEIPT_UID:-$(id -u)}" || fail "backup receipt is invalid"
[[ "$BACKUP_RECEIPT_HOST" == "$expected_host" ]] || fail "backup receipt belongs to a different host"

now_epoch="$(date -u +%s)"
max_age_hours="${LEADSHELF_BACKUP_MAX_AGE_HOURS:-26}"
[[ "$max_age_hours" =~ ^[0-9]+$ ]] || fail "LEADSHELF_BACKUP_MAX_AGE_HOURS must be numeric"
(( max_age_hours >= 1 && max_age_hours <= 168 )) || fail "backup maximum age must be between 1 and 168 hours"
max_age_seconds="$(( max_age_hours * 3600 ))"
age_seconds="$(( now_epoch - BACKUP_RECEIPT_CREATED_AT_EPOCH ))"
(( age_seconds >= 0 && age_seconds <= max_age_seconds )) || fail "backup receipt is future-dated or stale: ${age_seconds}s"

snapshot_json="$(restic snapshots --json "$BACKUP_RECEIPT_SNAPSHOT_ID")"
jq -e --arg id "$BACKUP_RECEIPT_SNAPSHOT_ID" --arg host "$BACKUP_RECEIPT_HOST" 'length == 1 and .[0].id == $id and .[0].hostname == $host and ((.[0].tags // []) | index("leadshelf-production") != null)' <<<"$snapshot_json" >/dev/null || fail "receipt snapshot ID, host or tag does not match repository"

check_subset="${LEADSHELF_RESTIC_CHECK_SUBSET:-5%}"
[[ "$check_subset" =~ ^[1-9][0-9]{0,2}%$ ]] || fail "LEADSHELF_RESTIC_CHECK_SUBSET must be a percentage"
(( ${check_subset%\%} <= 100 )) || fail "LEADSHELF_RESTIC_CHECK_SUBSET must not exceed 100%"
restic check --read-data-subset="$check_subset"
echo "[backup-verify] exact snapshot is fresh and repository check passed: $BACKUP_RECEIPT_SNAPSHOT_ID"
