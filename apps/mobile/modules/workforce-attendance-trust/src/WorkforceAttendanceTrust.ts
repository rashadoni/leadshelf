import { requireOptionalNativeModule } from "expo"

export type WorkforceAttendanceTrustAvailability = {
  available: boolean
  biometricStrongAvailable: boolean
}

export type WorkforceAttendanceEnrollmentKey = {
  /** Standard DER SPKI base64, accepted by LeadDrive's P-256 verifier. */
  publicKeySpki: string
  /** True only when Android Keystore itself requires per-use biometric unlock. */
  biometricBound: boolean
}

type NativeWorkforceAttendanceTrust = {
  getAvailability(): WorkforceAttendanceTrustAvailability
  createEnrollmentKey(keyAlias: string, biometricRequired: boolean): Promise<WorkforceAttendanceEnrollmentKey>
  sign(keyAlias: string, payload: string, biometricRequired: boolean): Promise<string>
  removeEnrollmentKey(keyAlias: string): Promise<void>
}

const nativeModule = requireOptionalNativeModule<NativeWorkforceAttendanceTrust>("WorkforceAttendanceTrust")

function unavailable(): Error {
  return new Error("Trusted attendance requires the current Android Field build")
}

/**
 * Android-only bridge for a non-exportable Keystore P-256 key.  The bridge
 * deliberately has no biometric-result API: Android unlocks the key locally
 * and JavaScript receives only the resulting DER ECDSA signature.
 */
export const workforceAttendanceTrust = {
  getAvailability(): WorkforceAttendanceTrustAvailability {
    return nativeModule?.getAvailability() ?? {
      available: false,
      biometricStrongAvailable: false,
    }
  },

  async createEnrollmentKey(
    keyAlias: string,
    biometricRequired: boolean,
  ): Promise<WorkforceAttendanceEnrollmentKey> {
    if (!nativeModule) throw unavailable()
    return nativeModule.createEnrollmentKey(keyAlias, biometricRequired)
  },

  async sign(
    keyAlias: string,
    payload: string,
    biometricRequired: boolean,
  ): Promise<string> {
    if (!nativeModule) throw unavailable()
    return nativeModule.sign(keyAlias, payload, biometricRequired)
  },

  async removeEnrollmentKey(keyAlias: string): Promise<void> {
    if (!nativeModule) return
    await nativeModule.removeEnrollmentKey(keyAlias)
  },
}
