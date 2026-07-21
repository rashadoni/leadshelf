#!/usr/bin/env bash
set -Eeuo pipefail

env_file="${LEADSHELF_BACKUP_ENV_FILE:-/opt/leadshelf/prod/.env.backup}"
if [[ -r "$env_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
fi

: "${OPERATIONS_ALERT_WEBHOOK_URL:?OPERATIONS_ALERT_WEBHOOK_URL is required for failure alerts}"
event="${1:-unknown_failure}"
host_name="$(hostname)"
payload="$(jq -n \
  --arg service "leadshelf" \
  --arg event "$event" \
  --arg host "$host_name" \
  --arg timestamp "$(date -u +%FT%TZ)" \
  '{service:$service,event:$event,host:$host,timestamp:$timestamp,severity:"critical"}')"

curl --fail-with-body --silent --show-error \
  --connect-timeout 5 --max-time 20 \
  -H 'content-type: application/json' \
  --data "$payload" \
  "$OPERATIONS_ALERT_WEBHOOK_URL" >/dev/null

echo "operations alert delivered: ${event}"
