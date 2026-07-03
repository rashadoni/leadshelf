# Phase 2, срез 1: библиотека оборудования (Codex, 2026-07-03)

Отступление от дизайна: PATCH version + PUT shelves объединены в один
атомарный PUT /templates/:id/version (одна форма -> один save), семантика
та же: draft обновляется, frozen клонируется в новую версию.

**(a) Core**
Add `packages/core/src/equipment/shelves.ts`.

```ts
export interface ShelfAutoLayoutInput {
  equipmentHeightMm: number
  shelfCount: number
  shelfThicknessMm: number
  shelfDepthMm: number
  topOffsetMm: number
  bottomOffsetMm: number
  minClearanceMm?: number
}

export interface ShelfGeometryDraft {
  shelfIndex: number // 0 = bottom
  yMm: number        // bottom edge from equipment floor
  thicknessMm: number
  depthMm: number
}

export interface ShelfLayoutResult {
  shelves: ShelfGeometryDraft[]
  rowGapMm: number
  clearancesMm: number[]
}

export function layoutEqualShelves(input: ShelfAutoLayoutInput): ShelfLayoutResult

export interface ShelfValidationIssue {
  code:
    | "invalid_dimension"
    | "shelf_count_required"
    | "shelves_do_not_fit"
    | "clearance_too_small"
    | "shelf_depth_exceeds_equipment"
  message: string
  field?: keyof ShelfAutoLayoutInput
}

export function validateShelfAutoLayout(input: ShelfAutoLayoutInput): ShelfValidationIssue[]
```

Math: all mm, bottom-to-top shelves. Available vertical space:

```ts
available = height - topOffset - bottomOffset - shelfCount * thickness
rowGap = shelfCount > 1 ? available / (shelfCount - 1) : 0
yMm[i] = bottomOffset + i * (thickness + rowGap)
```

For MVP, round to integer mm and reject if rounding would push the top shelf above `height - topOffset`.

**(b) API**
Use `/api/v1/equipment/*`, zod in `packages/api-contracts/src/equipment/v1`.

Types:

- `GET /api/v1/equipment/types`
- returns seeded kinds: `rack | pallet | fridge | pegboard | cabinet | table | stand`
- optional `POST /api/v1/equipment/types` only for admin custom labels, not needed for DoD.

Templates:

```ts
createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  typeId: z.string().min(1),
  widthMm: z.number().int().min(1).max(10000),
  heightMm: z.number().int().min(1).max(10000),
  depthMm: z.number().int().min(1).max(5000),
  shelfLayout: shelfAutoLayoutSchema.optional(),
})
```

- `GET /api/v1/equipment/templates?q=&typeKind=&limit=&cursor=`
- `POST /api/v1/equipment/templates` creates `EquipmentTemplate` + version `1` + shelves if provided.
- `GET /api/v1/equipment/templates/:templateId`
- `PATCH /api/v1/equipment/templates/:templateId` rename/type only, not geometry.

Versions:

```ts
versionGeometrySchema = z.object({
  widthMm: z.number().int().min(1),
  heightMm: z.number().int().min(1),
  depthMm: z.number().int().min(1),
})

saveVersionSchema = versionGeometrySchema.extend({
  baseVersionId: z.string().optional(),
  expectedVersionNumber: z.number().int().optional(),
  shelfLayout: shelfAutoLayoutSchema.optional(),
})
```

- `GET /api/v1/equipment/templates/:templateId/versions`
- `GET /api/v1/equipment/versions/:versionId`
- `PATCH /api/v1/equipment/versions/:versionId`
  - allowed only when `isFrozen=false` and it is latest version for template.
  - updates geometry only; children via bulk endpoint.
- `POST /api/v1/equipment/templates/:templateId/versions`
  - “save new version” flow.
  - if latest draft exists and is unfrozen, either update it via `PATCH` or create new version only when explicitly requested.
  - if editing frozen version, clone geometry/children into `versionNumber + 1`, `isFrozen=false`.

