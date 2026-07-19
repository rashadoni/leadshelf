import { expect, test } from "@playwright/test"

const locales = [
  {
    locale: "ru",
    heading: "LeadShelf — Вход",
    organization: "Код организации",
    email: "E-mail",
    password: "Пароль",
    submit: "Войти",
  },
  {
    locale: "az",
    heading: "LeadShelf — Daxil ol",
    organization: "Təşkilat kodu",
    email: "E-poçt",
    password: "Şifrə",
    submit: "Daxil ol",
  },
] as const

for (const copy of locales) {
  test(`${copy.locale} login exposes localized names and keyboard focus`, async ({ page }) => {
    await page.goto(`/${copy.locale}/login`)

    await expect(page.locator("html")).toHaveAttribute("lang", copy.locale)
    await expect(page.getByRole("heading", { name: copy.heading })).toBeVisible()

    const organization = page.getByRole("textbox", { name: copy.organization })
    const email = page.getByRole("textbox", { name: copy.email })
    const password = page.getByLabel(copy.password)
    const submit = page.getByRole("button", { name: copy.submit })

    await expect(organization).toBeVisible()
    await expect(email).toBeVisible()
    await expect(password).toHaveAttribute("type", "password")
    await expect(submit).toBeVisible()

    await page.keyboard.press("Tab")
    await expect(organization).toBeFocused()
    await expect(organization).toHaveCSS("outline-style", "solid")
    await page.keyboard.press("Tab")
    await expect(email).toBeFocused()
    await page.keyboard.press("Tab")
    await expect(password).toBeFocused()
    await page.keyboard.press("Tab")
    await expect(submit).toBeFocused()
  })
}
