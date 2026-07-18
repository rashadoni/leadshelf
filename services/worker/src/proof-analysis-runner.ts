import "dotenv/config"
import { createSystemClient } from "@leadshelf/db"
import { processNextProofAnalysisJob } from "./proof-analysis/processor"
import { initErrorReporting, safeOperationalCode, writeOperationalLog } from "./observability"
import { installShutdownHandlers, normalizePollMs, runPollingLoop } from "./runner-lifecycle"

initErrorReporting("proof-analysis")

const prisma = createSystemClient("proof-analysis-worker")
const pollMs = normalizePollMs(process.env.LEADSHELF_PROOF_ANALYSIS_POLL_MS, 5_000)
const once = process.argv.includes("--once")
const limitPerTick = Math.max(1, Number(process.env.LEADSHELF_PROOF_ANALYSIS_LIMIT_PER_TICK ?? 3))
const shutdown = installShutdownHandlers("proof-analysis-worker")

async function tick(): Promise<number> {
  let processed = 0
  for (let i = 0; i < limitPerTick; i++) {
    const result = await processNextProofAnalysisJob(prisma)
    if (result.status === "empty") break
    processed += 1
    if (result.status === "completed") {
      writeOperationalLog("info", "proof-analysis-worker", "analysis_completed", {
        photoSubmissionId: result.photoSubmissionId,
        reviewId: result.reviewId,
        provider: result.provider,
        modelVersion: result.modelVersion,
        status: "completed",
      })
    } else if (result.status === "skipped") {
      writeOperationalLog("info", "proof-analysis-worker", "analysis_skipped", {
        photoSubmissionId: result.photoSubmissionId,
        reasonCode: safeOperationalCode(result.reason, "unspecified"),
        status: "skipped",
      })
    } else {
      writeOperationalLog("error", "proof-analysis-worker", "analysis_failed", {
        photoSubmissionId: result.photoSubmissionId,
        reasonCode: safeOperationalCode(result.error, "processing_error"),
        status: "failed",
      })
    }
  }
  return processed
}

async function main() {
  if (once) {
    await tick()
    return
  }
  await runPollingLoop(async () => (await tick()) > 0, pollMs, shutdown.signal, {
    onTickError(error, context) {
      writeOperationalLog("warn", "proof-analysis-worker", "tick_retry_scheduled", {
        reasonCode: error instanceof Error ? error.name : "unknown_error",
        retryAttempt: context.attempt,
        retryDelayMs: context.retryDelayMs,
      })
    },
  })
}

main()
  .catch((error) => {
    writeOperationalLog("error", "proof-analysis-worker", "runner_failed", {
      reasonCode: error instanceof Error ? error.name : "unknown_error",
    })
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
