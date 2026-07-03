# Mobile, срез 1: замороженный mobile API (Codex, 2026-07-03)

**Verdict**
Build slice 1 as a frozen, narrow mobile backend contract. No Expo UI, no CRM spillover, no AI.

**Stress-Test**
Roles converge on: employee-code auth, bearer mobile JWT, assigned-task scoping, strict idempotency, server-won conflicts, multipart-through-app for pilot.
Main dissent: presigned upload is architecturally cleaner, but prod MinIO is not public, so it is not realistic for this slice.
Confidence: High. External Codex peer pass was unavailable because the MCP call was cancelled.

**Key Decisions**
1. Auth: use employee code + PIN for mobile, not email/password.
   Small schema correction: `User.email` should become nullable, add `User.employeeCode String?` unique per org. Do not force `STORE_STAFF` into `FieldAgent`.
   PIN uses existing Argon2 `passwordHash`.

2. Device/session: login creates or updates `MobileDevice`, creates `AuthSession`, binds refresh session to `deviceId`, returns JSON bearer tokens.
   Extend access JWT with `did`. Refresh route must tolerate same-device lost-response retry with a short grace window, otherwise mobile refresh rotation will falsely revoke sessions.

3. Store scope: pilot scope is assigned tasks only.
   Mobile user sees tasks where `Task.assigneeId = user.id`. Stores are derived from those tasks. No general “my stores” table in slice 1.

4. Sync: use per-collection server cursors, not one global timestamp.
   Cursor token should be server-issued `{updatedAt,id}` encoded per collection. Persist only on `/sync/ack`.

5. Photos: use multipart upload through app API for pilot.
   App server streams to internal MinIO. Later switch to presigned when R2/public object endpoint exists.

**Routes**
All `/api/v1/mobile/*` require `protocolVersion=1` via header/body/query and return `426` if missing/unsupported, except `/protocol`.

- `GET /api/v1/mobile/protocol`
- `POST /api/v1/mobile/auth/login`
  `{ protocolVersion, orgSlug, employeeCode, pin, device:{ id, platform, deviceName?, pushToken? } }`
- `POST /api/v1/mobile/auth/refresh`
  `{ protocolVersion, refreshToken, deviceId }`
- `POST /api/v1/mobile/auth/logout`
- `PATCH /api/v1/mobile/device`
  `{ pushToken?, deviceName? }`
- `POST /api/v1/mobile/sync/pull`
  `{ protocolVersion, deviceId, cursors:{ tasks?, stores?, planogramBundles?, photoSubmissions? }, limit? }`
- `POST /api/v1/mobile/sync/push`
  `{ protocolVersion, deviceId, operations:[{ clientOpId, kind, payload, clientCreatedAt }] }`
- `POST /api/v1/mobile/sync/ack`
  `{ protocolVersion, deviceId, appliedCursors, appliedClientOpIds? }`
- `POST /api/v1/mobile/photos/upload`
  multipart: `file`, `clientPhotoId`, `taskId`, `takenAt`, `sha256?`, `exifJson?`
- `GET /api/v1/mobile/tasks/:taskId`
  debug/detail route; same shape as pulled task bundle.
- `GET /api/v1/mobile/media/:key`
  bearer-protected media proxy, returns absolute usable image bytes.

**Push Ops**
`task.status` payload:
`{ taskId, expectedStatus, toStatus }`

Use existing FSM. If current status equals `toStatus`, return `ok/already_current`. If mismatch, return `conflict`, write `SyncConflict`, server wins.

`photo.submit` payload:
`{ clientPhotoId, taskId, storeId, uploadedObjectKey, takenAt, exif?, comment?, expectedTaskStatus:"IN_PROGRESS" }`

Photo is deduped by `[organizationId, clientPhotoId]`. If task is expired/completed, keep the photo as evidence but return conflict and do not move task status.

`task.comment` payload:
`{ taskId, body }`

Comments are appended to `TaskComment`, scoped to assigned tasks only, and
idempotent through the same `deviceId + clientOpId` push ledger.

**Pull Payload**
Return only mobile-needed entities:

- `tasks`: id, title, status, dueAt, storeId, planogramVersionId, updatedAt
- `stores`: id, name, code, address
- `planogramBundles`: version, equipment, shelves, placements, product info, dimensions, facings, image keys/media URLs
- `photoSubmissions`: clientPhotoId, taskId, url/key, createdAt

Published planogram bundles are immutable, so do not stream every placement as independently editable mobile state.

**Tests**
Use Vitest integration tests against real Postgres, like existing worker/db tests.

Cover:
- protocol `426`;
- employee-code login, device creation, refresh rotation/reuse;
- assigned-task visibility and tenant isolation;
- initial pull -> ack -> second pull empty;
- task status push idempotency and conflict;
- task comment push idempotency;
- duplicate `clientOpId`;
- duplicate `clientPhotoId`;
- multipart upload -> photo.submit -> `PHOTO_SUBMITTED`;
- expired/completed task server-wins;
- Decimal serialized as string;
- media proxy with bearer auth.

**Pitfalls**
- Never trust client clocks for cursors.
- Do not expose relative media URLs to mobile.
- Do not send Prisma `Decimal` as JS number.
- Big planograms need pagination/compression later.
- Refresh rotation needs mobile retry tolerance.
- Photo upload and metadata push can split; temp objects need cleanup worker.
- Server must never discard a valid uploaded photo just because task status conflicted.
