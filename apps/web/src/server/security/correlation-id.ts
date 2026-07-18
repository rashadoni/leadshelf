const SAFE_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export function resolveCorrelationId(
  incoming: string | null | undefined,
  generate: () => string = () => crypto.randomUUID(),
): string {
  const candidate = incoming?.trim()
  return candidate && SAFE_CORRELATION_ID.test(candidate) ? candidate : generate()
}
