import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { afterAll, describe, expect, it } from "vitest"
import {
  authenticationLockoutScope,
  getAuthenticationLockout,
  mobileAuthenticationLockoutKey,
  recordAuthenticationFailure,
  webAuthenticationLockoutKey,
} from "../auth-lockout"
import {
  executeManualAuthenticationUnlock,
  previewManualAuthenticationUnlock,
} from "../manual-auth-unlock"
import { readManualAuthUnlockRequestFile } from "../manual-auth-unlock-file"
import { createSystemClient } from "../tenant-client"

const db = createSystemClient("manual-authentication-unlock-integration-test")
const organizationIds: string[] = []
const lockoutKeys: Array<{ channel: "web" | "mobile"; key: string }> = []
const pepper = "manual-unlock-test-pepper-not-a-secret"
const email = "same-operator@example.test"
const query = (strings: TemplateStringsArray, ...values: unknown[]) =>
  db.$queryRaw<{ failureCount: number; lockedUntil: Date | null }[]>(strings, ...values)

async function lockedTenant(label: string, now: Date) {
  const suffix = randomUUID().slice(0, 8)
  const slug = `unlock-${label}-${suffix}`
  const organization = await db.organization.create({
    data: {
      name: `Unlock ${label}`,
      slug,
      users: { create: { name: "Support target", email } },
    },
    select: { id: true, slug: true },
  })
  organizationIds.push(organization.id)
  const key = webAuthenticationLockoutKey(slug, email, pepper)
  lockoutKeys.push({ channel: "web", key })
  const policy = { maxFailures: 2, windowMs: 60_000, lockoutMs: 60 * 60_000 }
  await recordAuthenticationFailure(query, authenticationLockoutScope("web"), key, policy, now)
  await recordAuthenticationFailure(query, authenticationLockoutScope("web"), key, policy, now)
  return { ...organization, key }
}

afterAll(async () => {
  for (const record of lockoutKeys) {
    const { opaqueRateLimitKey } = await import("../rate-limit")
    await db.authenticationLockout.deleteMany({
      where: {
        scope: authenticationLockoutScope(record.channel),
        keyHash: opaqueRateLimitKey([record.key]),
      },
    })
  }
  await db.organization.deleteMany({ where: { id: { in: organizationIds } } })
  await db.$disconnect()
})

