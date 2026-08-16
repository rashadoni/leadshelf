import { describe, expect, it, vi } from "vitest"
import { FIELD_PRESENCE_INTERVAL_MS, startFieldPresenceHeartbeat } from "./presence-heartbeat"

describe("field presence heartbeat", () => {
  it("beats immediately, every minute, and again when the app returns to foreground", async () => {
    let state: "active" | "background" = "active"
    const callbacks: {
      listener?: (next: "active" | "background") => void
      interval?: () => void
    } = {}
    const heartbeat = vi.fn(async () => {})
    const clearInterval = vi.fn()
    const unsubscribe = vi.fn()

    const stop = startFieldPresenceHeartbeat({
      heartbeat,
      currentState: () => state,
      subscribe: (next) => { callbacks.listener = next; return unsubscribe },
      setInterval: (next, delay) => {
        expect(delay).toBe(FIELD_PRESENCE_INTERVAL_MS)
        callbacks.interval = next
        return 7 as unknown as ReturnType<typeof setInterval>
      },
      clearInterval,
    })

    expect(heartbeat).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    callbacks.interval?.()
    expect(heartbeat).toHaveBeenCalledTimes(2)
    await Promise.resolve()

    state = "background"
    callbacks.listener?.("background")
    callbacks.interval?.()
    expect(heartbeat).toHaveBeenCalledTimes(2)

    state = "active"
    callbacks.listener?.("active")
    expect(heartbeat).toHaveBeenCalledTimes(3)

    stop()
    expect(clearInterval).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it("does not overlap slow heartbeat requests", async () => {
    const callbacks: { resolve?: () => void; interval?: () => void } = {}
    const heartbeat = vi.fn(() => new Promise<void>((done) => { callbacks.resolve = done }))

    const stop = startFieldPresenceHeartbeat({
      heartbeat,
      currentState: () => "active",
      subscribe: () => () => {},
      setInterval: (next) => {
        callbacks.interval = next
        return 8 as unknown as ReturnType<typeof setInterval>
      },
      clearInterval: () => {},
    })

    callbacks.interval?.()
    expect(heartbeat).toHaveBeenCalledTimes(1)
    callbacks.resolve?.()
    await Promise.resolve()
    await Promise.resolve()
    callbacks.interval?.()
    expect(heartbeat).toHaveBeenCalledTimes(2)
    stop()
  })
})
