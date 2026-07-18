#!/usr/bin/env bash
set -Eeuo pipefail

: "${BASE_URL:?BASE_URL is required, e.g. https://client.example.com}"
base_url="${BASE_URL%/}"
curl_flags=(--fail-with-body --silent --show-error --connect-timeout 5 --max-time 20)

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
if [[ ! -r "$SMOKE_PIN_FILE" ]]; then
  echo "SMOKE_PIN_FILE is not readable" >&2
  exit 66
fi

pin="$(<"$SMOKE_PIN_FILE")"
device_id="smoke-$(date -u +%Y%m%d)-${RANDOM}"
login_body="$(jq -n \
  --arg orgSlug "$SMOKE_ORG_SLUG" \
  --arg employeeCode "$SMOKE_EMPLOYEE_CODE" \
  --arg pin "$pin" \
  --arg deviceId "$device_id" \
  '{protocolVersion:1, orgSlug:$orgSlug, employeeCode:$employeeCode, pin:$pin,
    device:{id:$deviceId, platform:"operations-smoke", deviceName:"release-smoke"}}')"
unset pin

login_response="$(curl "${curl_flags[@]}" \
  -H 'content-type: application/json' \
  --data "$login_body" \
  "$base_url/api/v1/mobile/auth/login")"
access_token="$(jq -er '.tokens.access' <<<"$login_response")"
refresh_token="$(jq -er '.tokens.refresh' <<<"$login_response")"

pull_response="$(curl "${curl_flags[@]}" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer ${access_token}" \
  --data '{"protocolVersion":1,"cursors":{}}' \
  "$base_url/api/v1/mobile/sync/pull")"
jq -e '.cursors and (.tasks | type == "array")' <<<"$pull_response" >/dev/null

if [[ "${SMOKE_ALLOW_MUTATIONS:-0}" == "1" ]]; then
  task_id="$(jq -er '.tasks[0].id' <<<"$pull_response")"
  client_op_id="smoke-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}"
  push_body="$(jq -n --arg taskId "$task_id" --arg clientOpId "$client_op_id" \
    '{protocolVersion:1, operations:[{clientOpId:$clientOpId, kind:"task.comment",
      payload:{taskId:$taskId, body:"Automated release smoke"}}]}')"
  curl "${curl_flags[@]}" \
    -H 'content-type: application/json' \
    -H "authorization: Bearer ${access_token}" \
    --data "$push_body" \
    "$base_url/api/v1/mobile/sync/push" | jq -e '.results[0].status == "applied"' >/dev/null
  echo "smoke passed: mobile push in dedicated smoke tenant"
fi

logout_body="$(jq -n --arg refreshToken "$refresh_token" \
  '{protocolVersion:1, refreshToken:$refreshToken}')"
curl "${curl_flags[@]}" \
  -H 'content-type: application/json' \
  --data "$logout_body" \
  "$base_url/api/v1/mobile/auth/logout" >/dev/null

echo "smoke passed: mobile login/pull/logout"