describe("controlled manual authentication unlock", () => {
  it("unlocks only the exact tenant principal with drift guard, dual approval and minimal audit", async () => {
    const now = new Date("2026-07-19T04:00:00.000Z")
    const first = await lockedTenant("first", now)
    const neighbor = await lockedTenant("neighbor", now)
    expect(first.key).not.toBe(neighbor.key)
    const base = {
      organizationId: first.id,
      slug: first.slug,
      channel: "web" as const,
      principal: email,
      pepper,
      now: new Date(now.getTime() + 1_000),
    }
    const preview = await previewManualAuthenticationUnlock(db, base)
    expect(preview.state).toMatchObject({ exists: true, locked: true, failureCount: 2 })
    expect(JSON.stringify(preview)).not.toContain(email)
    expect(JSON.stringify(preview)).not.toContain(pepper)

    const execution = {
      ...base,
      enabled: true,
      stateDigest: preview.stateDigest,
      confirmation: preview.confirmation,
      approvals: ["support-owner:ticket-1", "security-owner:ticket-2"],
      ticketId: "SUP-12345",
      reasonCode: "verified_account_recovery",
    }
    await expect(executeManualAuthenticationUnlock(db, { ...execution, enabled: false }))
      .rejects.toThrow("disabled")
    await expect(executeManualAuthenticationUnlock(db, {
      ...execution,
      approvals: ["same-approval", "same-approval"],
    })).rejects.toThrow("two distinct")

    await recordAuthenticationFailure(
      query,
      authenticationLockoutScope("web"),
      first.key,
      { maxFailures: 2, windowMs: 60_000, lockoutMs: 60 * 60_000 },
      new Date(now.getTime() + 2_000),
    )
    await expect(executeManualAuthenticationUnlock(db, execution)).rejects.toThrow("state changed")

    const current = await previewManualAuthenticationUnlock(db, base)
    const result = await executeManualAuthenticationUnlock(db, {
      ...execution,
      stateDigest: current.stateDigest,
      confirmation: current.confirmation,
    })
    await expect(getAuthenticationLockout(
      query,
      authenticationLockoutScope("web"),
      first.key,
      base.now,
    )).resolves.toMatchObject({ locked: false, failureCount: 0 })
    await expect(getAuthenticationLockout(
      query,
      authenticationLockoutScope("web"),
      neighbor.key,
      base.now,
    )).resolves.toMatchObject({ locked: true, failureCount: 2 })

    const audit = await db.auditLog.findUniqueOrThrow({ where: { id: result.auditEventId } })
    expect(audit).toMatchObject({
      organizationId: first.id,
      action: "authentication.manual_unlock",
      entityType: "user",
    })
    const serialized = JSON.stringify(audit)
    expect(serialized).not.toContain(email)
    expect(serialized).not.toContain(pepper)
  })

  it("reads only bounded regular 0600 JSON request files without following symlinks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "leadshelf-auth-unlock-"))
    try {
      const request = join(directory, "request.json")
      await writeFile(request, JSON.stringify({ organizationId: "org-1", channel: "web" }), { mode: 0o600 })
      await expect(readManualAuthUnlockRequestFile(request)).resolves.toEqual({
        organizationId: "org-1",
        channel: "web",
      })
      await chmod(request, 0o644)
      await expect(readManualAuthUnlockRequestFile(request)).rejects.toThrow("0600")
      await chmod(request, 0o600)
      const linked = join(directory, "linked.json")
      await symlink(request, linked)
      await expect(readManualAuthUnlockRequestFile(linked)).rejects.toThrow("opened safely")
      await writeFile(request, JSON.stringify({ organizationId: "org-1", password: "must-not-pass" }), { mode: 0o600 })
      await expect(readManualAuthUnlockRequestFile(request)).rejects.toThrow("unsupported field")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("supports the tenant-qualified mobile employee-code channel without exposing it", async () => {
    const now = new Date("2026-07-19T06:00:00.000Z")
    const suffix = randomUUID().slice(0, 8)
    const slug = `unlock-mobile-${suffix}`
    const employeeCode = "FIELD-007"
    const organization = await db.organization.create({
      data: {
        name: "Mobile unlock",
        slug,
        users: { create: { name: "Field target", employeeCode } },
      },
      select: { id: true, slug: true },
    })
    organizationIds.push(organization.id)
    const key = mobileAuthenticationLockoutKey(slug, employeeCode, pepper)
    lockoutKeys.push({ channel: "mobile", key })
    const policy = { maxFailures: 2, windowMs: 60_000, lockoutMs: 60 * 60_000 }
    const scope = authenticationLockoutScope("mobile")
    await recordAuthenticationFailure(query, scope, key, policy, now)
    await recordAuthenticationFailure(query, scope, key, policy, now)
    const base = {
      organizationId: organization.id,
      slug,
      channel: "mobile" as const,
      principal: employeeCode,
      pepper,
      now: new Date(now.getTime() + 1_000),
    }
    const preview = await previewManualAuthenticationUnlock(db, base)
    expect(preview.state.locked).toBe(true)
    expect(JSON.stringify(preview)).not.toContain(employeeCode)
    await executeManualAuthenticationUnlock(db, {
      ...base,
      enabled: true,
      stateDigest: preview.stateDigest,
      confirmation: preview.confirmation,
      approvals: ["support-owner:mobile-1", "security-owner:mobile-2"],
      ticketId: "SUP-MOBILE-7",
      reasonCode: "verified_account_recovery",
    })
    await expect(getAuthenticationLockout(query, scope, key, base.now))
      .resolves.toMatchObject({ locked: false, failureCount: 0 })
  })
})
