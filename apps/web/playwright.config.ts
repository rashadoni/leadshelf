import { defineConfig } from "@playwright/test"

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100"
const e2eLoginAddressPrefix = process.env.LEADSHELF_E2E_LOGIN_ADDRESS_PREFIX
  ?? `e2e-${process.pid}-${Date.now()}`

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI
    ? [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
        // Local/CI proxy simulation: production Caddy overwrites this header.
        // A per-run value keeps durable login limiter tests independent without
        // disabling the limiter or deleting its persisted evidence.
        extraHTTPHeaders: { "x-forwarded-for": `${e2eLoginAddressPrefix}-chromium` },
      },
    },
    {
      name: "firefox",
      use: {
        browserName: "firefox",
        extraHTTPHeaders: { "x-forwarded-for": `${e2eLoginAddressPrefix}-firefox` },
      },
    },
    {
      name: "webkit",
      use: {
        browserName: "webkit",
        extraHTTPHeaders: { "x-forwarded-for": `${e2eLoginAddressPrefix}-webkit` },
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "node scripts/start-standalone.mjs",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          JWT_SECRET: process.env.JWT_SECRET ?? "local-e2e-only-not-a-secret",
          LEADSHELF_RUNTIME_PROFILE: process.env.LEADSHELF_RUNTIME_PROFILE ?? "client",
          ALLOWED_WEB_ORIGINS: process.env.ALLOWED_WEB_ORIGINS ?? baseURL,
          LEADSHELF_E2E_HTTP_ORIGIN: baseURL === "http://localhost:3100" ? baseURL : "",
        },
      },
})
