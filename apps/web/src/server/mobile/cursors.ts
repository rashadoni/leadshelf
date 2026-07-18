export type MobileCursorSet = {
  tasks?: string | null
  planogramBundles?: string | null
  routes?: string | null
  visits?: string | null
  photoSubmissions?: string | null
}

export function hasCompleteMobileCursorSet(cursors: MobileCursorSet): boolean {
  return (
    cursors.tasks !== undefined &&
    cursors.planogramBundles !== undefined &&
    cursors.routes !== undefined &&
    cursors.visits !== undefined &&
    cursors.photoSubmissions !== undefined
  )
}
