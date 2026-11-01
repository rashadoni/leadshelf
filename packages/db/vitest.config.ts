import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // Генерат Prisma теперь воркспейс-пакет, а линкованные пакеты Vite по
    // умолчанию не считает внешними и пытается трансформировать сам — на
    // нативном libquery_engine это разваливается. Externalize возвращает ему
    // то обращение, которое было у @prisma/client из node_modules.
    server: { deps: { external: ["@leadshelf/prisma-client"] } },
    // Интеграционные тесты ходят в реальный Postgres — таймауты с запасом.
    testTimeout: 30000,
    hookTimeout: 30000,
    // БД одна — файлы последовательно, чтобы не гонять cleanup друг по другу.
    fileParallelism: false,
  },
})
