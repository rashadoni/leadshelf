# Mobile workday and field-agent credentials

Status: approved implementation slice (2026-08-11).

## Stack

- Existing Next.js route handlers and server services.
- Existing Prisma/PostgreSQL tenant data model.
- Existing Expo/React Native mobile client and encrypted offline outbox.

## Repository scope

- `apps/web`: field-agent administration and mobile API routes.
- `apps/mobile`: LeadShelf authentication, workday UI and offline sync.
- `packages/api-contracts`: shared mobile request/response contracts.
- `packages/db`: tenant-scoped persistence and idempotent operation handling.

## First data models

- Keep `User` as the authentication identity and `FieldAgent` as its operational
  profile.
- Add a tenant-scoped workday aggregate for one field agent and local calendar
  date.
- Persist idempotent start, pause, resume and finish operations through the
  existing mobile operation receipt/outbox mechanism.

## First MVP flow

1. An authorized administrator creates a field agent with a unique employee
   code and an initial PIN. The PIN is hashed and is never returned or logged.
2. The employee signs in with organization code, employee code and PIN through
   the canonical `/api/v1/mobile/auth/*` API.
3. The employee starts, pauses, resumes and finishes a workday while online or
   offline.
4. The mobile outbox sends idempotent workday events to LeadShelf. A pull/read
   endpoint returns the canonical server state.

## Explicit exclusions

- No LeadDrive CRM modules, contacts, deals, messages or HRM data.
- No `/api/v1/mtm/*` compatibility layer.
- No payroll, timesheets, attendance approval or advanced route planning in
  this slice.
- No production rollout until the owner separately approves publication.

## Verification

- Tenant isolation, authorization, duplicate operation and state-transition
  tests.
- Targeted web and mobile tests plus TypeScript/Prisma validation.
- APK build and emulator smoke as a separate sequential heavy phase after the
  host resource preflight.
