import { defineConfig } from "vitest/config"

// Тестируем только чистый sync-движок — он без expo-импортов по построению.
export default defineConfig({
  test: {
    include: ["src/sync/**/*.test.ts"],
    environment: "node",
  },
})
