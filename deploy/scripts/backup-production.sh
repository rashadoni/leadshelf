#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

prod_root="${LEADSHELF_PROD_ROOT:-/opt/leadshelf/prod}"
backup_root="${LEADSHELF_BACKUP_ROOT:-/opt/leadshelf/backups}"
prod_env="${LEADSHELF_PROD_ENV:-$prod_root/.env.production}"
backup_env="${LEADSHELF_BACKUP_ENV:-$prod_root/.env.backup}"
compose_file="${LEADSHELF_COMPOSE_FILE:-$prod_root/docker-compose.yml}"
compose_project="${COMPOSE_PROJECT_NAME:-leadshelf-prod}"

fail() { echo "[backup] $*" >&2; exit 1; }
require_file() { [ -f "$1" ] || fail "required file is missing: $1"; }
expected_uid="${LEADSHELF_BACKUP_CONFIG_UID:-$(id -u)}"
require_private_config() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" ]] || fail "required config must be a regular non-symlink file: $path"
  [[ "$(stat -c '%a' -- "$path")" == "600" ]] || fail "required config must have mode 0600: $path"
  [[ "$(stat -c '%u' -- "$path")" == "$expected_uid" ]] || fail "required config has unexpected owner: $path"
}
for command_name in aws docker jq restic flock mktemp sha256sum stat; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command is missing: $command_name"
done

case "$backup_root" in
  /*) ;;
  *) fail "LEADSHELF_BACKUP_ROOT must be absolute" ;;
esac
[ "$backup_root" != "/" ] || fail "refusing to use / as backup root"
[[ "$expected_uid" =~ ^[0-9]+$ ]] || fail "LEADSHELF_BACKUP_CONFIG_UID must be numeric"
require_private_config "$prod_env"
require_private_config "$backup_env"
require_file "$compose_file"
[[ ! -L "$compose_file" && "$(stat -c '%u' -- "$compose_file")" == "$expected_uid" ]] || fail "compose file is symlinked or has unexpected owner"
(( (8#$(stat -c '%a' -- "$compose_file") & 0022) == 0 )) || fail "compose file must not be group/world writable"
mkdir -p "$backup_root"
[[ -d "$backup_root" && ! -L "$backup_root" ]] || fail "backup root must be a non-symlink directory"
[[ "$(stat -c '%u' -- "$backup_root")" == "$expected_uid" ]] || fail "backup root has unexpected owner"
(( (8#$(stat -c '%a' -- "$backup_root") & 0022) == 0 )) || fail "backup root must not be group/world writable"

set -a
source "$prod_env"
source "$backup_env"
set +a

for variable_name in POSTGRES_USER POSTGRES_DB S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET RESTIC_REPOSITORY RESTIC_PASSWORD; do
  [ -n "${!variable_name:-}" ] || fail "$variable_name is required"
done
[[ "$compose_project" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || fail "COMPOSE_PROJECT_NAME is invalid"

exec 9>"$backup_root/.backup.lock"
flock -n 9 || fail "another backup is already running"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
staging="$(mktemp -d "$backup_root/.staging-$timestamp.XXXXXX")"
backup_result="$(mktemp "$backup_root/.restic-backup-$timestamp.XXXXXX")"
receipt_tmp="$(mktemp "$backup_root/.LAST_SUCCESS_RECEIPT-$timestamp.XXXXXX")"
receipt="$backup_root/LAST_SUCCESS_RECEIPT"
cleanup() {
  rm -rf -- "$staging"
  rm -f -- "$backup_result" "$receipt_tmp"
}
trap cleanup EXIT
mkdir -p "$staging/media"

compose=(docker compose --project-name "$compose_project" --project-directory "$prod_root" -f "$compose_file")

echo "[backup] dumping PostgreSQL"
"${compose[@]}" exec -T postgres pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format custom --compress 9 --no-owner --no-privileges > "$staging/database.dump"
[ -s "$staging/database.dump" ] || fail "database dump is empty"
migration_count="$("${compose[@]}" exec -T postgres psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --command 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;')"
migration_count="$(tr -d '[:space:]' <<<"$migration_count")"
[[ "$migration_count" =~ ^[1-9][0-9]*$ ]] || fail "source database has no completed active Prisma migrations"

echo "[backup] mirroring object storage bucket"
env AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" AWS_DEFAULT_REGION="${S3_REGION:-us-east-1}" aws --endpoint-url "$S3_ENDPOINT" s3 sync "s3://$S3_BUCKET" "$staging/media" --only-show-errors

media_files="$(find "$staging/media" -type f -printf '.\n' | wc -l | tr -d '[:space:]')"
media_bytes="$(find "$staging/media" -type f -printf '%s\n' | awk '{ total += $1 } END { print total + 0 }')"
[[ "$media_files" =~ ^[0-9]+$ && "$media_bytes" =~ ^[0-9]+$ ]] || fail "media inventory is invalid"
printf 'VERSION=1\nCREATED_AT=%s\nSOURCE_HOST=%s\nDATABASE=%s\nBUCKET=%s\nSOURCE_MIGRATIONS=%s\nMEDIA_FILES=%s\nMEDIA_BYTES=%s\n' "$timestamp" "$compose_project" "$POSTGRES_DB" "$S3_BUCKET" "$migration_count" "$media_files" "$media_bytes" > "$staging/BACKUP-METADATA"
(
  cd "$staging"
  find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS
)

echo "[backup] uploading encrypted snapshot to external restic repository"
(
  cd "$staging"
  restic backup . --tag leadshelf-production --host "$compose_project" --json
) > "$backup_result"
snapshot_id="$(jq -er -s '[.[] | select(.message_type == "summary") | .snapshot_id] | last' "$backup_result")"
[[ "$snapshot_id" =~ ^[0-9a-f]{64}$ ]] || fail "restic did not return an exact snapshot ID"
restic forget --tag leadshelf-production --host "$compose_project" --keep-daily "${LEADSHELF_BACKUP_RETENTION_DAYS:-14}" --keep-weekly "${LEADSHELF_BACKUP_KEEP_WEEKLY:-8}" --keep-monthly "${LEADSHELF_BACKUP_KEEP_MONTHLY:-12}" --prune

created_at_epoch="$(date -u +%s)"
printf 'BACKUP_SNAPSHOT_ID=%s\nBACKUP_CREATED_AT_EPOCH=%s\nBACKUP_HOST=%s\n' "$snapshot_id" "$created_at_epoch" "$compose_project" > "$receipt_tmp"
chmod 600 "$receipt_tmp"
mv -T -- "$receipt_tmp" "$receipt"
echo "[backup] completed: $timestamp snapshot=$snapshot_id"
