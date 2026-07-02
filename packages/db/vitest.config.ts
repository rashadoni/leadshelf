import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // Интеграционные тесты ходят в реальный Postgres — таймауты с запасом.
    testTimeout: 30000,
    hookTimeout: 30000,
    // БД одна — файлы последовательно, чтобы не гонять cleanup друг по другу.
    fileParallelism: false,
  },
})
