import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface ExtractedProofFrame {
  timestampMs: number
  buffer: Buffer
  contentType: "image/jpeg"
}

export interface ProofFrameExtractor {
  extract(input: { video: Buffer; timestampsMs: number[]; sourceExt?: string }): Promise<ExtractedProofFrame[]>
}

function timestampSeconds(timestampMs: number): string {
  return (Math.max(0, timestampMs) / 1000).toFixed(3)
}

export function proofFrameKey(input: {
  organizationId: string
  photoSubmissionId: string
  timestampMs: number
}): string {
  const timestamp = String(Math.max(0, Math.floor(input.timestampMs))).padStart(6, "0")
  return `frames/${input.organizationId}/${input.photoSubmissionId}/${timestamp}.jpg`
}

export class FfmpegProofFrameExtractor implements ProofFrameExtractor {
  constructor(private readonly ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg") {}

  async extract(input: { video: Buffer; timestampsMs: number[]; sourceExt?: string }): Promise<ExtractedProofFrame[]> {
    const uniqueTimestamps = [...new Set(input.timestampsMs.map((value) => Math.max(0, Math.floor(value))))].sort(
      (a, b) => a - b,
    )
    if (uniqueTimestamps.length === 0) return []

    const dir = await mkdtemp(path.join(os.tmpdir(), "leadshelf-proof-video-"))
    const inputPath = path.join(dir, `source.${input.sourceExt ?? "mp4"}`)
    await writeFile(inputPath, input.video)

    try {
      const frames: ExtractedProofFrame[] = []
      for (const timestampMs of uniqueTimestamps) {
        const outputPath = path.join(dir, `${timestampMs}.jpg`)
        await execFileAsync(this.ffmpegPath, [
          "-hide_banner",
          "-loglevel",
          "error",
          "-ss",
          timestampSeconds(timestampMs),
          "-i",
          inputPath,
          "-frames:v",
          "1",
          "-vf",
          "scale='min(1280,iw)':-2",
          "-q:v",
          "3",
          outputPath,
        ])
        frames.push({
          timestampMs,
          buffer: await readFile(outputPath),
          contentType: "image/jpeg",
        })
      }
      return frames
    } finally {
      await rm(dir, { force: true, recursive: true }).catch(() => undefined)
    }
  }
}
