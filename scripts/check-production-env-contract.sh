#!/usr/bin/env bash
set -euo pipefail

missing=()
invalid=()

require() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    missing+=("$name")
  fi
}

require_one_of() {
  local name="$1"
  local expected="$2"
  if [ -z "${!name:-}" ]; then
    missing+=("$name")
  elif [ "${!name}" != "$expected" ]; then
    invalid+=("$name must equal $expected")
  fi
}

require DATABASE_URL
require JWT_SECRET
require AUTH_LOCKOUT_MAX_FAILURES
require AUTH_LOCKOUT_WINDOW_SECONDS
require AUTH_LOCKOUT_DURATION_SECONDS
require AUTH_LOCKOUT_PEPPER
require_one_of LEADSHELF_PROOF_PRIVACY_MODE no_people_in_frame_attestation
require LEADSHELF_PROOF_PRIVACY_APPROVAL
require S3_ENDPOINT
require S3_ACCESS_KEY
require S3_SECRET_KEY
require S3_BUCKET
require METRICS_BEARER_TOKEN

if [ "${#missing[@]}" -gt 0 ] || [ "${#invalid[@]}" -gt 0 ]; then
  printf 'Production env contract is not satisfied.\n' >&2
  if [ "${#missing[@]}" -gt 0 ]; then
    printf 'Missing variables:\n' >&2
    printf '  %s\n' "${missing[@]}" >&2
  fi
  if [ "${#invalid[@]}" -gt 0 ]; then
    printf 'Invalid variables:\n' >&2
    printf '  %s\n' "${invalid[@]}" >&2
  fi
  exit 1
fi

printf 'Production env contract contains required variable names.\n'
