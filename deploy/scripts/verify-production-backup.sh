#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

prod_root="${LEADSHELF_PROD_ROOT:-/opt/leadshelf/prod}"
backup_root="${LEADSHELF_BACKUP_ROOT:-/opt/leadshelf/backups}"
backup_env="${LEADSHELF_BACKUP_ENV:-$prod_root/.env.backup}"
marker="$backup_root/LAST_SUCCESS_EPOCH"

fail() { echo "[backup-verify] $*" >&2; exit 1; }
[ -r "$backup_env" ] || fail "backup env is not readable: $backup_env"
[ -f "$marker" ] || fail "success marker is missing: $marker"
set -a
source "$backup_env"
set +a
[ -n "${RESTIC_REPOSITORY:-}" ] || fail "RESTIC_REPOSITORY is required"
[ -n "${RESTIC_PASSWORD:-}" ] || fail "RESTIC_PASSWORD is required"

now_epoch="$(date -u +%s)"
last_epoch="$(tr -cd '0-9' < "$marker")"
[ -n "$last_epoch" ] || fail "success marker is invalid"
max_age_seconds="$(( ${LEADSHELF_BACKUP_MAX_AGE_HOURS:-26} * 3600 ))"
age_seconds="$(( now_epoch - last_epoch ))"
(( age_seconds >= 0 && age_seconds <= max_age_seconds )) || fail "latest successful backup is too old: ${age_seconds}s"

restic snapshots --tag leadshelf-production --latest 1 >/dev/null
restic check --read-data-subset="${LEADSHELF_RESTIC_CHECK_SUBSET:-5%}"
echo "[backup-verify] latest backup is fresh and repository check passed"
