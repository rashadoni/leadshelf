import { expect, test, type Page } from "@playwright/test"

async function login(page: Page) {
  await page.goto("/ru/login")
  await page.getByRole("textbox", { name: "Код организации" }).fill(
    process.env.E2E_ORGANIZATION_SLUG ?? "demo",
  )
  await page.getByRole("textbox", { name: "E-mail" }).fill(
    process.env.E2E_EMAIL ?? "admin@leadshelf.com",
  )
  await page.getByRole("textbox", { name: "Пароль" }).fill(
    process.env.E2E_PASSWORD ?? "demo1234",
  )
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    waitUntil: "domcontentloaded",
    timeout: 15_000,
  })
}

test("catalog mutation error exposes the support correlation ID", async ({ page }) => {
  await login(page)
  await page.route("**/api/v1/catalog/products", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "x-correlation-id": "e2e-support-503" },
      body: JSON.stringify({ error: "internal_details_must_not_be_rendered" }),
    })
  })

  await page.goto("/ru/catalog", { waitUntil: "networkidle" })
  const name = page.getByPlaceholder("Название", { exact: true })
  const sku = page.getByPlaceholder("SKU", { exact: true })
  await name.fill("Support error fixture")
  await sku.fill("E2E-SUPPORT-ERROR")
  await expect(name).toHaveValue("Support error fixture")
  await expect(sku).toHaveValue("E2E-SUPPORT-ERROR")
  await page.getByRole("button", { name: "Создать товар" }).click()

  const alert = page.locator('span[role="alert"]').filter({ hasText: "Не удалось сохранить" })
  await expect(alert).toContainText("Не удалось сохранить")
  await expect(alert).toContainText("Код поддержки: e2e-support-503.")
  await expect(alert).not.toContainText("internal_details_must_not_be_rendered")
})
