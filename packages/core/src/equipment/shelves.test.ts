import { describe, expect, test } from "vitest"
import { layoutEqualShelves, validateShelfAutoLayout } from "./shelves"

const RACK = {
  equipmentHeightMm: 1800,
  equipmentDepthMm: 300,
  shelfThicknessMm: 20,
  shelfDepthMm: 300,
  topOffsetMm: 0,
  bottomOffsetMm: 50,
}

describe("layoutEqualShelves", () => {
  test("DoD: стеллаж 1800мм, 5 полок — равные просветы, низ с отступом", () => {
    const r = layoutEqualShelves({ ...RACK, shelfCount: 5 })
    expect(r.shelves).toHaveLength(5)
    expect(r.shelves[0]!.yMm).toBe(50) // bottomOffset
    // available = 1800 - 0 - 50 - 5*20 = 1650; gap = 330
    expect(r.rowGapMm).toBe(330)
    expect(r.shelves[1]!.yMm).toBe(50 + 20 + 330)
    expect(r.shelves[4]!.yMm).toBe(50 + 4 * 350)
    // верхняя полка: 1450+20=1470, до верха 1800 -> просвет 330
    expect(r.clearancesMm[4]).toBe(330)
    expect(new Set(r.clearancesMm).size).toBe(1) // все просветы равны
  })

  test("одна полка — весь просвет над ней", () => {
    const r = layoutEqualShelves({ ...RACK, shelfCount: 1 })
    expect(r.shelves[0]!.yMm).toBe(50)
    expect(r.clearancesMm[0]).toBe(1800 - 50 - 20)
  })

  test("остаток от округления уходит в верхний просвет", () => {
    const r = layoutEqualShelves({ ...RACK, equipmentHeightMm: 1000, shelfCount: 3 })
    // available = 1000-50-60=890, gap=296 (890/3=296.67)
    expect(r.rowGapMm).toBe(296)
    expect(r.clearancesMm[2]!).toBeGreaterThanOrEqual(296)
  })
})

describe("validateShelfAutoLayout", () => {
  test("полки не влезают по высоте", () => {
    const issues = validateShelfAutoLayout({ ...RACK, equipmentHeightMm: 100, shelfCount: 10 })
    expect(issues.some((i) => i.code === "shelves_do_not_fit")).toBe(true)
  })

  test("просвет меньше минимума", () => {
    const issues = validateShelfAutoLayout({ ...RACK, shelfCount: 30 })
    expect(issues.some((i) => i.code === "clearance_too_small")).toBe(true)
  })

  test("глубина полки больше глубины оборудования", () => {
    const issues = validateShelfAutoLayout({ ...RACK, shelfCount: 3, shelfDepthMm: 400 })
    expect(issues.some((i) => i.code === "shelf_depth_exceeds_equipment")).toBe(true)
  })

  test("валидный вход — пусто", () => {
    expect(validateShelfAutoLayout({ ...RACK, shelfCount: 5 })).toHaveLength(0)
  })
})
