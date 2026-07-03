import { useState } from "react"
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

  async function onLogin() {
    setPending(true)
    setError(false)
    try {
      const res = await mobileLogin({ orgSlug: orgSlug.trim(), employeeCode: employeeCode.trim(), pin })
      if (res) {
        router.replace("/(app)/tasks" as never)
      } else {
        setError(true)
      }
    } catch {
      setError(true)
    } finally {
      setPending(false)
    }
  }

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
        <TextInput
          style={styles.input}
          placeholder={t("orgSlug")}
          autoCapitalize="none"
          value={orgSlug}
          onChangeText={setOrgSlug}
        />
        <TextInput
          style={styles.input}
          placeholder={t("employeeCode")}
          autoCapitalize="characters"
          value={employeeCode}
          onChangeText={setEmployeeCode}
        />
        <TextInput
          style={styles.input}
          placeholder={t("pin")}
          secureTextEntry
          keyboardType="number-pad"
          value={pin}
          onChangeText={setPin}
        />
        {error && <Text style={styles.error}>{t("loginError")}</Text>}
        <Pressable
          onPress={onLogin}
          disabled={pending || !employeeCode || !pin}
          style={[styles.button, (pending || !employeeCode || !pin) && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>{t("login")}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", padding: 20, backgroundColor: "#fafaf9" },
  card: { backgroundColor: "white", borderRadius: 16, padding: 24, gap: 12, elevation: 2 },
  localeRow: { flexDirection: "row", gap: 6, justifyContent: "flex-end" },
  localeBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  localeActive: { backgroundColor: "#171717" },
  localeText: { color: "#737373", fontSize: 12 },
  localeTextActive: { color: "white", fontSize: 12 },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  error: { color: "#dc2626", fontSize: 13 },
  button: { backgroundColor: "#171717", borderRadius: 8, padding: 14, alignItems: "center" },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "white", fontWeight: "600", fontSize: 16 },
})
