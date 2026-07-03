# Mobile, срез 2: Expo-приложение (Codex, 2026-07-03)

**(a) Storage Decision**
Use `expo-sqlite` now.

Rationale: slice 2 needs an Expo Go demo today against `https://hermescrm.xyz`; WatermelonDB is better long-term but requires dev-client/native build and blocks instant owner verification. `docs/05` requires offline outbox + local photo persistence, not WatermelonDB specifically. Pilot volume is small enough for SQLite.

Migration path: hide storage behind `LocalStore` interfaces. Tables mirror sync entities: `tasks`, `stores`, `planogram_bundles`, `cursors`, `outbox_ops`, `photo_queue`, `conflicts`, `media_cache`. Later dev-client build adds WatermelonDB adapter, one-way migrates SQLite rows/files, keeps `clientOpId`, `clientPhotoId`, cursors, and file URIs unchanged.

**(b) App Structure**
```text
apps/mobile/
  app.json
  package.json
  app/
    _layout.tsx
    index.tsx
    (auth)/login.tsx
    (app)/_layout.tsx
    (app)/tasks/index.tsx
    (app)/tasks/[taskId].tsx
    upgrade-required.tsx
  src/
    api/mobile-client.ts        # bearer, refresh, 426 handling
    api/media-client.ts         # authed media fetch/cache
    auth/token-store.ts         # expo-secure-store
    auth/device-id.ts
    db/sqlite.ts
    db/migrations.ts
    db/repositories.ts
    sync/sync-manager.ts        # pure TS, injected fetch/storage/clock
    sync/outbox.ts
    sync/types.ts
    photos/photo-store.ts       # expo-file-system persisted queue
    photos/photo-uploader.ts
    planogram/PlanogramSvg.tsx  # react-native-svg front view
    planogram/bundle-cache.ts
    i18n/index.ts
    i18n/az.ts
    i18n/ru.ts
```

Deps: `expo-router`, `expo-sqlite`, `expo-secure-store`, `expo-file-system`, `expo-image-picker` or `expo-camera`, `@react-native-community/netinfo`, `react-native-svg`, `i18n-js`, `expo-crypto`.

**(c) Sync Manager**
State machine: `idle -> pulling -> applyingPull -> acking -> uploadingPhotos -> pushing -> applyingPushResults -> idle`.

Triggers: app start, foreground, pull-to-refresh, NetInfo connectivity restore, after queuing photo/status op.

Order: `pull -> local transaction -> ack cursors -> upload pending photos -> push ops -> optional pull again`. Ack only after SQLite commit. Push sends max batches, keeps `clientOpId >= 8`, retries with exponential backoff + jitter. `426` moves to `upgrade-required`. Conflicts are stored locally and surfaced on task detail; server wins, but uploaded photo evidence remains.

**(d) Photo Survival**
On capture, copy image into `FileSystem.documentDirectory/photo-outbox/<clientPhotoId>.jpg`, persist `photo_queue` row, then queue `photo.submit`. If offline or app is killed, restart scans DB/files and resumes.

Upload is retried with same `clientPhotoId`; if response was lost, server dedup returns existing photo/key. Only after upload succeeds does `photo.submit` push. Delete original only after upload + submit are `applied/already_applied`.

**(e) Verification**
Headless CI:
`tsc`, `vitest` for sync-manager with mocked fetch/storage/clock/netinfo, outbox idempotency, pull-ack sequencing, 401 refresh singleflight, 426 halt, photo retry/dedupe, conflict handling, plus `expo export`.

Owner phone:
Expo Go QR, login with org slug + employee code + PIN, task list pull, open planogram, authed product media, airplane-mode start/photo, kill app, reopen offline, restore internet, confirm photo/status reaches web, token refresh after access expiry.

**(f) Pitfalls**
Refresh must be singleflight; concurrent refresh can race with 120s grace and store the wrong token. Do not trust client clocks for cursors. RN `<Image source={{ uri, headers }}>` can work, but media caching via authed fetch to local file is safer. SQLite writes need real transactions; never ack before commit. Expo Go has no WatermelonDB, no true background upload, and limited native camera options. Planogram bundles can grow, so cache by version, lazy-load media, never inline base64 images.

