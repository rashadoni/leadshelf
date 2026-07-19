import {
  clearAuthenticationFailures,
  getAuthenticationLockout,
  recordAuthenticationFailure,
  validateAuthenticationLockoutPolicy,
  type AuthenticationLockoutPolicy,
  type AuthenticationLockoutState,
} from "@leadshelf/db"
import { createHmac } from "node:crypto"
import { workerDb } from "@/server/db/client"

const WEB_SCOPE = "web-account"
const MOBILE_SCOPE = "mobile-account"
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

function accountLockoutKey(parts: string[], pepper: string): string {
  return createHmac("sha256", pepper).update(parts.join("\0")).digest("hex")
}

export function webAccountLockoutKey(email: string, pepper: string): string {
  return accountLockoutKey(["web", email.trim().toLowerCase()], pepper)
}

export function mobileAccountLockoutKey(
  orgSlug: string,
  employeeCode: string,
  pepper: string,
): string {
  return accountLockoutKey(
    ["mobile", orgSlug.trim().toLowerCase(), employeeCode.trim().toLowerCase()],
    pepper,
  )
}

function scope(channel: "web" | "mobile"): string {
  return channel === "web" ? WEB_SCOPE : MOBILE_SCOPE
}

export function accountLockoutState(
  channel: "web" | "mobile",
  key: string,
): Promise<AuthenticationLockoutState> {
  return getAuthenticationLockout(
    (strings, ...values) => workerDb.$queryRaw(strings, ...values),
    scope(channel),
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
    scope(channel),
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
    scope(channel),
    key,
  )
}
