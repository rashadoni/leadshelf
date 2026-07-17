import { useEffect, useState } from "react"
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
import { AccountSwitchBlockedError, mobileLogin } from "../../src/api/mobile-client"
import { tokenStore } from "../../src/auth/token-store"
import { setLocale, t, useLocale } from "../../src/i18n"
import { HttpError } from "../../src/sync/ports-error"
import { colors, cardShadow, radii } from "../../src/theme"

export default function LoginScreen() {
  const locale = useLocale()
  const [orgSlug, setOrgSlug] = useState("demo")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // Предзаполняем организацию и email с прошлого входа — не заставляем
  // печатать заново (docs/28 «запомнить меня»).
  useEffect(() => {
    void (async () => {
      const [savedOrg, savedEmail] = await Promise.all([
        tokenStore.getOrgSlug(),
        tokenStore.getLastEmail(),
      ])
      if (savedOrg) setOrgSlug(savedOrg)
      if (savedEmail) setEmail(savedEmail)
    })()
  }, [])

  async function onLogin() {
    setPending(true)
    setError(null)
    try {
      const normalizedEmail = email.trim().toLowerCase()
      const res = await mobileLogin({
        orgSlug: orgSlug.trim().toLowerCase(),
        email: normalizedEmail,
        password,
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

  const canSubmit = Boolean(orgSlug.trim() && email.trim() && password && !pending)

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <View style={styles.mark}><Text style={styles.markText}>LD</Text></View>
          <Text style={styles.brandTitle}>{t("appName")}</Text>
          <Text style={styles.brandHint}>{t("welcomeHint")}</Text>
        </View>

        <View style={styles.card}>
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

          <Text style={styles.title}>{t("loginTitle")}</Text>
          <Text style={styles.welcome}>{t("loginSecureHint")}</Text>

        <View style={styles.field}>
          <Text style={styles.label}>{t("orgSlug")}</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            value={orgSlug}
            onChangeText={setOrgSlug}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>{t("email")}</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            value={email}
            onChangeText={setEmail}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>{t("password")}</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            textContentType="password"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={() => canSubmit && void onLogin()}
          />
        </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

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
          </Pressable>
        </View>
        <Text style={styles.footer}>{t("loginFooter")}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 36 },
  brand: { alignItems: "center", marginBottom: 24 },
  mark: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: colors.headerText,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  markText: { color: colors.primary, fontSize: 20, fontWeight: "900", letterSpacing: -0.8 },
  brandTitle: { color: colors.headerText, fontSize: 29, fontWeight: "900", letterSpacing: -0.7 },
  brandHint: { color: colors.headerSubtext, fontSize: 14, marginTop: 5, textAlign: "center" },
  card: { backgroundColor: colors.card, borderRadius: 24, padding: 22, gap: 15, ...cardShadow },
  localeRow: { flexDirection: "row", gap: 6, justifyContent: "flex-end" },
  localeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  localeActive: { backgroundColor: colors.primarySoft },
  localeText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  localeTextActive: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  title: { fontSize: 24, fontWeight: "900", color: colors.text, letterSpacing: -0.4 },
  welcome: { fontSize: 14, lineHeight: 20, color: colors.muted, marginTop: -8, marginBottom: 2 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: "700", color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.inner,
    paddingHorizontal: 14,
    minHeight: 52,
    fontSize: 17,
    color: colors.text,
    backgroundColor: "#FAFAFB",
  },
  error: { color: "#dc2626", fontSize: 14, fontWeight: "600" },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { backgroundColor: colors.primaryPressed },
  buttonText: { color: colors.headerText, fontWeight: "800", fontSize: 17 },
  footer: { color: colors.headerSubtext, fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: 18 },
})
