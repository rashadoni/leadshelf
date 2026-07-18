import { describe, expect, it } from "vitest"
import { TrySemaphore } from "./try-semaphore"

describe("TrySemaphore", () => {
  it("rejects excess work and accepts it after release", () => {
    const semaphore = new TrySemaphore(2)
    const first = semaphore.tryAcquire()
    const second = semaphore.tryAcquire()
    expect(first).toBeTypeOf("function")
    expect(second).toBeTypeOf("function")
    expect(semaphore.activeCount).toBe(2)
    expect(semaphore.tryAcquire()).toBeNull()

    first!()
    expect(semaphore.activeCount).toBe(1)
    expect(semaphore.tryAcquire()).toBeTypeOf("function")
  })

  it("makes release idempotent and rejects invalid capacity", () => {
    const semaphore = new TrySemaphore(1)
    const release = semaphore.tryAcquire()!
    release()
    release()
    expect(semaphore.activeCount).toBe(0)
    expect(() => new TrySemaphore(0)).toThrow("positive integer")
  })
})
