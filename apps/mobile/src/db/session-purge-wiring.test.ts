import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

const source = readFileSync(new URL("./local-store.ts", import.meta.url), "utf8")

describe("session purge wiring", () => {
  test("removes Field cache together with operational data", () => {
    const start = source.indexOf("export function purgeLocalOperationalData")
    const end = source.indexOf("export function getLocalDatabaseCapacity", start)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(source.slice(start, end)).toContain("DELETE FROM field_cache;")
  })
})
