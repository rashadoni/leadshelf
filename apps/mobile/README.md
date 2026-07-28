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

## Local Commands

```sh
pnpm --filter @leadshelf/mobile typecheck
pnpm --filter @leadshelf/mobile test
pnpm --filter @leadshelf/mobile start
```

Set `EXPO_PUBLIC_API_URL` when testing against a non-default backend. The default is `https://hermescrm.xyz`.
