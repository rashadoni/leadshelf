# apps/mobile

Expo mobile client for the first LeadShelf field-execution flow.

## Current Scope

- Employee-code login against `/api/v1/mobile/auth/*`.
- Protocol-versioned sync against `/api/v1/mobile/sync/*`.
- Offline task/status/photo outbox on `expo-sqlite`.
- Expo Go friendly pilot build; WatermelonDB/dev-client remains a later migration.

## Build types

- `development` is an Expo development client and requires a Metro server.
- `preview` is the standalone internal-distribution build for device smoke.
- `production` is the store release profile and requires production signing
  credentials.

The GitHub workflow `Mobile standalone preview APK` builds a release-variant
Android APK with an embedded JavaScript bundle. It uses the Android debug key
for internal demo distribution only and must not be presented as a production
store-signed artifact.

## Zeytunpharm / LeadDrive Field variant

The same maintained Expo codebase also builds the Zeytunpharm field-agent APK:

- `EXPO_PUBLIC_MOBILE_VARIANT=leaddrive-field`
- `EXPO_PUBLIC_ORGANIZATION_SLUG=zeytunpharm` (production tenant slug)
- `EXPO_PUBLIC_API_URL=https://app.leaddrivecrm.org`
- Android application id: `org.leaddrive.field.zeytunpharm`

The field variant supports phone and tablet layouts. Android rotation is enabled;
at 768 dp and above the five primary areas move into a persistent left navigation
rail, list/calendar screens use bounded two-column workspaces, and touch targets
remain at least 44 dp. Phone navigation and one-column task execution remain
unchanged.

This variant signs in once through LeadDrive MTM. CRM/medical routes stay in
LeadDrive, while shelf and commercial requests go through LeadDrive's trusted
Field BFF. No LeadShelf service credential is stored in the APK.

## Standalone preview APK baseline

This is a release-control record, not a claim that every Field workflow has
passed device E2E.

The confirmed physical-device baseline is **2026-08-26**:

- source commit: `7bc499844550bf4fb2773914d0679a25054ca824`;
- GitHub Actions run: `32991697133` (`Mobile standalone preview APK`);
- artifact:
  `mobile-android-standalone-preview-zeytunpharm-arm64-v8a-live-demo-7bc499844550bf4fb2773914d0679a25054ca824`;
- artifact ZIP SHA-256:
  `d5b3dd32d7e3d4f6c787a988cd7cdfd61ed66929ae5c1543a9e8a96de211e5d5`;
- APK SHA-256 (inside the artifact and after `adb install -r`):
  `23d6ec43eb77cdd8a0c13d40f4c9ff11bb52360dd7b5282e1939929d8c00d5cd`;
- package/version: `org.leaddrive.field.zeytunpharm`, `1.0.0` (`versionCode` 1);
- physical evidence: the APK was installed with data preserved and
  `MainActivity` reached the foreground on a Samsung SM-S918B.

The ZIP and APK digests intentionally differ: one identifies the downloadable
artifact archive, the other identifies the installed Android package. Do not
substitute APK size, a workflow run number, or a display version for either
proof.


Release sequencing is stricter than the original physical baseline: the prior
Field source candidate was version 1.0.1 / Android code 2. The current
browse-list candidate is version 1.0.2 / Android code 3. Once that candidate
is distributed, any later preview must use a code greater than 3; a different
workflow run or APK size is never
evidence of a newer release. Source version changes alone are also not
acceptance evidence.

Every later standalone preview must meet all of these conditions before it is
called newer or ready for review:

1. Its candidate commit is different from, and a descendant of,
   `7bc499844550bf4fb2773914d0679a25054ca824`.
2. Its Android `versionCode` is greater than `2`, and its `versionName`
   truthfully identifies the candidate release.
3. The recorded source commit, workflow `headSha`, and commit suffix in the
   artifact name are identical.
4. Release evidence records the artifact ZIP digest and the extracted/installed
   APK digest separately.
5. A physical-device check records `adb install -r`, installed APK digest,
   foreground launch, a fresh screenshot, authenticated Field refresh, and the
   route-target query. The latter two must succeed or show the documented,
   non-error empty state.

The baseline installation itself is **not** functional acceptance: a subsequent
physical-device rerun reproduced a handled sync-cache warning and a route-target
loading failure. The release APK did not expose safe HTTP status or error-class
diagnostics in logcat, so the sync cause remains open. The production route-target
handler was deployed after this diagnostic; a public probe now reaches it
(401 without credentials rather than the previous 404). It still requires
authenticated physical-device proof before a new preview is accepted.

## Local Commands

```sh
pnpm --filter @leadshelf/mobile typecheck
pnpm --filter @leadshelf/mobile test
pnpm --filter @leadshelf/mobile start
```

Set `EXPO_PUBLIC_API_URL` when testing against a non-default backend. The default is `https://hermescrm.xyz`.
