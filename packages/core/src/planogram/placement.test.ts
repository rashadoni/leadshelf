import { describe, expect, test } from "vitest"
import {
  nextFreeXMm,
  shelfSpaceForShelf,
  shelfUsage,
  validatePlacementOnShelf,
  type EquipmentGeometryMm,
  type PlacementCandidateMm,
} from "./placement"

const EQUIPMENT: EquipmentGeometryMm = {
  widthMm: 1200,
  heightMm: 1800,
  depthMm: 300,
  shelves: [
    { id: "s0", shelfIndex: 0, yMm: 50, thicknessMm: 20, depthMm: 300 },
    { id: "s1", shelfIndex: 1, yMm: 400, thicknessMm: 20, depthMm: 300 },
    { id: "s2", shelfIndex: 2, yMm: 750, thicknessMm: 20, depthMm: 250 },
  ],
}

const PRODUCT = { widthMm: 75, heightMm: 150, depthMm: 60 }

function candidate(over: Partial<PlacementCandidateMm> = {}): PlacementCandidateMm {
  return { shelfId: "s0", xMm: 0, facingsX: 1, facingsY: 1, facingsZ: 1, ...PRODUCT, ...over }
}

describe("shelfSpaceForShelf", () => {
  test("просвет считается до полки ВЫШЕ, не до верха", () => {
    const s0 = shelfSpaceForShelf(EQUIPMENT, "s0")!
    expect(s0.clearanceHeightMm).toBe(400 - 70) // до s1.yMm
    const s2 = shelfSpaceForShelf(EQUIPMENT, "s2")!
    expect(s2.clearanceHeightMm).toBe(1800 - 770) // верхняя — до верха
  })
})

describe("validatePlacementOnShelf — физика", () => {
  const shelf = shelfSpaceForShelf(EQUIPMENT, "s0")!

  test("влезает: 5 фейсов по 75мм", () => {
    const r = validatePlacementOnShelf({ shelf, candidate: candidate({ facingsX: 5 }), existing: [] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.occupiedWidthMm).toBe(375)
  })

  test("не влезает по ширине — причина в мм", () => {
    const r = validatePlacementOnShelf({
      shelf,
      candidate: candidate({ xMm: 1000, facingsX: 4 }),
      existing: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe("outside_width")
      expect(r.message).toMatch(/1200мм/)
    }
  })

  test("глубже полки: facingsZ x depth > 300", () => {
    const r = validatePlacementOnShelf({
      shelf,
      candidate: candidate({ facingsZ: 6 }), // 360мм
      existing: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe("outside_depth")
  })

  test("выше просвета: facingsY x height > clearance до следующей полки", () => {
    const r = validatePlacementOnShelf({
      shelf,
      candidate: candidate({ facingsY: 3 }), // 450 > 330
      existing: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe("outside_height")
  })

  test("коллизия с существующим размещением", () => {
    const existing = [candidate({ id: "p1", xMm: 100, facingsX: 4 })] // 100-400
    const r = validatePlacementOnShelf({
      shelf,
      candidate: candidate({ xMm: 350 }),
      existing,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/100-400/)
  })

  test("compressionX уменьшает занятую ширину и интервал коллизии", () => {
    const existing = [candidate({ id: "p1", xMm: 100, facingsX: 4, compressionX: 0.8 })] // 100-340
    const fitsAfterCompressedEnd = validatePlacementOnShelf({
      shelf,
      candidate: candidate({ xMm: 340 }),
      existing,
    })
    const overlapsCompressedEnd = validatePlacementOnShelf({
      shelf,
      candidate: candidate({ xMm: 339 }),
      existing,
    })

    expect(fitsAfterCompressedEnd.ok).toBe(true)
    expect(overlapsCompressedEnd.ok).toBe(false)
  })

  test("update: свое старое место не считается коллизией", () => {
    const existing = [candidate({ id: "p1", xMm: 100, facingsX: 4 })]
    const r = validatePlacementOnShelf({
      shelf,
      candidate: candidate({ id: "p1", xMm: 120, facingsX: 4 }),
      existing,
    })
    expect(r.ok).toBe(true)
  })
})

describe("nextFreeXMm", () => {
  const shelf = shelfSpaceForShelf(EQUIPMENT, "s0")!

  test("пустая полка -> 0; после занятых -> первый зазор", () => {
    expect(nextFreeXMm({ shelf, shelfId: "s0", widthNeededMm: 300, existing: [] })).toBe(0)
    const existing = [
      candidate({ id: "a", xMm: 0, facingsX: 4 }), // 0-300
      candidate({ id: "b", xMm: 700, facingsX: 4 }), // 700-1000
    ]
    expect(nextFreeXMm({ shelf, shelfId: "s0", widthNeededMm: 300, existing })).toBe(300)
    expect(nextFreeXMm({ shelf, shelfId: "s0", widthNeededMm: 500, existing })).toBeNull()
  })
})

describe("shelfUsage", () => {
  test("занято/свободно", () => {
    const shelf = shelfSpaceForShelf(EQUIPMENT, "s0")!
    const u = shelfUsage({
      shelf,
      shelfId: "s0",
      existing: [candidate({ id: "a", xMm: 0, facingsX: 4 })],
    })
    expect(u.usedWidthMm).toBe(300)
    expect(u.freeWidthMm).toBe(900)
  })
})
