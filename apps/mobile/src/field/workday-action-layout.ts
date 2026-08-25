import type { FieldWorkdayAction } from "./contracts"

export function splitWorkdayActions(actions: readonly FieldWorkdayAction[]): {
  primary: FieldWorkdayAction | null
  secondary: FieldWorkdayAction[]
} {
  const primary = (["START", "PAUSE", "RESUME", "FINISH"] as const)
    .find((action) => actions.includes(action)) ?? actions[0] ?? null
  return {
    primary,
    secondary: primary ? actions.filter((action) => action !== primary) : [],
  }
}
