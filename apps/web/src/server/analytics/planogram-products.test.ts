import { describe, expect, it } from "vitest"

import {
  getAbcRows,
  getAssortmentGapRows,
  getBasicDashboardSummary,
  getLikeForLikeBreakdown,
  getLikeForLikeSummary,
  getObsoletePlanogramRows,
  getPhase8MetricRows,
  getPlanogramProductRows,
  getTaskKpiReport,
  getShelfShareGroups,
  getSpaceProductivityRows,
  type ProductRow,
} from "./planogram-products"

type AnalyticsDb = Parameters<typeof getAssortmentGapRows>[0]
type PlanogramPlacementDb = Parameters<typeof getPlanogramProductRows>[0]
type PlanogramAssignmentDb = Parameters<typeof getBasicDashboardSummary>[1]

function asDb(db: unknown): AnalyticsDb {
  return db as AnalyticsDb
}

function asPlacementDb(db: unknown): PlanogramPlacementDb {
  return db as PlanogramPlacementDb
}

function asAssignmentDb(db: unknown): PlanogramAssignmentDb {
  return db as PlanogramAssignmentDb
}

function expectOrganizationScope(args: unknown, organizationId = "org-a"): void {
  const scoped = args as {
    where?: { planogramVersion?: { planogram?: { organizationId?: string } } }
  }
  expect(scoped.where?.planogramVersion?.planogram?.organizationId).toBe(organizationId)
}

function expectFormatScope(args: unknown, organizationId = "org-a"): void {
  const scoped = args as { where?: { format?: { organizationId?: string } } }
  expect(scoped.where?.format?.organizationId).toBe(organizationId)
}

function expectStoreScope(args: unknown, organizationId = "org-a"): void {
  const scoped = args as { where?: { store?: { organizationId?: string } } }
  expect(scoped.where?.store?.organizationId).toBe(organizationId)
}

function product(overrides: {
  id: string
  sku: string
  name?: string
  isActive?: boolean
}) {
  return {
    id: overrides.id,
    sku: overrides.sku,
    name: overrides.name ?? overrides.sku,
    isActive: overrides.isActive ?? true,
    brand: { name: "Brand" },
    category: { name: "Category" },
    supplier: { name: "Supplier" },
  }
}

function productRow(overrides: Partial<ProductRow> & Pick<ProductRow, "productId" | "sku" | "linearMm">): ProductRow {
  return {
    key: `${overrides.productId}:row`,
    productId: overrides.productId,
    planogramId: "planogram-a",
    versionId: "version-a",
    planogramName: "Planogram A",
    versionNumber: 1,
    state: "PUBLISHED",
    sku: overrides.sku,
    productName: overrides.productName ?? overrides.sku,
    category: overrides.category === undefined ? "Category" : overrides.category,
    brand: overrides.brand === undefined ? "Brand" : overrides.brand,
    supplier: overrides.supplier === undefined ? "Supplier" : overrides.supplier,
    placements: overrides.placements ?? 1,
    units: overrides.units ?? 1,
    linearMm: overrides.linearMm,
  }
}

