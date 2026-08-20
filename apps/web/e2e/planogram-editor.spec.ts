import { expect, test, type Page, type Request } from "@playwright/test"

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

async function openEditableDemoPlanogram(page: Page) {
  await page.goto("/ru/planograms")
  await page
    .getByRole("link", { name: "OTC: простуда и боль - базовая выкладка", exact: true })
    .first()
    .click()

  const createDraft = page.getByRole("button", { name: "Создать черновик для редактирования" })
  const shelfSelector = page.locator('[data-testid="planogram-shelf-selector"]').first()
  await expect
    .poll(async () => (await createDraft.isVisible()) || (await shelfSelector.isVisible()), {
      message: "planogram must expose either its draft action or editable shelf controls",
      timeout: 15_000,
    })
    .toBe(true)
  if (await createDraft.isVisible()) {
    const publishedUrl = page.url()
    await Promise.all([
      page.waitForURL((url) => url.toString() !== publishedUrl && /\/ru\/planograms\/[^/]+\/[^/]+$/.test(url.pathname)),
      createDraft.click(),
    ])
  }
  await expect(page.getByTestId("planogram-canvas")).toBeVisible()
  await expect(shelfSelector).toBeVisible()
}

function isPlacementMutation(request: Request, method: "PATCH" | "DELETE") {
  return request.method() === method && /\/api\/v1\/planograms\/[^/]+\/versions\/[^/]+\/placements\/[^/]+$/.test(request.url())
}

test("planogram editor renders real facings and supports repeated add, commit, move and cleanup", async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await login(page)
  await openEditableDemoPlanogram(page)

  const repeatedPlacement = page.locator('[data-testid="planogram-placement"][data-facings-x="4"]').first()
  await expect(repeatedPlacement).toBeVisible()
  const facingGeometry = await repeatedPlacement.evaluate((element) => {
    const pattern = element.querySelector('[data-testid="planogram-facing-pattern"]')
    const fill = element.querySelector('[data-testid="planogram-facing-fill"]')
    return {
      facingsX: Number(element.getAttribute("data-facings-x")),
      facingsY: Number(element.getAttribute("data-facings-y")),
      faceWidth: Number(pattern?.getAttribute("data-face-width-px")),
      faceHeight: Number(pattern?.getAttribute("data-face-height-px")),
      totalWidth: Number(fill?.getAttribute("width")),
      totalHeight: Number(fill?.getAttribute("height")),
    }
  })
  expect(facingGeometry.totalWidth / facingGeometry.faceWidth).toBeCloseTo(facingGeometry.facingsX, 5)
  expect(facingGeometry.totalHeight / facingGeometry.faceHeight).toBeCloseTo(facingGeometry.facingsY, 5)

  await page.locator('[data-testid="planogram-shelf-selector"][data-shelf-index="1"]').click()
  await page.getByPlaceholder("Поиск товара...").fill("OTC-001")
  const productResult = page.locator('[data-testid="planogram-product-result"][data-sku="OTC-001"]')
  await expect(productResult).toBeVisible()
  const existingProductPlacements = await page.locator('[data-testid="planogram-placement"][data-sku="OTC-001"]').count()

  const addResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && /\/placements$/.test(response.url()),
  )
  await productResult.getByRole("button", { name: "Добавить OTC-001 на полку 1" }).click()
  const addResponse = await addResponsePromise
  expect(addResponse.status()).toBe(201)
  const added = (await addResponse.json()) as { placementId: string }
  const addedPlacement = page.locator(`[data-placement-id="${added.placementId}"]`)
  await expect(addedPlacement).toBeVisible()

  const patchBodies: Array<Record<string, unknown>> = []
  page.on("request", (request) => {
    if (!isPlacementMutation(request, "PATCH")) return
    patchBodies.push(request.postDataJSON() as Record<string, unknown>)
  })

  await addedPlacement.click()
  const position = page.getByLabel("Позиция X, мм")
  await position.fill("100")
  const positionResponse = page.waitForResponse(
    (response) => isPlacementMutation(response.request(), "PATCH") && response.request().postDataJSON().xMm === 100,
  )
  await position.blur()
  expect((await positionResponse).ok()).toBe(true)
  await expect(addedPlacement).toHaveAttribute("data-x-mm", "100")
  expect(patchBodies.filter((body) => body.xMm !== undefined)).toHaveLength(1)
  expect(patchBodies.find((body) => body.xMm !== undefined)?.xMm).toBe(100)

  const beforeDrag = await addedPlacement.boundingBox()
  expect(beforeDrag).not.toBeNull()
  const dragResponse = page.waitForResponse(
    (response) => isPlacementMutation(response.request(), "PATCH") && response.request().postDataJSON().xMm !== undefined,
  )
  await page.mouse.move(beforeDrag!.x + beforeDrag!.width / 2, beforeDrag!.y + beforeDrag!.height / 2)
  await page.mouse.down()
  await page.mouse.move(beforeDrag!.x + beforeDrag!.width / 2 + 50, beforeDrag!.y + beforeDrag!.height / 2, { steps: 5 })
  await expect(addedPlacement).toHaveAttribute("data-drop-state", "valid")
  await page.mouse.up()
  const movedResponse = await dragResponse
  expect(movedResponse.ok()).toBe(true)
  const movedX = Number(movedResponse.request().postDataJSON().xMm)
  expect(movedX).toBeGreaterThan(100)
  await expect(addedPlacement).toHaveAttribute("data-x-mm", String(movedX))
  await expect(addedPlacement).toHaveAttribute("data-drop-state", "idle")

  // Тот же результат поиска остаётся доступным: SKU можно без повторного
  // поиска поставить ещё раз, в том числе на другую полку.
  await page.locator('[data-testid="planogram-shelf-selector"][data-shelf-index="4"]').click()
  const repeatResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && /\/placements$/.test(response.url()),
  )
  await productResult.getByRole("button", { name: "Добавить OTC-001 на полку 4" }).click()
  const repeatResponse = await repeatResponsePromise
  expect(repeatResponse.status()).toBe(201)
  const repeated = (await repeatResponse.json()) as { placementId: string }
  const repeatedPlacementOnShelf = page.locator(`[data-placement-id="${repeated.placementId}"]`)
  await expect(repeatedPlacementOnShelf).toBeVisible()
  await expect(page.locator('[data-testid="planogram-placement"][data-sku="OTC-001"]')).toHaveCount(
    existingProductPlacements + 2,
  )

  await repeatedPlacementOnShelf.click()
  let deleteResponse = page.waitForResponse((response) => isPlacementMutation(response.request(), "DELETE"))
  await page.getByRole("button", { name: "Убрать с полки" }).click()
  expect((await deleteResponse).ok()).toBe(true)
  await expect(repeatedPlacementOnShelf).toHaveCount(0)

  await addedPlacement.click()
  deleteResponse = page.waitForResponse((response) => isPlacementMutation(response.request(), "DELETE"))
  await page.getByRole("button", { name: "Убрать с полки" }).click()
  expect((await deleteResponse).ok()).toBe(true)
  await expect(addedPlacement).toHaveCount(0)
})
