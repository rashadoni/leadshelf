# MTM → LeadShelf: план миграции (Codex, gpt-5.5, 2026-07-02)

Сгенерирован Codex-архитектором по правилам из `08-scope-expansion-mtm-full-port.md`.

Below is the migration plan I would use. The main principle: **LeadShelf becomes a new field-force + shelf-execution product; MTM is the behavioral reference, not the architecture source.**

**Stress-Test Result**
Internal review converged on the same direction: build the LeadShelf domain first, then port algorithms and flows into it. Biggest risk is trying to “full port” routes/orders/AI before the physical planogram + publish + mobile proof spine exists. Codex peer-review escalation was attempted, but the MCP call was cancelled, so no second-model verdict was available.

**A. Repo Bootstrap Order**

1. **Create monorepo skeleton**
   - `apps/web`
   - `apps/mobile`
   - `services/worker`
   - `services/vision` optional stub only
   - `packages/db`
   - `packages/core`
   - `packages/api-contracts`
   - `packages/ui`

2. **Set foundations before porting UI**
   - TypeScript, lint, formatting, test runner.
   - Prisma in `packages/db`.
   - Zod contracts in `packages/api-contracts`.
   - Pure domain math in `packages/core`.

3. **Implement schema v0 first**
   - Identity/tenant.
   - Store/network.
   - Catalog/snapshots.
   - Equipment library.
   - Asset management.
   - Physical planograms.
   - Publish/task/mobile sync.
   - Field-force entities.

4. **Build core packages before pages**
   - `packages/core/planogram`: mm geometry, facings X/Y/Z, capacity validation.
   - `packages/core/equipment`: shelf/cell/template helpers.
   - `packages/core/photo-proof`: EXIF, watermark, quality rules.
   - `packages/core/field-force`: territory scope, geofence, visit anomaly.
   - `packages/core/orders`: credit limit, promotions, invoice inputs.

5. **Create minimal web shell**
   - Auth/tenant.
   - Navigation placeholders.
   - Demo tenant seed.
   - Empty modules: Catalog, Equipment Library, Stores, Planograms, Tasks, Field Force, Analytics.

6. **Only then port MTM behavior**
   - Start with pure algorithms from `src/lib/mtm`.
   - Rebuild API routes around new zod contracts.
   - Rebuild UI screens using LeadShelf-native routes and names.
   - Do not copy old `Mtm*` Prisma models or old dashboard sidebar structure.

---

**B. Domain-by-Domain Port Order**

| Order | LeadShelf module | Source MTM sections/files | Port / rewrite / drop |
|---:|---|---|---|
| 1 | Catalog & ERP snapshots | `skus`, `categories`, `sku-import-modal`, `src/lib/mtm/sku/*`, `erp-health` | Port CSV/category parsing behavior. Rewrite models as `Product`, `Category`, `Barcode`, `PriceSnapshot`, `StockSnapshot`, `SalesSnapshot`. Drop `MtmSku` naming. |
| 2 | Retail network | `customers`, `regions` | Rewrite `MtmCustomer` as `Store`. Add `StoreFormat`, `StoreGroup`, `FloorPlan`. No CRM contact semantics. |
| 3 | Workforce | `agents`, `teams`, `settings`, `territory-scope.ts` | Port territory scoping logic into `packages/core`. Rewrite as `FieldAgent`, `Team`, `Region`, tied to `User` but not CRM. |
| 4 | Equipment library | Old `equipment`, `equipment-form`, `shelf-builder` | Rewrite. Old MTM equipment is asset inventory, not planogram constructor. Equipment library must model templates, shelves, cells, hooks, mm dimensions. |
| 5 | Asset management | `equipment`, `repair-requests`, equipment status helpers | Port status transitions/repair behavior. Rewrite as `EquipmentAsset`, `AssetInspection`, `RepairRequest`, `AssetHistory`. |
| 6 | Physical planogram core | `planograms`, `shelf-builder.tsx` | Mostly rewrite. Old expected SKU/bbox model is not the core. New core is `PlanogramVersion`, shelves, zones, placements, facings X/Y/Z, mm dimensions. |
| 7 | Golden reference / AI check layer | `golden-reference-editor`, `shelf-annotator`, `planogram-checks`, `shelf-analytics`, `model-training` | Port later. Old bbox slots become `GoldenReferenceSlot` / `ShelfDetection`, never `PlanogramPlacement`. |
| 8 | Publish + tasks | `tasks`, `planogram-checks`, mobile planogram APIs | Rewrite around immutable publish snapshot. Task must point to published version, store, assignment, due date, SLA. |
| 9 | Mobile execution | `mobile/auth`, `mobile/sync`, `mobile/location`, `mobile/profile`, `mobile/planogram-checks`, `photos` | Port offline/idempotency lessons. Rewrite contracts. Keep mobile simple: task list, planogram view, photo proof, comments, barcode lookup. |
| 10 | Photo proof | `photo-watermark`, `photo-quality`, `inline-scan-exif-forensics`, `photos` | Port algorithms into `packages/core/photo-proof`. Replace “LeadDrive MTM” EXIF markers with LeadShelf. Store media in object storage. |
| 11 | Routes / visits / live map | `routes`, `visits`, `map`, `locations`, `route-map`, `live-map`, `visit-anomaly/*` | Port route/visit behavior after mobile task proof. Keep `Route`, `RouteStop`, `Visit`, `AgentLocation`. |
| 12 | Orders / promos / credit / invoices | `orders`, `promotions`, `credit-limits`, `promotion-engine.ts`, `credit-limit.ts`, `invoice-generator.ts`, `price-ocr` | Port pure algorithms. Rewrite data model with `OrderLine`, `Promotion`, `CreditLimit`, `Invoice`. Avoid JSON-only order items if reports matter. |
| 13 | Alerts / notifications / activity | `alerts`, `notifications`, `activity`, `push-notification.ts` | Rewrite as product-wide event/alert system. Port event types selectively. |
| 14 | Analytics / reports / leaderboard | `analytics`, `reports`, `leaderboard`, `shelf-leaderboard.ts`, `shelf-backstop*` | Rewrite queries against snapshots and published versions. Port scoring formulas only after validating against new physical model. |
| 15 | AI/model training | `model-training`, COCO export, `shelf-backstop`, detector provider ideas | Phase 2+. Keep as optional `services/vision`. Do not block MVP on detector quality. |

