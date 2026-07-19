export type ReadinessCheck = {
  status: "up" | "down"
  latencyMs: number
  error?: string
}

export type ReadinessResult = {
  status: "ready" | "not_ready"
  checkedAt: string
  checks: {
    configuration: ReadinessCheck
    database: ReadinessCheck
    objectStorage: ReadinessCheck
  }
}

type ReadinessDependencies = {
  configuration: () => Promise<void>
  database: () => Promise<void>
  objectStorage: () => Promise<void>
  now?: () => Date
  timeoutMs?: number
}

function safeError(error: unknown) {
  if (error instanceof Error && error.name === "TimeoutError") return "timeout"
  return "unavailable"
}

async function withTimeout(operation: Promise<void>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("readiness dependency timed out")
      error.name = "TimeoutError"
      reject(error)
    }, timeoutMs)
  })

  try {
    await Promise.race([operation, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function runCheck(operation: () => Promise<void>, timeoutMs: number): Promise<ReadinessCheck> {
  const startedAt = Date.now()
  try {
    await withTimeout(Promise.resolve().then(operation), timeoutMs)
    return { status: "up", latencyMs: Date.now() - startedAt }
  } catch (error) {
    return {
      status: "down",
      latencyMs: Date.now() - startedAt,
      error: safeError(error),
    }
  }
}

export async function checkReadiness({
  configuration,
  database,
  objectStorage,
  now = () => new Date(),
  timeoutMs = 2_000,
}: ReadinessDependencies): Promise<ReadinessResult> {
  const [configurationCheck, databaseCheck, objectStorageCheck] = await Promise.all([
    runCheck(configuration, timeoutMs),
    runCheck(database, timeoutMs),
    runCheck(objectStorage, timeoutMs),
  ])
  const ready = configurationCheck.status === "up"
    && databaseCheck.status === "up"
    && objectStorageCheck.status === "up"

  return {
    status: ready ? "ready" : "not_ready",
    checkedAt: now().toISOString(),
    checks: { configuration: configurationCheck, database: databaseCheck, objectStorage: objectStorageCheck },
  }
}
