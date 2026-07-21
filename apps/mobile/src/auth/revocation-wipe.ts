export interface RevocationWipeDependencies {
  deleteMedia: () => void | Promise<void>
  purgeOperationalData: () => void | Promise<void>
  clearSession: () => void | Promise<void>
}

export interface RevocationWipeResult {
  failures: Array<"media" | "database" | "session">
}

/**
 * Remote revocation is terminal: every cleanup step is attempted even if an
 * earlier storage backend fails. The caller may report `failures`, but must
 * still leave the authenticated application shell.
 */
export async function wipeRevokedSession(
  dependencies: RevocationWipeDependencies,
): Promise<RevocationWipeResult> {
  const failures: RevocationWipeResult["failures"] = []
  const steps: Array<[RevocationWipeResult["failures"][number], () => void | Promise<void>]> = [
    ["media", dependencies.deleteMedia],
    ["database", dependencies.purgeOperationalData],
    ["session", dependencies.clearSession],
  ]
  for (const [name, operation] of steps) {
    try {
      await operation()
    } catch {
      failures.push(name)
    }
  }
  return { failures }
}
