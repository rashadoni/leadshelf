import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

async function expectNoWcagViolations(page: Page, label: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    })),
    `${label} WCAG violations`,
  ).toEqual([])
}

async function login(page: Page) {
  await page.goto("/ru/login", { waitUntil: "networkidle" })
  const origin = new URL(page.url()).origin
  const response = await page.context().request.post(`${origin}/api/auth/login`, {
    headers: { origin },
    data: {
      organizationSlug: process.env.E2E_ORGANIZATION_SLUG ?? "demo",
      email: process.env.E2E_EMAIL ?? "admin@leadshelf.com",
      password: process.env.E2E_PASSWORD ?? "demo1234",
    },
  })
  expect(response.status(), "demo login HTTP status").toBe(200)
}

test("RU/AZ core surfaces have no automated WCAG A/AA violations", async ({ page }) => {
  test.setTimeout(120_000)

  for (const locale of ["ru", "az"] as const) {
    await page.goto(`/${locale}/login`, { waitUntil: "networkidle" })
    await expectNoWcagViolations(page, `${locale} login`)
  }

  await login(page)
  const surfaces = [
    { path: "/ru/catalog", label: "RU catalog" },
    { path: "/ru/tasks", label: "RU tasks" },
    { path: "/ru/analytics", label: "RU analytics" },
    { path: "/az/catalog", label: "AZ catalog" },
    { path: "/az/tasks", label: "AZ tasks" },
    { path: "/az/analytics", label: "AZ analytics" },
  ]
  for (const surface of surfaces) {
    await page.goto(surface.path, { waitUntil: "networkidle" })
    await expect(page.locator("main")).toBeVisible()
    await expectNoWcagViolations(page, surface.label)
  }
})
