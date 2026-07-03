# Phase 6, срез 1: publish + задачи (Codex, 2026-07-03)

**(a) Repo Layer**

```ts
type PublishTarget =
  | { type: "FORMAT"; formatId: string }
  | { type: "STORES"; storeIds: string[] }

publishPlanogramVersion(db, orgId, {
  planogramId,
  versionId,
  expectedRevision,
  target,
  activeFrom?,
  activeTo?,
  dueAt?,
  publishedById,
  changeNote?,
}): Promise<{
  versionId: string
  publishedAt: string
  assignmentIds: string[]
  taskIds: string[]
  resolvedStoreCount: number
  frozenEquipmentVersionIds: string[]
}>

createNextDraft(db, orgId, {
  planogramId,
  sourceVersionId,
  authorId?,
}): Promise<{ versionId: string; versionNumber: number; created: boolean }>

listTasks(db, orgId, {
  status?,
  storeId?,
  assigneeId?,
  unassigned?,
  limit?,
  cursor?,
})

transitionTaskStatus(db, orgId, {
  taskId,
  expectedStatus,
  toStatus,
  byUserId,
})
```

Publish tx steps:

1. Lock `PlanogramVersion` row; assert tenant via `Planogram.organizationId`.
2. Assert `state=DRAFT`, `updatedAt === expectedRevision`.
3. Assert equipment exists and placements are non-empty.
4. Revalidate all placements against current `EquipmentVersion` shelves using placement dimension snapshots.
5. Important stale geometry rule: if equipment draft was edited after placements, publish does not trust old placement validation. If shelf deleted/moved or placement no longer fits, reject `stale_geometry`; user must fix draft before publish. If still valid, publish freezes current equipment geometry.
6. Resolve target stores:
   - `FORMAT`: one `PlanogramAssignment(formatId)`, tasks for active stores in that format.
   - `STORES`: one `PlanogramAssignment(storeId)` per explicit store.
7. Reject target with zero stores, missing stores, duplicate store ids, invalid `activeFrom >= activeTo`.
8. Check active assignment overlap for resolved stores for same planogram/category scope. In this slice: reject overlap; no silent replacement.
9. `EquipmentVersion.updateMany({ isFrozen: true })`.
10. Update version to `PUBLISHED`, set `publishedAt`, `publishedById`, `changeNote`.
11. Create assignment(s).
12. Create one `Task` per resolved store: `status=NEW`, `assigneeId=null`, title from planogram name, `dueAt`.
13. Create `TaskStatusHistory(fromStatus=null,toStatus=NEW)` for every task.

`createNextDraft` tx:

1. Source must be `PUBLISHED`.
2. If a DRAFT already exists for the same planogram, return it or 409; do not create duplicates.
3. Clone `PlanogramVersion` to `versionNumber=max+1`, `state=DRAFT`.
4. Clone `PlanogramEquipment`, `PlanogramZone`, `PlanogramPlacement`, remapping equipment/zone ids. Keep same frozen `EquipmentVersion`; equipment geometry editing remains separate.

**(b) Migration Triggers**

Ship now as raw SQL:

- `planogram_assignments`: INSERT/UPDATE only if referenced version is `PUBLISHED`.
- `tasks`: planogram task must reference `PUBLISHED`; if `assignmentId` exists, assignment version must match task version, and task store must match either assignment `storeId` or assignment `formatId` through `Store.formatId`.
- `planogram_versions`: block published content mutation and state regression to `DRAFT`.
- Child immutability triggers on `planogram_equipment`, `planogram_zones`, `planogram_placements`: no INSERT/UPDATE/DELETE unless parent version is `DRAFT`. Repo already blocks non-DRAFT edits, but DB must protect bypass writers.
- `equipment_versions`: block geometry updates when `isFrozen=true`.
- Also block shelf/cell/hook mutation for frozen equipment versions.
- Optional but recommended: trigger on `PlanogramVersion` publish to set referenced `EquipmentVersion.isFrozen=true`; repo still does it explicitly.

