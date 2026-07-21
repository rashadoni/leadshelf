import { describe, expect, it, vi } from "vitest"
import {
  normalizePollMs,
  pollingRetryDelayMs,
  runPollingLoop,
  waitForPoll,
} from "./runner-lifecycle"

describe("runner lifecycle", () => {
  it("does not start work when shutdown was already requested", async () => {
    const controller = new AbortController()
    controller.abort("test")
    const tick = vi.fn(async () => false)

    await runPollingLoop(tick, 1_000, controller.signal)

    expect(tick).not.toHaveBeenCalled()
  })

  it("interrupts an idle poll immediately", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const waiting = waitForPoll(60_000, controller.signal)

    controller.abort("test")
    await waiting

    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it("rejects invalid or dangerously tight poll intervals", () => {
    expect(normalizePollMs(undefined, 5_000)).toBe(5_000)
    expect(normalizePollMs("NaN", 5_000)).toBe(5_000)
    expect(normalizePollMs("20", 5_000)).toBe(5_000)
    expect(normalizePollMs("250.9", 5_000)).toBe(250)
  })

  it("continues polling after a transient tick failure", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const onTickError = vi.fn()
    const tick = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockImplementationOnce(async () => {
        controller.abort("recovered")
        return false
      })

    const loop = runPollingLoop(tick, 1_000, controller.signal, {
      retryBaseMs: 100,
      retryMaxMs: 1_000,
      random: () => 0,
      onTickError,
    })
    await vi.advanceTimersByTimeAsync(50)
    await loop

    expect(tick).toHaveBeenCalledTimes(2)
    expect(onTickError).toHaveBeenCalledWith(expect.any(Error), {
      attempt: 1,
      retryDelayMs: 50,
    })
    vi.useRealTimers()
  })

  it("interrupts retry backoff without starting another tick", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const onTickError = vi.fn()
    const tick = vi.fn(async () => {
      throw new Error("database unavailable")
    })

    const loop = runPollingLoop(tick, 1_000, controller.signal, {
      retryBaseMs: 1_000,
      retryMaxMs: 1_000,
      random: () => 1,
      onTickError,
    })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort("shutdown")
    await loop

    expect(tick).toHaveBeenCalledTimes(1)
    expect(onTickError).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it("caps exponential retry and applies bounded jitter", () => {
    expect(pollingRetryDelayMs(1, { baseMs: 1_000, maxMs: 8_000, random: () => 0 })).toBe(500)
    expect(pollingRetryDelayMs(4, { baseMs: 1_000, maxMs: 8_000, random: () => 1 })).toBe(8_000)
    expect(pollingRetryDelayMs(20, { baseMs: 1_000, maxMs: 8_000, random: () => 0 })).toBe(4_000)
  })
})
