package expo.modules.workforceattendancetrust

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The private P-256 key never leaves Android Keystore. Biometric templates,
 * match scores and even a boolean "matched" result never cross this module's
 * boundary; a successful system prompt merely unlocks this one signature.
 */
class WorkforceAttendanceTrustModule : Module() {
  private val promptInFlight = AtomicBoolean(false)

  override fun definition() = ModuleDefinition {
    Name("WorkforceAttendanceTrust")

    Function("getAvailability") {
      val context = appContext.reactContext
        ?: throw failure("ERR_WORKFORCE_ATTENDANCE_CONTEXT", "Android context is unavailable")
      val biometricStatus = BiometricManager.from(context).canAuthenticate(
        BiometricManager.Authenticators.BIOMETRIC_STRONG,
      )
      mapOf(
        "available" to true,
        "biometricStrongAvailable" to (biometricStatus == BiometricManager.BIOMETRIC_SUCCESS),
      )
    }

    AsyncFunction("createEnrollmentKey") { keyAlias: String, biometricRequired: Boolean ->
      createEnrollmentKey(keyAlias, biometricRequired)
    }

    AsyncFunction("removeEnrollmentKey") { keyAlias: String ->
      val alias = requireAlias(keyAlias)
      val keyStore = keyStore()
      if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
    }

    AsyncFunction("getEnrollmentPublicKeySpki") { keyAlias: String ->
      enrollmentPublicKeySpki(keyAlias)
    }

    AsyncFunction("sign") { keyAlias: String, payload: String, biometricRequired: Boolean, promise: Promise ->
      sign(keyAlias, payload, biometricRequired, promise)
    }
  }

