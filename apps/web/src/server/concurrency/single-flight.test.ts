import { describe, expect, it, vi } from "vitest"
import { SingleFlight } from "./single-flight"

describe("SingleFlight", () => {
  it("coalesces concurrent work for the same key", async () => {
    let release!: (value: string) => void
    const pending = new Promise<string>((resolve) => {
      release = resolve
    })
    const operation = vi.fn(() => pending)
    const singleFlight = new SingleFlight<string, string>()

    const first = singleFlight.run("tenant:user:cursor", operation)
    const second = singleFlight.run("tenant:user:cursor", operation)
    release("bundle")

    await expect(Promise.all([first, second])).resolves.toEqual(["bundle", "bundle"])
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it("clears rejected work so a retry can execute", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce("recovered")
    const singleFlight = new SingleFlight<string, string>()

    await expect(singleFlight.run("key", operation)).rejects.toThrow("database unavailable")
    await expect(singleFlight.run("key", operation)).resolves.toBe("recovered")
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it("does not retain additional keys after the bound is reached", async () => {
    let release!: () => void
    const pending = new Promise<string>((resolve) => {
      release = () => resolve("first")
    })
    const overflow = vi.fn(async () => "overflow")
    const singleFlight = new SingleFlight<string, string>(1)

    const first = singleFlight.run("first", () => pending)
    await expect(singleFlight.run("second", overflow)).resolves.toBe("overflow")
    await expect(singleFlight.run("second", overflow)).resolves.toBe("overflow")
    expect(overflow).toHaveBeenCalledTimes(2)
    release()
    await expect(first).resolves.toBe("first")
  })
})
