# LeadShelf: data model draft

Черновик. Названия можно менять, но границы сущностей желательно сохранить.

## Identity

```text
Organization
User
Role
Permission
UserRole
AuditLog
ApiToken
```

## Retail network

```text
Store
StoreFormat
StoreFormatAssignment
Region
StoreGroup
FloorPlan
FloorPlanVersion
FloorPlanEquipment
```

## Catalog

```text
Product
ProductBarcode
ProductImage
ProductDimension
Category
Brand
Supplier
Manufacturer
ProductAttributeDefinition
ProductAttributeValue
AssortmentMatrix
StoreAssortment
PriceSnapshot
StockSnapshot
SalesSnapshot
ImportBatch
ImportError
```

## Equipment

```text
EquipmentTemplate
EquipmentType
EquipmentVersion
EquipmentShelf
EquipmentCell
EquipmentHook
EquipmentConstraint
EquipmentPreviewAsset
```

## Planograms

```text
Planogram
PlanogramVersion
PlanogramEquipment
PlanogramShelf
PlanogramZone
PlanogramPlacement
PlanogramRuleSet
PlanogramRuleStep
PlanogramAssignment
PlanogramPublish
PlanogramChangeLog
```

### PlanogramPlacement core fields

```text
id
planogramVersionId
productId
equipmentId
shelfId
zoneId
xMm
yMm
zMm
widthMm
heightMm
depthMm
facingsX
facingsY
facingsZ
rotationX
rotationY
rotationZ
compressionX
compressionY
compressionZ
stackMode
sortOrder
metadataJson
```

## Publishing & Tasks

```text
Task
TaskAssignment
TaskStatusHistory
TaskComment
TaskAttachment
PhotoSubmission
PlanogramExecutionCheck
```

Task must reference a published immutable version:

```text
task.planogramVersionId
task.storeId
task.assignmentId
```

## Mobile sync

```text
MobileDevice
MobileSession
SyncCursor
OutboxOperation
SyncConflict
```

## Analytics

```text
MetricSnapshot
PlanogramMetricSnapshot
StoreMetricSnapshot
SkuMetricSnapshot
TaskMetricSnapshot
ReportExport
```

For BI, avoid computing everything from raw data every time.

## AI / Vision

```text
GoldenReference
GoldenReferenceSlot
ShelfScan
ShelfDetection
ShelfComplianceResult
ModelTrainingRun
ActiveModel
HumanReview
```

AI tables should be optional. Core planogram workflow must work without them.

## Versioning rules

### Draft

User edits draft version.

### Publish

Publishing creates immutable published version snapshot.

### Assignment

Published version is assigned to stores or formats.

### Task

Task points to the published version.

### Analytics

Analytics uses published version + sales/stock snapshots for the selected period.

## Indexes to think about early

```text
Product.organizationId
ProductBarcode.barcode
Product.categoryId
Product.brandId
Store.organizationId
Store.formatId
Planogram.organizationId
PlanogramVersion.planogramId
PlanogramPlacement.planogramVersionId
PlanogramAssignment.storeId
PlanogramAssignment.formatId
Task.storeId/status/dueAt
StockSnapshot.productId/storeId/date
SalesSnapshot.productId/storeId/date
```

## Import principle

Every import should create `ImportBatch`.

Bad rows should not silently disappear. They should become `ImportError` with:

- source row;
- field;
- reason;
- severity;
- suggested fix.
