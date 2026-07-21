#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

prod_root="${LEADSHELF_PROD_ROOT:-/opt/leadshelf/prod}"
backup_env="${LEADSHELF_BACKUP_ENV:-$prod_root/.env.backup}"
backup_root="${LEADSHELF_BACKUP_ROOT:-/opt/leadshelf/backups}"
receipt="${LEADSHELF_BACKUP_RECEIPT:-$backup_root/LAST_SUCCESS_RECEIPT}"
drill_root="${LEADSHELF_RESTORE_DRILL_ROOT:-/opt/leadshelf/restore-drills}"
expected_host="${COMPOSE_PROJECT_NAME:-leadshelf-prod}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/scripts/backup-receipt.sh
source "$script_dir/backup-receipt.sh"

fail() { echo "[restore-drill] $*" >&2; exit 1; }
expected_uid="${LEADSHELF_BACKUP_CONFIG_UID:-$(id -u)}"
for command_name in docker mktemp restic sha256sum stat; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command is missing: $command_name"
done
[[ "$expected_uid" =~ ^[0-9]+$ ]] || fail "LEADSHELF_BACKUP_CONFIG_UID must be numeric"
[[ -f "$backup_env" && ! -L "$backup_env" ]] || fail "backup env must be a regular non-symlink file"
[[ "$(stat -c '%a' -- "$backup_env")" == "600" ]] || fail "backup env must have mode 0600"
[[ "$(stat -c '%u' -- "$backup_env")" == "$expected_uid" ]] || fail "backup env has unexpected owner"
case "$drill_root" in
  /*) ;;
  *) fail "LEADSHELF_RESTORE_DRILL_ROOT must be absolute" ;;
esac
[ "$drill_root" != "/" ] || fail "refusing to use / as drill root"
mkdir -p "$drill_root"
[[ -d "$drill_root" && ! -L "$drill_root" ]] || fail "drill root must be a non-symlink directory"
[[ "$(stat -c '%u' -- "$drill_root")" == "$expected_uid" ]] || fail "drill root has unexpected owner"
(( (8#$(stat -c '%a' -- "$drill_root") & 0022) == 0 )) || fail "drill root must not be group/world writable"

set -a
source "$backup_env"
set +a
[ -n "${RESTIC_REPOSITORY:-}" ] || fail "RESTIC_REPOSITORY is required"
[ -n "${RESTIC_PASSWORD:-}" ] || fail "RESTIC_PASSWORD is required"
LEADSHELF_BACKUP_RECEIPT="$receipt" "$script_dir/verify-production-backup.sh" >/dev/null
read_backup_receipt "$receipt" "${LEADSHELF_BACKUP_RECEIPT_UID:-$(id -u)}" || fail "backup receipt is invalid"
[[ "$BACKUP_RECEIPT_HOST" == "$expected_host" ]] || fail "backup receipt belongs to a different host"

drill_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
target="$(mktemp -d "$drill_root/.drill-$drill_id.XXXXXX")"
pg_container="leadshelf-restore-pg-$drill_id"
cleanup() {
  docker rm -f "$pg_container" >/dev/null 2>&1 || true
  rm -rf -- "$target"
}
trap cleanup EXIT

echo "[restore-drill] restoring exact encrypted snapshot: $BACKUP_RECEIPT_SNAPSHOT_ID"
restic restore "$BACKUP_RECEIPT_SNAPSHOT_ID" --target "$target"
[ -s "$target/database.dump" ] || fail "restored database dump is missing or empty"
[ -f "$target/SHA256SUMS" ] || fail "checksum manifest is missing"
[ -f "$target/BACKUP-METADATA" ] || fail "backup metadata is missing"
grep -Fq '  ./BACKUP-METADATA' "$target/SHA256SUMS" || fail "backup metadata is not checksum-protected"
(
  cd "$target"
  sha256sum -c SHA256SUMS
)

declare -A metadata=()
declare -A allowed_metadata=(
  [VERSION]=1
  [CREATED_AT]=1
  [SOURCE_HOST]=1
  [DATABASE]=1
  [BUCKET]=1
  [SOURCE_MIGRATIONS]=1
  [MEDIA_FILES]=1
  [MEDIA_BYTES]=1
)
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" == *=* ]] || fail "backup metadata contains a malformed line"
  key="${line%%=*}"
  value="${line#*=}"
  [[ -n "${allowed_metadata[$key]:-}" ]] || fail "backup metadata contains an unknown field"
  [[ -z "${metadata[$key]+present}" ]] || fail "backup metadata contains a duplicate field"
  (( ${#value} >= 1 && ${#value} <= 255 )) || fail "backup metadata field has invalid length"
  metadata[$key]="$value"
done < "$target/BACKUP-METADATA"
for key in VERSION CREATED_AT SOURCE_HOST DATABASE BUCKET SOURCE_MIGRATIONS MEDIA_FILES MEDIA_BYTES; do
  [[ -n "${metadata[$key]:-}" ]] || fail "backup metadata is missing a required field"
done
[[ "${metadata[VERSION]}" == "1" ]] || fail "unsupported backup metadata version"
[[ "${metadata[SOURCE_HOST]}" == "$BACKUP_RECEIPT_HOST" ]] || fail "backup metadata host does not match receipt"
for key in SOURCE_MIGRATIONS MEDIA_FILES MEDIA_BYTES; do
  [[ "${metadata[$key]}" =~ ^[0-9]+$ ]] || fail "backup metadata count is invalid"
done
(( metadata[SOURCE_MIGRATIONS] > 0 )) || fail "backup metadata has no completed migrations"

echo "[restore-drill] restoring PostgreSQL into an isolated container"
docker run -d --name "$pg_container" -e POSTGRES_USER=restore -e POSTGRES_PASSWORD=restore-only -e POSTGRES_DB=leadshelf_restore postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do
  if docker exec "$pg_container" pg_isready -U restore -d leadshelf_restore >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$pg_container" pg_isready -U restore -d leadshelf_restore >/dev/null 2>&1 || fail "restore PostgreSQL did not become ready"
docker cp "$target/database.dump" "$pg_container:/tmp/database.dump" >/dev/null
docker exec "$pg_container" pg_restore --username restore --dbname leadshelf_restore --exit-on-error --no-owner --no-privileges /tmp/database.dump
migration_count="$(docker exec "$pg_container" psql -U restore -d leadshelf_restore -Atc 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;')"
[[ "$migration_count" =~ ^[0-9]+$ ]] || fail "restored migration count is invalid"
[[ "$migration_count" == "${metadata[SOURCE_MIGRATIONS]}" ]] || fail "restored migration count does not match backup metadata"

echo "[restore-drill] verifying restored media bytes"
[ -d "$target/media" ] || fail "restored media directory is missing"
expected_media="$(find "$target/media" -type f -printf '.\n' | wc -l | tr -d '[:space:]')"
media_bytes="$(find "$target/media" -type f -printf '%s\n' | awk '{ total += $1 } END { print total + 0 }')"
[[ "$expected_media" == "${metadata[MEDIA_FILES]}" ]] || fail "restored media file count does not match backup metadata"
[[ "$media_bytes" == "${metadata[MEDIA_BYTES]}" ]] || fail "restored media bytes do not match backup metadata"

echo "[restore-drill] passed: snapshot=$BACKUP_RECEIPT_SNAPSHOT_ID migrations=$migration_count media=$expected_media bytes=$media_bytes"
