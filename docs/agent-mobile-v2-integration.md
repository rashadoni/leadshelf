# Agent Mobile v2 — LeadShelf integration boundary

Status: confirmed owner scope, implementation in progress  
Date: 2026-07-15

## Decision

The existing Expo application in `apps/mobile` is the maintained foundation for
the unified field-agent client. It will support product variants and capability
modules instead of creating another disconnected React Native application.

The owner expanded the mobile requirement: every workflow used by an agent must
be manageable on mobile. This explicitly includes routes, visits, contacts,
tasks, promotions, sample inventory, orders, returns, rewards, messages,
documents, HRM requests, GPS, KPI, shelf work, and planograms.

This decision does not merge LeadDrive CRM and LeadShelf persistence:

- LeadShelf stays authoritative for catalog, stock, orders, returns, promotion
  mechanics, rewards, shelf tasks, and planograms.
- LeadDrive stays authoritative for CRM/medical organizations and contacts,
  routes, visits, work calendar, workday/GPS, general tasks, commitments,
  messages/documents, HRM requests, and personal KPI.
- The app uses a single LeadDrive Field BFF and a single user session. The BFF
  federates commercial operations server-to-server.

## Mobile architecture changes

1. Introduce a product-variant configuration (`leadshelf` and
   `leaddrive-field`) without duplicating screens or sync infrastructure.
2. Add a capability manifest to control navigation and permitted mutations.
3. Split the API layer into domain adapters behind one mobile-facing client.
4. Extend local SQLite storage and outbox with schema-versioned modules.
5. Keep one sync center and one conflict model for all agent operations.
6. Preserve existing photo-proof, planogram, order, route, visit, and task tests.
7. Add Russian, Azerbaijani, and English strings for every new state.

## Navigation contract

Five primary destinations:

- Today — active workday, next route stop, active visit, urgent exception.
- Week — seven-day calendar, status/holiday semantics, draft planning.
- Work — routes, visits, customers/contacts, tasks, promotions, stock,
  orders/returns/rewards, shelf/planogram, HRM.
- Inbox — messages, documents, approvals, notifications, sync conflicts.
- Profile — KPI, GPS readiness/history, device, language, sync diagnostics.

Complex modules belong in Work or contextual visit actions; they must not create
an unreadable tab bar.

## Offline rules

- Current plus adjacent weeks, assigned organizations/contacts, tasks, active
  promotion mechanics, and recent personal KPI are cached.
- All agent mutations use idempotent outbox operations with expected versions.
- Media is durable across app restarts and uploads independently.
- Server conflicts are never auto-overwritten when they affect routes, visits,
  inventory, orders, commitments, attendance, or approvals.
- The application exposes pending, applied, conflict, rejected, and quarantined
  counts with actionable recovery.

## Compatibility

- Existing LeadShelf tenants retain their current modules through capabilities.
- Existing mobile protocol v1 remains supported during rollout.
- Unified fields are introduced under a new protocol version and additive local
  migrations.
- A forced-upgrade response is used only after a verified APK is available.

## Release gates

- `pnpm --filter @leadshelf/mobile typecheck`
- `pnpm --filter @leadshelf/mobile test`
- API-contract and server tests for every outbox operation
- Android build and deterministic emulator smoke
- physical Android offline/online, app-kill, GPS-permission, and conflict smoke
- no regression in existing shelf proof and offline order flows

The cross-product master scope is maintained in LeadDrive at
`docs/mtm-agent-mobile-v2-master-plan.md`.
