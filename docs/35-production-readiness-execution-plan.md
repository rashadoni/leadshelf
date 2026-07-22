# Production readiness execution plan

Updated: 2026-07-22.

Scope: finish verifiable production-readiness work without pretending external
access exists. VPS/deployed production actions require explicit permission and
are marked separately.

## Current repository state

- Project: LeadShelf.
- Branch: `codex/non-vps-production-readiness`.
- Latest local/remote SHA at plan creation:
  `4dce0383b0f6921dd83eebe18d4320ab7d00a763`.
- Previous PR `#23` is already merged into `main`; later commits on this
  branch are not covered by that PR.
- GitHub Actions observation: `ci.yml` runs on `push` to `main` and
  `pull_request`; `mobile-native.yml` runs on `pull_request` and manual
  dispatch. Therefore new commits on `codex/non-vps-production-readiness`
  do not automatically run CI unless a new PR is opened or workflows are run
  manually.
- Local unstaged deletions intentionally not owned by this plan:
  `video/.probe-film.mjs`, `video/.verify-film.sh`,
  `video/scenarios/overrides.mjs`.

## 1. GitHub Actions

Goal: prove the latest branch SHA is checked by CI and mobile-native compile.

Current status:

- Remote PR checks were green for earlier SHA `e53e9b8`.
- Latest branch SHA is newer and has no Actions run yet.
- Reason: the branch has no open PR after PR `#23` was merged.

Next actions:

1. Open a new PR from `codex/non-vps-production-readiness` to `main`.
2. Confirm `CI` and `Mobile native compile` start on the PR.
3. If they do not start, inspect workflow path filters and repository Actions
   settings.
4. Preserve evidence links and exact head SHA in this file or
   `docs/33-non-vps-release-readiness.md`.

PASS evidence:

- PR URL.
- Head SHA.
- `CI` success URL.
- `Mobile native compile` success URL and artifact SHA.

## 2. Expo/EAS signed release

Goal: build signed mobile artifacts from exact `main` with frozen credentials.

Required external inputs:

- GitHub environment `mobile-release` secret `EXPO_TOKEN`.
- EAS Android keystore approved by the release owner.
- EAS Apple credentials and Apple team/TestFlight access for iOS.
- Release owner acknowledgement: `SIGNED-RELEASE`.

Next actions after inputs exist:

1. Merge checked PR to `main`.
2. Run `Mobile signed release` manually from `main`.
3. Use platform `android` profile `preview` first.
4. Verify downloaded APK/AAB checksum artifact.
5. Repeat for iOS only after Apple credentials are approved.

PASS evidence:

- EAS build ID.
- APK/AAB/IPA filename and SHA-256.
- `mobile-release-evidence.json`.
- Confirmation that workflow used `--freeze-credentials`.

BLOCKED until `EXPO_TOKEN` and EAS credentials are provided.

## 3. Physical device matrix

Goal: prove the signed app survives real device behavior.

Required devices:

- Current Android.
- Low-end Android.
- iPhone.

Smoke matrix:

- Login/refresh/logout.
- Route and store context.
- Check-in.
- Planogram view.
- Barcode lookup.
- Guided photo burst and guided video.
- Comment.
- Checkout.
- Offline before every step, reconnect, sync.
- App kill/restart with pending outbox.
- Disk-full/near-limit behavior.
- Camera permission revoke/restore.
- EXIF/orientation handling.

PASS evidence:

- Device model, OS version, app artifact SHA.
- Scenario result for each device.
- Failure list with bug links or commit SHA for fixes.

BLOCKED until signed artifact and physical devices exist.

## 4. Production/VPS/deployed runtime

Goal: verify deployed readiness, metrics, headers, deploy/rollback, and smoke.

Boundary:

- Do not touch VPS without explicit permission.

Read-only checks after permission:

- `GET /api/health`.
- `GET /api/ready`.
- `GET /api/metrics` with bearer token from owner.
- Login headers: CSP, HSTS, frame, nosniff, no `x-powered-by`.
- Confirm deployed SHA.

Mutation checks after explicit release window:

- Backup receipt.
- Restore drill receipt.
- Exact-SHA deploy.
- Post-deploy smoke.
- Rollback/forward-fix drill evidence.

BLOCKED until VPS permission, secrets, and release window exist.

## 5. Production env values

Goal: avoid hidden runtime defaults in production.

Required owner-provided values:

- `DATABASE_URL`.
- `JWT_SECRET`.
- `AUTH_LOCKOUT_MAX_FAILURES`.
- `AUTH_LOCKOUT_WINDOW_SECONDS`.
- `AUTH_LOCKOUT_DURATION_SECONDS`.
- `AUTH_LOCKOUT_PEPPER`.
- `LEADSHELF_PROOF_PRIVACY_MODE=no_people_in_frame_attestation`.
- `LEADSHELF_PROOF_PRIVACY_APPROVAL=<privacy/legal evidence id>`.
- `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`.
- `METRICS_BEARER_TOKEN`.
- Sentry DSN / alert webhooks if observability is in scope.

PASS evidence:

- `/api/ready` returns 200 in production runtime.
- No secret values are copied into docs, logs, CI artifacts, or tickets.
- Rotation owner and date are recorded outside Git.

## 6. ERP/client data

Goal: prove import and reconciliation on real client-like data.

Required external inputs:

- ERP/1C mapping sheet.
- Timezone, currency, VAT, unit mapping, barcode policy.
- Sample CSV/XLSX/API payloads for products, prices, stock, sales,
  assortment.
- 14 consecutive manifests or exchange receipts for pilot readiness.

Next actions after inputs exist:

1. Run staging import with manifest row counts and SHA-256.
2. Re-run same input to prove idempotency.
3. Capture reconciliation report for count/checksum/totals.
4. Document every mismatch as explained, fixed, or blocked.

PASS evidence:

- 14 exchange receipts with no unexplained count/checksum/amount drift.
- Replay report proves no duplicates.

## 7. Privacy/legal decision

Goal: make proof media legally operable before pilot.

Current technical state:

- Face blur before persistence is not implemented.
- Server and readiness now fail-closed unless production has explicit
  no-people-in-frame policy approval.
- Mobile guided capture adds operator attestation.

Required owner decision:

- Either approve `no_people_in_frame_attestation` as the operating mode, with
  `LEADSHELF_PROOF_PRIVACY_APPROVAL`, or approve a CV provider/dataset for
  true pre-store face blur.

PASS evidence:

- Privacy/legal approval ID.
- Updated runtime env.
- Device smoke confirms proof uploads work only under the approved mode.

BLOCKED until privacy/legal owner gives the approval receipt or authorizes a
true blur implementation.

