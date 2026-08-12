import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  assertSqlCipherIntegrity,
  buildEncryptedAttachSql,
  bytesToHex,
  encryptedDatabaseBootstrapPlan,
  normalizeSqlCipherKey,
  quoteSqliteIdentifier,
  quoteSqliteString,
  sqliteFileUri,
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

  it("normalizes SQLite paths without duplicating the file URI scheme", () => {
    expect(sqliteFileUri("/data/user/0/com.leadshelf.mobile/databases/leadshelf.db"))
      .toBe("file:///data/user/0/com.leadshelf.mobile/databases/leadshelf.db")
    expect(sqliteFileUri("file:///data/user/0/com.leadshelf.mobile/databases/leadshelf.db"))
      .toBe("file:///data/user/0/com.leadshelf.mobile/databases/leadshelf.db")
  })

  it("accepts an empty SQLCipher integrity result and rejects reported page errors", () => {
    expect(() => assertSqlCipherIntegrity([])).not.toThrow()
    expect(() => assertSqlCipherIntegrity(["HMAC verification failed for page 4"]))
      .toThrow("SQLCipher integrity check failed")
  })
})
