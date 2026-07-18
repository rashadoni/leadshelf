import { readFile } from "node:fs/promises"

const CONFIRMATION = "yes-i-understand-local-only"

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`expected integer between ${min} and ${max}`)
  }
  return parsed
}

function percentile(values: number[], share: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * share) - 1)]!
}

async function main() {
  if (process.env.RUN_DISTINCT_USER_LOAD !== CONFIRMATION) {
    throw new Error(`RUN_DISTINCT_USER_LOAD must equal ${CONFIRMATION}`)
  }
  const baseUrls = (process.env.BASE_URLS ?? process.env.BASE_URL ?? "")
    .split(",")
    .filter(Boolean)
    .map((value) => new URL(value.trim()))
  if (baseUrls.length === 0 || baseUrls.some((url) => url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
    throw new Error("distinct-user load runner requires loopback URL(s)")
  }
  const users = boundedInteger(process.env.SYNC_VUS, 200, 1, 500)
  const durationSeconds = boundedInteger(process.env.DURATION_SECONDS, 20, 5, 120)
  const tokens = (await readFile(
    process.env.MOBILE_ACCESS_TOKENS_FILE ?? "/tmp/leadshelf-distinct-user-tokens.csv",
    "utf8",
  )).split(",").map((token) => token.trim()).filter(Boolean)
  if (tokens.length < users) throw new Error(`expected ${users} tokens, got ${tokens.length}`)

  const pullDurations: number[] = []
  const initialDurations: number[] = []
  const deltaDurations: number[] = []
  const readinessDurations: number[] = []
  let pullRequests = 0
  let pullErrors = 0
  let readinessRequests = 0
  let readinessErrors = 0
  const stopAt = Date.now() + durationSeconds * 1_000

  const readiness = (async () => {
    let index = 0
    while (Date.now() < stopAt) {
      const started = performance.now()
      try {
        const response = await fetch(new URL("/api/ready", baseUrls[index++ % baseUrls.length]!))
        if (!response.ok) readinessErrors += 1
      } catch {
        readinessErrors += 1
      }
      readinessRequests += 1
      readinessDurations.push(performance.now() - started)
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  })()

  await Promise.all(tokens.slice(0, users).map(async (token, userIndex) => {
    let cursors: Record<string, string | null> = {}
    let initial = true
    let iteration = 0
    while (Date.now() < stopAt) {
      const started = performance.now()
      try {
        const baseUrl = baseUrls[(userIndex + iteration++) % baseUrls.length]!
        const response = await fetch(new URL("/api/v1/mobile/sync/pull", baseUrl), {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ protocolVersion: 1, cursors }),
        })
        const body = await response.json().catch(() => null) as { cursors?: Record<string, string | null> } | null
        if (!response.ok || !body?.cursors) pullErrors += 1
        else cursors = body.cursors
      } catch {
        pullErrors += 1
      }
      const duration = performance.now() - started
      pullRequests += 1
      pullDurations.push(duration)
      if (initial) initialDurations.push(duration)
      else deltaDurations.push(duration)
      initial = false
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  }))
  await readiness

  const metrics = (values: number[]) => ({
    p50Ms: Math.round(percentile(values, 0.5) * 100) / 100,
    p95Ms: Math.round(percentile(values, 0.95) * 100) / 100,
    p99Ms: Math.round(percentile(values, 0.99) * 100) / 100,
  })
  const result = {
    users,
    instances: baseUrls.length,
    durationSeconds,
    pull: { requests: pullRequests, errors: pullErrors, ...metrics(pullDurations) },
    initialPull: { requests: initialDurations.length, ...metrics(initialDurations) },
    deltaPull: { requests: deltaDurations.length, ...metrics(deltaDurations) },
    readiness: { requests: readinessRequests, errors: readinessErrors, ...metrics(readinessDurations) },
  }
  console.log(JSON.stringify(result))
  if (pullErrors > 0 || readinessErrors > 0 || percentile(pullDurations, 0.95) >= 3_000) {
    throw new Error("distinct-user load thresholds failed")
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
