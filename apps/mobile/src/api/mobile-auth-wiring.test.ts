import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8")
}

describe("variant-capable field mobile auth wiring", () => {
  it("keeps LeadShelf direct auth and routes LeadDrive Field through MTM + Field BFF", () => {
    const client = source("./mobile-client.ts")
    const variant = source("../config/mobile-variant.ts")

    expect(client).toContain("/api/v1/mobile/auth/login")
    expect(client).toContain("/api/v1/mobile/auth/refresh")
    expect(client).toContain("/api/v1/mobile/auth/logout")
    expect(client).toContain('"/api/v1/mobile/workday"')
    expect(client).toContain('"/api/v1/mobile/locations"')
    expect(client).toContain("/api/v1/mtm/mobile/auth")
    expect(client).toContain("/api/v1/mtm/mobile/bootstrap")
    expect(client).toContain("/api/v1/mtm/mobile/attendance/devices/enrollments")
    expect(client).toContain("attendanceDeviceEnrollments")
    expect(client).toContain("pushEphemeralWorkday")
    expect(client).toContain('shelfBffPath("pull")')
    expect(client).toContain('shelfBffPath("push")')
    expect(variant).toContain("/api/v1/mtm/mobile/shelf/sync/pull")
    expect(variant).toContain("/api/v1/mtm/mobile/shelf/sync/push")
    expect(variant).toContain('organizationSlug: process.env.EXPO_PUBLIC_ORGANIZATION_SLUG?.trim().toLowerCase() || "zeytunpharm"')
    expect(variant).toContain('apiUrl: process.env.EXPO_PUBLIC_API_URL?.trim() || "https://app.leaddrivecrm.org"')
  })

  it("keeps the PIN field visible when the Android keyboard opens", () => {
    const login = source("../../app/(auth)/login.tsx")
    const appConfig = JSON.parse(
      readFileSync(resolve(process.cwd(), "app.json"), "utf8"),
    ) as { expo?: { android?: { softwareKeyboardLayoutMode?: string } } }

    expect(login).toContain('behavior={Platform.OS === "ios" ? "padding" : "height"}')
    expect(login).toContain("scrollToEnd({ animated: true })")
    expect(login).toContain('IS_LEADDRIVE_FIELD ? t("email") : t("employeeCode")')
    expect(login).toContain('IS_LEADDRIVE_FIELD ? t("password") : t("pin")')
    expect(appConfig.expo?.android?.softwareKeyboardLayoutMode).toBe("resize")
  })

  it("lets LeadDrive Field users change the organization at login", () => {
    const login = source("../../app/(auth)/login.tsx")

    expect(login).toContain("if (savedOrg) setOrgSlug(savedOrg)")
    expect(login).toContain("orgSlug: orgSlug.trim().toLowerCase()")
    expect(login).toContain("value={orgSlug}")
    expect(login).toContain("onChangeText={setOrgSlug}")
    expect(login).not.toContain("mobileVariant.organizationSlug ?? orgSlug.trim().toLowerCase()")
    expect(login).not.toContain("tenantBadge")
  })
})
