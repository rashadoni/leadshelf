#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
backup="$repo_root/deploy/scripts/backup-production.sh"
verify="$repo_root/deploy/scripts/verify-production-backup.sh"
restore="$repo_root/deploy/scripts/restore-drill.sh"
fixture_root="$(mktemp -d /tmp/leadshelf-backup-recovery-test-XXXXXX)"
trap 'rm -rf -- "$fixture_root"' EXIT
chmod 700 "$fixture_root"
mkdir -p "$fixture_root/bin" "$fixture_root/prod" "$fixture_root/backups" "$fixture_root/restic-snapshot" "$fixture_root/drills"
chmod 700 "$fixture_root/backups" "$fixture_root/drills"

snapshot_id="$(printf 'a%.0s' {1..64})"
restic_log="$fixture_root/restic.log"
prod_env="$fixture_root/prod/.env.production"
backup_env="$fixture_root/prod/.env.backup"
compose_file="$fixture_root/prod/docker-compose.yml"
receipt="$fixture_root/backups/LAST_SUCCESS_RECEIPT"
printf '%s\n' 'services: {}' > "$compose_file"
cat > "$prod_env" <<'ENV'
POSTGRES_USER=leadshelf
POSTGRES_DB=leadshelf
S3_ENDPOINT=https://storage.invalid
S3_ACCESS_KEY=test-access
S3_SECRET_KEY=test-secret
S3_BUCKET=test-bucket
ENV
cat > "$backup_env" <<'ENV'
RESTIC_REPOSITORY=/test/repository
RESTIC_PASSWORD=test-only-password
LEADSHELF_RESTIC_CHECK_SUBSET=5%
ENV
chmod 600 "$prod_env" "$backup_env"

cat > "$fixture_root/bin/docker" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
args=" $* "
if [[ "$args" == *" compose "* && "$args" == *" exec -T postgres pg_dump "* ]]; then
  printf 'fake-custom-database-dump\n'
elif [[ "$args" == *" compose "* && "$args" == *" exec -T postgres psql "* ]]; then
  printf '35\n'
elif [[ "${1:-}" == "run" ]]; then
  printf 'fake-container-id\n'
elif [[ "${1:-}" == "exec" && "$args" == *" pg_isready "* ]]; then
  exit 0
elif [[ "${1:-}" == "exec" && "$args" == *" pg_restore "* ]]; then
  exit 0
elif [[ "${1:-}" == "exec" && "$args" == *" psql "* ]]; then
  printf '%s\n' "${DOCKER_TEST_RESTORE_MIGRATIONS:-35}"
elif [[ "${1:-}" == "cp" || "${1:-}" == "rm" ]]; then
  exit 0
else
  printf 'unexpected docker invocation\n' >&2
  exit 90
fi
SH

