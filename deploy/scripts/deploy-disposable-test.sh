#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() { echo "[test-deploy] $*" >&2; exit 1; }

(( $# == 1 )) || fail "exactly one release SHA argument is required"
release_sha="$1"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || fail "release SHA must be an exact lowercase 40-character commit SHA"
[[ "${LEADSHELF_TEST_DEPLOY_ACK:-}" == "DISPOSABLE" ]] || fail "LEADSHELF_TEST_DEPLOY_ACK=DISPOSABLE is required"

for command_name in curl date docker flock git grep install openssl stat; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command is missing: $command_name"
done

prod_root="${LEADSHELF_PROD_ROOT:-/opt/leadshelf/prod}"
app_root="$prod_root/app"
prod_env="$prod_root/.env.production"
backup_root="${LEADSHELF_TEST_BACKUP_ROOT:-/opt/leadshelf/test-backups}"

[[ "$prod_root" == /* && "$prod_root" != "/" ]] || fail "production root must be an absolute non-root path"
[[ "$backup_root" == /* && "$backup_root" != "/" ]] || fail "backup root must be an absolute non-root path"
[[ -d "$app_root" && ! -L "$app_root" ]] || fail "application checkout is missing or unsafe"
[[ -f "$prod_env" && ! -L "$prod_env" ]] || fail "production env is missing or unsafe"
[[ "$(stat -c '%a' -- "$prod_env")" == "600" ]] || fail "production env must have mode 0600"

mkdir -p "$backup_root"
chmod 700 "$backup_root"
exec 9>"$prod_root/.test-deploy.lock"
flock -n 9 || fail "another test deployment is running"

cd "$app_root"
[ -z "$(git status --porcelain)" ] || fail "production application checkout is not clean"
previous_sha="$(git rev-parse HEAD)"
[[ "$previous_sha" =~ ^[0-9a-f]{40}$ ]] || fail "current checkout is not an exact commit"

set -a
# shellcheck disable=SC1090
source "$prod_env"
set +a
for variable_name in POSTGRES_USER POSTGRES_DB S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET; do
  [ -n "${!variable_name:-}" ] || fail "$variable_name is required before deployment"
done

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="$backup_root/$timestamp-$previous_sha"
install -d -m 700 "$backup_dir"
install -m 600 "$prod_root/docker-compose.yml" "$backup_dir/docker-compose.yml"
install -m 600 "$prod_root/Caddyfile" "$backup_dir/Caddyfile"

compose=(docker compose --project-name leadshelf-prod --project-directory "$prod_root" -f "$prod_root/docker-compose.yml")
echo "[test-deploy] creating a local PostgreSQL safety dump"
"${compose[@]}" exec -T postgres pg_dump \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format custom \
  --compress 9 --no-owner --no-privileges > "$backup_dir/database.dump"
[ -s "$backup_dir/database.dump" ] || fail "PostgreSQL safety dump is empty"
chmod 600 "$backup_dir/database.dump"

lockout_count=0
for variable_name in AUTH_LOCKOUT_MAX_FAILURES AUTH_LOCKOUT_WINDOW_SECONDS AUTH_LOCKOUT_DURATION_SECONDS AUTH_LOCKOUT_PEPPER; do
  [ -n "${!variable_name:-}" ] && lockout_count=$((lockout_count + 1))
done
if (( lockout_count != 0 && lockout_count != 4 )); then
  fail "AUTH_LOCKOUT settings are only partially configured"
fi
if (( lockout_count == 0 )); then
  {
    printf '\n# Added by the disposable test rollout; rotate before a client pilot.\n'
    printf 'AUTH_LOCKOUT_MAX_FAILURES=5\n'
    printf 'AUTH_LOCKOUT_WINDOW_SECONDS=900\n'
    printf 'AUTH_LOCKOUT_DURATION_SECONDS=1800\n'
    printf 'AUTH_LOCKOUT_PEPPER=%s\n' "$(openssl rand -hex 32)"
  } >> "$prod_env"
  echo "[test-deploy] configured the test authentication lockout policy"
fi
if [ -z "${METRICS_BEARER_TOKEN:-}" ]; then
  printf 'METRICS_BEARER_TOKEN=%s\n' "$(openssl rand -hex 32)" >> "$prod_env"
  echo "[test-deploy] configured a test metrics bearer token"
fi
chmod 600 "$prod_env"

echo "[test-deploy] fetching exact release $release_sha"
git fetch --depth=1 origin "$release_sha"
[ "$(git rev-parse FETCH_HEAD)" = "$release_sha" ] || fail "fetched SHA mismatch"
git checkout --detach "$release_sha"
[ "$(git rev-parse HEAD)" = "$release_sha" ] || fail "release checkout mismatch"
[ -z "$(git status --porcelain)" ] || fail "release checkout is not clean"

install -m 644 deploy/docker-compose.prod.yml "$prod_root/docker-compose.yml"
install -m 644 deploy/Caddyfile "$prod_root/Caddyfile"
cd "$prod_root"

echo "[test-deploy] building production runtime images"
docker compose build caddy postgres web migrate worker-import worker-notifications worker-proof-analysis vision
echo "[test-deploy] applying database migrations"
docker compose run --rm migrate
echo "[test-deploy] starting the updated stack"
docker compose up -d --wait --wait-timeout 300 \
  web caddy worker-import worker-notifications worker-proof-analysis vision
docker compose ps

wait_for_public_endpoint() {
  local url="$1"
  local attempts=18
  local delay_seconds=5
  local attempt

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if curl --fail --silent --show-error --max-time 20 "$url" >/dev/null 2>&1; then
      return 0
    fi
    if (( attempt < attempts )); then
      echo "[test-deploy] waiting for public TLS endpoint ($attempt/$attempts)"
      sleep "$delay_seconds"
    fi
  done

  fail "public endpoint did not become ready: $url"
}

wait_for_public_endpoint https://hermescrm.xyz/api/health
wait_for_public_endpoint https://hermescrm.xyz/api/ready
metrics_payload="$(curl --fail --silent --show-error --max-time 20 \
  --header "Authorization: Bearer $METRICS_BEARER_TOKEN" \
  https://hermescrm.xyz/api/metrics)"
grep -q '^# HELP leadshelf_database_size_bytes ' <<<"$metrics_payload"
printf 'release_sha=%s\nprevious_sha=%s\ndeployed_at=%s\nbackup_dir=%s\n' \
  "$release_sha" "$previous_sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$backup_dir" \
  > "$prod_root/LAST_TEST_RELEASE"
chmod 600 "$prod_root/LAST_TEST_RELEASE"
echo "[test-deploy] completed release=$release_sha backup=$backup_dir"
