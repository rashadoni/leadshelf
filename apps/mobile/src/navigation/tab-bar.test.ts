import { describe, expect, it } from "vitest"
import { getBottomTabBarMetrics } from "./tab-bar"

describe("getBottomTabBarMetrics", () => {
  it("preserves the compact tab bar when no bottom inset is present", () => {
    expect(getBottomTabBarMetrics(0)).toEqual({
      height: 62,
      paddingBottom: 8,
    })
  })

  it("keeps tab content above Android system navigation", () => {
    expect(getBottomTabBarMetrics(48)).toEqual({
      height: 110,
      paddingBottom: 56,
    })
  })

  it("ignores invalid negative insets", () => {
    expect(getBottomTabBarMetrics(-12)).toEqual({
      height: 62,
      paddingBottom: 8,
    })
  })
})
