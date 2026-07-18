#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

prod_root="${LEADSHELF_PROD_ROOT:-/opt/leadshelf/prod}"
backup_env="${LEADSHELF_BACKUP_ENV:-$prod_root/.env.backup}"
drill_root="${LEADSHELF_RESTORE_DRILL_ROOT:-/opt/leadshelf/restore-drills}"

fail() { echo "[restore-drill] $*" >&2; exit 1; }
for command_name in docker restic sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command is missing: $command_name"
done
[ -r "$backup_env" ] || fail "backup env is not readable: $backup_env"
case "$drill_root" in
  /*) ;;
  *) fail "LEADSHELF_RESTORE_DRILL_ROOT must be absolute" ;;
esac
[ "$drill_root" != "/" ] || fail "refusing to use / as drill root"

set -a
source "$backup_env"
set +a
[ -n "${RESTIC_REPOSITORY:-}" ] || fail "RESTIC_REPOSITORY is required"
[ -n "${RESTIC_PASSWORD:-}" ] || fail "RESTIC_PASSWORD is required"

drill_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
target="$drill_root/$drill_id"
pg_container="leadshelf-restore-pg-$drill_id"
cleanup() {
  docker rm -f "$pg_container" >/dev/null 2>&1 || true
  rm -rf -- "$target"
}
trap cleanup EXIT
mkdir -p "$target"

echo "[restore-drill] restoring latest encrypted snapshot"
restic restore latest --tag leadshelf-production --target "$target"
[ -s "$target/database.dump" ] || fail "restored database dump is missing or empty"
[ -f "$target/SHA256SUMS" ] || fail "checksum manifest is missing"
(
  cd "$target"
  sha256sum -c SHA256SUMS
)

echo "[restore-drill] restoring PostgreSQL into an isolated container"
docker run -d --name "$pg_container" \
  -e POSTGRES_USER=restore \
  -e POSTGRES_PASSWORD=restore-only \
  -e POSTGRES_DB=leadshelf_restore \
  postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do
  if docker exec "$pg_container" pg_isready -U restore -d leadshelf_restore >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$pg_container" pg_isready -U restore -d leadshelf_restore >/dev/null 2>&1 || fail "restore PostgreSQL did not become ready"
docker cp "$target/database.dump" "$pg_container:/tmp/database.dump" >/dev/null
docker exec "$pg_container" pg_restore \
  --username restore \
  --dbname leadshelf_restore \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  /tmp/database.dump
migration_count="$(docker exec "$pg_container" psql -U restore -d leadshelf_restore -Atc 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;')"
(( migration_count > 0 )) || fail "restored database has no completed Prisma migrations"

echo "[restore-drill] verifying restored media bytes"
[ -d "$target/media" ] || fail "restored media directory is missing"
expected_media="$(find "$target/media" -type f -printf '.' | wc -c | tr -d ' ')"
media_bytes="$(du -sb "$target/media" | cut -f1)"
(( expected_media > 0 )) || fail "restored media set is empty"
(( media_bytes > 0 )) || fail "restored media bytes are empty"

echo "[restore-drill] passed: migrations=$migration_count media=$expected_media bytes=$media_bytes"
