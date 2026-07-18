import { expect, test } from "@playwright/test"

const viewports = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 900 },
  { name: "desktop", width: 1440, height: 1000 },
] as const

const targets = [
  { name: "tasks", path: "/ru/tasks?status=PHOTO_SUBMITTED", readyText: "Выполнить выкладку OTC-зоны" },
  { name: "field-force", path: "/ru/field-force?view=routes", readyText: "Mars Nizami pharmacy execution" },
  { name: "orders", path: "/ru/orders", readyText: "Состояние мобильного исполнения" },
] as const

async function login(page: import("@playwright/test").Page) {
  await page.goto("/ru/login")
  await page.getByRole("textbox", { name: "E-mail" }).fill(process.env.E2E_EMAIL ?? "admin@leadshelf.com")
  await page.getByRole("textbox", { name: "Пароль" }).fill(process.env.E2E_PASSWORD ?? "demo1234")
  const loginResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/auth/login") && response.request().method() === "POST",
  )
  await page.getByRole("button", { name: "Войти" }).click()
  expect((await loginResponse).status(), "demo login HTTP status").toBe(200)
  await page.waitForURL((url) => !url.pathname.includes("/login"), { waitUntil: "domcontentloaded", timeout: 15_000 })
}

for (const viewport of viewports) {
  test(`${viewport.name} execution surfaces stay responsive`, async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await login(page)

    for (const target of targets) {
      await page.goto(target.path, { waitUntil: "domcontentloaded" })
      await expect(page.locator("main")).toBeVisible()
      await expect(page.getByText(target.readyText, { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 })
      const layout = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }))
      expect(layout.content, `${target.name} overflows at ${viewport.width}px`).toBeLessThanOrEqual(layout.viewport + 1)
      await page.screenshot({
        path: testInfo.outputPath(`${target.name}-${viewport.width}.png`),
        fullPage: true,
        animations: "disabled",
      })
    }
  })
}
