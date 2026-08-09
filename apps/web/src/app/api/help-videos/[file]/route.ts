import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { Readable } from "node:stream"
import type { NextRequest } from "next/server"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"

export const runtime = "nodejs"

// Only recorder-produced Azerbaijani assets: <slug>.az.VOICE.mp4 / .poster.jpg —
// everything else 404s before touching the filesystem (no traversal surface).
const FILE_PATTERN = /^[a-z0-9-]+\.az\.(VOICE\.mp4|poster\.jpg)$/

// Dev: apps/web cwd → repo-root video/player (recorder output).
// Prod (docker): a read-only volume mounted by deploy/docker-compose.prod.yml.
const DEFAULT_ASSET_DIR =
  process.env.NODE_ENV === "production"
    ? "/help-videos/player"
    : join(process.cwd(), "..", "..", "video", "player")

function contentTypeFor(file: string) {
  return file.endsWith(".mp4") ? "video/mp4" : "image/jpeg"
}

function parseRange(range: string | null, size: number) {
  if (!range) return null
  const match = range.match(/^bytes=(\d*)-(\d*)$/)
  if (!match) return null
  const start = match[1] ? Number.parseInt(match[1], 10) : 0
  const end = match[2] ? Number.parseInt(match[2], 10) : size - 1
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end >= size) {
    return null
  }
  return { start, end }
}

function streamFile(path: string, range?: { start: number; end: number }) {
  const stream = range
    ? createReadStream(path, { start: range.start, end: range.end })
    : createReadStream(path)
  return Readable.toWeb(stream) as ReadableStream
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  if (!FILE_PATTERN.test(file)) return new Response("Not found", { status: 404 })

  const session = await requireApiSession(req)
  if (!session) return unauthorized()

  const assetDir = process.env.HELP_VIDEO_ASSET_DIR || DEFAULT_ASSET_DIR
  const filePath = join(assetDir, file)
  const contentType = contentTypeFor(file)

  try {
    const fileStat = await stat(filePath)
    const size = fileStat.size
    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
      "Accept-Ranges": "bytes",
    })

    if (contentType === "video/mp4") {
      const range = parseRange(req.headers.get("range"), size)
      if (range) {
        headers.set("Content-Length", String(range.end - range.start + 1))
        headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`)
        return new Response(streamFile(filePath, range), { status: 206, headers })
      }
    }

    headers.set("Content-Length", String(size))
    return new Response(streamFile(filePath), { headers })
  } catch {
    return new Response("Not found", { status: 404 })
  }
}
