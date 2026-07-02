# Phase 1, срез 1: staging-импорт каталога (Codex, 2026-07-02)

Дизайн Codex-архитектора. Срез 1 = contracts + core-парсеры + worker-исполнитель products + идемпотентность.
Срез 2 = web-роуты + очередь + snapshots/assortment + data-quality API + UI.

**Stack / Boundary**
Next.js App Router + Prisma/Postgres stays. Code split:

- `packages/api-contracts`: versioned zod contracts only.
- `packages/core`: pure parsing/normalization/natural-key logic only.
- `services/worker`: real import executor with `createSystemClient("import-worker")`.
- `apps/web`: minimal authenticated API, upload/status/list. No UI in this slice.

Explicit exclusions: XLSX if it slows CSV, UI screens, product images upload UI, manual dimensions UI, generic 1C adapter, AI import.

**(a) `packages/api-contracts`**
Structure:

```text
packages/api-contracts/src/
  index.ts
  import/
    index.ts
    v1/
      index.ts
      shared.ts
      products.ts
      prices.ts
      stock.ts
      sales.ts
      assortment.ts
      batches.ts
  catalog/
    v1/
      products.ts
      data-quality.ts
```

Versioning: export `import/v1/*`; API requires `contractVersion: "catalog-import.v1"`. Future v2 lives beside v1, not by mutating v1.

Key schemas:

- `ProductImportRowV1`: `sku`, `name`, `barcode`, `categoryPath | categoryCode`, `brandName`, optional `supplierName`, `manufacturerName`, `unit`, `widthMm`, `heightMm`, `depthMm`, `weightG`, `isActive`.
- `PriceSnapshotImportRowV1`: `sku | barcode`, `date`, optional `storeCode`, `price`, optional `costPrice`, `currency`.
- `StockSnapshotImportRowV1`: `sku | barcode`, `date`, optional `storeCode | warehouseCode`, `quantity`.
- `SalesSnapshotImportRowV1`: `sku | barcode`, `date`, optional `storeCode`, `quantity`, `revenue`, optional `profit`.
- `AssortmentImportRowV1`: `sku | barcode`, `scope: "format" | "store"`, `formatName | storeCode`, `status`, optional `validFrom`, `validTo`.
- Shared primitives: `SkuSchema`, `BarcodeSchema`, `DecimalStringSchema`, `DateOnlySchema`, `ProductUnitSchema`, `ImportSeveritySchema`, `ImportBatchStatusSchema`, `ImportEntityTypeSchema`.

Keep decimals as strings. File rows are parsed into these normalized schemas; raw CSV header variants are not the contract.

**(b) `packages/core` Catalog Module**
Structure:

```text
packages/core/src/catalog-import/
  index.ts
  types.ts
  headers.ts
  primitives.ts
  units.ts
  categories.ts
  natural-keys.ts
  parse-product-row.ts
  parse-price-row.ts
  parse-stock-row.ts
  parse-sales-row.ts
  parse-assortment-row.ts
```

Core signatures:

```ts
type RawCsvRow = Record<string, string | undefined>

type RowIssue = {
  rowNumber: number
  field?: string
  reason: string
  severity: "error" | "warning"
  suggestedFix?: string
}

type ParseResult<T> =
  | { ok: true; value: T; warnings: RowIssue[] }
  | { ok: false; errors: RowIssue[]; warnings: RowIssue[] }

parseProductRowV1(row: RawCsvRow, rowNumber: number): ParseResult<ProductImportRowV1>
parsePriceRowV1(row: RawCsvRow, rowNumber: number): ParseResult<PriceSnapshotImportRowV1>
parseStockRowV1(row: RawCsvRow, rowNumber: number): ParseResult<StockSnapshotImportRowV1>
parseSalesRowV1(row: RawCsvRow, rowNumber: number): ParseResult<SalesSnapshotImportRowV1>
parseAssortmentRowV1(row: RawCsvRow, rowNumber: number): ParseResult<AssortmentImportRowV1>

normalizeHeader(header: string): string
canonicalizeRow(row: RawCsvRow, aliases: HeaderAliasMap): RawCsvRow

parseUnit(input: string | undefined): ParseResult<ProductUnit>
// шт -> PCS, ящик -> BOX, кг -> KG, л -> L, пачка -> PACK

parseDecimalString(input: string): ParseResult<string>
parseIntegerMm(input: string | undefined): ParseResult<number | null>
parseDateOnly(input: string): ParseResult<string>
normalizeSku(input: string): string
normalizeBarcode(input: string): string

parseCategoryPath(input: string): ParseResult<{
  segments: string[]
  normalizedPath: string
}>

productNaturalKey(row): { organizationId: string; sku: string }
barcodeNaturalKey(row): { organizationId: string; barcode: string }
snapshotNaturalKey(row): { organizationId: string; productId: string; storeId?: string | null; warehouseId?: string | null; date: string }
assortmentNaturalKey(row): { formatId?: string; storeId?: string; productId: string }
```

Category handling: accept path like `OTC / Pain / Tablets` or `categoryCode`. Normalize trim/collapse whitespace/case for matching, preserve display names for create.

**(c) Import Service**
Location: `services/worker/src/catalog-import/execute-import-batch.ts`.

Reason: 10k-100k rows, streaming, retries, and bulk natural-key writes do not belong inside a Next route handler. `packages/db` should stay DB/client/migrations, not business import logic.

API flow:

1. Web route authenticates tenant.
2. Creates `ImportBatch` with tenant client: `PENDING`.
3. Streams upload to object/temp storage.
4. Enqueues worker job `{ batchId, organizationId, entityType, fileKey, contractVersion }`.
5. Worker uses `createSystemClient("import-worker")`.

