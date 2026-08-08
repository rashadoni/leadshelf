import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8")
}

describe("standalone LeadShelf mobile auth wiring", () => {
  it("uses the production LeadShelf auth and shelf sync contract", () => {
    const client = source("./mobile-client.ts")

    expect(client).toContain("/api/v1/mobile/auth/login")
    expect(client).toContain("/api/v1/mobile/auth/refresh")
    expect(client).toContain("/api/v1/mobile/auth/logout")
    expect(client).toContain("/api/v1/mobile/sync/pull")
    expect(client).toContain("/api/v1/mobile/sync/push")
    expect(client).not.toContain("/api/v1/mtm/mobile/auth")
    expect(client).not.toContain("app.leaddrivecrm.org")
  })

  it("keeps the PIN field visible when the Android keyboard opens", () => {
    const login = source("../../app/(auth)/login.tsx")
    const appConfig = JSON.parse(
      readFileSync(resolve(process.cwd(), "app.json"), "utf8"),
    ) as { expo?: { android?: { softwareKeyboardLayoutMode?: string } } }

    expect(login).toContain('behavior={Platform.OS === "ios" ? "padding" : "height"}')
    expect(login).toContain("scrollToEnd({ animated: true })")
    expect(login).toContain('t("employeeCode")')
    expect(login).toContain('t("pin")')
    expect(appConfig.expo?.android?.softwareKeyboardLayoutMode).toBe("resize")
  })
})