  private fun createEnrollmentKey(keyAlias: String, biometricRequired: Boolean): Map<String, Any> {
    val alias = requireAlias(keyAlias)
    val keyStore = keyStore()
    if (keyStore.containsAlias(alias)) {
      throw failure("ERR_WORKFORCE_ATTENDANCE_KEY_EXISTS", "Attendance enrollment key already exists")
    }
    if (biometricRequired) requireStrongBiometrics()

    val spec = KeyGenParameterSpec.Builder(
      alias,
      KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
    )
      .setDigests(KeyProperties.DIGEST_SHA256)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      // Without a validity window Android requires an unlock for every use.
      .setUserAuthenticationRequired(biometricRequired)
      .apply {
        if (biometricRequired && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
          // A changed biometric enrollment invalidates an old trust binding;
          // the user then completes the explicit enrollment flow again.
          setInvalidatedByBiometricEnrollment(true)
        }
      }
      .build()

    val generator = KeyPairGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_EC,
      "AndroidKeyStore",
    )
    generator.initialize(spec)
    val keyPair = generator.generateKeyPair()
    return mapOf(
      "publicKeySpki" to Base64.encodeToString(keyPair.public.encoded, Base64.NO_WRAP),
      "biometricBound" to biometricRequired,
    )
  }

  private fun sign(
    keyAlias: String,
    payload: String,
    biometricRequired: Boolean,
    promise: Promise,
  ) {
    val signature: Signature
    val keyRequiresAuthentication: Boolean
    try {
      val alias = requireAlias(keyAlias)
      if (payload.isBlank() || payload.length > MAX_SIGNING_PAYLOAD_LENGTH) {
        throw failure("ERR_WORKFORCE_ATTENDANCE_PAYLOAD", "Attendance signing payload is invalid")
      }
      val entry = keyStore().getEntry(alias, null) as? KeyStore.PrivateKeyEntry
        ?: throw reenrollFailure("Attendance enrollment key is unavailable")
      keyRequiresAuthentication = keyRequiresAuthentication(entry.privateKey)
      if (biometricRequired && !keyRequiresAuthentication) {
        // A non-biometric key can never be upgraded in place. This stops a
        // stale local record from relabelling a weaker key as biometric-bound.
        throw failure("ERR_WORKFORCE_ATTENDANCE_REENROLL", "Re-enroll this device with biometric protection")
      }
      signature = Signature.getInstance("SHA256withECDSA")
      signature.initSign(entry.privateKey)
    } catch (error: KeyPermanentlyInvalidatedException) {
      promise.reject(reenrollFailure("Attendance enrollment key was invalidated", error))
      return
    } catch (error: CodedException) {
      promise.reject(error)
      return
    } catch (error: Exception) {
      promise.reject(failure("ERR_WORKFORCE_ATTENDANCE_SIGN", "Could not prepare attendance signature", error))
      return
    }

    if (!biometricRequired && !keyRequiresAuthentication) {
      resolveSignature(signature, payload, promise)
      return
    }

    if (!promptInFlight.compareAndSet(false, true)) {
      promise.reject(failure("ERR_WORKFORCE_ATTENDANCE_PROMPT_BUSY", "Another biometric confirmation is already open"))
      return
    }
    try {
      requireStrongBiometrics()
      val activity = appContext.currentActivity as? FragmentActivity
        ?: throw failure("ERR_WORKFORCE_ATTENDANCE_ACTIVITY", "Open the app before confirming attendance")
      activity.runOnUiThread {
        try {
          val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
              override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                promptInFlight.set(false)
                promise.reject(failure("ERR_WORKFORCE_ATTENDANCE_BIOMETRIC", "Biometric confirmation was not completed"))
              }

              override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                try {
                  val unlockedSignature = result.cryptoObject?.signature
                    ?: throw failure("ERR_WORKFORCE_ATTENDANCE_BIOMETRIC", "Biometric confirmation did not unlock the attendance key")
                  resolveSignature(unlockedSignature, payload, promise)
                } finally {
                  promptInFlight.set(false)
                }
              }
            },
          )
          val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Confirm work time")
            .setSubtitle("Use your enrolled biometric to sign this work-time action")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setNegativeButtonText(activity.getString(android.R.string.cancel))
            .build()
          prompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(signature))
        } catch (error: CodedException) {
          promptInFlight.set(false)
          promise.reject(error)
        } catch (error: Exception) {
          promptInFlight.set(false)
          promise.reject(failure("ERR_WORKFORCE_ATTENDANCE_BIOMETRIC", "Could not open biometric confirmation", error))
        }
      }
    } catch (error: CodedException) {
      promptInFlight.set(false)
      promise.reject(error)
    } catch (error: Exception) {
      promptInFlight.set(false)
      promise.reject(failure("ERR_WORKFORCE_ATTENDANCE_BIOMETRIC", "Could not open biometric confirmation", error))
    }
  }

  private fun resolveSignature(signature: Signature, payload: String, promise: Promise) {
    try {
      signature.update(payload.toByteArray(Charsets.UTF_8))
      promise.resolve(Base64.encodeToString(signature.sign(), Base64.NO_WRAP))
    } catch (error: KeyPermanentlyInvalidatedException) {
      promise.reject(reenrollFailure("Attendance enrollment key was invalidated", error))
    } catch (error: Exception) {
      promise.reject(failure("ERR_WORKFORCE_ATTENDANCE_SIGN", "Could not sign attendance action", error))
    }
  }

  private fun enrollmentPublicKeySpki(keyAlias: String): String {
    return try {
      val alias = requireAlias(keyAlias)
      val entry = keyStore().getEntry(alias, null) as? KeyStore.PrivateKeyEntry
        ?: throw reenrollFailure("Attendance enrollment key is unavailable")
      Base64.encodeToString(entry.certificate.publicKey.encoded, Base64.NO_WRAP)
    } catch (error: KeyPermanentlyInvalidatedException) {
      throw reenrollFailure("Attendance enrollment key was invalidated", error)
    }
  }

  private fun keyRequiresAuthentication(privateKey: java.security.PrivateKey): Boolean {
    return try {
      val keyInfo = KeyFactory.getInstance(privateKey.algorithm, "AndroidKeyStore")
        .getKeySpec(privateKey, KeyInfo::class.java)
      keyInfo.isUserAuthenticationRequired
    } catch (error: KeyPermanentlyInvalidatedException) {
      throw reenrollFailure("Attendance enrollment key was invalidated", error)
    } catch (error: Exception) {
      throw failure("ERR_WORKFORCE_ATTENDANCE_KEY", "Could not inspect attendance key protection", error)
    }
  }

  private fun requireStrongBiometrics() {
    val context = appContext.reactContext
      ?: throw failure("ERR_WORKFORCE_ATTENDANCE_CONTEXT", "Android context is unavailable")
    if (BiometricManager.from(context).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) != BiometricManager.BIOMETRIC_SUCCESS) {
      throw failure("ERR_WORKFORCE_ATTENDANCE_BIOMETRIC", "A strong enrolled biometric is required")
    }
  }

  private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun requireAlias(value: String): String {
    if (!ALIAS_PATTERN.matches(value)) {
      throw failure("ERR_WORKFORCE_ATTENDANCE_ALIAS", "Attendance key alias is invalid")
    }
    return value
  }

  private fun failure(code: String, message: String, cause: Throwable? = null): CodedException =
    CodedException(code, message, cause)

  private fun reenrollFailure(message: String, cause: Throwable? = null): CodedException =
    failure("ERR_WORKFORCE_ATTENDANCE_REENROLL", message, cause)

  private companion object {
    val ALIAS_PATTERN = Regex("^[A-Za-z0-9._-]{1,120}$")
    const val MAX_SIGNING_PAYLOAD_LENGTH = 4_096
  }
}
