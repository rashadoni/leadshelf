import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// ru/az должны иметь идентичную структуру ключей (docs/26 §13): пропущенный
// перевод — тихий баг в проде. Сравниваем рекурсивно по путям ключей.
function keyPaths(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix]
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key))
    .sort()
}

function loadMessages(locale: string): unknown {
  const path = fileURLToPath(new URL(`./${locale}.json`, import.meta.url))
  return JSON.parse(readFileSync(path, "utf-8"))
}

describe("web i18n key parity", () => {
  it("ru and az share the exact same key structure", () => {
    const ru = keyPaths(loadMessages("ru"))
    const az = keyPaths(loadMessages("az"))
    const missingInAz = ru.filter((k) => !az.includes(k))
    const missingInRu = az.filter((k) => !ru.includes(k))
    expect(missingInAz, `keys missing in az: ${missingInAz.join(", ")}`).toEqual([])
    expect(missingInRu, `keys missing in ru: ${missingInRu.join(", ")}`).toEqual([])
  })
})
