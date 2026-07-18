import { describe, expect, test } from "vitest"
import {
  classifyProofAnalysisError,
  proofAiRateLimitRule,
  proofAnalysisRetryDelayMs,
} from "./processor.ts"

describe("proof analysis retry policy", () => {
  test("uses bounded exponential backoff by attempt", () => {
    expect(proofAnalysisRetryDelayMs(1, 1_000)).toBe(1_000)
    expect(proofAnalysisRetryDelayMs(2, 1_000)).toBe(2_000)
    expect(proofAnalysisRetryDelayMs(3, 1_000)).toBe(4_000)
    expect(proofAnalysisRetryDelayMs(20, 1_000, 30_000)).toBe(30_000)
  })

  test("treats missing configured provider credentials as permanent", () => {
    expect(classifyProofAnalysisError("openai_api_key_missing")).toBe("permanent")
    expect(classifyProofAnalysisError("gemini_api_key_missing")).toBe("permanent")
    expect(classifyProofAnalysisError("openai_responses_failed:503")).toBe("retryable")
    expect(classifyProofAnalysisError("openai_response_not_json")).toBe("retryable")
  })

  test("uses a bounded tenant AI cost window", () => {
    expect(proofAiRateLimitRule({})).toEqual({ max: 100, windowMs: 3_600_000 })
    expect(proofAiRateLimitRule({
      LEADSHELF_PROOF_AI_MAX_PER_WINDOW: "25",
      LEADSHELF_PROOF_AI_WINDOW_MS: "60000",
    })).toEqual({ max: 25, windowMs: 60_000 })
    expect(proofAiRateLimitRule({
      LEADSHELF_PROOF_AI_MAX_PER_WINDOW: "0",
      LEADSHELF_PROOF_AI_WINDOW_MS: "10",
    })).toEqual({ max: 100, windowMs: 3_600_000 })
  })
})
