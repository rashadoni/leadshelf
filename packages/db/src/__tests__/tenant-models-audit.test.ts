import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { TENANT_MODELS } from "../tenant-client.ts"

describe("tenant models audit", () => {
  test("TENANT_MODELS matches every schema model with organizationId", () => {
    const schemaPath = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url))
    const schema = readFileSync(schemaPath, "utf8")
    const fromSchema = new Set<string>()
    for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
      const [, name, body] = match
      if (/^\s*organizationId\s+String/m.test(body!) && name !== "Organization") {
        fromSchema.add(name!)
      }
    }
    expect([...TENANT_MODELS].sort()).toEqual([...fromSchema].sort())
  })
})
