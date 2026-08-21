import { expect, test, type Page } from "@playwright/test"

async function login(page: Page) {
  await page.goto("/ru/login")
  await page.getByRole("textbox", { name: "Код организации" }).fill(process.env.E2E_ORGANIZATION_SLUG ?? "demo")
  await page.getByRole("textbox", { name: "E-mail" }).fill(process.env.E2E_EMAIL ?? "admin@leadshelf.com")
  await page.getByRole("textbox", { name: "Пароль" }).fill(process.env.E2E_PASSWORD ?? "demo1234")
  const response = page.waitForResponse(
    (item) => item.url().endsWith("/api/auth/login") && item.request().method() === "POST",
  )
  await page.getByRole("button", { name: "Войти" }).click()
  expect((await response).status()).toBe(200)
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15_000 })
}

test("floor plan editor adds, drags, rotates and locks equipment without mutating the database", async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await login(page)
  await page.goto("/ru/floor-plans")

  const editor = page.getByTestId("floor-plan-editor").filter({ visible: true }).first()
  const canvas = editor.getByTestId("floor-plan-canvas")
  await expect(canvas).toBeVisible()
  await expect(editor.getByTestId("floor-plan-properties")).toBeVisible()

  const placements = editor.getByTestId("floor-plan-equipment")
  const initialCount = await placements.count()
  await editor.getByRole("button", { name: "Добавить оборудование" }).click()
  await expect(placements).toHaveCount(initialCount + 1)

  const added = placements.last()
  await added.click()
  await expect(editor.getByLabel("Позиция X, мм")).toBeVisible()
  const initialRotation = await added.getAttribute("data-rotation-deg")
  await editor.getByRole("button", { name: "Повернуть 90°" }).click()
  await expect(added).not.toHaveAttribute("data-rotation-deg", initialRotation ?? "0")

  const beforeLockX = await added.getAttribute("data-x-mm")
  await editor.getByRole("button", { name: "Заблокировать" }).click()
  await added.press("ArrowRight")
  await expect(added).toHaveAttribute("data-x-mm", beforeLockX ?? "0")
  await editor.getByRole("button", { name: "Разблокировать" }).click()

  const roomBox = await canvas.boundingBox()
  const itemBox = await added.boundingBox()
  expect(roomBox).not.toBeNull()
  expect(itemBox).not.toBeNull()
  await page.mouse.move(itemBox!.x + itemBox!.width / 2, itemBox!.y + itemBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(roomBox!.x + roomBox!.width * 0.72, roomBox!.y + roomBox!.height * 0.72, { steps: 8 })
  await page.mouse.up()
  await expect(added).not.toHaveAttribute("data-x-mm", beforeLockX ?? "0")

  // No save click: the test intentionally leaves production-like seed data untouched.
  await expect(editor.getByRole("button", { name: "Обновить план" })).toBeEnabled()
})
