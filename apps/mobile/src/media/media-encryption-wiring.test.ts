import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8")
}

describe("offline media encryption wiring", () => {
  it("encrypts every durable media class and never uploads persistent ciphertext directly", () => {
    for (const file of [
      "../photos/photo-store.ts",
      "../commercial/media-store.ts",
      "../field/visit-photo-store.ts",
      "../field/document-files.ts",
    ]) {
      const text = source(file)
      expect(text).toContain("persistEncryptedMedia")
      expect(text).toContain("deletePlaintextSource: true")
      expect(text).not.toContain("FileSystem.copyAsync")
    }

    const client = source("../api/mobile-client.ts")
    expect(client.match(/withDecryptedMedia\(/g)).toHaveLength(4)
    expect(client).toContain("withTemporaryPlaintextMedia")
    expect(client).toContain("persistEncryptedMedia(result.uri, destination, { deletePlaintextSource: true })")
    expect(client).not.toMatch(/new File\((?:input|photo|media)\.fileUri\)/)
    expect(client).toContain("FileSystem.uploadAsync")
    expect(client).toContain("FileSystem.FileSystemUploadType.MULTIPART")
    expect(client).toContain('fieldName: "file"')
  })

  it("uses decrypted previews and full media/key wipe for logout and revocation", () => {
    const previewSources = [
      "../components/ShelfComparisonCard.tsx",
      "../../app/(app)/commercial/media-queue.tsx",
      "../../app/(app)/sync-center.tsx",
      "../../app/(app)/tasks/[taskId].tsx",
    ].map(source)
    expect(previewSources.every((text) => text.includes("EncryptedMediaImage"))).toBe(true)
    expect(source("../sync/sync-context.tsx")).toContain("deleteAllEncryptedMedia()")
    expect(source("../../app/(app)/(tabs)/profile.tsx")).toContain("deleteAllEncryptedMedia()")
  })
})