describe("analytics planogram product helpers", () => {
  it("reads placements through an organization-scoped parent path", async () => {
    const db = {
      planogramPlacement: {
        findMany: async (args: {
          where: { planogramVersion: { planogram: { organizationId: string } } }
        }) => {
          expectOrganizationScope(args)
          return [
            {
              planogramVersionId: "version-a",
              productId: "product-a",
              facingsX: 2,
              facingsY: 1,
              facingsZ: 3,
              widthMm: 75,
              compressionX: 0.9,
              sortOrder: 1,
              planogramVersion: {
                id: "version-a",
                versionNumber: 1,
                state: "PUBLISHED",
                planogram: { id: "planogram-a", name: "Planogram A" },
              },
              product: {
                id: "product-a",
                sku: "SKU-A",
                name: "Product A",
                category: { name: "Category" },
                brand: { name: "Brand" },
                supplier: { name: "Supplier" },
              },
            },
          ]
        },
      },
    }

    await expect(getPlanogramProductRows(asPlacementDb(db), "org-a")).resolves.toEqual([
      expect.objectContaining({
        key: "version-a:product-a",
        units: 6,
        linearMm: 135,
      }),
    ])
  })

  it("counts active dashboard assignments through direct stores and formats", async () => {
    const now = new Date("2026-07-04T10:00:00.000Z")
    const db = asDb({
      planogramAssignment: {
        findMany: async (args: unknown) => {
          expectOrganizationScope(args)
          return [
            {
              storeId: "store-direct",
              formatId: null,
              planogramVersionId: "version-a",
              activeFrom: new Date("2026-07-01T00:00:00.000Z"),
              activeTo: null,
              planogramVersion: {
                placements: [
                  { productId: "product-a", widthMm: 100, compressionX: 0.9, facingsX: 2 },
                  { productId: "product-b", widthMm: 50, compressionX: 1, facingsX: 1 },
                ],
              },
            },
            {
              storeId: null,
              formatId: "format-a",
              planogramVersionId: "version-a",
              activeFrom: new Date("2026-07-01T00:00:00.000Z"),
              activeTo: null,
              planogramVersion: {
                placements: [
                  { productId: "product-a", widthMm: 100, compressionX: 0.9, facingsX: 2 },
                  { productId: "product-b", widthMm: 50, compressionX: 1, facingsX: 1 },
                ],
              },
            },
            {
              storeId: "store-expired",
              formatId: null,
              planogramVersionId: "version-expired",
              activeFrom: new Date("2026-06-01T00:00:00.000Z"),
              activeTo: new Date("2026-06-30T00:00:00.000Z"),
              planogramVersion: {
                placements: [
                  { productId: "product-expired", widthMm: 1000, compressionX: 1, facingsX: 1 },
                ],
              },
            },
          ]
        },
      },
      store: {
        findMany: async () => [{ id: "store-format-1" }, { id: "store-format-2" }],
      },
      salesSnapshot: {
        findMany: async () => [
          { revenue: 100, profit: 30 },
          { revenue: 40, profit: null },
        ],
      },
    })

    await expect(getBasicDashboardSummary(db, asAssignmentDb(db), "org-a", now)).resolves.toEqual({
      storesWithPlanograms: 3,
      activePlanograms: 1,
      placedSkus: 2,
      linearMm: 230,
      turnover: 140,
      profit: 30,
    })
  })

  it("assigns ABC classes across turnover, cost, profit, and quantity", async () => {
    const db = asDb({
      salesSnapshot: {
        findMany: async () => [
          {
            productId: "product-a",
            revenue: 160,
            profit: 80,
            quantity: 80,
            product: product({ id: "product-a", sku: "A" }),
          },
          {
            productId: "product-b",
            revenue: 30,
            profit: 15,
            quantity: 15,
            product: product({ id: "product-b", sku: "B" }),
          },
          {
            productId: "product-c",
            revenue: 10,
            profit: 5,
            quantity: 5,
            product: product({ id: "product-c", sku: "C" }),
          },
        ],
      },
    })

    const rows = await getAbcRows(db)

    expect(rows.map((row) => [row.sku, row.classes.turnover])).toEqual([
      ["A", "A"],
      ["B", "B"],
      ["C", "C"],
    ])
    expect(rows.find((row) => row.sku === "A")?.classes).toEqual({
      turnover: "A",
      cost: "A",
      profit: "A",
      quantity: "A",
    })
  })

  it("reports active assortment gaps only when assigned planograms miss the product", async () => {
    const now = new Date("2026-07-04T10:00:00.000Z")
    const db = asDb({
      assortmentMatrix: {
        findMany: async (args: unknown) => {
          expectFormatScope(args)
          return [
            {
              formatId: "format-a",
              productId: "product-placed",
              isActive: true,
              validFrom: null,
              validTo: null,
              format: { id: "format-a", name: "Format A" },
              product: product({ id: "product-placed", sku: "PLACED" }),
            },
            {
              formatId: "format-a",
              productId: "product-gap",
              isActive: true,
              validFrom: null,
              validTo: null,
              format: { id: "format-a", name: "Format A" },
              product: product({ id: "product-gap", sku: "GAP" }),
            },
            {
              formatId: "format-a",
              productId: "product-future",
              isActive: true,
              validFrom: new Date("2026-08-01T00:00:00.000Z"),
              validTo: null,
              format: { id: "format-a", name: "Format A" },
              product: product({ id: "product-future", sku: "FUTURE" }),
            },
          ]
        },
      },
      storeAssortment: {
        findMany: async (args: unknown) => {
          expectStoreScope(args)
          return [
            {
              storeId: "store-a",
              productId: "product-store-placed",
              isActive: true,
              validFrom: null,
              validTo: null,
              store: { id: "store-a", name: "Store A" },
              product: product({ id: "product-store-placed", sku: "STORE-PLACED" }),
            },
            {
              storeId: "store-a",
              productId: "product-store-gap",
              isActive: true,
              validFrom: null,
              validTo: null,
              store: { id: "store-a", name: "Store A" },
              product: product({ id: "product-store-gap", sku: "STORE-GAP" }),
            },
          ]
        },
      },
      planogramAssignment: {
        findMany: async (args: unknown) => {
          expectOrganizationScope(args)
          return [
          {
            formatId: "format-a",
            storeId: null,
            activeFrom: new Date("2026-07-01T00:00:00.000Z"),
            activeTo: null,
            planogramVersion: { placements: [{ productId: "product-placed" }] },
          },
          {
            formatId: null,
            storeId: "store-a",
            activeFrom: new Date("2026-07-01T00:00:00.000Z"),
            activeTo: null,
            planogramVersion: { placements: [{ productId: "product-store-placed" }] },
          },
          {
            formatId: "format-a",
            storeId: null,
            activeFrom: new Date("2026-06-01T00:00:00.000Z"),
            activeTo: new Date("2026-06-30T00:00:00.000Z"),
            planogramVersion: { placements: [{ productId: "product-gap" }] },
          },
          ]
        },
      },
    })

    const rows = await getAssortmentGapRows(db, asAssignmentDb(db), "org-a", now)

    expect(rows.map((row) => row.key)).toEqual([
      "format:format-a:product-gap",
      "store:store-a:product-store-gap",
    ])
  })

  it("reports obsolete planogram products by inactive, expired, missing, and product inactive reasons", async () => {
    const now = new Date("2026-07-04T10:00:00.000Z")
    const db = asDb({
      assortmentMatrix: {
        findMany: async (args: unknown) => {
          expectFormatScope(args)
          return [
            {
              formatId: "format-a",
              productId: "product-active",
              isActive: true,
              validFrom: null,
              validTo: null,
            },
            {
              formatId: "format-a",
              productId: "product-inactive",
              isActive: false,
              validFrom: null,
              validTo: null,
            },
            {
              formatId: "format-a",
              productId: "product-expired",
              isActive: true,
              validFrom: null,
              validTo: new Date("2026-06-30T00:00:00.000Z"),
            },
            {
              formatId: "format-a",
              productId: "product-not-active",
              isActive: true,
              validFrom: null,
              validTo: null,
            },
          ]
        },
      },
      storeAssortment: {
        findMany: async (args: unknown) => {
          expectStoreScope(args)
          return [
            {
              storeId: "store-a",
              productId: "product-store-override",
              isActive: true,
              validFrom: null,
              validTo: null,
            },
          ]
        },
      },
      planogramAssignment: {
        findMany: async (args: unknown) => {
          expectOrganizationScope(args)
          return [
          {
            id: "assignment-format",
            formatId: "format-a",
            storeId: null,
            activeFrom: new Date("2026-07-01T00:00:00.000Z"),
            activeTo: null,
            format: { id: "format-a", name: "Format A" },
            store: null,
            planogramVersion: {
              id: "version-a",
              versionNumber: 1,
              planogram: { id: "planogram-a", name: "Planogram A" },
              placements: [
                { productId: "product-active", product: product({ id: "product-active", sku: "ACTIVE" }) },
                { productId: "product-inactive", product: product({ id: "product-inactive", sku: "INACTIVE" }) },
                { productId: "product-inactive", product: product({ id: "product-inactive", sku: "INACTIVE" }) },
                { productId: "product-expired", product: product({ id: "product-expired", sku: "EXPIRED" }) },
                { productId: "product-missing", product: product({ id: "product-missing", sku: "MISSING" }) },
                {
                  productId: "product-not-active",
                  product: product({ id: "product-not-active", sku: "NOT-ACTIVE", isActive: false }),
                },
              ],
            },
          },
          {
            id: "assignment-store",
            formatId: null,
            storeId: "store-a",
            activeFrom: new Date("2026-07-01T00:00:00.000Z"),
            activeTo: null,
            format: null,
            store: { id: "store-a", name: "Store A", formatId: "format-a" },
            planogramVersion: {
              id: "version-store",
              versionNumber: 2,
              planogram: { id: "planogram-store", name: "Store Planogram" },
              placements: [
                {
                  productId: "product-store-override",
                  product: product({ id: "product-store-override", sku: "STORE-OK" }),
                },
              ],
            },
          },
          ]
        },
      },
    })

    const rows = await getObsoletePlanogramRows(db, asAssignmentDb(db), "org-a", now)

    expect(rows.map((row) => [row.sku, row.reason, row.placements])).toEqual([
      ["EXPIRED", "expired", 1],
      ["INACTIVE", "inactive", 2],
      ["MISSING", "missing", 1],
      ["NOT-ACTIVE", "productInactive", 1],
    ])
  })

  it("calculates task KPI completion, timeliness, photo proof, and group metrics", async () => {
    const now = new Date("2026-07-04T10:00:00.000Z")
    const db = asDb({
      task: {
        findMany: async () => [
          {
            id: "task-new",
            status: "NEW",
            createdAt: new Date("2026-07-04T08:00:00.000Z"),
            completedAt: null,
            dueAt: new Date("2026-07-04T09:00:00.000Z"),
            assigneeId: null,
            storeId: "store-a",
            store: { id: "store-a", name: "Store A", code: "A001" },
            planogramVersion: null,
            _count: { photoSubmissions: 0 },
          },
          {
            id: "task-photo",
            status: "PHOTO_SUBMITTED",
            createdAt: new Date("2026-07-04T07:00:00.000Z"),
            completedAt: null,
            dueAt: new Date("2026-07-05T09:00:00.000Z"),
            assigneeId: "user-a",
            storeId: "store-a",
            store: { id: "store-a", name: "Store A", code: "A001" },
            planogramVersion: {
              id: "version-a",
              versionNumber: 1,
              planogram: { id: "planogram-a", name: "Planogram A" },
            },
            _count: { photoSubmissions: 2 },
          },
          {
            id: "task-completed-on-time",
            status: "COMPLETED",
            createdAt: new Date("2026-07-04T06:00:00.000Z"),
            completedAt: new Date("2026-07-04T08:00:00.000Z"),
            dueAt: new Date("2026-07-04T09:00:00.000Z"),
            assigneeId: "user-a",
            storeId: "store-b",
            store: { id: "store-b", name: "Store B", code: null },
            planogramVersion: {
              id: "version-a",
              versionNumber: 1,
              planogram: { id: "planogram-a", name: "Planogram A" },
            },
            _count: { photoSubmissions: 1 },
          },
          {
            id: "task-completed-late",
            status: "COMPLETED",
            createdAt: new Date("2026-07-04T04:00:00.000Z"),
            completedAt: new Date("2026-07-04T08:00:00.000Z"),
            dueAt: new Date("2026-07-04T07:00:00.000Z"),
            assigneeId: "user-b",
            storeId: "store-b",
            store: { id: "store-b", name: "Store B", code: null },
            planogramVersion: {
              id: "version-b",
              versionNumber: 2,
              planogram: { id: "planogram-b", name: "Planogram B" },
            },
            _count: { photoSubmissions: 0 },
          },
          {
            id: "task-expired",
            status: "EXPIRED",
            createdAt: new Date("2026-07-03T04:00:00.000Z"),
            completedAt: null,
            dueAt: new Date("2026-07-03T07:00:00.000Z"),
            assigneeId: "user-b",
            storeId: "store-c",
            store: { id: "store-c", name: "Store C", code: "C001" },
            planogramVersion: null,
            _count: { photoSubmissions: 0 },
          },
        ],
      },
    })

    const report = await getTaskKpiReport(db, now)

    expect(report.summary).toEqual({
      total: 5,
      open: 2,
      completed: 2,
      expired: 1,
      photoSubmitted: 1,
      overdueOpen: 1,
      unassignedOpen: 1,
      photoSubmissions: 3,
      completionRate: 0.4,
      onTimeRate: 0.5,
      avgCompletionHours: 3,
    })
    expect(report.stores.map((row) => [row.label, row.total, row.open, row.completed])).toEqual([
      ["Store A (A001)", 2, 2, 0],
      ["Store B", 2, 0, 2],
      ["Store C (C001)", 1, 0, 0],
    ])
    expect(report.planograms.map((row) => [row.label, row.total, row.completionRate])).toEqual([
      ["Planogram A · v1", 2, 0.5],
      ["Planogram B · v2", 1, 1],
    ])
  })

  it("compares like-for-like periods by turnover, profit, and quantity", async () => {
    const now = new Date("2026-07-04T10:00:00.000Z")
    const db = asDb({
      salesSnapshot: {
        findMany: async () => [
          {
            date: new Date("2026-07-01T00:00:00.000Z"),
            quantity: 10,
            revenue: 100,
            profit: 30,
          },
          {
            date: new Date("2026-06-01T00:00:00.000Z"),
            quantity: 4,
            revenue: 50,
            profit: 10,
          },
        ],
      },
    })

    const summary = await getLikeForLikeSummary(db, now, 30)

    expect(summary).toEqual({
      days: 30,
      currentStart: "2026-06-05",
      currentEnd: "2026-07-04",
      previousStart: "2026-05-06",
      previousEnd: "2026-06-04",
      rows: [
        { metric: "turnover", current: 100, previous: 50, delta: 50, deltaPct: 1 },
        { metric: "profit", current: 30, previous: 10, delta: 20, deltaPct: 2 },
        { metric: "quantity", current: 10, previous: 4, delta: 6, deltaPct: 1.5 },
      ],
    })
  })

  it("breaks like-for-like turnover down by store, format, and active planogram", async () => {
    const now = new Date("2026-07-04T10:00:00.000Z")
    const db = asDb({
      salesSnapshot: {
        findMany: async () => [
          {
            date: new Date("2026-07-01T00:00:00.000Z"),
            productId: "product-a",
            quantity: 10,
            revenue: 100,
            profit: 30,
            store: {
              id: "store-a",
              name: "Store A",
              code: "A001",
              format: { id: "format-a", name: "Format A" },
            },
          },
          {
            date: new Date("2026-06-01T00:00:00.000Z"),
            productId: "product-a",
            quantity: 4,
            revenue: 50,
            profit: 10,
            store: {
              id: "store-a",
              name: "Store A",
              code: "A001",
              format: { id: "format-a", name: "Format A" },
            },
          },
        ],
      },
      planogramAssignment: {
        findMany: async (args: unknown) => {
          expectOrganizationScope(args)
          return [
          {
            storeId: "store-a",
            formatId: null,
            activeFrom: new Date("2026-07-01T00:00:00.000Z"),
            activeTo: null,
            store: { id: "store-a", name: "Store A", code: "A001" },
            format: null,
            planogramVersion: {
              id: "version-a",
              versionNumber: 1,
              planogram: { id: "planogram-a", name: "Planogram A" },
              placements: [{ productId: "product-a" }],
            },
          },
          ]
        },
      },
    })

    const breakdown = await getLikeForLikeBreakdown(db, asAssignmentDb(db), "org-a", now, 30)

    expect(breakdown.store).toMatchObject([
      {
        key: "store-a",
        label: "Store A (A001)",
        currentTurnover: 100,
        previousTurnover: 50,
        turnoverDeltaPct: 1,
      },
    ])
    expect(breakdown.format).toMatchObject([
      {
        key: "format-a",
        label: "Format A",
        currentTurnover: 100,
        previousTurnover: 50,
        turnoverDeltaPct: 1,
      },
    ])
    expect(breakdown.planogram).toMatchObject([
      {
        key: "version-a",
        label: "Planogram A · v1",
        currentTurnover: 100,
        previousTurnover: 50,
        turnoverDeltaPct: 1,
      },
    ])
  })

  it("calculates phase 8 per-meter metrics and stock days from unique placed products", () => {
    const metrics = getPhase8MetricRows({
      likeForLikeSummary: {
        days: 30,
        currentStart: "2026-06-05",
        currentEnd: "2026-07-04",
        previousStart: "2026-05-06",
        previousEnd: "2026-06-04",
        rows: [
          { metric: "turnover", current: 300, previous: 150, delta: 150, deltaPct: 1 },
          { metric: "profit", current: 90, previous: 45, delta: 45, deltaPct: 1 },
          { metric: "quantity", current: 30, previous: 10, delta: 20, deltaPct: 2 },
        ],
      },
      totalLinearMm: 3000,
      stockCoverageByProduct: new Map([
        ["product-a", { productId: "product-a", latestStockQty: 50, avgDailySalesQty: 10, stockDays: 5 }],
        ["product-b", { productId: "product-b", latestStockQty: 30, avgDailySalesQty: 2, stockDays: 15 }],
      ]),
      productIds: ["product-a", "product-a", "product-b"],
    })

    expect(metrics).toEqual([
      { key: "turnover", value: 300 },
      { key: "profit", value: 90 },
      { key: "quantity", value: 30 },
      { key: "turnoverPerMeter", value: 100 },
      { key: "profitPerMeter", value: 30 },
      { key: "stockDays", value: 10 },
      { key: "turnoverRatio", value: 2 },
    ])
  })

  it("calculates space productivity gaps and shelf share groups", () => {
    const rows = [
      productRow({ productId: "product-a", sku: "A", brand: "Brand A", supplier: "Supplier A", linearMm: 200 }),
      productRow({ productId: "product-a", sku: "A", brand: "Brand A", supplier: "Supplier A", linearMm: 100 }),
      productRow({ productId: "product-b", sku: "B", brand: null, supplier: "Supplier B", linearMm: 700 }),
    ]
    const abcRows = [
      {
        productId: "product-a",
        sku: "A",
        productName: "A",
        brand: "Brand A",
        category: "Category",
        turnover: 80,
        cost: 90,
        profit: -10,
        quantity: 8,
        classes: { turnover: "A", cost: "A", profit: "C", quantity: "A" },
      },
      {
        productId: "product-b",
        sku: "B",
        productName: "B",
        brand: null,
        category: "Category",
        turnover: 20,
        cost: 10,
        profit: 50,
        quantity: 2,
        classes: { turnover: "B", cost: "B", profit: "A", quantity: "B" },
      },
    ] as const

    const productivityRows = getSpaceProductivityRows(rows, [...abcRows])
    const shelfShareGroups = getShelfShareGroups(rows, "Unassigned")

    expect(productivityRows.map((row) => [row.sku, row.shelfShare, row.salesShare, row.profitShare])).toEqual([
      ["A", 0.3, 0.8, 0],
      ["B", 0.7, 0.2, 1],
    ])
    expect(shelfShareGroups.find((group) => group.dimension === "brand")?.rows).toEqual([
      { label: "Unassigned", productCount: 1, linearMm: 700, shelfShare: 0.7 },
      { label: "Brand A", productCount: 1, linearMm: 300, shelfShare: 0.3 },
    ])
  })
})
