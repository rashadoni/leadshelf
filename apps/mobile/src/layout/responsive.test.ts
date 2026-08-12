import { describe, expect, it } from "vitest"
import { resolveResponsiveLayout, TABLET_CONTENT_MAX_WIDTH } from "./responsive"

describe("responsive mobile layout", () => {
  it("keeps phone layouts single-column in both orientations", () => {
    expect(resolveResponsiveLayout(390, 844)).toMatchObject({ isTablet: false, columns: 1 })
    expect(resolveResponsiveLayout(740, 360)).toMatchObject({ isTablet: false, isLandscape: true, columns: 1 })
  })

  it("switches tablets to a two-column workspace", () => {
    expect(resolveResponsiveLayout(768, 1024)).toMatchObject({ isTablet: true, isTabletLandscape: false, columns: 2 })
    expect(resolveResponsiveLayout(1280, 800)).toMatchObject({ isTablet: true, isTabletLandscape: true, columns: 2 })
  })

  it("bounds very wide tablet content", () => {
    expect(resolveResponsiveLayout(2560, 1600).contentMaxWidth).toBe(TABLET_CONTENT_MAX_WIDTH)
  })
})
