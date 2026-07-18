export interface ImportQueueRetryPolicy {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  staleAfterMs: number
}

const DEFAULT_POLICY: ImportQueueRetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 5_000,
  maxDelayMs: 5 * 60_000,
  staleAfterMs: 30 * 60_000,
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

export function importQueueRetryPolicy(env: NodeJS.ProcessEnv = process.env): ImportQueueRetryPolicy {
  return {
    maxAttempts: boundedInteger(env.LEADSHELF_IMPORT_QUEUE_MAX_ATTEMPTS, DEFAULT_POLICY.maxAttempts, 1, 20),
    baseDelayMs: boundedInteger(env.LEADSHELF_IMPORT_QUEUE_RETRY_BASE_MS, DEFAULT_POLICY.baseDelayMs, 100, 60 * 60_000),
    maxDelayMs: boundedInteger(env.LEADSHELF_IMPORT_QUEUE_RETRY_MAX_MS, DEFAULT_POLICY.maxDelayMs, 100, 24 * 60 * 60_000),
    staleAfterMs: boundedInteger(env.LEADSHELF_IMPORT_QUEUE_STALE_MS, DEFAULT_POLICY.staleAfterMs, 60_000, 24 * 60 * 60_000),
  }
}

export function retryDelayMs(attempts: number, policy: ImportQueueRetryPolicy): number {
  const exponent = Math.max(0, attempts - 1)
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** exponent)
}
