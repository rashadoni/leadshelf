export function isRouteDraftDirty(input: {
  initialDate: string | null
  selectedDate: string | null
  name: string
  notes: string
  targetCount: number
}): boolean {
  return input.targetCount > 0 ||
    input.name.trim().length > 0 ||
    input.notes.trim().length > 0 ||
    input.selectedDate !== input.initialDate
}

export interface ExistingRouteDraftSnapshot {
  name: string
  notes: string
  points: Array<{ id: string; time: string }>
}

type ExistingRouteDraftInput = {
  name: string
  notes: string
  points: readonly { id: string }[]
  timeInputs: Readonly<Record<string, string>>
}

/**
 * Route editing stays local until Save.  Compare the visible edit model rather
 * than the server route so Back can warn about a reorder, stop or time change
 * as well as typed text.
 */
export function snapshotExistingRouteDraft(input: ExistingRouteDraftInput): ExistingRouteDraftSnapshot {
  return {
    name: input.name.trim(),
    notes: input.notes.trim(),
    points: input.points.map((point) => ({
      id: point.id,
      time: (input.timeInputs[point.id] ?? "").trim(),
    })),
  }
}

export function isExistingRouteDraftDirty(
  initial: ExistingRouteDraftSnapshot | null,
  current: ExistingRouteDraftInput,
): boolean {
  if (!initial) return false
  const snapshot = snapshotExistingRouteDraft(current)
  if (initial.name !== snapshot.name || initial.notes !== snapshot.notes || initial.points.length !== snapshot.points.length) return true
  return initial.points.some((point, index) => {
    const currentPoint = snapshot.points[index]
    return point.id !== currentPoint?.id || point.time !== currentPoint.time
  })
}
