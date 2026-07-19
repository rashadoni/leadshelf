import "dotenv/config"
import { createSystemClient } from "@leadshelf/db"

import { prepareRetentionMediaPurge, RetentionMediaPurgeError } from "./media-purge"
import { createRetentionS3ObjectStore } from "./s3-version-store"

function args(values: string[]): { controlFile: string; outputFile: string } {
  if (values.length !== 4 || values[0] !== "--control-file" || values[2] !== "--output-file" || !values[1] || !values[3]) {
    throw new Error("arguments_invalid")
  }
  return { controlFile: values[1], outputFile: values[3] }
}

async function main() {
  const prisma = createSystemClient("retention-media-purge-prepare")
  try {
    const paths = args(process.argv.slice(2))
    let store
    try {
      store = createRetentionS3ObjectStore()
    } catch {
      throw new RetentionMediaPurgeError("object_store_failed")
    }
    await prepareRetentionMediaPurge(prisma, store, paths)
    process.stdout.write('{"event":"retention_media_purge_prepared"}\n')
  } catch (error) {
    const code = error instanceof RetentionMediaPurgeError ? error.code : "arguments_invalid"
    process.stderr.write(`${JSON.stringify({ event: "retention_media_purge_prepare_failed", code })}\n`)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

void main()
