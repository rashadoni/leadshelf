import { useEffect, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router } from "expo-router"
import { t } from "../../../src/i18n"
import { tokenStore } from "../../../src/auth/token-store"
import { mobileLogout } from "../../../src/api/mobile-client"

export default function ProfileScreen() {
  const [name, setName] = useState("")
  const [org, setOrg] = useState("")
  const [code, setCode] = useState("")

  useEffect(() => {
    void tokenStore.getUserName().then((v) => setName(v ?? ""))
    void tokenStore.getOrgSlug().then((v) => setOrg(v ?? ""))
    void tokenStore.getLastEmployeeCode().then((v) => setCode(v ?? ""))
  }, [])

  async function logout() {
    await mobileLogout() // best-effort отзыв refresh-сессии на сервере
    await tokenStore.clearSession()
    router.replace("/(auth)/login" as never)
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Text style={styles.title}>{t("tabProfile")}</Text>
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>👤</Text>
        </View>
        {name ? <Text style={styles.name}>{name}</Text> : null}
        {org ? (
          <Text style={styles.meta}>
            {t("orgSlug")}: {org}
          </Text>
        ) : null}
        {code ? (
          <Text style={styles.meta}>
            {t("employeeCode")}: {code}
          </Text>
        ) : null}
      </View>
      <Pressable style={({ pressed }) => [styles.logout, pressed && styles.logoutPressed]} onPress={logout}>
        <Text style={styles.logoutText}>{t("logout")}</Text>
      </Pressable>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f5f5f4" },
  title: { fontSize: 26, fontWeight: "800", color: "#1c1917", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  card: {
    alignItems: "center",
    gap: 6,
    backgroundColor: "white",
    marginHorizontal: 12,
    marginTop: 8,
    paddingVertical: 24,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#eeece9",
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#f5f5f4",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  avatarText: { fontSize: 36 },
  name: { fontSize: 20, fontWeight: "800", color: "#1c1917" },
  meta: { fontSize: 14, color: "#78716c" },
  logout: {
    marginHorizontal: 12,
    marginTop: 16,
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: "#1c1917",
    alignItems: "center",
    justifyContent: "center",
  },
  logoutPressed: { backgroundColor: "#292524" },
  logoutText: { color: "white", fontSize: 16, fontWeight: "800" },
})
