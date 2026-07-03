import { defineConfig } from "vitest/config"

// Тестируем только чистые TS-модули без expo runtime.
export default defineConfig({
  test: {
    include: ["src/sync/**/*.test.ts", "src/planogram/**/*.test.ts"],
    environment: "node",
  },
})
