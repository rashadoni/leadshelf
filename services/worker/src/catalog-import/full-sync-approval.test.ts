import { execFile } from "node:child_process"
import { promisify } from "node:util"
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { issueDestructiveFullSyncApprovalFromFiles } from "./full-sync-approval"
import { guardDestructiveFullSync, type DestructiveFullSyncApprovalPayload } from "./reconciliation"

const execFileAsync = promisify(execFile)
const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "leadshelf-full-sync-approval-"))
  cleanupPaths.push(root)
  await chmod(root, 0o700)
  const now = new Date()
  const payload: DestructiveFullSyncApprovalPayload = {
    version: 1,
    action: "deactivate_absent_products",
    changeId: "CHG-private-001",
    requesterApprovalId: "requester-approval-001",
    reviewerApprovalId: "reviewer-approval-001",
    reasonCode: "authoritative-catalog-reconciliation",
    organizationId: "org-private-001",
    entityType: "products",
    sourceChecksum: "c".repeat(64),
    currentActiveRows: 100,
    incomingActiveRows: 80,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
  }
  const secret = "S".repeat(48)
  const requestFile = join(root, "request.json")
  const secretFile = join(root, "secret")
  await writeFile(requestFile, `${JSON.stringify(payload)}\n`, { mode: 0o600 })
  await writeFile(secretFile, `${secret}\n`, { mode: 0o600 })
  return { root, now, payload, secret, requestFile, secretFile }
}

describe("controlled destructive full-sync approval issuer", () => {
  it("writes an exclusive mode-0600 token without exposing protected input through the CLI", async () => {
    const setup = await fixture()
    const outputFile = join(setup.root, "approval.token")
    await expect(issueDestructiveFullSyncApprovalFromFiles({
      requestFile: setup.requestFile,
      secretFile: setup.secretFile,
      outputFile,
      expectedUid: process.getuid!(),
      now: setup.now,
    })).resolves.toEqual({ changeId: setup.payload.changeId })

    const token = (await readFile(outputFile, "utf8")).trim()
    expect((await stat(outputFile)).mode & 0o777).toBe(0o600)
    expect(token).not.toContain(setup.secret)
    expect(guardDestructiveFullSync({
      organizationId: setup.payload.organizationId,
      entityType: "products",
      sourceChecksum: setup.payload.sourceChecksum,
      currentActiveRows: setup.payload.currentActiveRows,
      incomingActiveRows: setup.payload.incomingActiveRows,
      approvalToken: token,
      approvalSecret: setup.secret,
      now: setup.now,
    })).toEqual({ allowed: true, changeId: setup.payload.changeId })

    const cliOutput = join(setup.root, "approval-cli.token")
    const cli = resolve("src/catalog-import/full-sync-approval-cli.ts")
    const tsx = resolve("node_modules/tsx/dist/cli.mjs")
    const result = await execFileAsync(process.execPath, [
      tsx,
      cli,
      "--request-file", setup.requestFile,
      "--secret-file", setup.secretFile,
      "--output-file", cliOutput,
    ], { cwd: process.cwd() })
    expect(result.stdout).toBe('{"event":"full_sync_approval_written"}\n')
    expect(result.stderr).toBe("")
    for (const privateValue of [setup.secret, setup.payload.organizationId, setup.payload.changeId]) {
      expect(result.stdout).not.toContain(privateValue)
      expect(result.stderr).not.toContain(privateValue)
    }
    expect((await stat(cliOutput)).mode & 0o777).toBe(0o600)
  })

  it("fails closed for unsafe files, stale/invalid requests and existing output", async () => {
    const setup = await fixture()
    const issue = (outputFile: string, overrides: Record<string, unknown> = {}) =>
      issueDestructiveFullSyncApprovalFromFiles({
        requestFile: setup.requestFile,
        secretFile: setup.secretFile,
        outputFile,
        expectedUid: process.getuid!(),
        now: setup.now,
        ...overrides,
      })

    const existing = join(setup.root, "existing.token")
    await writeFile(existing, "do-not-overwrite", { mode: 0o600 })
    await expect(issue(existing)).rejects.toMatchObject({ code: "output_exists", message: "output_exists" })
    expect(await readFile(existing, "utf8")).toBe("do-not-overwrite")

    await chmod(setup.requestFile, 0o644)
    await expect(issue(join(setup.root, "unsafe-request.token"))).rejects.toMatchObject({
      code: "input_file_permissions_invalid",
    })
    await chmod(setup.requestFile, 0o600)

    await chmod(setup.secretFile, 0o640)
    await expect(issue(join(setup.root, "unsafe-secret.token"))).rejects.toMatchObject({
      code: "input_file_permissions_invalid",
    })
    await chmod(setup.secretFile, 0o600)

    const requestLink = join(setup.root, "request-link.json")
    await symlink(setup.requestFile, requestLink)
    await expect(issue(join(setup.root, "symlink.token"), { requestFile: requestLink })).rejects.toMatchObject({
      code: "input_file_invalid",
    })

    const secretLink = join(setup.root, "secret-link")
    await symlink(setup.secretFile, secretLink)
    await expect(issue(join(setup.root, "secret-symlink.token"), { secretFile: secretLink })).rejects.toMatchObject({
      code: "input_file_invalid",
    })

    const unsafeDir = join(setup.root, "unsafe-output")
    await mkdir(unsafeDir, { mode: 0o700 })
    await chmod(unsafeDir, 0o777)
    await expect(issue(join(unsafeDir, "approval.token"))).rejects.toMatchObject({
      code: "output_directory_invalid",
    })

    await writeFile(setup.requestFile, JSON.stringify({
      ...setup.payload,
      reviewerApprovalId: setup.payload.requesterApprovalId,
    }), { mode: 0o600 })
    await expect(issue(join(setup.root, "same-approver.token"))).rejects.toMatchObject({ code: "request_invalid" })

    await writeFile(setup.requestFile, JSON.stringify({
      ...setup.payload,
      issuedAt: new Date(setup.now.getTime() - 10 * 60_000).toISOString(),
      expiresAt: new Date(setup.now.getTime() + 10 * 60_000).toISOString(),
    }), { mode: 0o600 })
    await expect(issue(join(setup.root, "stale-request.token"))).rejects.toMatchObject({ code: "request_time_invalid" })
  })
})
