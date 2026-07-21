export type LogoutDataSummary = {
  unsyncedOperations: number
  unsyncedPhotos: number
}

export function requiresLogoutConfirmation(summary: LogoutDataSummary): boolean {
  return summary.unsyncedOperations > 0 || summary.unsyncedPhotos > 0
}
