#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "usage: $0 /absolute/path/to/anonymized.dump" >&2
  exit 64
fi

dump_file="$(realpath "$1")"
if [[ "$dump_file" == /opt/leadshelf/prod/* ]]; then
  echo "refusing a live production path; copy an anonymized dump first" >&2
  exit 65
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container="leadshelf-migration-rehearsal-$RANDOM-$$"
host_port="${REHEARSAL_POSTGRES_PORT:-55439}"
db_name="leadshelf_rehearsal"
db_user="postgres"
db_password="rehearsal-only"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "$container" \
  -e POSTGRES_DB="$db_name" \
  -e POSTGRES_USER="$db_user" \
  -e POSTGRES_PASSWORD="$db_password" \
  -p "127.0.0.1:${host_port}:5432" postgres:16-alpine >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U "$db_user" -d "$db_name" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container" pg_isready -U "$db_user" -d "$db_name" >/dev/null

docker cp "$dump_file" "$container:/tmp/source.dump"
docker exec "$container" pg_restore \
  --exit-on-error --no-owner --no-privileges \
  -U "$db_user" -d "$db_name" /tmp/source.dump

cd "$repo_root"
DATABASE_URL="postgresql://${db_user}:${db_password}@127.0.0.1:${host_port}/${db_name}" \
  pnpm --filter @leadshelf/db exec prisma migrate deploy

migration_count="$(docker exec "$container" psql -At -U "$db_user" -d "$db_name" \
  -c 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')"
if [[ ! "$migration_count" =~ ^[1-9][0-9]*$ ]]; then
  echo "migration rehearsal failed: no completed migrations" >&2
  exit 1
fi

docker exec "$container" pg_dump -Fc -U "$db_user" -d "$db_name" -f /tmp/after.dump
docker exec "$container" pg_restore --list /tmp/after.dump >/dev/null

echo "migration rehearsal passed: completed_migrations=${migration_count}"