Shelf bulk-set:

```ts
bulkSetShelvesSchema = z.object({
  mode: z.literal("replace"),
  expectedVersionNumber: z.number().int(),
  shelves: z.array(z.object({
    shelfIndex: z.number().int().min(0),
    yMm: z.number().int().min(0),
    thicknessMm: z.number().int().min(1),
    depthMm: z.number().int().min(1),
    maxLoadKg: z.number().int().positive().nullable().optional(),
  })).min(0).max(200),
})
```

- `PUT /api/v1/equipment/versions/:versionId/shelves`
- rejects frozen/non-latest draft.
- transaction: verify template ownership, delete shelves for version, createMany new shelves.

**(c) UI**
Route: `apps/web/src/app/[locale]/(app)/equipment-library`.

Components:

- `page.tsx`: server page, list templates with latest version, filters by type/search.
- `equipment-library-tabs.tsx`: optional, keep simple: Library / Create.
- `equipment-template-table.tsx`: name, type, dimensions, latest version, frozen/draft badge, actions.
- `equipment-template-form.tsx`: client form for name/type/dimensions.
- `shelf-fill-tool.tsx`: count, thickness, shelf depth, top/bottom offsets, min clearance; calls core pure functions client-side.
- `equipment-preview-svg.tsx`: live SVG 2D front view, no canvas, no dragging. Draw outer rectangle, shelves by `yMm`, labels in mm.
- `version-status-badge.tsx`: `Draft`, `Frozen`, `vN`.
- `save-equipment-button.tsx`: POST/PATCH/PUT orchestration and error display.

Pages:

- `/equipment-library`: list + “create”.
- `/equipment-library/new`: create rack/fridge/etc. form with live preview.
- `/equipment-library/[templateId]`: detail/version list.
- `/equipment-library/[templateId]/edit?versionId=...`: form-driven edit. If version frozen, UI says save creates new draft version.

**(d) Tenant Write Path**
Recommend parent-path repository, not direct system-client service in route handlers.

Reason: `EquipmentVersion`, `EquipmentShelf`, `EquipmentCell`, `EquipmentHook` have no `organizationId`, so tenant client correctly blocks generic writes. Follow existing `packages/db/src/repos/import.ts` pattern:

- route handler authenticates/role-checks;
- route passes `workerDb`, `session.org`, and parsed input to `packages/db/src/repos/equipment.ts`;
- repo verifies parent ownership through `EquipmentTemplate.organizationId`;
- repo writes `EquipmentVersion` and `EquipmentShelf` in one transaction;
- no direct `workerDb.equipmentShelf.*` in API route files.

This keeps the tenant door intact while allowing child geometry writes through audited parent ownership.

**(e) Pitfalls**
- mm coherence: UI labels may show `120x180x30 cm`, but DB/core must store `1200x1800x300 mm`.
- shelf overflow: validate `topOffset + bottomOffset + count * thickness <= height`; also reject shelf depth greater than equipment depth.
- min clearance: row gap must not be visually acceptable only; enforce business minimum, e.g. default `minClearanceMm=50`.
- version explosion: editing an unfrozen latest draft should update that draft; only frozen edits create a new version.
- concurrency: require `expectedVersionNumber` or `updatedAt`/revision check. Current schema lacks `updatedAt` on `EquipmentVersion`; app-level check is possible, but adding `updatedAt` or `revision` later would harden it.
- frozen semantics: never mutate shelves/cells/hooks of `isFrozen=true`; Phase 4 publish only sets freeze, it should not copy geometry again.
- future hooks/cells: do not design pegboard/cabinet editors now; keep API children separate so shelf MVP does not block later geometry types.
tokens used
61,496
**(a) Core**
Add `packages/core/src/equipment/shelves.ts`.

```ts
export interface ShelfAutoLayoutInput {
