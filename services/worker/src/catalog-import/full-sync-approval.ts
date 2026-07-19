import {
  constants,
  open,
  realpath,
  stat,
  unlink,
} from "node:fs/promises"
import { dirname, isAbsolute, resolve } from "node:path"

import {
  signDestructiveFullSyncApproval,
  type DestructiveFullSyncApprovalPayload,
} from "./reconciliation"

export type FullSyncApprovalIssueErrorCode =
  | "path_invalid"
  | "input_file_invalid"
  | "input_file_permissions_invalid"
  | "input_too_large"
  | "request_invalid"
  | "request_time_invalid"
  | "secret_invalid"
  | "output_directory_invalid"
  | "output_exists"
  | "output_write_failed"

export class FullSyncApprovalIssueError extends Error {
  constructor(readonly code: FullSyncApprovalIssueErrorCode) {
    super(code)
    this.name = "FullSyncApprovalIssueError"
  }
}

function fail(code: FullSyncApprovalIssueErrorCode): never {
  throw new FullSyncApprovalIssueError(code)
}

export async function readProtectedFullSyncFile(
  filePath: string,
  expectedUid: number,
  maxBytes: number,
): Promise<Buffer> {
  if (!isAbsolute(filePath) || filePath === "/") fail("path_invalid")
  let handle
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    fail("input_file_invalid")
  }
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile() || metadata.uid !== expectedUid) fail("input_file_invalid")
    if ((metadata.mode & 0o077) !== 0) fail("input_file_permissions_invalid")
    if (metadata.size < 1 || metadata.size > maxBytes) fail("input_too_large")
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

async function validateOutputDirectory(outputPath: string, expectedUid: number): Promise<void> {
  if (!isAbsolute(outputPath) || outputPath === "/") fail("path_invalid")
  const parent = dirname(outputPath)
  try {
    const [metadata, canonical] = await Promise.all([stat(parent), realpath(parent)])
    if (
      !metadata.isDirectory() ||
      metadata.uid !== expectedUid ||
      (metadata.mode & 0o022) !== 0 ||
      canonical !== resolve(parent)
    ) fail("output_directory_invalid")
  } catch (error) {
    if (error instanceof FullSyncApprovalIssueError) throw error
    fail("output_directory_invalid")
  }
}

export async function writeProtectedFullSyncFile(
  outputFile: string,
  content: string,
  expectedUid: number,
): Promise<void> {
  await validateOutputDirectory(outputFile, expectedUid)
  let handle
  try {
    handle = await open(
      outputFile,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("output_exists")
    fail("output_write_failed")
  }
  try {
    await handle.writeFile(content, "utf8")
    await handle.sync()
  } catch {
    await handle.close().catch(() => undefined)
    await unlink(outputFile).catch(() => undefined)
    fail("output_write_failed")
  }
  await handle.close()
}

function parseRequest(buffer: Buffer, now: Date): DestructiveFullSyncApprovalPayload {
  let raw: unknown
  try {
    raw = JSON.parse(buffer.toString("utf8"))
  } catch {
    fail("request_invalid")
  }
  try {
    // Signing performs the authoritative exact-schema validation. A temporary
    // non-secret key is sufficient here; the returned token is discarded.
    signDestructiveFullSyncApproval(raw as DestructiveFullSyncApprovalPayload, "request-validation-key-at-least-32-bytes")
  } catch {
    fail("request_invalid")
  }
  const payload = raw as DestructiveFullSyncApprovalPayload
  const nowMs = now.getTime()
  const issuedAt = new Date(payload.issuedAt).getTime()
  const expiresAt = new Date(payload.expiresAt).getTime()
  if (
    !Number.isFinite(nowMs) ||
    issuedAt < nowMs - 5 * 60_000 ||
    issuedAt > nowMs + 60_000 ||
    expiresAt <= nowMs
  ) fail("request_time_invalid")
  return payload
}

function parseSecret(buffer: Buffer): string {
  const text = buffer.toString("utf8")
  const secret = text.replace(/\r?\n$/, "")
  if (!/^[A-Za-z0-9_-]{43,256}$/.test(secret)) fail("secret_invalid")
  return secret
}

export async function issueDestructiveFullSyncApprovalFromFiles(input: {
  requestFile: string
  secretFile: string
  outputFile: string
  expectedUid?: number
  now?: Date
}): Promise<{ changeId: string }> {
  const expectedUid = input.expectedUid ?? process.getuid?.()
  if (!Number.isSafeInteger(expectedUid) || Number(expectedUid) < 0) fail("path_invalid")
  const [requestBuffer, secretBuffer] = await Promise.all([
    readProtectedFullSyncFile(input.requestFile, Number(expectedUid), 16 * 1024),
    readProtectedFullSyncFile(input.secretFile, Number(expectedUid), 4 * 1024),
  ])
  const payload = parseRequest(requestBuffer, input.now ?? new Date())
  const secret = parseSecret(secretBuffer)
  let token: string
  try {
    token = signDestructiveFullSyncApproval(payload, secret)
  } catch {
    fail("request_invalid")
  }

  await writeProtectedFullSyncFile(input.outputFile, `${token}\n`, Number(expectedUid))
  token = ""
  return { changeId: payload.changeId }
}
