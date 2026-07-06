export interface ProofVideoFramePlanInput {
  durationMs: number
  maxFrames?: number
  minGapMs?: number
}

export interface ProofVideoFramePlan {
  timestampsMs: number[]
  strategy: "single_midpoint" | "front_middle_back" | "empty"
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function selectProofVideoFrameTimestamps(input: ProofVideoFramePlanInput): ProofVideoFramePlan {
  const durationMs = Math.floor(input.durationMs)
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return { timestampsMs: [], strategy: "empty" }
  }

  const maxFrames = clamp(Math.floor(input.maxFrames ?? 3), 1, 6)
  const minGapMs = clamp(Math.floor(input.minGapMs ?? 900), 250, 5_000)

  if (maxFrames === 1 || durationMs < minGapMs * 2) {
    return {
      timestampsMs: [Math.round(durationMs / 2)],
      strategy: "single_midpoint",
    }
  }

  const safeStart = clamp(900, 0, durationMs)
  const safeEnd = clamp(durationMs - 900, safeStart, durationMs)
  const candidates = [
    safeStart,
    Math.round(durationMs / 2),
    safeEnd,
    Math.round(durationMs * 0.35),
    Math.round(durationMs * 0.65),
  ]

  const timestamps: number[] = []
  for (const candidate of candidates) {
    const timestamp = clamp(candidate, 0, durationMs)
    if (timestamps.some((existing) => Math.abs(existing - timestamp) < minGapMs)) continue
    timestamps.push(timestamp)
    if (timestamps.length >= maxFrames) break
  }

  if (timestamps.length === 0) {
    return { timestampsMs: [Math.round(durationMs / 2)], strategy: "single_midpoint" }
  }

  return {
    timestampsMs: timestamps.sort((a, b) => a - b),
    strategy: timestamps.length === 1 ? "single_midpoint" : "front_middle_back",
  }
}
