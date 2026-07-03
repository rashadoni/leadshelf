# apps/mobile

Expo mobile client for the first LeadShelf field-execution flow.

## Current Scope

- Employee-code login against `/api/v1/mobile/auth/*`.
- Protocol-versioned sync against `/api/v1/mobile/sync/*`.
- Offline task/status/photo outbox on `expo-sqlite`.
- Expo Go friendly pilot build; WatermelonDB/dev-client remains a later migration.

## Local Commands

```sh
pnpm --filter @leadshelf/mobile typecheck
pnpm --filter @leadshelf/mobile test
pnpm --filter @leadshelf/mobile start
```

Set `EXPO_PUBLIC_API_URL` when testing against a non-default backend. The default is `https://hermescrm.xyz`.
