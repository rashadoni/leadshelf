import { describe, expect, it } from "vitest"

import {
  fieldForceSettingsPatchSchema,
  normalizeFieldForceSettings,
  offlineCutoffFor,
  shapeFieldForceSettings,
} from "./settings"

describe("field-force settings helpers", () => {
  it("returns server defaults when tenant settings are not created yet", () => {
    expect(shapeFieldForceSettings(null)).toMatchObject({
      gpsRefreshSeconds: 15,
      geofenceRadiusM: 120,
      offlineAfterMinutes: 45,
      requirePhotoProof: true,
      requireShelfScan: true,
      alertLateVisits: true,
      updatedAt: null,
    })
  })

  it("merges partial settings into defaults", () => {
    expect(normalizeFieldForceSettings({ offlineAfterMinutes: 20, requireShelfScan: false })).toMatchObject({
      gpsRefreshSeconds: 15,
      offlineAfterMinutes: 20,
      requireShelfScan: false,
      requirePhotoProof: true,
    })
  })

  it("rejects unsafe setting ranges", () => {
    expect(fieldForceSettingsPatchSchema.safeParse({ gpsRefreshSeconds: 4 }).success).toBe(false)
    expect(fieldForceSettingsPatchSchema.safeParse({ geofenceRadiusM: 25 }).success).toBe(false)
    expect(fieldForceSettingsPatchSchema.safeParse({ offlineAfterMinutes: 241 }).success).toBe(false)
  })

  it("uses the saved offline threshold to compute cutoff time", () => {
    const cutoff = offlineCutoffFor(new Date("2026-07-06T10:00:00.000Z"), { offlineAfterMinutes: 20 })

    expect(cutoff.toISOString()).toBe("2026-07-06T09:40:00.000Z")
  })
})
