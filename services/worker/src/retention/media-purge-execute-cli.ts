import "dotenv/config"
import { createSystemClient } from "@leadshelf/db"

import { executePreparedRetentionMediaPurge, RetentionMediaPurgeError } from "./media-purge"
import { createRetentionS3ObjectStore } from "./s3-version-store"

function args(values: string[]): { manifestFile: string } {
  if (values.length !== 2 || values[0] !== "--manifest-file" || !values[1]) throw new Error("arguments_invalid")
  return { manifestFile: values[1] }
}

async function main() {
  const prisma = createSystemClient("retention-media-purge-execute")
  try {
    const paths = args(process.argv.slice(2))
    let store
    try {
      store = createRetentionS3ObjectStore()
    } catch {
      throw new RetentionMediaPurgeError("object_store_failed")
    }
    await executePreparedRetentionMediaPurge(prisma, store, paths)
    process.stdout.write('{"event":"retention_media_purge_completed"}\n')
  } catch (error) {
    const code = error instanceof RetentionMediaPurgeError ? error.code : "arguments_invalid"
    process.stderr.write(`${JSON.stringify({ event: "retention_media_purge_execute_failed", code })}\n`)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

void main()
