#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
smoke="$repo_root/deploy/scripts/post-deploy-smoke.sh"
fixture_root="$(mktemp -d /tmp/leadshelf-post-deploy-smoke-test-XXXXXX)"
trap 'rm -rf -- "$fixture_root"' EXIT
chmod 700 "$fixture_root"
mkdir "$fixture_root/bin"
argv_log="$fixture_root/curl-argv.log"
pin_file="$fixture_root/pin"

printf '%s\n' 'smoke-pin-private-value' > "$pin_file"
chmod 600 "$pin_file"

fake_curl="$fixture_root/bin/curl"
{
  printf '%s\n' '#!/usr/bin/env bash' 'set -Eeuo pipefail'
  printf '%s\n' ': "${SMOKE_CURL_ARGV_LOG:?}"'
  printf '%s\n' 'printf '\''%q '\'' "$@" >> "$SMOKE_CURL_ARGV_LOG"'
  printf '%s\n' 'printf '\''\n'\'' >> "$SMOKE_CURL_ARGV_LOG"'
  printf '%s\n' 'case "$*" in'
  printf '%s\n' '  *"/api/health"*) printf '\''{"ok":true}\n'\'' ;;'
  printf '%s\n' '  *"/api/ready"*) printf '\''{"status":"ready"}\n'\'' ;;'
  printf '%s\n' '  *"/api/v1/mobile/auth/login"*) printf '\''{"tokens":{"access":"access-private-token","refresh":"refresh-private-token"}}\n'\'' ;;'
  printf '%s\n' '  *"/api/v1/mobile/sync/pull"*) printf '\''{"cursors":{},"tasks":[{"id":"task-smoke-id"}]}\n'\'' ;;'
  printf '%s\n' '  *"/api/v1/mobile/sync/push"*) printf '\''{"results":[{"status":"applied"}]}\n'\'' ;;'
  printf '%s\n' '  *"/api/v1/mobile/auth/logout"*) printf '\''{}\n'\'' ;;'
  printf '%s\n' '  *) printf '\''unexpected curl request\n'\'' >&2; exit 22 ;;'
  printf '%s\n' 'esac'
} > "$fake_curl"
chmod 755 "$fake_curl"

output="$(
  PATH="$fixture_root/bin:$PATH" \
  SMOKE_CURL_ARGV_LOG="$argv_log" \
  BASE_URL="https://smoke.invalid" \
  SMOKE_ORG_SLUG="organization-private-value" \
  SMOKE_EMPLOYEE_CODE="employee-private-value" \
  SMOKE_PIN_FILE="$pin_file" \
  SMOKE_ALLOW_MUTATIONS=1 \
    "$smoke" 2>&1
)"

for private_value in \
  smoke-pin-private-value \
  organization-private-value \
  employee-private-value \
  access-private-token \
  refresh-private-token; do
  if grep -Fq -- "$private_value" "$argv_log" || grep -Fq -- "$private_value" <<< "$output"; then
    echo "[post-deploy-smoke-test] private value escaped to argv/stdout/stderr" >&2
    exit 1
  fi
done

grep -Fq 'smoke passed: mobile login/pull/logout' <<< "$output" || {
  echo "[post-deploy-smoke-test] expected mobile smoke completion" >&2
  exit 1
}

chmod 644 "$pin_file"
if PATH="$fixture_root/bin:$PATH" SMOKE_CURL_ARGV_LOG="$argv_log" \
  BASE_URL="https://smoke.invalid" SMOKE_ORG_SLUG="organization-private-value" \
  SMOKE_EMPLOYEE_CODE="employee-private-value" SMOKE_PIN_FILE="$pin_file" \
  "$smoke" >/dev/null 2>&1; then
  echo "[post-deploy-smoke-test] group/world-readable PIN file was accepted" >&2
  exit 1
fi

chmod 600 "$pin_file"
ln -s "$pin_file" "$fixture_root/pin-link"
if PATH="$fixture_root/bin:$PATH" SMOKE_CURL_ARGV_LOG="$argv_log" \
  BASE_URL="https://smoke.invalid" SMOKE_ORG_SLUG="organization-private-value" \
  SMOKE_EMPLOYEE_CODE="employee-private-value" SMOKE_PIN_FILE="$fixture_root/pin-link" \
  "$smoke" >/dev/null 2>&1; then
  echo "[post-deploy-smoke-test] symlink PIN file was accepted" >&2
  exit 1
fi

if grep -Eq -- '--arg (pin|orgSlug|employeeCode)|authorization: Bearer \$\{|--data "\$login_body"' "$smoke"; then
  echo "[post-deploy-smoke-test] unsafe secret-bearing process argument returned" >&2
  exit 1
fi
grep -Fq 'curl_flags=(--disable ' "$smoke" || {
  echo "[post-deploy-smoke-test] implicit curlrc loading is not disabled" >&2
  exit 1
}

echo "[post-deploy-smoke-test] PASS"