Keep app-level:

- Physical placement validation.
- Target resolution, zero-store rejection.
- Assignment active-window overlap.
- Task creation/dedupe.
- Status transition FSM.

**(c) API Routes**

`POST /api/v1/planograms/:planogramId/versions/:versionId/publish`

```ts
z.object({
  expectedRevision: z.string().datetime(),
  target: z.discriminatedUnion("type", [
    z.object({ type: z.literal("FORMAT"), formatId: z.string().min(1) }),
    z.object({ type: z.literal("STORES"), storeIds: z.array(z.string().min(1)).min(1).max(500) }),
  ]),
  activeFrom: z.string().datetime().optional(),
  activeTo: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  changeNote: z.string().max(1000).optional(),
})
```

`POST /api/v1/planograms/:planogramId/versions/:versionId/next-draft`

```ts
z.object({})
```

`GET /api/v1/tasks?status=NEW&storeId=&unassigned=true&limit=50&cursor=`

```ts
status: TaskStatus optional, repeatable or comma-separated
storeId?: string
assigneeId?: string
unassigned?: boolean
limit?: 1..100
cursor?: string
```

`PATCH /api/v1/tasks/:taskId/status`

```ts
z.object({
  expectedStatus: z.enum(["NEW","IN_PROGRESS","PHOTO_SUBMITTED","COMPLETED","EXPIRED","EMPTY"]),
  toStatus: z.enum(["NEW","IN_PROGRESS","PHOTO_SUBMITTED","COMPLETED","EXPIRED","EMPTY"]),
})
```

Writes use `workerDb + repo`; reads can use `tenantDb` where model has `organizationId`, otherwise repo parent-path.

**(d) UI**

Publish dialog in editor toolbar, visible only for DRAFT:

- target segmented control: Format / Stores;
- format select with resolved active store count;
- multi-store picker for explicit stores;
- due date;
- active from, active to optional;
- change note;
- summary: placement count, equipment version(s), “will freeze equipment geometry”;
- stale geometry errors shown as blocking list.

After publish:

- editor becomes read-only with `PUBLISHED` badge;
- primary CTA: `Create next draft`;
- same button also appears on planogram list/version card.

Tasks page:

- status tabs/chips: All, New, In Progress, Photo Submitted, Completed, Expired, Empty;
- table: status, task title, store, planogram version, due date, assignee/unassigned, updated;
- row action/status dropdown for office transitions;
- group/filter unassigned pool per store.

**(e) Status Rules**

| From | To | Who | Guard |
|---|---|---|---|
| NEW | IN_PROGRESS | office roles | expectedStatus matches |
| IN_PROGRESS | PHOTO_SUBMITTED | office roles | pilot manual; photo required later |
| PHOTO_SUBMITTED | COMPLETED | office roles | expectedStatus matches |
| NEW / IN_PROGRESS | EMPTY | office roles | terminal; expectedStatus matches |
| NEW / IN_PROGRESS / PHOTO_SUBMITTED | EXPIRED | office roles, later worker | dueAt passed or manager override |
| COMPLETED / EXPIRED / EMPTY | any | no one in slice | terminal |

**(f) Pitfalls**

- Double publish: lock row plus atomic `DRAFT -> PUBLISHED`; second request returns 409.
- Empty planogram: reject before publish.
- Format with 0 active stores: reject; no assignment/task shell.
- Stale equipment geometry: revalidate current equipment before freezing.
- Re-publish to same target: reject active overlap; do not duplicate tasks.
- Store list duplicates: dedupe input, but reject if dedupe changes count.
- Assignment overlap: resolve stores from both explicit and format assignments in app; raw DB exclusion is not enough with current schema.
- Format membership changes later: tasks are snapshot for resolved stores at publish time; assignment remains format-level intent.
tokens used
67,401
**(a) Repo Layer**
