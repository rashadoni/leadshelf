import { writeOperationalLog } from "./observability"

export function installShutdownHandlers(workerName: string): AbortController {
  const controller = new AbortController()

  const requestShutdown = (signal: NodeJS.Signals) => {
    if (controller.signal.aborted) return
    writeOperationalLog("info", workerName, "shutdown_requested", {
      signal, draining: true,
    })
    controller.abort(signal)
  }

  process.once("SIGTERM", requestShutdown)
  process.once("SIGINT", requestShutdown)
  return controller
}

export async function waitForPoll(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return

  await new Promise<void>((resolve) => {
    const timer = setTimeout(finish, Math.max(0, delayMs))

    function finish() {
      clearTimeout(timer)
      signal.removeEventListener("abort", finish)
      resolve()
    }

    signal.addEventListener("abort", finish, { once: true })
  })
}

export async function runPollingLoop(
  tick: () => Promise<boolean>,
  pollMs: number,
  signal: AbortSignal,
  options: PollingLoopOptions = {},
): Promise<void> {
  let consecutiveFailures = 0
  while (!signal.aborted) {
    try {
      const processed = await tick()
      consecutiveFailures = 0
      if (!processed && !signal.aborted) await waitForPoll(pollMs, signal)
    } catch (error) {
      if (signal.aborted) break
      consecutiveFailures += 1
      const retryDelayMs = pollingRetryDelayMs(consecutiveFailures, {
        baseMs: options.retryBaseMs ?? Math.max(250, pollMs),
        maxMs: options.retryMaxMs ?? 60_000,
        random: options.random,
      })
      options.onTickError?.(error, { attempt: consecutiveFailures, retryDelayMs })
      await waitForPoll(retryDelayMs, signal)
    }
  }
}

export interface PollingLoopOptions {
  retryBaseMs?: number
  retryMaxMs?: number
  random?: () => number
  onTickError?: (
    error: unknown,
    context: { attempt: number; retryDelayMs: number },
  ) => void
}

export function pollingRetryDelayMs(
  attempt: number,
  options: { baseMs: number; maxMs: number; random?: () => number },
): number {
  const baseMs = Math.max(50, Math.floor(options.baseMs))
  const maxMs = Math.max(baseMs, Math.floor(options.maxMs))
  const exponent = Math.max(0, Math.min(30, Math.floor(attempt) - 1))
  const cap = Math.min(maxMs, baseMs * 2 ** exponent)
  const random = Math.min(1, Math.max(0, (options.random ?? Math.random)()))
  return Math.floor(cap / 2 + random * cap / 2)
}

export function normalizePollMs(value: string | undefined, fallbackMs: number): number {
  const parsed = Number(value ?? fallbackMs)
  if (!Number.isFinite(parsed) || parsed < 50) return fallbackMs
  return Math.floor(parsed)
}
