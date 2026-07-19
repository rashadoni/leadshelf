#!/usr/bin/env bash
set -Eeuo pipefail

: "${BASE_URL:?BASE_URL is required, e.g. https://client.example.com}"
base_url="${BASE_URL%/}"
curl_flags=(--disable --fail-with-body --silent --show-error --connect-timeout 5 --max-time 20)

health="$(curl "${curl_flags[@]}" "$base_url/api/health")"
jq -e '.ok == true' <<<"$health" >/dev/null
echo "smoke passed: /api/health"

ready="$(curl "${curl_flags[@]}" "$base_url/api/ready")"
jq -e '.status == "ready"' <<<"$ready" >/dev/null
echo "smoke passed: /api/ready"

if [[ -z "${SMOKE_ORG_SLUG:-}" && -z "${SMOKE_EMPLOYEE_CODE:-}" && -z "${SMOKE_PIN_FILE:-}" ]]; then
  echo "mobile smoke skipped: set SMOKE_ORG_SLUG, SMOKE_EMPLOYEE_CODE and SMOKE_PIN_FILE"
  exit 0
fi

: "${SMOKE_ORG_SLUG:?all mobile smoke variables are required}"
: "${SMOKE_EMPLOYEE_CODE:?all mobile smoke variables are required}"
: "${SMOKE_PIN_FILE:?all mobile smoke variables are required}"
if [[ ! -f "$SMOKE_PIN_FILE" || -L "$SMOKE_PIN_FILE" || ! -r "$SMOKE_PIN_FILE" ]]; then
  echo "SMOKE_PIN_FILE must be a readable regular non-symlink file" >&2
  exit 66
fi
pin_mode="$(stat -c '%a' -- "$SMOKE_PIN_FILE")"
(( (8#$pin_mode & 0077) == 0 )) || {
  echo "SMOKE_PIN_FILE must not be accessible by group or world" >&2
  exit 66
}

smoke_runtime="$(mktemp -d /tmp/leadshelf-post-deploy-smoke-XXXXXX)"
cleanup() { rm -rf -- "$smoke_runtime"; }
trap cleanup EXIT
chmod 700 "$smoke_runtime"
org_file="$smoke_runtime/organization"
employee_file="$smoke_runtime/employee"
login_body_file="$smoke_runtime/login.json"
auth_config="$smoke_runtime/auth.curl"
refresh_file="$smoke_runtime/refresh-token"
logout_body_file="$smoke_runtime/logout.json"
pull_body_file="$smoke_runtime/pull.json"
push_body_file="$smoke_runtime/push.json"
printf '%s' "$SMOKE_ORG_SLUG" > "$org_file"
printf '%s' "$SMOKE_EMPLOYEE_CODE" > "$employee_file"
chmod 600 "$org_file" "$employee_file"

device_id="smoke-$(date -u +%Y%m%d)-${RANDOM}"
jq -n \
  --rawfile orgSlug "$org_file" \
  --rawfile employeeCode "$employee_file" \
  --rawfile pin "$SMOKE_PIN_FILE" \
  --arg deviceId "$device_id" \
  '($pin | rtrimstr("\n") | rtrimstr("\r")) as $safePin
   | if ($safePin | length) < 1 or ($safePin | length) > 64
     then error("SMOKE_PIN_FILE contains an invalid PIN length")
     else {protocolVersion:1, orgSlug:$orgSlug, employeeCode:$employeeCode, pin:$safePin,
       device:{id:$deviceId, platform:"operations-smoke", deviceName:"release-smoke"}}
     end' > "$login_body_file"
chmod 600 "$login_body_file"

login_response="$(curl "${curl_flags[@]}" \
  -H 'content-type: application/json' \
  --data-binary "@$login_body_file" \
  "$base_url/api/v1/mobile/auth/login")"
access_token="$(jq -er '.tokens.access' <<<"$login_response")"
refresh_token="$(jq -er '.tokens.refresh' <<<"$login_response")"
[[ "$access_token" =~ ^[A-Za-z0-9._~-]+$ ]] || { echo "mobile access token has unsafe format" >&2; exit 65; }
[[ "$refresh_token" =~ ^[A-Za-z0-9._~-]+$ ]] || { echo "mobile refresh token has unsafe format" >&2; exit 65; }
printf 'header = "authorization: Bearer %s"\n' "$access_token" > "$auth_config"
printf '%s' "$refresh_token" > "$refresh_file"
chmod 600 "$auth_config" "$refresh_file"
unset access_token refresh_token login_response

jq -n '{protocolVersion:1,cursors:{}}' > "$pull_body_file"
pull_response="$(curl "${curl_flags[@]}" \
  --config "$auth_config" \
  -H 'content-type: application/json' \
  --data-binary "@$pull_body_file" \
  "$base_url/api/v1/mobile/sync/pull")"
jq -e '.cursors and (.tasks | type == "array")' <<<"$pull_response" >/dev/null

if [[ "${SMOKE_ALLOW_MUTATIONS:-0}" == "1" ]]; then
  task_id="$(jq -er '.tasks[0].id' <<<"$pull_response")"
  client_op_id="smoke-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}"
  jq -n --arg taskId "$task_id" --arg clientOpId "$client_op_id" \
    '{protocolVersion:1, operations:[{clientOpId:$clientOpId, kind:"task.comment",
      payload:{taskId:$taskId, body:"Automated release smoke"}}]}' > "$push_body_file"
  curl "${curl_flags[@]}" \
    --config "$auth_config" \
    -H 'content-type: application/json' \
    --data-binary "@$push_body_file" \
    "$base_url/api/v1/mobile/sync/push" | jq -e '.results[0].status == "applied"' >/dev/null
  echo "smoke passed: mobile push in dedicated smoke tenant"
fi

jq -n --rawfile refreshToken "$refresh_file" \
  '{protocolVersion:1, refreshToken:$refreshToken}' > "$logout_body_file"
curl "${curl_flags[@]}" \
  -H 'content-type: application/json' \
  --data-binary "@$logout_body_file" \
  "$base_url/api/v1/mobile/auth/logout" >/dev/null

echo "smoke passed: mobile login/pull/logout"
