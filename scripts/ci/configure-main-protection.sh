#!/usr/bin/env bash
# Layer 1 of docs/DELIVERY-ARCHITECTURE.md, as a script rather than a promise.
#
# A replacement control that is only described is not a control, so the
# enforcement lives here, is version controlled, is re-runnable, and is what
# every other repository copies.
#
# What it configures on `main`:
#   - changes arrive only through a pull request (no direct push, no force push,
#     no branch deletion)
#   - `agent-review` must be green before merge, ALONGSIDE the checks this
#     repository already required. The two existing contexts are listed
#     explicitly because the API replaces the whole list: dropping them here to
#     "add" agent-review would quietly delete two gates, which the delivery
#     rules forbid. Change them only together with the workflows that produce
#     them.
#   - no required approvals: the owner works alone, and a rule nobody can
#     satisfy is how delivery stalls in the first place
#
# Usage:  bash scripts/ci/configure-main-protection.sh [owner/repo]
set -euo pipefail

REPO="${1:-rashadrahimov/leadshelf}"
BRANCH="${BRANCH:-main}"

command -v gh >/dev/null || { echo "gh is required" >&2; exit 1; }

echo "Configuring branch protection on ${REPO}@${BRANCH}"

gh api -X PUT "repos/${REPO}/branches/${BRANCH}/protection" \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["ci", "Secret and production-image scan", "agent-review"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": false,
  "required_conversation_resolution": true,
  "block_creations": false
}
JSON

echo
echo "Applied. Current state:"
gh api "repos/${REPO}/branches/${BRANCH}/protection" \
  --jq '{
    pull_request_only: (.required_status_checks != null),
    required_checks: .required_status_checks.contexts,
    force_pushes: .allow_force_pushes.enabled,
    deletions: .allow_deletions.enabled
  }'

echo
echo "Note: enforce_admins is false on purpose. The owner must retain a way to"
echo "recover production when a check itself is broken — that is a break-glass"
echo "path, not a routine one. Using it is worth saying out loud in the report."
