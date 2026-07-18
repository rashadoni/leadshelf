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
require_readable() { [ -r "$1" ] || fail "required config is not readable: $1"; }
require_file() { [ -f "$1" ] || fail "required file is missing: $1"; }
for command_name in aws docker restic flock sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command is missing: $command_name"
done

case "$backup_root" in
  /*) ;;
  *) fail "LEADSHELF_BACKUP_ROOT must be absolute" ;;
esac
[ "$backup_root" != "/" ] || fail "refusing to use / as backup root"
require_readable "$prod_env"
require_readable "$backup_env"
require_file "$compose_file"
mkdir -p "$backup_root"

set -a
source "$prod_env"
source "$backup_env"
set +a

for variable_name in POSTGRES_USER POSTGRES_DB S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET RESTIC_REPOSITORY RESTIC_PASSWORD; do
  [ -n "${!variable_name:-}" ] || fail "$variable_name is required"
done

exec 9>"$backup_root/.backup.lock"
flock -n 9 || fail "another backup is already running"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
staging="$backup_root/.staging-$timestamp"
cleanup() { rm -rf -- "$staging"; }
trap cleanup EXIT
mkdir -p "$staging/media"

compose=(docker compose --project-name "$compose_project" --project-directory "$prod_root" -f "$compose_file")

echo "[backup] dumping PostgreSQL"
"${compose[@]}" exec -T postgres pg_dump \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --format custom \
  --compress 9 \
  --no-owner \
  --no-privileges > "$staging/database.dump"
[ -s "$staging/database.dump" ] || fail "database dump is empty"

echo "[backup] mirroring object storage bucket"
AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
AWS_DEFAULT_REGION="${S3_REGION:-us-east-1}" \
  aws --endpoint-url "$S3_ENDPOINT" s3 sync \
    "s3://$S3_BUCKET" "$staging/media" \
    --only-show-errors

(
  cd "$staging"
  find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS
)
printf 'createdAt=%s\nsource=%s\ndatabase=%s\nbucket=%s\n' \
  "$timestamp" "$compose_project" "$POSTGRES_DB" "$S3_BUCKET" > "$staging/BACKUP-METADATA"

echo "[backup] uploading encrypted snapshot to external restic repository"
(
  cd "$staging"
  restic backup . --tag leadshelf-production --host "$compose_project"
)
restic forget \
  --tag leadshelf-production \
  --keep-daily "${LEADSHELF_BACKUP_RETENTION_DAYS:-14}" \
  --keep-weekly "${LEADSHELF_BACKUP_KEEP_WEEKLY:-8}" \
  --keep-monthly "${LEADSHELF_BACKUP_KEEP_MONTHLY:-12}" \
  --prune

date -u +%s > "$backup_root/LAST_SUCCESS_EPOCH"
echo "[backup] completed: $timestamp"
