type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }

export type ProofPrivacyPolicy = {
  mode: "no_people_in_frame_attestation"
  approvalReceipt: string | null
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function sanitizedReceipt(value: string | undefined): string | null {
  const receipt = value?.trim()
  if (!receipt) return null
  if (receipt.length < 8 || receipt.length > 256) return null
  if (/[\r\n]/.test(receipt)) return null
  return receipt
}

export function configuredProofPrivacyPolicy(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProofPrivacyPolicy {
  const mode = env.LEADSHELF_PROOF_PRIVACY_MODE
  if (!mode && env.NODE_ENV !== "production") {
    return { mode: "no_people_in_frame_attestation", approvalReceipt: null }
  }
  if (mode !== "no_people_in_frame_attestation") {
    throw new Error("proof privacy policy mode is not approved")
  }
  const approvalReceipt = sanitizedReceipt(env.LEADSHELF_PROOF_PRIVACY_APPROVAL)
  if (!approvalReceipt) throw new Error("proof privacy approval receipt is not configured")
  return { mode, approvalReceipt }
}

export function hasProofPrivacyAttestation(captureFlags: JsonObject | null): boolean {
  const privacy = objectRecord(captureFlags?.privacy)
  return (
    privacy.bystanderPolicy === "no_people_in_frame" &&
    privacy.operatorAttestedNoPeople === true &&
    typeof privacy.attestedAt === "string" &&
    privacy.attestedAt.length > 0
  )
}
