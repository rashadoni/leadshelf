import { useEffect, useRef, useState } from "react"
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { AccountSwitchBlockedError, mobileLogin } from "../../src/api/mobile-client"
import { BrandMark } from "../../src/components/BrandMark"
import { tokenStore } from "../../src/auth/token-store"
import { setLocale, t, useLocale } from "../../src/i18n"
import { HttpError } from "../../src/sync/ports-error"
import { colors, radii } from "../../src/theme"

export default function LoginScreen() {
  const locale = useLocale()
  const scrollRef = useRef<ScrollView>(null)
  const [orgSlug, setOrgSlug] = useState("demo")
  const [employeeCode, setEmployeeCode] = useState("")
  const [pin, setPin] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // Предзаполняем организацию и код с прошлого входа — не заставляем
  // печатать заново (docs/28 «запомнить меня»).
  useEffect(() => {
    void (async () => {
      const [savedOrg, savedEmployeeCode] = await Promise.all([
        tokenStore.getOrgSlug(),
        tokenStore.getLastEmployeeCode(),
      ])
      if (savedOrg) setOrgSlug(savedOrg)
      if (savedEmployeeCode) setEmployeeCode(savedEmployeeCode)
    })()
  }, [])

  async function onLogin() {
    setPending(true)
    setError(null)
    try {
      const normalizedEmployeeCode = employeeCode.trim().toUpperCase()
      const res = await mobileLogin({
        orgSlug: orgSlug.trim().toLowerCase(),
        employeeCode: normalizedEmployeeCode,
        pin,
      })
      if (res) {
        router.replace("/(app)/(tabs)" as never)
      } else {
        setError(t("loginError"))
      }
    } catch (reason) {
      setError(
        reason instanceof AccountSwitchBlockedError
          ? t("loginPendingAccount", { count: reason.pendingOps + reason.pendingPhotos })
          : reason instanceof HttpError && reason.status === 429
            ? t("loginRateLimit")
            : t("loginNetworkError"),
      )
    } finally {
      setPending(false)
    }
  }

  const canSubmit = Boolean(orgSlug.trim() && employeeCode.trim() && pin && !pending)

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.topbar}>
            <BrandMark />
            <View style={styles.localeRow}>
          {(["az", "ru"] as const).map((l) => (
            <Pressable
              key={l}
              hitSlop={8}
              onPress={() => {
                setLocale(l)
                void tokenStore.setLocale(l)
              }}
              style={[styles.localeBtn, locale === l && styles.localeActive]}
            >
              <Text style={locale === l ? styles.localeTextActive : styles.localeText}>
                {l.toUpperCase()}
              </Text>
            </Pressable>
          ))}
            </View>
          </View>

          <View style={styles.intro}>
            <Text style={styles.eyebrow}>FIELD OPERATIONS</Text>
            <Text style={styles.title}>{t("loginTitle")}</Text>
            <Text style={styles.welcome}>{t("loginSecureHint")}</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.label}>{t("orgSlug")}</Text>
              <TextInput
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                value={orgSlug}
                onChangeText={setOrgSlug}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t("employeeCode")}</Text>
              <TextInput
                style={styles.input}
                autoCapitalize="characters"
                autoCorrect={false}
                value={employeeCode}
                onChangeText={setEmployeeCode}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t("pin")}</Text>
              <TextInput
                style={styles.input}
                secureTextEntry
                textContentType="password"
                keyboardType="number-pad"
                value={pin}
                onChangeText={setPin}
                onFocus={() => {
                  setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120)
                }}
                onSubmitEditing={() => canSubmit && void onLogin()}
              />
            </View>

            {error ? <View style={styles.errorBox}><Text style={styles.error}>{error}</Text></View> : null}

            <Pressable
              onPress={onLogin}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.button,
                !canSubmit && styles.buttonDisabled,
                pressed && canSubmit && styles.buttonPressed,
              ]}
            >
              <Text style={styles.buttonText}>{pending ? t("loginPending") : t("login")}</Text>
              <Text style={styles.buttonArrow}>→</Text>
            </Pressable>
          </View>
          <View style={styles.securityRow}>
            <View style={styles.securityDot} />
            <Text style={styles.footer}>{t("loginFooter")}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  keyboard: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingTop: 26, paddingBottom: 40 },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 52 },
  localeRow: { flexDirection: "row", gap: 4, padding: 3, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  localeBtn: { minWidth: 38, alignItems: "center", paddingHorizontal: 8, paddingVertical: 7, borderRadius: 7 },
  localeActive: { backgroundColor: colors.navy },
  localeText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  localeTextActive: { color: colors.headerText, fontSize: 13, fontWeight: "800" },
  intro: { marginBottom: 28 },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1.7, marginBottom: 9 },
  title: { fontSize: 34, lineHeight: 39, fontWeight: "900", color: colors.text, letterSpacing: -1.1 },
  welcome: { fontSize: 15, lineHeight: 22, color: colors.muted, marginTop: 8, maxWidth: 330 },
  form: { gap: 17 },
  field: { gap: 7 },
  label: { fontSize: 12, fontWeight: "800", color: colors.muted, letterSpacing: 0.2 },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.inner,
    paddingHorizontal: 16,
    minHeight: 54,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.card,
  },
  errorBox: { padding: 12, borderRadius: radii.inner, backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: colors.dangerBorder },
  error: { color: colors.dangerPressed, fontSize: 13, fontWeight: "700", lineHeight: 18 },
  button: {
    backgroundColor: colors.navy,
    borderRadius: radii.inner,
    minHeight: 56,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  buttonDisabled: { opacity: 0.35 },
  buttonPressed: { backgroundColor: colors.navyRaised },
  buttonText: { color: colors.headerText, fontWeight: "800", fontSize: 16 },
  buttonArrow: { color: colors.accent, fontSize: 22, fontWeight: "500" },
  securityRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: 8, marginTop: 24, paddingHorizontal: 12 },
  securityDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success, marginTop: 5 },
  footer: { flexShrink: 1, color: colors.muted, fontSize: 11, lineHeight: 16 },
})
