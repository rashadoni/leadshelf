import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    hookTimeout: 30000,
    testTimeout: 30000,
    // интеграционные тесты пишут в одну БД — без параллелизма
    fileParallelism: false,
  },
})
