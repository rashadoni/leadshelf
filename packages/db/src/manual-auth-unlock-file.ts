import { constants } from "node:fs"
import { open, type FileHandle } from "node:fs/promises"

const MAX_REQUEST_BYTES = 16 * 1024
const ALLOWED_FIELDS = new Set([
  "organizationId",
  "slug",
  "channel",
  "principal",
  "ticketId",
  "reasonCode",
  "approvals",
  "stateDigest",
  "confirmation",
])

export async function readManualAuthUnlockRequestFile(path: string): Promise<Record<string, unknown>> {
  if (!path.trim()) throw new Error("[auth-unlock] --request-file is required")
  let handle: FileHandle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    throw new Error("[auth-unlock] request file could not be opened safely")
  }
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile()) throw new Error("[auth-unlock] request file must be a regular file")
    if ((metadata.mode & 0o077) !== 0) {
      throw new Error("[auth-unlock] request file must have permissions 0600 or stricter")
    }
    if (metadata.size < 2 || metadata.size > MAX_REQUEST_BYTES) {
      throw new Error("[auth-unlock] request file size is invalid")
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(await handle.readFile({ encoding: "utf8" })) as unknown
    } catch {
      throw new Error("[auth-unlock] request file must contain valid JSON")
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("[auth-unlock] request file must contain a JSON object")
    }
    const result = parsed as Record<string, unknown>
    if (Object.keys(result).some((key) => !ALLOWED_FIELDS.has(key))) {
      throw new Error("[auth-unlock] request file contains an unsupported field")
    }
    return result
  } finally {
    await handle.close()
  }
}
