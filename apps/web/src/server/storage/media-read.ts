export type SafeMediaRead<T> =
  | { status: "available"; object: T }
  | { status: "missing" }
  | { status: "unavailable" }

export async function safeMediaRead<T>(
  key: string,
  loader: (key: string) => Promise<T | null>,
): Promise<SafeMediaRead<T>> {
  try {
    const object = await loader(key)
    return object === null ? { status: "missing" } : { status: "available", object }
  } catch {
    return { status: "unavailable" }
  }
}
