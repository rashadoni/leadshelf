import { describe, expect, it } from "vitest"
import { formatLocaleDate, intlLocale } from "./format"

describe("locale formatting", () => {
  it("maps every supported locale to an explicit Intl locale", () => {
    expect(intlLocale("ru")).toBe("ru-RU")
    expect(intlLocale("az")).toBe("az-AZ")
  })

  it("keeps missing or invalid values presentation-safe", () => {
    expect(formatLocaleDate(null, "ru")).toBe("—")
    expect(formatLocaleDate("invalid", "az")).toBe("—")
  })

  it("keeps Azerbaijani medium dates readable in reduced-ICU browsers", () => {
    expect(formatLocaleDate(new Date(2026, 6, 7), "az", { dateStyle: "medium" })).toBe("7 iyl 2026")
  })
})
