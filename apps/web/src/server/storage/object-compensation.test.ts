import { describe, expect, it, vi } from "vitest"
import { attemptObjectWrite, persistWithObjectCleanup } from "./object-compensation"

describe("persistWithObjectCleanup", () => {
  it("does not remove a successfully persisted object", async () => {
    const cleanup = vi.fn(async () => undefined)
    await expect(
      persistWithObjectCleanup({ persist: async () => "saved", cleanup }),
    ).resolves.toBe("saved")
    expect(cleanup).not.toHaveBeenCalled()
  })

  it("removes its object and preserves the persistence error", async () => {
    const original = new Error("database failed")
    const cleanup = vi.fn(async () => undefined)
    await expect(
      persistWithObjectCleanup({ persist: async () => { throw original }, cleanup }),
    ).rejects.toBe(original)
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it("preserves the persistence error when cleanup also fails", async () => {
    const original = new Error("database failed")
    await expect(
      persistWithObjectCleanup({
        persist: async () => { throw original },
        cleanup: async () => { throw new Error("storage failed") },
      }),
    ).rejects.toBe(original)
  })
})

describe("attemptObjectWrite", () => {
  it("reports a successful storage write", async () => {
    const write = vi.fn(async () => undefined)
    await expect(attemptObjectWrite(write)).resolves.toBe(true)
    expect(write).toHaveBeenCalledOnce()
  })

  it("converts a storage exception into an unavailable signal", async () => {
    const write = vi.fn(async () => {
      throw new Error("storage secret must not leak")
    })
    await expect(attemptObjectWrite(write)).resolves.toBe(false)
    expect(write).toHaveBeenCalledOnce()
  })
})
