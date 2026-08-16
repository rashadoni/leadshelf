import type { AppStateStatus } from "react-native"

export const FIELD_PRESENCE_INTERVAL_MS = 60_000

type PresenceHeartbeatRuntime = {
  heartbeat: () => Promise<void>
  currentState: () => AppStateStatus
  subscribe: (listener: (state: AppStateStatus) => void) => () => void
  setInterval?: (listener: () => void, intervalMs: number) => ReturnType<typeof setInterval>
  clearInterval?: (timer: ReturnType<typeof setInterval>) => void
}

/**
 * Keep app-presence separate from GPS tracking. The heartbeat only says that
 * the authenticated field app is open; coordinates continue to be collected
 * exclusively by the workday/visit privacy boundary.
 */
export function startFieldPresenceHeartbeat(runtime: PresenceHeartbeatRuntime): () => void {
  const schedule = runtime.setInterval ?? setInterval
  const cancel = runtime.clearInterval ?? clearInterval
  let active = runtime.currentState() === "active"
  let stopped = false
  let inFlight = false

  const heartbeat = () => {
    if (stopped || !active || inFlight) return
    inFlight = true
    void runtime.heartbeat()
      .catch(() => {
        // Sync/auth providers own recovery. Presence must not crash the app or
        // create a second retry loop while the device is offline.
      })
      .finally(() => { inFlight = false })
  }

  heartbeat()
  const timer = schedule(heartbeat, FIELD_PRESENCE_INTERVAL_MS)
  const unsubscribe = runtime.subscribe((state) => {
    active = state === "active"
    if (active) heartbeat()
  })

  return () => {
    stopped = true
    cancel(timer)
    unsubscribe()
  }
}
