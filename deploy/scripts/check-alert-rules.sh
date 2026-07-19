#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
rules_dir="$repo_root/deploy/monitoring"
prometheus_tool_image="${PROMETHEUS_TOOL_IMAGE:-prom/prometheus@sha256:69f5241418838263316593f7274a304b095c40bcf22e57272865da91bd60a8ac}"

docker run --rm --entrypoint /bin/promtool \
  -v "$rules_dir:/rules:ro" \
  "$prometheus_tool_image" check rules /rules/leadshelf-alerts.yml

docker run --rm --entrypoint /bin/promtool \
  -v "$rules_dir:/rules:ro" \
  "$prometheus_tool_image" test rules /rules/leadshelf-alerts.test.yml
