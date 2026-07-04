import { describe, expect, it } from "vitest"

import {
  getAbcRows,
  getAssortmentGapRows,
  getBasicDashboardSummary,
  getObsoletePlanogramRows,
  getTaskKpiReport,
} from "./planogram-products"

type AnalyticsDb = Parameters<typeof getAssortmentGapRows>[0]

function asDb(db: unknown): AnalyticsDb {
  return db as AnalyticsDb
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

describe("analytics planogram product helpers", () => {
  it("counts active dashboard assignments through direct stores and formats", async () => {
    const now = new Date("2026-07-04T10:00:00.000Z")
    const db = asDb({
      planogramAssignment: {
        findMany: async () => [
          {
            storeId: "store-direct",
            formatId: null,
            planogramVersionId: "version-a",
            activeFrom: new Date("2026-07-01T00:00:00.000Z"),
            activeTo: null,
          },
          {
            storeId: null,
            formatId: "format-a",
            planogramVersionId: "version-a",
            activeFrom: new Date("2026-07-01T00:00:00.000Z"),
            activeTo: null,
          },
          {
            storeId: "store-expired",
            formatId: null,
            planogramVersionId: "version-expired",
            activeFrom: new Date("2026-06-01T00:00:00.000Z"),
            activeTo: new Date("2026-06-30T00:00:00.000Z"),
          },
        ],
      },
      store: {
        findMany: async () => [{ id: "store-format-1" }, { id: "store-format-2" }],
      },
    })

    await expect(getBasicDashboardSummary(db, now)).resolves.toEqual({
      storesWithPlanograms: 3,
      activePlanograms: 1,
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
        findMany: async () => [
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
        ],
      },
      storeAssortment: {
        findMany: async () => [
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
        ],
      },
      planogramAssignment: {
        findMany: async () => [
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
        ],
      },
    })

    const rows = await getAssortmentGapRows(db, now)

    expect(rows.map((row) => row.key)).toEqual([
      "format:format-a:product-gap",
      "store:store-a:product-store-gap",
    ])
  })

  it("reports obsolete planogram products by inactive, expired, missing, and product inactive reasons", async () => {
    const now = new Date("2026-07-04T10:00:00.000Z")
    const db = asDb({
      assortmentMatrix: {
        findMany: async () => [
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
        ],
      },
      storeAssortment: {
        findMany: async () => [
          {
            storeId: "store-a",
            productId: "product-store-override",
            isActive: true,
            validFrom: null,
            validTo: null,
          },
        ],
      },
      planogramAssignment: {
        findMany: async () => [
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
        ],
      },
    })

    const rows = await getObsoletePlanogramRows(db, now)

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
})
