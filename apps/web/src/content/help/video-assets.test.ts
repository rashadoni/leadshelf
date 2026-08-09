import { describe, expect, it } from "vitest"
import { HELP_VIDEO_AVAILABILITY } from "./video-availability.generated"
import {
  HELP_VIDEO_ENTRIES,
  getRegisteredHelpVideoForPath,
  normalizeHelpVideoLocale,
} from "./video-assets"

describe("LeadShelf help-video registry", () => {
  it.each([
    ["/az", "overview"],
    ["/az/catalog", "catalog"],
    ["/az/catalog/import", "catalog-import"],
    ["/az/catalog/quality", "catalog-quality"],
    ["/az/equipment-library/new", "equipment-new"],
    ["/az/equipment-library/template-1", "equipment-editor"],
    ["/az/stores/store-1", "store-detail"],
    ["/az/planograms/new", "planogram-new"],
    ["/az/planograms/planogram-1/version-1", "planogram-editor"],
    ["/az/tasks/task-1", "task-detail"],
    ["/az/reviews", "reviews"],
    ["/az/field-force", "field-force"],
    ["/az/orders", "orders"],
    ["/az/analytics", "analytics"],
  ])("maps %s to %s", (path, slug) => {
    expect(getRegisteredHelpVideoForPath(path)?.slug).toBe(slug)
  })

  it("does not offer a non-Azerbaijani guide locale", () => {
    expect(normalizeHelpVideoLocale("az")).toBe("az")
    expect(normalizeHelpVideoLocale("ru")).toBeNull()
    expect(normalizeHelpVideoLocale("en")).toBeNull()
  })

  it("keeps the generated availability list AZ-only and registry-backed", () => {
    const slugs = new Set<string>(HELP_VIDEO_ENTRIES.map((entry) => entry.slug))
    for (const item of HELP_VIDEO_AVAILABILITY as readonly string[]) {
      expect(item).toMatch(/^[a-z0-9-]+\.az$/)
      expect(slugs.has(item.replace(/\.az$/, ""))).toBe(true)
    }
  })
})
