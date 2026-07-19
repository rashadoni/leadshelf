#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
verifier="$repo_root/deploy/scripts/verify-release-approval.sh"
fixture_root="$(mktemp -d /tmp/leadshelf-release-preflight-XXXXXX)"
trap 'rm -rf -- "$fixture_root"' EXIT
chmod 700 "$fixture_root"
receipt="$fixture_root/production.env"
release_sha="0123456789abcdef0123456789abcdef01234567"

write_receipt() {
  local restore_epoch="$1"
  {
    printf 'RELEASE_SHA=%s\n' "$release_sha"
    printf 'APPROVAL_ID=CHG-2026-001\n'
    printf 'RESTORE_DRILL_ID=DRILL-2026-001\n'
    printf 'RESTORE_DRILL_EPOCH=%s\n' "$restore_epoch"
    printf 'BACKUP_SNAPSHOT_ID=restic-abc123\n'
    printf 'ROLLBACK_OWNER_ID=infra-primary\n'
  } > "$receipt"
  chmod 600 "$receipt"
}

run_verifier() {
  LEADSHELF_RELEASE_SHA="$1" \
  LEADSHELF_RELEASE_RECEIPT="$2" \
  LEADSHELF_RELEASE_RECEIPT_UID="$(id -u)" \
  LEADSHELF_RESTORE_EVIDENCE_MAX_AGE_DAYS=31 \
    "$verifier"
}

expect_failure() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "[release-preflight-test] expected failure: $label" >&2
    exit 1
  fi
}

write_receipt "$(date -u +%s)"
run_verifier "$release_sha" "$receipt" >/dev/null

expect_failure "different SHA" run_verifier "1123456789abcdef0123456789abcdef01234567" "$receipt"

printf 'APPROVAL_ID=duplicate\n' >> "$receipt"
expect_failure "duplicate field" run_verifier "$release_sha" "$receipt"

write_receipt "$(( $(date -u +%s) - 32 * 86400 ))"
expect_failure "stale restore drill" run_verifier "$release_sha" "$receipt"

write_receipt "$(date -u +%s)"
chmod 644 "$receipt"
expect_failure "unsafe mode" run_verifier "$release_sha" "$receipt"

chmod 600 "$receipt"
ln -s "$receipt" "$fixture_root/release-link.env"
expect_failure "symlink receipt" run_verifier "$release_sha" "$fixture_root/release-link.env"

workflow="$repo_root/.github/workflows/ci.yml"
deploy_job="$fixture_root/deploy-job.yml"
deploy_wrapper="$repo_root/deploy/scripts/deploy-approved-release.sh"
awk '/^  deploy:/{found=1} found' "$workflow" > "$deploy_job"

require_workflow_text() {
  grep -Fq -- "$1" "$deploy_job" || {
    echo "[release-preflight-test] missing workflow invariant: $1" >&2
    exit 1
  }
}

forbid_workflow_text() {
  if grep -Fq -- "$1" "$deploy_job"; then
    echo "[release-preflight-test] forbidden workflow behavior: $1" >&2
    exit 1
  fi
}

require_workflow_text "vars.PRODUCTION_DEPLOY_ENABLED == 'true'"
require_workflow_text "name: production"
require_workflow_text "timeout-minutes: 120"
require_workflow_text "cancel-in-progress: false"
require_workflow_text 'DEPLOY_KNOWN_HOSTS: ${{ secrets.DEPLOY_KNOWN_HOSTS }}'
require_workflow_text 'sudo -n /usr/local/sbin/leadshelf-deploy-approved-release "$RELEASE_SHA"'
require_workflow_text '"$PRODUCTION_URL/api/ready"'
forbid_workflow_text 'git pull'
forbid_workflow_text 'ssh-keyscan'
forbid_workflow_text 'root@$HOST'
forbid_workflow_text 'seed-demo'
forbid_workflow_text 'sudo -n /bin/bash'

for text in \
  'LEADSHELF_RELEASE_SHA="$release_sha" "$release_verifier"' \
  'flock -n 9' \
  'deploy/scripts/backup-production.sh' \
  'deploy/scripts/verify-production-backup.sh' \
  'git fetch --depth=1 origin "$release_sha"' \
  'git checkout --detach "$release_sha"' \
  'docker compose run --rm migrate' \
  'docker compose up -d --wait --wait-timeout 300'; do
  grep -Fq -- "$text" "$deploy_wrapper" || {
    echo "[release-preflight-test] missing wrapper invariant: $text" >&2
    exit 1
  }
done
if grep -Eq 'git pull|seed-demo|docker compose down' "$deploy_wrapper"; then
  echo "[release-preflight-test] wrapper contains forbidden deploy behavior" >&2
  exit 1
fi

approval_line="$(grep -nF 'LEADSHELF_RELEASE_SHA="$release_sha" "$release_verifier"' "$deploy_wrapper" | cut -d: -f1)"
backup_line="$(grep -nF 'deploy/scripts/backup-production.sh' "$deploy_wrapper" | cut -d: -f1)"
verify_line="$(grep -nF 'deploy/scripts/verify-production-backup.sh' "$deploy_wrapper" | cut -d: -f1)"
migrate_line="$(grep -nF 'docker compose run --rm migrate' "$deploy_wrapper" | cut -d: -f1)"
wait_line="$(grep -nF 'docker compose up -d --wait --wait-timeout 300' "$deploy_wrapper" | cut -d: -f1)"
receipt_line="$(grep -nF '> "$prod_root/LAST_RELEASE"' "$deploy_wrapper" | cut -d: -f1)"
(( approval_line < backup_line && backup_line < verify_line && verify_line < migrate_line )) || {
  echo "[release-preflight-test] release evidence and verified backup must precede migration" >&2
  exit 1
}
(( migrate_line < wait_line && wait_line < receipt_line )) || {
  echo "[release-preflight-test] service health wait must precede release success receipt" >&2
  exit 1
}

echo "[release-preflight-test] PASS"
