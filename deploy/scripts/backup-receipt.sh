#!/usr/bin/env bash

# Sourced by backup verification and restore tooling. Receipt contents are
# parsed as data and are never evaluated as shell.
read_backup_receipt() {
  local receipt="$1"
  local expected_uid="${2:-$(id -u)}"
  local receipt_dir receipt_mode receipt_uid dir_mode dir_uid line key value
  local -A fields=()
  local -A allowed=(
    [BACKUP_SNAPSHOT_ID]=1
    [BACKUP_CREATED_AT_EPOCH]=1
    [BACKUP_HOST]=1
  )

  case "$receipt" in
    /*) ;;
    *) echo "[backup-receipt] receipt path must be absolute" >&2; return 1 ;;
  esac
  [[ "$receipt" != "/" ]] || {
    echo "[backup-receipt] refusing / as receipt" >&2
    return 1
  }
  [[ -f "$receipt" && ! -L "$receipt" ]] || {
    echo "[backup-receipt] receipt must be a regular non-symlink file" >&2
    return 1
  }
  [[ "$expected_uid" =~ ^[0-9]+$ ]] || {
    echo "[backup-receipt] expected owner must be numeric" >&2
    return 1
  }

  receipt_dir="$(dirname -- "$receipt")"
  [[ -d "$receipt_dir" && ! -L "$receipt_dir" ]] || {
    echo "[backup-receipt] receipt directory must be a non-symlink directory" >&2
    return 1
  }
  receipt_mode="$(stat -c '%a' -- "$receipt")"
  receipt_uid="$(stat -c '%u' -- "$receipt")"
  dir_mode="$(stat -c '%a' -- "$receipt_dir")"
  dir_uid="$(stat -c '%u' -- "$receipt_dir")"
  [[ "$receipt_mode" == "600" ]] || {
    echo "[backup-receipt] receipt must have mode 0600" >&2
    return 1
  }
  [[ "$receipt_uid" == "$expected_uid" && "$dir_uid" == "$expected_uid" ]] || {
    echo "[backup-receipt] receipt or directory has unexpected owner" >&2
    return 1
  }
  (( (8#$dir_mode & 0022) == 0 )) || {
    echo "[backup-receipt] receipt directory must not be group/world writable" >&2
    return 1
  }

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || {
      echo "[backup-receipt] receipt contains a malformed line" >&2
      return 1
    }
    key="${line%%=*}"
    value="${line#*=}"
    [[ -n "${allowed[$key]:-}" ]] || {
      echo "[backup-receipt] receipt contains an unknown field" >&2
      return 1
    }
    [[ -z "${fields[$key]+present}" ]] || {
      echo "[backup-receipt] receipt contains a duplicate field" >&2
      return 1
    }
    (( ${#value} >= 1 && ${#value} <= 128 )) || {
      echo "[backup-receipt] receipt field has invalid length" >&2
      return 1
    }
    [[ "$value" =~ ^[A-Za-z0-9._-]+$ ]] || {
      echo "[backup-receipt] receipt field contains unsafe characters" >&2
      return 1
    }
    fields[$key]="$value"
  done < "$receipt"

  for key in BACKUP_SNAPSHOT_ID BACKUP_CREATED_AT_EPOCH BACKUP_HOST; do
    [[ -n "${fields[$key]:-}" ]] || {
      echo "[backup-receipt] receipt is missing a required field" >&2
      return 1
    }
  done
  [[ "${fields[BACKUP_SNAPSHOT_ID]}" =~ ^[0-9a-f]{64}$ ]] || {
    echo "[backup-receipt] snapshot ID must be an exact lowercase restic ID" >&2
    return 1
  }
  [[ "${fields[BACKUP_CREATED_AT_EPOCH]}" =~ ^[0-9]{10}$ ]] || {
    echo "[backup-receipt] backup epoch must be a ten-digit UTC epoch" >&2
    return 1
  }
  [[ "${fields[BACKUP_HOST]}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || {
    echo "[backup-receipt] backup host is invalid" >&2
    return 1
  }

  BACKUP_RECEIPT_SNAPSHOT_ID="${fields[BACKUP_SNAPSHOT_ID]}"
  BACKUP_RECEIPT_CREATED_AT_EPOCH="${fields[BACKUP_CREATED_AT_EPOCH]}"
  BACKUP_RECEIPT_HOST="${fields[BACKUP_HOST]}"
}