Batching:

- Stream CSV row-by-row.
- Parse rows in chunks of 500-1000.
- Write valid rows in short transactions per chunk.
- Batch `ImportError.createMany`.
- Update `ImportBatch.totalRows/errorRows/status` after chunks.
- Never one 100k-row transaction.

Upsert/idempotency:

- Worker may use system client Prisma `upsert` or raw `INSERT ... ON CONFLICT DO UPDATE`, but every query must include `organizationId`.
- Route/server-component code must use tenant-safe pseudo-upsert only: `findFirst` → `updateMany` or `create`, catch unique conflict, re-read.
- Products: natural key `organizationId + sku`.
- Barcodes: `organizationId + barcode`.
- Brand/Supplier/Manufacturer: `organizationId + name`.
- Price: `organizationId + productId + storeId/null + date`.
- Stock: `organizationId + productId + storeId/null + warehouseId/null + date`.
- Sales: `organizationId + productId + storeId/null + date`.
- Assortment matrix: `formatId + productId`.
- Store assortment: `storeId + productId`.

Schema hardening needed before service: add real unique indexes for snapshot natural keys with `NULLS NOT DISTINCT`; add a category uniqueness strategy, preferably normalized category path per org or unique parent/name handling. Current `Category` has no unique key, so category idempotency is not concurrency-safe yet.

`ImportBatch` lifecycle:

`PENDING -> PROCESSING -> COMPLETED | COMPLETED_WITH_ERRORS | FAILED`

Row errors:

- Parser errors become `ImportError`.
- Resolver errors also become `ImportError`: unknown store, unknown format, barcode conflict, duplicate conflicting row.
- `severity="error"` skips that row.
- `severity="warning"` imports row but records quality issue.

Double-run idempotency: rerunning the same file may create a new `ImportBatch`, but product/ref/snapshot/assortment counts and values must remain identical.

**(d) Minimal API**
Routes under `apps/web/src/app/api/v1/catalog`.

- `GET /api/v1/catalog/products`
  - Query zod: `q`, `categoryId`, `brandId`, `missingDimensions`, `missingBarcode`, `limit`, `cursor`.
  - Response: paged product list with primary barcode, category, brand, dimensions flags.

- `POST /api/v1/catalog/imports`
  - Multipart: `file`, `entityType`, `contractVersion`, optional `delimiter`, `encoding`, `dryRun`.
  - Response: `{ batchId, status, totalRows: 0, errorRows: 0 }`.

- `GET /api/v1/catalog/imports/:batchId`
  - Response: batch status, counters, started/finished timestamps.

- `GET /api/v1/catalog/imports/:batchId/errors`
  - Query: `severity`, `field`, `limit`, `cursor`.
  - Response: paged `ImportError[]`.

- `GET /api/v1/catalog/data-quality`
  - Response: counts for missing dimensions, missing barcode, missing image, missing category, plus latest import error summary by field/reason.

**(e) Test Plan**
Parser unit tests:

- Case-insensitive headers.
- BOM stripping.
- RU/AZ header aliases.
- Unit map: `шт/ящик/кг/л/пачка`.
- Decimal comma to decimal string.
- Barcode keeps leading zeros.
- Dimensions parsed as integer mm/g.
- Multiple field errors accumulated per row.
- Category path normalization.
- Price is rejected on product row except as separate price import.

Service integration tests:

- Seed org, stores, formats.
- Import products with category/brand/supplier/manufacturer creation.
- Import price/stock/sales snapshots.
- Import assortment matrix/store exceptions.
- Invalid rows create `ImportError` with row/field/reason/severity/suggestedFix.
- Double-run same file: same product/snapshot/assortment counts and same values.
- Barcode unique inside org, allowed across different orgs.
- Unknown store/format/product becomes queryable error, not silent skip.

Data-quality proof:

- Query `GET /data-quality` after imports.
- Assert counts for missing dimensions/category/barcode/image.
- Assert latest batch errors aggregate by `field + reason + severity`.

**(f) Top Pitfalls**
- 1C CSV may be Windows-1251; detect/allow `encoding=windows-1251`, convert before parsing.
- Decimal comma: parse `12,50` as `"12.50"`, never JS float math.
- BOM and invisible spaces in first header.
- Header variants in AZ/RU/EN; normalize with aliases, but output canonical fields.
- Big files in route handler; route should upload/enqueue, worker streams/processes.
- Excel may turn barcode into scientific notation or strip leading zeros.
- Category idempotency is unsafe without a real unique strategy.
- Snapshot nullable keys need DB-level `NULLS NOT DISTINCT` unique indexes.
- Case-sensitive brand/supplier names can create duplicates unless normalized policy is fixed.
tokens used
74,274
**Stack / Boundary**
Next.js App Router + Prisma/Postgres stays. Code split:

- `packages/api-contracts`: versioned zod contracts only.
- `packages/core`: pure parsing/normalization/natural-key logic only.
- `services/worker`: real import executor with `createSystemClient("import-worker")`.
- `apps/web`: minimal authenticated API, upload/status/list. No UI in this slice.

Explicit exclusions: XLSX if it slows CSV, UI screens, product images upload UI, manual dimensions UI, generic 1C adapter, AI import.

**(a) `packages/api-contracts`**
Structure:

```text
packages/api-contracts/src/
  index.ts
  import/
    index.ts
    v1/
      index.ts
      shared.ts
      products.ts
      prices.ts
      stock.ts
      sales.ts
      assortment.ts
      batches.ts
  catalog/
    v1/
      products.ts
      data-quality.ts
```

