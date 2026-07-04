# LeadShelf demo/product-readiness report

Updated: 2026-07-05.

Production domain: `https://hermescrm.xyz`.

## Completed scope

### P0 - demo baseline

- Dashboard now explains the product through readiness KPIs and a demo-flow.
- Demo tenant has a coherent RU demo story: catalog, equipment, floor plan,
  published planogram, task, photo submission, review queue, field agent and
  analytics data.
- Catalog, stores, tasks and analytics tables were wrapped/fixed so admin UI
  does not break the page width.
- Demo floor plan and demo photo proof are populated and connected to the
  store, planogram and task.
- Seed/deploy flow runs `seed-demo` after migrations so production demo data is
  restored during deploy.

### P1 - product core

- Planogram list now shows preview/status/version/targets/task signals and
  useful actions.
- 2D/3D placement consistency was improved; 3D render uses oriented product
  sizes and better camera framing.
- Task page exposes status history, assignee, comments, photo submissions,
  reviews and guarded terminal status transitions.
- Store page exposes floor plan, assignments, tasks, field work and photo proof
  context.

### P2 - analytics

- Demo sales, stock and price snapshots cover a 60-day analytics story.
- Analytics first screen now has non-zero revenue/profit/quantity/stock-days
  and under-space / over-space / balanced recommendations.
- Production analytics smoke showed meaningful numbers and no page overflow.

### P3 - field/mobile story

- Seed creates one field team, one mobile agent, one route, one stop, one
  completed visit, live location samples and a no-geofence-anomaly example.
- The field-force page now shows the office story first: agent, store, check-in,
  check-out, proof photo, pending review and no-anomaly state.
- Mobile sync now persists and sends `routes` / `visits` cursors, not only task
  and planogram bundle cursors.
- Mobile task detail allows resubmitting proof photos from `PHOTO_SUBMITTED`.
- Production mobile API smoke confirmed demo login, tasks, store, route, stop,
  completed visit, planogram bundles and route/visit cursors.

### P4 - shell and final polish

- App shell now has active navigation, breadcrumbs, sticky operational header,
  demo tenant badge and denser SaaS styling.
- Production walkthrough covered dashboard, catalog, equipment library, floor
  plans, planograms, tasks, reviews, field-force and analytics.
- Desktop and mobile-width checks showed no uncontrolled horizontal overflow on
  the verified routes.

## Verification evidence

- Local:
  - `CI=true pnpm --filter @leadshelf/db seed:demo`
  - `CI=true pnpm --filter @leadshelf/db typecheck`
  - `CI=true pnpm --filter @leadshelf/web typecheck`
  - `CI=true pnpm --filter @leadshelf/mobile typecheck`
  - `CI=true pnpm --filter @leadshelf/db test`
  - `CI=true pnpm --filter @leadshelf/web test`
  - `CI=true pnpm --filter @leadshelf/mobile test`
  - `CI=true pnpm lint`
- Production deploys:
  - `effdec6` via GitHub Actions run `28721986487`, CI + deploy smoke success.
  - `35fe878` via GitHub Actions run `28722189948`, CI + deploy smoke success.
- Production browser:
  - `/ru`, `/ru/catalog`, `/ru/equipment-library`, `/ru/floor-plans`,
    `/ru/planograms`, `/ru/tasks`, `/ru/reviews`, `/ru/field-force`,
    `/ru/analytics`.
  - Active nav, demo badge and operational shell visible.
  - No console errors captured during walkthrough.
  - No uncontrolled horizontal overflow at 1280px.
  - Key mobile-width routes checked at 390px with no uncontrolled horizontal
    overflow.
- Production mobile API:
  - Login `org=demo`, `employeeCode=M-001`, `PIN=1234`.
  - Pull returned tasks, store, one route, one route stop, one completed visit,
    planogram bundles, and `routes` / `visits` cursors.

## Not 100%

- Native Expo app was verified by typecheck/tests and production mobile API
  sync, not by a physical phone camera session. Real camera permission,
  barcode scanning and photo capture still need a device walkthrough before a
  client pilot.
- Demo data is intentionally RU-first. AZ UI labels exist, but the populated
  demo product/store content is not fully localized into Azerbaijani.
- Analytics is demo-seeded, not connected to a real retailer sales/stock feed.
  The story is good for product demo, not for pilot ROI proof.
- Field-force map is a lightweight SVG live-location view, not a GIS map.
- AI/computer-vision compliance remains a later layer; current proof flow uses
  quality score/review scaffolding and human review.
- The web admin is responsive enough not to collapse on mobile width, but it is
  still desktop-first. The intended field mobile workflow remains the Expo app.
