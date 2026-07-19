import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { readFullSyncCancelControlFile } from "./full-sync-cancel"

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe("controlled full-sync cancellation", () => {
  it("accepts only an exact owner-only dual-approval control file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "leadshelf-full-sync-cancel-"))
    cleanup.push(root)
    await chmod(root, 0o700)
    const file = path.join(root, "cancel.json")
    const control = {
      organizationId: "org-cancel-001",
      jobId: "job-cancel-001",
      changeId: "CHG-cancel-001",
      requesterApprovalId: "requester-cancel-001",
      reviewerApprovalId: "reviewer-cancel-001",
      reasonCode: "operator-cancelled-stale-source",
      confirmation: "CANCEL FULL SYNC job-cancel-001 org-cancel-001",
    }
    await writeFile(file, `${JSON.stringify(control)}\n`, { mode: 0o600 })
    await expect(readFullSyncCancelControlFile(file)).resolves.toEqual(control)

    await writeFile(file, JSON.stringify({ ...control, confirmation: "CANCEL" }), { mode: 0o600 })
    await expect(readFullSyncCancelControlFile(file)).rejects.toMatchObject({ code: "control_invalid" })

    await writeFile(file, JSON.stringify({ ...control, reviewerApprovalId: control.requesterApprovalId }), { mode: 0o600 })
    await expect(readFullSyncCancelControlFile(file)).rejects.toMatchObject({ code: "control_invalid" })

    await writeFile(file, JSON.stringify(control), { mode: 0o600 })
    await chmod(file, 0o644)
    await expect(readFullSyncCancelControlFile(file)).rejects.toMatchObject({ code: "control_invalid" })
    await chmod(file, 0o600)

    const link = path.join(root, "cancel-link.json")
    await symlink(file, link)
    await expect(readFullSyncCancelControlFile(link)).rejects.toMatchObject({ code: "control_invalid" })
  })
})
