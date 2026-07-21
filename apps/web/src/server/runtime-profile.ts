export type RuntimeProfile = "client" | "demo"

export function resolveRuntimeProfile(
  value: string | undefined,
  nodeEnv: string | undefined,
): RuntimeProfile {
  if (value === "client" || value === "demo") return value
  if (nodeEnv === "production") throw new Error("runtime profile is not configured")
  return "client"
}

export function runtimeProfile(): RuntimeProfile {
  return resolveRuntimeProfile(
    process.env.LEADSHELF_RUNTIME_PROFILE,
    process.env.NODE_ENV,
  )
}

export function demoMediaFallbackAllowed(
  profile: RuntimeProfile,
  key: string,
  organizationId: string,
): boolean {
  if (profile !== "demo") return false
  return (
    key.startsWith(`products/${organizationId}/`) && key.endsWith("/demo-pack.svg")
  ) || (
    key.startsWith(`photos/${organizationId}/`) && key.endsWith("/demo-proof-001.svg")
  )
}