---

**C. Prisma Schema v0 Model List**

Identity:
`Organization`, `User`, `Role`, `Permission`, `UserRole`, `Session`, `ApiToken`, `Setting`, `AuditLog`.

Retail network:
`Region`, `StoreFormat`, `Store`, `StoreGroup`, `StoreFormatAssignment`, `FloorPlan`, `FloorPlanVersion`, `FloorPlanEquipment`.

Catalog / ERP:
`Product`, `ProductBarcode`, `ProductImage`, `ProductDimension`, `Category`, `Brand`, `Supplier`, `Manufacturer`, `ProductAttributeDefinition`, `ProductAttributeValue`, `AssortmentMatrix`, `StoreAssortment`, `Warehouse`, `PriceSnapshot`, `StockSnapshot`, `SalesSnapshot`, `ImportBatch`, `ImportError`, `ExternalIdMap`, `ErpSyncLog`.

Equipment library:
`EquipmentTemplate`, `EquipmentType`, `EquipmentVersion`, `EquipmentShelf`, `EquipmentCell`, `EquipmentHook`, `EquipmentConstraint`, `EquipmentPreviewAsset`.

Asset management:
`EquipmentAsset`, `EquipmentAssetHistory`, `EquipmentInspection`, `RepairRequest`.

Planograms:
`Planogram`, `PlanogramVersion`, `PlanogramEquipment`, `PlanogramShelf`, `PlanogramZone`, `PlanogramPlacement`, `PlanogramRuleSet`, `PlanogramRuleStep`, `PlanogramAssignment`, `PlanogramPublish`, `PlanogramChangeLog`.

Publishing / tasks / mobile:
`Task`, `TaskAssignment`, `TaskStatusHistory`, `TaskComment`, `TaskAttachment`, `PhotoSubmission`, `PlanogramExecutionCheck`, `MobileDevice`, `MobileSession`, `SyncCursor`, `OutboxOperation`, `SyncConflict`, `Notification`.

Field force:
`FieldAgent`, `Team`, `Route`, `RouteStop`, `Visit`, `AgentLocation`, `OnboardingProgress`.

Orders / commercial execution:
`Order`, `OrderLine`, `Promotion`, `PromotionProduct`, `CreditLimit`, `Invoice`.

Analytics:
`MetricSnapshot`, `PlanogramMetricSnapshot`, `StoreMetricSnapshot`, `ProductMetricSnapshot`, `TaskMetricSnapshot`, `LeaderboardSnapshot`, `ReportExport`, `ActivityEvent`.

AI / vision:
`GoldenReference`, `GoldenReferenceSlot`, `ShelfScan`, `ShelfDetection`, `ShelfAnnotation`, `ShelfComplianceResult`, `PhotoPriceDetection`, `ModelTrainingRun`, `ActiveModel`, `HumanReview`.

Key relation rules:
- `Store` replaces `MtmCustomer`.
- `Product` replaces `MtmSku`.
- `EquipmentTemplate` is for planogram construction.
- `EquipmentAsset` is a physical store asset.
- `PlanogramVersion` owns physical placements.
- `PlanogramPublish` creates immutable published snapshots.
- `Task` references published version + store + assignment.
- `ShelfDetection` / `GoldenReferenceSlot` reference photos and AI checks, not core placement.

---

**D. Top Risks / Edge Cases**

- Full MTM port can bury the planogram MVP under field-force/order scope.
- Old bbox planogram logic can accidentally leak into the physical model.
- Equipment naming can confuse template vs real asset.
- Mutable draft publishing would break mobile proof and historical analytics.
- Offline mobile needs idempotency from day one, especially photos/orders/check-ins.
- Decimal serialization from Prisma must be normalized for mobile JSON.
- Relative media URLs must become absolute for React Native images.
- ERP imports must create snapshots, not overwrite historical reporting facts.
- Promotions/credit/invoices are financial-adjacent; port algorithms with tests before UI.
- AI compliance should store raw detections, model version, confidence, and human review state.
- Tenant isolation must be rebuilt natively, not copied from CRM assumptions.

---

**E. Explicitly NOT Phase 1**

- Do not copy the old MTM sidebar/pages/API tree.
- Do not create `Mtm*` models.
- Do not import LeadDrive CRM modules, permissions, dashboards, contacts, deals, finance, loyalty, omnichannel, contracts, or AI Advisor.
- Do not make bbox/golden-reference the source of truth for planograms.
- Do not publish mutable drafts.
- Do not build 3D editor or AI detector first.
- Do not build mobile as online-only.
- Do not store planogram/order/report-critical data as unmanaged JSON blobs.
- Do not implement orders/promos/invoices before catalog, store, planogram, publish, and task proof are stable.
