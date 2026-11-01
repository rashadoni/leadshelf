import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Генерат Prisma теперь воркспейс-пакет, а линкованные пакеты Vite по
    // умолчанию не считает внешними и пытается трансформировать сам — на
    // нативном libquery_engine это разваливается. Externalize возвращает ему
    // то обращение, которое было у @prisma/client из node_modules.
    server: { deps: { external: ["@leadshelf/prisma-client"] } },
    include: ["src/**/*.test.ts"],
  },
})
