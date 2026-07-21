import { randomUUID } from "node:crypto"
import { afterAll, describe, expect, it } from "vitest"
import {
  clearAuthenticationFailures,
  getAuthenticationLockout,
  recordAuthenticationFailure,
} from "../auth-lockout"
import { createSystemClient } from "../tenant-client"

const db = createSystemClient("authentication-lockout-integration-test")
const scopes: string[] = []
const query = (strings: TemplateStringsArray, ...values: unknown[]) =>
  db.$queryRaw<{ failureCount: number; lockedUntil: Date | null }[]>(strings, ...values)
const execute = (strings: TemplateStringsArray, ...values: unknown[]) =>
  db.$executeRaw(strings, ...values)

afterAll(async () => {
  for (const scope of scopes) {
    await db.authenticationLockout.deleteMany({ where: { scope } })
  }
  await db.$disconnect()
})

describe("durable authentication lockout", () => {
  it("locks at the approved threshold, does not extend under attack, resets and clears", async () => {
    const scope = `auth-${randomUUID()}`.slice(0, 63)
    const key = randomUUID()
    scopes.push(scope)
    const policy = { maxFailures: 3, windowMs: 60 * 60_000, lockoutMs: 20 * 60_000 }
    const startedAt = new Date("2026-07-19T02:00:00.000Z")

    await expect(getAuthenticationLockout(query, scope, key, startedAt)).resolves.toMatchObject({
      locked: false,
      failureCount: 0,
    })
    await expect(recordAuthenticationFailure(query, scope, key, policy, startedAt)).resolves.toMatchObject({
      locked: false,
      failureCount: 1,
    })
    await recordAuthenticationFailure(query, scope, key, policy, new Date(startedAt.getTime() + 1_000))
    const locked = await recordAuthenticationFailure(query, scope, key, policy, new Date(startedAt.getTime() + 2_000))
    expect(locked).toMatchObject({ locked: true, failureCount: 3, retryAfterSeconds: 1_200 })

    const attacked = await recordAuthenticationFailure(query, scope, key, policy, new Date(startedAt.getTime() + 3_000))
    expect(attacked.failureCount).toBe(3)
    expect(attacked.lockedUntil).toEqual(locked.lockedUntil)

    const afterLock = new Date(locked.lockedUntil!.getTime() + 1)
    await expect(recordAuthenticationFailure(query, scope, key, policy, afterLock)).resolves.toMatchObject({
      locked: false,
      failureCount: 1,
    })
    await clearAuthenticationFailures(execute, scope, key)
    await expect(getAuthenticationLockout(query, scope, key, afterLock)).resolves.toMatchObject({
      locked: false,
      failureCount: 0,
    })
  })

  it("atomically caps concurrent failures at the lock threshold", async () => {
    const scope = `auth-${randomUUID()}`.slice(0, 63)
    const key = randomUUID()
    scopes.push(scope)
    const policy = { maxFailures: 5, windowMs: 10 * 60_000, lockoutMs: 30 * 60_000 }
    const now = new Date("2026-07-19T03:00:00.000Z")

    const results = await Promise.all(
      Array.from({ length: 12 }, () => recordAuthenticationFailure(query, scope, key, policy, now)),
    )
    expect(results.some((result) => result.locked)).toBe(true)
    await expect(getAuthenticationLockout(query, scope, key, now)).resolves.toMatchObject({
      locked: true,
      failureCount: 5,
      retryAfterSeconds: 1_800,
    })
  })
})
