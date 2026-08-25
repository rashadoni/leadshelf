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
