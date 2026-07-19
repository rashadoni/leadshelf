type DemoSeedReadyInput = {
  organizationId: string
  organizationSlug: string
  userCount: number
  mobileUserCount: number
  removedE2eRoutes: number
  removedE2eTasks: number
}

function safeIdentifier(value: string): string | undefined {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined
}

export function buildDemoSeedReadyLog(input: DemoSeedReadyInput): string {
  return JSON.stringify({
    level: "info",
    event: "demo_seed_ready",
    organizationId: safeIdentifier(input.organizationId),
    organizationSlug: safeIdentifier(input.organizationSlug),
    userCount: input.userCount,
    mobileUserCount: input.mobileUserCount,
    removedE2eRoutes: input.removedE2eRoutes,
    removedE2eTasks: input.removedE2eTasks,
  })
}

export function buildDemoSeedFailureLog(error: unknown): string {
  const candidate = error && typeof error === "object" ? error as Record<string, unknown> : {}
  const errorName = typeof candidate.name === "string" ? safeIdentifier(candidate.name) : undefined
  const errorCode = typeof candidate.code === "string" ? safeIdentifier(candidate.code) : undefined
  return JSON.stringify({
    level: "error",
    event: "demo_seed_failed",
    ...(errorName ? { errorName } : {}),
    ...(errorCode ? { errorCode } : {}),
  })
}
