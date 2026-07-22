#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checker="$script_dir/check-production-env-contract.sh"

output_file="$(mktemp)"
trap 'rm -f "$output_file"' EXIT

if env -i bash "$checker" >"$output_file" 2>&1; then
  printf 'expected missing env contract to fail\n' >&2
  exit 1
fi

grep -q "DATABASE_URL" "$output_file"
grep -q "LEADSHELF_PROOF_PRIVACY_MODE" "$output_file"

env -i \
  DATABASE_URL="postgresql://example" \
  JWT_SECRET="test-jwt-secret" \
  AUTH_LOCKOUT_MAX_FAILURES="5" \
  AUTH_LOCKOUT_WINDOW_SECONDS="900" \
  AUTH_LOCKOUT_DURATION_SECONDS="1800" \
  AUTH_LOCKOUT_PEPPER="test-pepper-not-a-production-secret" \
  LEADSHELF_PROOF_PRIVACY_MODE="no_people_in_frame_attestation" \
  LEADSHELF_PROOF_PRIVACY_APPROVAL="privacy-test-approval" \
  S3_ENDPOINT="https://s3.example" \
  S3_ACCESS_KEY="test-access-key" \
  S3_SECRET_KEY="test-secret-key" \
  S3_BUCKET="test-bucket" \
  METRICS_BEARER_TOKEN="test-metrics-token" \
  bash "$checker" >"$output_file"

grep -q "Production env contract contains required variable names" "$output_file"

if env -i \
  DATABASE_URL="postgresql://example" \
  JWT_SECRET="test-jwt-secret" \
  AUTH_LOCKOUT_MAX_FAILURES="5" \
  AUTH_LOCKOUT_WINDOW_SECONDS="900" \
  AUTH_LOCKOUT_DURATION_SECONDS="1800" \
  AUTH_LOCKOUT_PEPPER="test-pepper-not-a-production-secret" \
  LEADSHELF_PROOF_PRIVACY_MODE="unsupported" \
  LEADSHELF_PROOF_PRIVACY_APPROVAL="privacy-test-approval" \
  S3_ENDPOINT="https://s3.example" \
  S3_ACCESS_KEY="test-access-key" \
  S3_SECRET_KEY="test-secret-key" \
  S3_BUCKET="test-bucket" \
  METRICS_BEARER_TOKEN="test-metrics-token" \
  bash "$checker" >"$output_file" 2>&1; then
  printf 'expected unsupported privacy mode to fail\n' >&2
  exit 1
fi

grep -q "LEADSHELF_PROOF_PRIVACY_MODE must equal no_people_in_frame_attestation" "$output_file"

printf 'production env contract test passed\n'
