export async function persistWithObjectCleanup<T>(input: {
  persist: () => Promise<T>
  cleanup: () => Promise<void>
}): Promise<T> {
  try {
    return await input.persist()
  } catch (error) {
    await input.cleanup().catch(() => undefined)
    throw error
  }
}

export async function attemptObjectWrite(write: () => Promise<void>): Promise<boolean> {
  try {
    await write()
    return true
  } catch {
    return false
  }
}
