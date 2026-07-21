import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  buildEncryptedAttachSql,
  bytesToHex,
  encryptedDatabaseBootstrapPlan,
  normalizeSqlCipherKey,
  quoteSqliteIdentifier,
  quoteSqliteString,
  sqlCipherKeyLiteral,
} from "./sqlite-encryption"

describe("mobile SQLCipher bootstrap safeguards", () => {
  it("fails closed when an encrypted database exists without its device key", () => {
    expect(encryptedDatabaseBootstrapPlan({
      encryptedDatabaseExists: true,
      legacyDatabaseExists: true,
      keyExists: false,
    })).toBe("missing-key")
    expect(encryptedDatabaseBootstrapPlan({
      encryptedDatabaseExists: false,
      legacyDatabaseExists: true,
      keyExists: false,
    })).toBe("migrate-legacy")
    expect(encryptedDatabaseBootstrapPlan({
      encryptedDatabaseExists: false,
      legacyDatabaseExists: false,
      keyExists: false,
    })).toBe("create-encrypted")
  })

  it("accepts only an exact 256-bit hex key and builds injection-safe SQL", () => {
    const key = bytesToHex(Uint8Array.from({ length: 32 }, (_, index) => index))
    expect(key).toHaveLength(64)
    expect(normalizeSqlCipherKey(key.toUpperCase())).toBe(key)
    expect(sqlCipherKeyLiteral(key)).toBe(`"x'${key}'"`)
    expect(() => normalizeSqlCipherKey("short")).toThrow("invalid SQLCipher key")
    expect(quoteSqliteString("/safe/it's.db")).toBe("'/safe/it''s.db'")
    expect(buildEncryptedAttachSql("/safe/it's.db", key)).toContain("'/safe/it''s.db'")
    expect(quoteSqliteIdentifier("photo_queue")).toBe('"photo_queue"')
    expect(() => quoteSqliteIdentifier("photo_queue; DROP TABLE tasks")).toThrow("unsafe")
  })

  it("requires SQLCipher in the native Expo config", () => {
    const appConfig = JSON.parse(readFileSync(resolve(process.cwd(), "app.json"), "utf8")) as {
      expo: { plugins: Array<string | [string, Record<string, unknown>]> }
    }
    expect(appConfig.expo.plugins).toContainEqual(["expo-sqlite", { useSQLCipher: true }])
  })
})
