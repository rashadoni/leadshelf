# Phase 4, срез 1: редактор планограмм MVP (Codex, 2026-07-03)

**(a) Core**

Add to `packages/core/src/planogram/capacity.ts` or adjacent `placement.ts`:

```ts
export interface EquipmentShelfMm {
  id: string
  shelfIndex: number
  yMm: number
  thicknessMm: number
  depthMm: number
}

export interface EquipmentGeometryMm {
  widthMm: number
  heightMm: number
  depthMm: number
  shelves: EquipmentShelfMm[]
}

export interface PlacementCandidateMm extends ProductSizeMm {
  id?: string
  shelfId: string
  xMm: number
  zMm?: number
  facingsX: number
  facingsY: number
  facingsZ: number
  gapMm?: number
}

export type PlacementValidationIssueCode =
  | "invalid_facings"
  | "outside_width"
  | "outside_depth"
  | "outside_height"
  | "collision"

export function shelfSpaceForShelf(
  equipment: EquipmentGeometryMm,
  shelfId: string,
): ShelfSpaceMm & { yMm: number; shelfId: string }

export function validatePlacementOnShelf(input: {
  shelf: ShelfSpaceMm
  candidate: PlacementCandidateMm
  existing: PlacementCandidateMm[]
  ignorePlacementId?: string
}): { ok: true; occupiedWidthMm: number; capacity: CapacityResult } | {
  ok: false
  code: PlacementValidationIssueCode
  message: string
}

export function nextFreeXMm(input: {
  shelf: ShelfSpaceMm
  candidate: Omit<PlacementCandidateMm, "xMm">
  existing: PlacementCandidateMm[]
}): number | null

export function suggestPlacementOnShelf(input: {
  equipment: EquipmentGeometryMm
  shelfId: string
  product: ProductSizeMm
  facingsX?: number
  facingsY?: number
  facingsZ?: number
  existing: PlacementCandidateMm[]
}): PlacementCandidateMm | null
```

Clearance must use the shelf above: `nextShelf.yMm - (shelf.yMm + shelf.thicknessMm)`, or equipment top for the highest shelf.

**(b) Repo**

Create `packages/db/src/repos/planogram.ts`.

Error shape mirrors equipment repo:

```ts
class PlanogramRepoError extends Error {
  code:
    | "not_found"
    | "version_conflict"
    | "invalid_state"
    | "invalid_equipment"
    | "invalid_shelf"
    | "invalid_zone"
    | "missing_product_dimensions"
    | "invalid_placement"
}
```

Functions:

```ts
createPlanogramFromEquipmentTemplate(prisma, organizationId, {
  name,
  description?,
  categoryId?,
  equipmentTemplateId,
  authorId?,
})
```

Checks template belongs to org, loads latest `EquipmentVersion`, creates `Planogram`, `PlanogramVersion v1 DRAFT`, one `PlanogramEquipment`.

```ts
getPlanogramEditor(prisma, organizationId, planogramId, versionId?)
```

Loads planogram via parent `Planogram.organizationId`, version, equipment version, shelves, placements, product image/name/SKU/snapshot dims.

```ts
addPlacement(prisma, organizationId, {
  planogramVersionId,
  expectedVersionUpdatedAt,
  planogramEquipmentId,
  shelfId,
  productId,
  xMm?, // if omitted, use nextFreeXMm
  zMm?,
  facingsX,
  facingsY,
  facingsZ,
})
```

Checks version belongs to org and is `DRAFT`; `PlanogramEquipment.planogramVersionId` matches; shelf belongs to that equipment version; product belongs to org and has non-null dims; copies product dims into placement snapshot; derives `yMm = shelf.yMm + shelf.thicknessMm`; validates fit/collision with core.

```ts
updatePlacement(prisma, organizationId, {
  placementId,
  expectedVersionUpdatedAt,
  shelfId?,
  xMm?,
  zMm?,
  facingsX?,
  facingsY?,
  facingsZ?,
})
```

Same graph checks; revalidate against existing placements excluding itself.

```ts
removePlacement(prisma, organizationId, {
  placementId,
  expectedVersionUpdatedAt,
})
```

DRAFT-only; verifies ownership through version -> planogram.

Optimistic concurrency: use `PlanogramVersion.updatedAt` as the draft revision token. Every mutation requires the last seen timestamp and bumps `updatedAt`; mismatch returns `409 version_conflict`.

**(c) API**

Use existing route-handler pattern: `requireApiSession`, edit roles `OWNER/ADMIN/CATEGORY_MANAGER/MERCHANDISER`, reads through tenant/client includes, writes through `workerDb + repo`.

Routes:

```text
GET  /api/v1/planograms
POST /api/v1/planograms
```

POST zod:

```ts
{
  name: string.min(1).max(120),
  description?: string.max(1000),
  categoryId?: string,
  equipmentTemplateId: string
}
```

```text
GET /api/v1/planograms/:planogramId/versions/:versionId/editor
```

Returns version revision, equipment geometry/shelves, placements, product display data.

```text
POST   /api/v1/planograms/:planogramId/versions/:versionId/placements
PATCH  /api/v1/planograms/:planogramId/versions/:versionId/placements/:placementId
DELETE /api/v1/planograms/:planogramId/versions/:versionId/placements/:placementId
```

Placement zod:

```ts
{
  expectedVersionUpdatedAt: string.datetime(),
  planogramEquipmentId: string,
  shelfId: string,
  productId: string,
  xMm?: int.min(0),
  zMm?: int.min(0).default(0),
