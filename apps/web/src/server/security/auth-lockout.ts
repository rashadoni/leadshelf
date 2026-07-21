import {
  clearAuthenticationFailures,
  authenticationLockoutScope,
  getAuthenticationLockout,
  mobileAuthenticationLockoutKey,
  recordAuthenticationFailure,
  validateAuthenticationLockoutPolicy,
  webAuthenticationLockoutKey,
  type AuthenticationLockoutPolicy,
  type AuthenticationLockoutState,
} from "@leadshelf/db"
import { workerDb } from "@/server/db/client"

const MINIMUM_PEPPER_LENGTH = 32

export type ConfiguredAuthLockoutPolicy = AuthenticationLockoutPolicy & {
  pepper: string
}

function integer(value: string | undefined, name: string): number {
  if (!value || !/^\d+$/.test(value)) throw new Error(`${name} is required and must be an integer`)
  return Number(value)
}

export function configuredAuthLockoutPolicy(
  env: Record<string, string | undefined> = process.env,
): ConfiguredAuthLockoutPolicy | null {
  const values = [
    env.AUTH_LOCKOUT_MAX_FAILURES,
    env.AUTH_LOCKOUT_WINDOW_SECONDS,
    env.AUTH_LOCKOUT_DURATION_SECONDS,
    env.AUTH_LOCKOUT_PEPPER,
  ]
  if (values.every((value) => value == null || value === "")) return null
  if (values.some((value) => value == null || value === "")) {
    throw new Error("all AUTH_LOCKOUT_* settings must be configured together")
  }
  const pepper = values[3]!
  if (pepper.trim().length < MINIMUM_PEPPER_LENGTH) {
    throw new Error(`AUTH_LOCKOUT_PEPPER must contain at least ${MINIMUM_PEPPER_LENGTH} characters`)
  }
  return {
    ...validateAuthenticationLockoutPolicy({
      maxFailures: integer(values[0], "AUTH_LOCKOUT_MAX_FAILURES"),
      windowMs: integer(values[1], "AUTH_LOCKOUT_WINDOW_SECONDS") * 1_000,
      lockoutMs: integer(values[2], "AUTH_LOCKOUT_DURATION_SECONDS") * 1_000,
    }),
    pepper,
  }
}

export function webAccountLockoutKey(
  organizationSlug: string,
  email: string,
  pepper: string,
): string {
  return webAuthenticationLockoutKey(organizationSlug, email, pepper)
}

export function mobileAccountLockoutKey(
  orgSlug: string,
  employeeCode: string,
  pepper: string,
): string {
  return mobileAuthenticationLockoutKey(orgSlug, employeeCode, pepper)
}

export function accountLockoutState(
  channel: "web" | "mobile",
  key: string,
): Promise<AuthenticationLockoutState> {
  return getAuthenticationLockout(
    (strings, ...values) => workerDb.$queryRaw(strings, ...values),
    authenticationLockoutScope(channel),
    key,
  )
}

export function recordAccountAuthenticationFailure(
  channel: "web" | "mobile",
  key: string,
  policy: AuthenticationLockoutPolicy,
): Promise<AuthenticationLockoutState> {
  return recordAuthenticationFailure(
    (strings, ...values) => workerDb.$queryRaw(strings, ...values),
    authenticationLockoutScope(channel),
    key,
    policy,
  )
}

export function clearAccountAuthenticationFailures(
  channel: "web" | "mobile",
  key: string,
): Promise<void> {
  return clearAuthenticationFailures(
    (strings, ...values) => workerDb.$executeRaw(strings, ...values),
    authenticationLockoutScope(channel),
    key,
  )
}
