#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() { echo "[release-preflight] $*" >&2; exit 1; }

release_sha="${LEADSHELF_RELEASE_SHA:-}"
receipt="${LEADSHELF_RELEASE_RECEIPT:-/opt/leadshelf/prod/release-evidence/production.env}"
expected_uid="${LEADSHELF_RELEASE_RECEIPT_UID:-0}"
max_age_days="${LEADSHELF_RESTORE_EVIDENCE_MAX_AGE_DAYS:-31}"

[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || fail "LEADSHELF_RELEASE_SHA must be an exact lowercase 40-character commit SHA"
[[ "$expected_uid" =~ ^[0-9]+$ ]] || fail "LEADSHELF_RELEASE_RECEIPT_UID must be numeric"
[[ "$max_age_days" =~ ^[0-9]+$ ]] || fail "LEADSHELF_RESTORE_EVIDENCE_MAX_AGE_DAYS must be numeric"
(( max_age_days >= 1 && max_age_days <= 90 )) || fail "restore evidence maximum age must be between 1 and 90 days"

case "$receipt" in
  /*) ;;
  *) fail "release receipt path must be absolute" ;;
esac
[[ "$receipt" != "/" ]] || fail "refusing / as release receipt"
[[ -f "$receipt" && ! -L "$receipt" ]] || fail "release receipt must be a regular non-symlink file"

receipt_dir="$(dirname -- "$receipt")"
receipt_mode="$(stat -c '%a' -- "$receipt")"
receipt_uid="$(stat -c '%u' -- "$receipt")"
dir_mode="$(stat -c '%a' -- "$receipt_dir")"
dir_uid="$(stat -c '%u' -- "$receipt_dir")"
[[ "$receipt_mode" == "600" ]] || fail "release receipt must have mode 0600"
[[ "$receipt_uid" == "$expected_uid" ]] || fail "release receipt has unexpected owner"
[[ "$dir_uid" == "$expected_uid" ]] || fail "release receipt directory has unexpected owner"
(( (8#$dir_mode & 0022) == 0 )) || fail "release receipt directory must not be group/world writable"

declare -A fields=()
declare -A allowed=(
  [RELEASE_SHA]=1
  [APPROVAL_ID]=1
  [RESTORE_DRILL_ID]=1
  [RESTORE_DRILL_EPOCH]=1
  [BACKUP_SNAPSHOT_ID]=1
  [ROLLBACK_OWNER_ID]=1
)

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  [[ "$line" == *=* ]] || fail "release receipt contains a malformed line"
  key="${line%%=*}"
  value="${line#*=}"
  [[ -n "${allowed[$key]:-}" ]] || fail "release receipt contains an unknown field"
  [[ -z "${fields[$key]+present}" ]] || fail "release receipt contains a duplicate field"
  (( ${#value} >= 1 && ${#value} <= 160 )) || fail "release receipt field has invalid length"
  [[ "$value" =~ ^[A-Za-z0-9._:@/+\-]+$ ]] || fail "release receipt field contains unsafe characters"
  fields[$key]="$value"
done < "$receipt"

for key in RELEASE_SHA APPROVAL_ID RESTORE_DRILL_ID RESTORE_DRILL_EPOCH BACKUP_SNAPSHOT_ID ROLLBACK_OWNER_ID; do
  [[ -n "${fields[$key]:-}" ]] || fail "release receipt is missing a required field"
done

[[ "${fields[RELEASE_SHA]}" == "$release_sha" ]] || fail "release receipt is for a different commit SHA"
[[ "${fields[RESTORE_DRILL_EPOCH]}" =~ ^[0-9]{10}$ ]] || fail "RESTORE_DRILL_EPOCH must be a ten-digit UTC epoch"

now_epoch="$(date -u +%s)"
restore_epoch="${fields[RESTORE_DRILL_EPOCH]}"
age_seconds="$(( now_epoch - restore_epoch ))"
max_age_seconds="$(( max_age_days * 86400 ))"
(( age_seconds >= 0 && age_seconds <= max_age_seconds )) || fail "restore drill evidence is missing, future-dated or stale"

echo "[release-preflight] exact SHA, approval, backup/restore evidence and rollback owner verified"
