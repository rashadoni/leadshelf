import { useEffect, useState } from "react"
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { router } from "expo-router"
import { mobileLogin } from "../../src/api/mobile-client"
import { tokenStore } from "../../src/auth/token-store"
import { setLocale, t, useLocale } from "../../src/i18n"

export default function LoginScreen() {
  const locale = useLocale()
  const [orgSlug, setOrgSlug] = useState("demo")
  const [employeeCode, setEmployeeCode] = useState("")
  const [pin, setPin] = useState("")
  const [error, setError] = useState(false)
  const [pending, setPending] = useState(false)

  // Предзаполняем организацию и код с прошлого входа — не заставляем
  // печатать заново (docs/28 «запомнить меня»).
  useEffect(() => {
    void (async () => {
      const [savedOrg, savedCode] = await Promise.all([
        tokenStore.getOrgSlug(),
        tokenStore.getLastEmployeeCode(),
      ])
      if (savedOrg) setOrgSlug(savedOrg)
      if (savedCode) setEmployeeCode(savedCode)
    })()
  }, [])

  async function onLogin() {
    setPending(true)
    setError(false)
    try {
      const code = employeeCode.trim()
      const res = await mobileLogin({ orgSlug: orgSlug.trim(), employeeCode: code, pin })
      if (res) {
        await tokenStore.setLastEmployeeCode(code)
        router.replace("/(app)/(tabs)" as never)
      } else {
        setError(true)
      }
    } catch {
      setError(true)
    } finally {
      setPending(false)
    }
  }

  const canSubmit = !!employeeCode && !!pin && !pending

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
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

        <Text style={styles.title}>{t("appName")}</Text>
        <Text style={styles.welcome}>{t("welcomeHint")}</Text>

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
          <Text style={styles.label}>{t("employeeCode")}</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="characters"
            value={employeeCode}
            onChangeText={setEmployeeCode}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>{t("pin")}</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            keyboardType="number-pad"
            value={pin}
            onChangeText={setPin}
          />
        </View>

        {error ? <Text style={styles.error}>{t("loginError")}</Text> : null}

        <Pressable
          onPress={onLogin}
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.button,
            !canSubmit && styles.buttonDisabled,
            pressed && canSubmit && styles.buttonPressed,
          ]}
        >
          <Text style={styles.buttonText}>{t("login")}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", padding: 20, backgroundColor: "#F4F4F6" },
  card: { backgroundColor: "white", borderRadius: 20, padding: 24, gap: 14, elevation: 2 },
  localeRow: { flexDirection: "row", gap: 6, justifyContent: "flex-end" },
  localeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  localeActive: { backgroundColor: "#6366F1" },
  localeText: { color: "#737373", fontSize: 13, fontWeight: "600" },
  localeTextActive: { color: "white", fontSize: 13, fontWeight: "600" },
  title: { fontSize: 28, fontWeight: "800", color: "#1c1917" },
  welcome: { fontSize: 15, color: "#78716c", marginTop: -8, marginBottom: 4 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: "600", color: "#57534e" },
  input: {
    borderWidth: 1,
    borderColor: "#d6d3d1",
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 52,
    fontSize: 17,
    color: "#1c1917",
  },
  error: { color: "#dc2626", fontSize: 14, fontWeight: "600" },
  button: {
    backgroundColor: "#6366F1",
    borderRadius: 14,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { backgroundColor: "#4F46E5" },
  buttonText: { color: "white", fontWeight: "800", fontSize: 18 },
})
