#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() { echo "[production-deploy] $*" >&2; exit 1; }

(( $# == 1 )) || fail "exactly one release SHA argument is required"
release_sha="$1"
[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || fail "release SHA must be an exact lowercase 40-character commit SHA"

for command_name in date docker flock git install stat; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command is missing: $command_name"
done

prod_root="${LEADSHELF_PROD_ROOT:-/opt/leadshelf/prod}"
app_root="$prod_root/app"
release_verifier="${LEADSHELF_RELEASE_VERIFIER:-/usr/local/sbin/leadshelf-verify-release-approval}"
[[ "$prod_root" == /* && "$prod_root" != "/" ]] || fail "production root must be an absolute non-root path"
[[ -x "$release_verifier" && ! -L "$release_verifier" ]] || fail "installed release verifier is missing or unsafe"
[[ "$(stat -c '%u' -- "$release_verifier")" == "0" ]] || fail "installed release verifier must be root-owned"
(( (8#$(stat -c '%a' -- "$release_verifier") & 0022) == 0 )) || fail "installed release verifier must not be group/world writable"

cd "$app_root"
[[ "$(stat -c '%u' -- "$app_root")" == "0" ]] || fail "production app directory must be root-owned"
[ -z "$(git status --porcelain)" ] || fail "production app worktree is not clean"
exec 9>"$prod_root/.deploy.lock"
flock -n 9 || fail "another production deploy is already running"
previous_sha="$(git rev-parse HEAD)"
[[ "$previous_sha" =~ ^[0-9a-f]{40}$ ]] || fail "current production checkout is not an exact commit"

LEADSHELF_RELEASE_SHA="$release_sha" "$release_verifier"
deploy/scripts/backup-production.sh
deploy/scripts/verify-production-backup.sh

git fetch --depth=1 origin "$release_sha"
[ "$(git rev-parse FETCH_HEAD)" = "$release_sha" ] || fail "fetched SHA mismatch"
git checkout --detach "$release_sha"
[ "$(git rev-parse HEAD)" = "$release_sha" ] || fail "checkout SHA mismatch"
[ -z "$(git status --porcelain)" ] || fail "release checkout is not clean"

install -m 644 deploy/docker-compose.prod.yml "$prod_root/docker-compose.yml"
install -m 644 deploy/Caddyfile "$prod_root/Caddyfile"
cd "$prod_root"
docker compose build caddy postgres web migrate worker-import worker-notifications worker-proof-analysis vision
docker compose run --rm migrate
docker compose up -d --wait --wait-timeout 300 \
  web caddy worker-import worker-notifications worker-proof-analysis vision
docker compose ps
printf 'release_sha=%s\nprevious_sha=%s\ndeployed_at=%s\n' \
  "$release_sha" "$previous_sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$prod_root/LAST_RELEASE"
