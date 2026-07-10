export interface DemoReadinessSnapshot {
  hasDemoStore: boolean
  activeProducts: number
  canonicalTasks: number
  canonicalTaskStatus: string | null
  canonicalTaskDueAt: Date | null
  canonicalProofs: number
  pendingReviews: number
  fieldAgents: number
  activeRoutes: number
  visits: number
  e2eRoutes: number
  e2eTasks: number
}

export function evaluateDemoReadiness(snapshot: DemoReadinessSnapshot, now = new Date()): boolean {
  return (
    snapshot.hasDemoStore &&
    snapshot.activeProducts >= 6 &&
    snapshot.canonicalTasks === 1 &&
    snapshot.canonicalTaskStatus === "PHOTO_SUBMITTED" &&
    snapshot.canonicalTaskDueAt !== null &&
    snapshot.canonicalTaskDueAt > now &&
    snapshot.canonicalProofs === 1 &&
    snapshot.pendingReviews >= 2 &&
    snapshot.fieldAgents >= 5 &&
    snapshot.activeRoutes >= 5 &&
    snapshot.visits > 0 &&
    snapshot.e2eRoutes === 0 &&
    snapshot.e2eTasks === 0
  )
}