cat > "$fixture_root/bin/aws" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
destination=""
while (( $# > 0 )); do
  if [[ "$1" == "sync" ]]; then
    shift 2
    destination="$1"
    break
  fi
  shift
done
[[ -n "$destination" ]] || { echo "missing sync destination" >&2; exit 91; }
mkdir -p "$destination"
SH

cat > "$fixture_root/bin/restic" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
: "${RESTIC_TEST_LOG:?}" "${RESTIC_TEST_SNAPSHOT_DIR:?}" "${RESTIC_TEST_SNAPSHOT_ID:?}"
printf '%q ' "$@" >> "$RESTIC_TEST_LOG"
printf '\n' >> "$RESTIC_TEST_LOG"
case "${1:-}" in
  backup)
    rm -rf -- "$RESTIC_TEST_SNAPSHOT_DIR"
    mkdir -p "$RESTIC_TEST_SNAPSHOT_DIR"
    cp -a ./. "$RESTIC_TEST_SNAPSHOT_DIR/"
    printf '{"message_type":"summary","snapshot_id":"%s"}\n' "$RESTIC_TEST_SNAPSHOT_ID"
    ;;
  forget|check) exit 0 ;;
  snapshots)
    printf '[{"id":"%s","hostname":"%s","tags":["%s"]}]\n' "${RESTIC_TEST_RETURN_ID:-$RESTIC_TEST_SNAPSHOT_ID}" "${RESTIC_TEST_HOST:-leadshelf-prod}" "${RESTIC_TEST_TAG:-leadshelf-production}"
    ;;
  restore)
    [[ "${2:-}" == "$RESTIC_TEST_SNAPSHOT_ID" ]] || { echo "wrong snapshot ID" >&2; exit 92; }
    target=""
    shift 2
    while (( $# > 0 )); do
      if [[ "$1" == "--target" ]]; then target="$2"; break; fi
      shift
    done
    [[ -n "$target" ]] || { echo "missing restore target" >&2; exit 93; }
    cp -a "$RESTIC_TEST_SNAPSHOT_DIR/." "$target/"
    ;;
  *) echo "unexpected restic invocation" >&2; exit 94 ;;
esac
SH
chmod 755 "$fixture_root/bin/docker" "$fixture_root/bin/aws" "$fixture_root/bin/restic"

common_env=(
  "PATH=$fixture_root/bin:$PATH"
  "LEADSHELF_PROD_ROOT=$fixture_root/prod"
  "LEADSHELF_PROD_ENV=$prod_env"
  "LEADSHELF_BACKUP_ENV=$backup_env"
  "LEADSHELF_COMPOSE_FILE=$compose_file"
  "LEADSHELF_BACKUP_ROOT=$fixture_root/backups"
  "LEADSHELF_BACKUP_RECEIPT=$receipt"
  "LEADSHELF_BACKUP_RECEIPT_UID=$(id -u)"
  "LEADSHELF_RESTORE_DRILL_ROOT=$fixture_root/drills"
  "COMPOSE_PROJECT_NAME=leadshelf-prod"
  "RESTIC_TEST_LOG=$restic_log"
  "RESTIC_TEST_SNAPSHOT_DIR=$fixture_root/restic-snapshot"
  "RESTIC_TEST_SNAPSHOT_ID=$snapshot_id"
)

env "${common_env[@]}" "$backup" >/dev/null
[[ -f "$receipt" && ! -L "$receipt" && "$(stat -c '%a' "$receipt")" == "600" ]] || {
  echo "[backup-recovery-test] backup did not create a safe receipt" >&2
  exit 1
}
grep -Fxq "BACKUP_SNAPSHOT_ID=$snapshot_id" "$receipt" || {
  echo "[backup-recovery-test] receipt is not bound to exact snapshot" >&2
  exit 1
}
grep -Fq '  ./BACKUP-METADATA' "$fixture_root/restic-snapshot/SHA256SUMS" || {
  echo "[backup-recovery-test] metadata is not checksum-protected" >&2
  exit 1
}
grep -Fxq 'MEDIA_FILES=0' "$fixture_root/restic-snapshot/BACKUP-METADATA" || {
  echo "[backup-recovery-test] zero-media inventory was not recorded" >&2
  exit 1
}

env "${common_env[@]}" "$verify" >/dev/null
env "${common_env[@]}" "$restore" >/dev/null
grep -Fq "restore $snapshot_id --target" "$restic_log" || {
  echo "[backup-recovery-test] restore did not use receipt snapshot ID" >&2
  exit 1
}
if grep -Fq 'restore latest' "$restic_log"; then
  echo "[backup-recovery-test] restore fell back to ambiguous latest snapshot" >&2
  exit 1
fi

expect_verify_failure() {
  local label="$1"
  shift
  if env "${common_env[@]}" "$@" "$verify" >/dev/null 2>&1; then
    echo "[backup-recovery-test] expected verification failure: $label" >&2
    exit 1
  fi
}

expect_verify_failure "repository host mismatch" RESTIC_TEST_HOST=neighbor-prod
expect_verify_failure "repository snapshot mismatch" RESTIC_TEST_RETURN_ID="$(printf 'b%.0s' {1..64})"
expect_verify_failure "repository tag mismatch" RESTIC_TEST_TAG=other

cp "$receipt" "$fixture_root/receipt-valid"
ln -sf "$fixture_root/receipt-valid" "$receipt"
expect_verify_failure "symlinked receipt"
rm -- "$receipt"
cp "$fixture_root/receipt-valid" "$receipt"
ln -s "$fixture_root/backups" "$fixture_root/receipt-dir-link"
expect_verify_failure "symlinked receipt directory" LEADSHELF_BACKUP_RECEIPT="$fixture_root/receipt-dir-link/LAST_SUCCESS_RECEIPT"
printf 'BACKUP_HOST=leadshelf-prod\n' >> "$receipt"
expect_verify_failure "duplicate receipt field"
cp "$fixture_root/receipt-valid" "$receipt"
sed -i "s/BACKUP_CREATED_AT_EPOCH=.*/BACKUP_CREATED_AT_EPOCH=$(( $(date -u +%s) + 3600 ))/" "$receipt"
expect_verify_failure "future-dated receipt"
cp "$fixture_root/receipt-valid" "$receipt"

cp "$receipt" "$fixture_root/receipt-copy"
chmod 644 "$receipt"
expect_verify_failure "unsafe receipt mode"
mv "$fixture_root/receipt-copy" "$receipt"
chmod 600 "$receipt"

chmod 644 "$backup_env"
expect_verify_failure "unsafe backup config mode"
chmod 600 "$backup_env"

sed -i "s/BACKUP_CREATED_AT_EPOCH=.*/BACKUP_CREATED_AT_EPOCH=$(( $(date -u +%s) - 27 * 3600 ))/" "$receipt"
expect_verify_failure "stale receipt"

cp "$fixture_root/receipt-valid" "$receipt"
if env "${common_env[@]}" DOCKER_TEST_RESTORE_MIGRATIONS=34 "$restore" >/dev/null 2>&1; then
  echo "[backup-recovery-test] expected restore failure: migration inventory mismatch" >&2
  exit 1
fi

cp "$fixture_root/restic-snapshot/BACKUP-METADATA" "$fixture_root/metadata-valid"
sed -i 's/MEDIA_FILES=0/MEDIA_FILES=1/' "$fixture_root/restic-snapshot/BACKUP-METADATA"
(
  cd "$fixture_root/restic-snapshot"
  sha256sum BACKUP-METADATA > "$fixture_root/metadata-checksum"
  sed -i '/  .\/BACKUP-METADATA$/d' SHA256SUMS
  sed 's#  BACKUP-METADATA#  ./BACKUP-METADATA#' "$fixture_root/metadata-checksum" >> SHA256SUMS
)
if env "${common_env[@]}" "$restore" >/dev/null 2>&1; then
  echo "[backup-recovery-test] expected restore failure: media inventory mismatch" >&2
  exit 1
fi
cp "$fixture_root/metadata-valid" "$fixture_root/restic-snapshot/BACKUP-METADATA"

echo "[backup-recovery-test] PASS"
