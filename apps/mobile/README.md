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
- `EXPO_PUBLIC_ORGANIZATION_SLUG=zeytun` (internal production tenant slug)
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

## Local Commands

```sh
pnpm --filter @leadshelf/mobile typecheck
pnpm --filter @leadshelf/mobile test
pnpm --filter @leadshelf/mobile start
```

Set `EXPO_PUBLIC_API_URL` when testing against a non-default backend. The default is `https://hermescrm.xyz`.
