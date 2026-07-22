import { describe, expect, it } from "vitest"
import {
  configuredProofPrivacyPolicy,
  hasProofPrivacyAttestation,
} from "./proof-privacy-policy"

describe("proof privacy policy", () => {
  it("defaults to attestation mode outside production", () => {
    expect(configuredProofPrivacyPolicy({ NODE_ENV: "test" })).toEqual({
      mode: "no_people_in_frame_attestation",
      approvalReceipt: null,
    })
  })

  it("fails closed in production without an approved privacy receipt", () => {
    expect(() => configuredProofPrivacyPolicy({ NODE_ENV: "production" })).toThrow("proof privacy")
    expect(() => configuredProofPrivacyPolicy({
      NODE_ENV: "production",
      LEADSHELF_PROOF_PRIVACY_MODE: "prestore_face_blur",
      LEADSHELF_PROOF_PRIVACY_APPROVAL: "privacy-ticket-1",
    })).toThrow("proof privacy")
  })

  it("accepts the explicit no-people-in-frame operating policy in production", () => {
    expect(configuredProofPrivacyPolicy({
      NODE_ENV: "production",
      LEADSHELF_PROOF_PRIVACY_MODE: "no_people_in_frame_attestation",
      LEADSHELF_PROOF_PRIVACY_APPROVAL: "privacy-owner-approved-ticket-42",
    })).toEqual({
      mode: "no_people_in_frame_attestation",
      approvalReceipt: "privacy-owner-approved-ticket-42",
    })
  })

  it("validates proof upload attestations without accepting arbitrary flags", () => {
    expect(hasProofPrivacyAttestation({
      privacy: {
        bystanderPolicy: "no_people_in_frame",
        operatorAttestedNoPeople: true,
        attestedAt: "2026-07-22T17:30:00.000Z",
      },
    })).toBe(true)
    expect(hasProofPrivacyAttestation({ privacy: { operatorAttestedNoPeople: true } })).toBe(false)
    expect(hasProofPrivacyAttestation({ equipmentMismatch: true })).toBe(false)
  })
})
