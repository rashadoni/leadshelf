import "dotenv/config"
import { createSystemClient } from "@leadshelf/db"
import { processNextProofVideoAnalysisJob } from "./proof-analysis/processor"

const prisma = createSystemClient("proof-analysis-worker")
const pollMs = Number(process.env.LEADSHELF_PROOF_ANALYSIS_POLL_MS ?? 5000)
const once = process.argv.includes("--once")
const limitPerTick = Math.max(1, Number(process.env.LEADSHELF_PROOF_ANALYSIS_LIMIT_PER_TICK ?? 3))

async function tick(): Promise<number> {
  let processed = 0
  for (let i = 0; i < limitPerTick; i++) {
    const result = await processNextProofVideoAnalysisJob(prisma)
    if (result.status === "empty") break
    processed += 1
    if (result.status === "completed") {
      console.log(
        `[proof-analysis-worker] photo=${result.photoSubmissionId} review=${result.reviewId} provider=${result.provider} model=${result.modelVersion}`,
      )
    } else if (result.status === "skipped") {
      console.log(`[proof-analysis-worker] photo=${result.photoSubmissionId} skipped=${result.reason}`)
    } else {
      console.error(`[proof-analysis-worker] photo=${result.photoSubmissionId} failed=${result.error}`)
    }
  }
  return processed
}

async function main() {
  if (once) {
    await tick()
    return
  }
  for (;;) {
    const processed = await tick()
    if (processed === 0) await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    if (once) await prisma.$disconnect()
  })
