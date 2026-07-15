import { defineConfig } from "vitest/config"

// Тестируем только чистые TS-модули без expo runtime.
export default defineConfig({
  test: {
    include: [
      "src/sync/**/*.test.ts",
      "src/planogram/**/*.test.ts",
      "src/photos/**/*.test.ts",
      "src/tasks/**/*.test.ts",
      "src/orders/**/*.test.ts",
      "src/location/**/*.test.ts",
      "src/navigation/**/*.test.ts",
      "src/i18n/**/*.test.ts",
      "src/observability/**/*.test.ts",
      "src/field/**/*.test.ts",
    ],
    environment: "node",
  },
})
