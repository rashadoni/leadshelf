import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  MEDIA_MAGIC,
  hasEncryptedMediaHeader,
  mediaEncryptionBootstrapPlan,
  normalizeMediaKey,
  openEncryptedMediaPayload,
  safeTemporaryExtension,
  sealEncryptedMediaPayload,
} from "./media-encryption"

describe("encrypted offline media protocol", () => {
  it("fails closed when a marker survives but its device-only key does not", () => {
    expect(mediaEncryptionBootstrapPlan({ keyExists: false, marker: "ready:v1" })).toBe("missing-key")
    expect(mediaEncryptionBootstrapPlan({ keyExists: false, marker: "migrating:v1" })).toBe("missing-key")
    expect(mediaEncryptionBootstrapPlan({ keyExists: false, marker: null })).toBe("create")
    expect(mediaEncryptionBootstrapPlan({ keyExists: true, marker: null })).toBe("resume-migration")
    expect(mediaEncryptionBootstrapPlan({ keyExists: true, marker: "ready:v1" })).toBe("open")
  })

  it("round-trips only versioned sealed payloads and rejects plaintext/truncation", () => {
    const combined = new Uint8Array(32).map((_, index) => index)
    const sealed = sealEncryptedMediaPayload(combined)
    expect([...sealed.slice(0, MEDIA_MAGIC.length)]).toEqual([...MEDIA_MAGIC])
    expect(hasEncryptedMediaHeader(sealed)).toBe(true)
    expect(openEncryptedMediaPayload(sealed)).toEqual(combined)
    expect(() => openEncryptedMediaPayload(new Uint8Array([0xff, 0xd8, 0xff]))).toThrow("marker")
    expect(() => openEncryptedMediaPayload(sealEncryptedMediaPayload(new Uint8Array(27)))).toThrow("truncated")
  })

  it("accepts exactly a 256-bit hex key without returning raw key material in errors", () => {
    expect(normalizeMediaKey(" A".padEnd(65, "0"))).toMatch(/^[a-f\d]{64}$/)
    expect(() => normalizeMediaKey("private-key-value")).toThrow("invalid AES-256 key material")
    try {
      normalizeMediaKey("private-key-value")
    } catch (error) {
      expect(String(error)).not.toContain("private-key-value")
    }
  })

  it("limits temporary suffixes to non-path executable extensions", () => {
    expect(safeTemporaryExtension("file:///proof.JPG")).toBe("jpg")
    expect(safeTemporaryExtension("file:///proof.tar.gz")).toBe("gz")
    expect(safeTemporaryExtension("file:///proof.bad/../../sh")).toBe("bin")
    expect(safeTemporaryExtension("file:///proof.extensiontoolong")).toBe("bin")
  })

  it("disables Android app-data backup and keeps SecureStore backup exclusion explicit", () => {
    const appConfig = JSON.parse(readFileSync(resolve(process.cwd(), "app.json"), "utf8")) as {
      expo: {
        android: { allowBackup?: boolean }
        plugins: Array<string | [string, Record<string, unknown>]>
      }
    }
    expect(appConfig.expo.android.allowBackup).toBe(false)
    expect(appConfig.expo.plugins).toContainEqual([
      "expo-secure-store",
      { configureAndroidBackup: true },
    ])
  })
})
