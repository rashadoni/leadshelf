import { describe, expect, it } from "vitest"
import { parseLocalPlanogramLibrary } from "./local-library"

describe("parseLocalPlanogramLibrary", () => {
  it("builds offline planogram and equipment summaries from a synced bundle", () => {
    const library = parseLocalPlanogramLibrary([
      {
        versionId: "version-1",
        taskId: "task-1",
        json: JSON.stringify({
          versionNumber: 3,
          publishedAt: "2026-07-10T10:00:00.000Z",
          planogram: { name: "Аптека — витамины" },
          equipment: [
            {
              planogramEquipmentId: "equipment-1",
              name: "Стеллаж 1200",
              widthMm: 1200,
              heightMm: 1800,
              depthMm: 400,
              shelves: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
            },
          ],
          placements: [
            { product: { id: "p1", sku: "SKU-1" } },
            { product: { id: "p1", sku: "SKU-1" } },
            { product: { id: "p2", sku: "SKU-2" } },
          ],
        }),
      },
    ])

    expect(library.planograms).toEqual([
      expect.objectContaining({
        versionId: "version-1",
        name: "Аптека — витамины",
        versionNumber: 3,
        equipmentCount: 1,
        shelfCount: 3,
        productCount: 2,
        taskId: "task-1",
      }),
    ])
    expect(library.equipment).toEqual([
      expect.objectContaining({
        id: "equipment-1",
        name: "Стеллаж 1200",
        widthMm: 1200,
        heightMm: 1800,
        depthMm: 400,
        shelfCount: 3,
        taskId: "task-1",
      }),
    ])
  })

  it("skips malformed bundles", () => {
    expect(
      parseLocalPlanogramLibrary([{ versionId: "broken", taskId: null, json: "{" }]),
    ).toEqual({ planograms: [], equipment: [] })
  })
})
