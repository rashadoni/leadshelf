// Вкладка «Профиль»: агент, язык интерфейса, синхронизация, выход.
import { useEffect, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router } from "expo-router"
import { SyncBar } from "../../../src/components/SyncBar"
import { mobileLogout } from "../../../src/api/mobile-client"
import { tokenStore } from "../../../src/auth/token-store"
import { useSync } from "../../../src/sync/sync-context"
import { setLocale, t, useLocale, type Locale } from "../../../src/i18n"
import { colors, cardShadow, radii } from "../../../src/theme"

const LOCALES: Locale[] = ["az", "ru"]

export default function ProfileTab() {
  const locale = useLocale()
  const { status, sync } = useSync()
  const [userName, setUserName] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    void tokenStore.getUserName().then((name) => setUserName(name))
  }, [])

  async function onSyncNow() {
    setSyncing(true)
    await sync()
    setSyncing(false)
  }

  async function logout() {
    await mobileLogout() // best-effort отзыв refresh-сессии на сервере
    await tokenStore.clearSession()
    router.replace("/(auth)/login" as never)
  }

  const initial = (userName ?? "?").trim().charAt(0).toUpperCase() || "?"
  const running = !["idle", "offline", "error", "upgradeRequired"].includes(status.phase)

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>{t("tabProfile")}</Text>
        </View>

        <View style={[styles.card, styles.accountCard]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.accountBody}>
            <Text style={styles.accountLabel}>{t("profileAccount")}</Text>
            <Text style={styles.accountName} numberOfLines={1}>
              {userName ?? "—"}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t("profileLanguage")}</Text>
          <View style={styles.localeRow}>
            {LOCALES.map((l) => (
              <Pressable
                key={l}
                onPress={() => {
                  setLocale(l)
                  void tokenStore.setLocale(l)
                }}
                style={[styles.localeBtn, locale === l && styles.localeActive]}
              >
                <Text style={[styles.localeText, locale === l && styles.localeTextActive]}>
                  {l === "az" ? "Azərbaycanca" : "Русский"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t("profileSync")}</Text>
          <SyncBar />
          <Pressable
            disabled={running || syncing}
            onPress={() => void onSyncNow()}
            style={({ pressed }) => [
              styles.syncButton,
              pressed && styles.syncPressed,
              (running || syncing) && styles.syncDisabled,
            ]}
          >
            <Text style={styles.syncText}>{running || syncing ? t("syncRunning") : t("syncNow")}</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => void logout()} style={({ pressed }) => [styles.logout, pressed && styles.logoutPressed]}>
          <Text style={styles.logoutText}>{t("logout")}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 24 },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text },
  card: {
    backgroundColor: colors.card,
    marginHorizontal: 14,
    marginTop: 14,
    padding: 16,
    borderRadius: radii.card,
    ...cardShadow,
  },
  accountCard: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "white", fontSize: 22, fontWeight: "800" },
  accountBody: { flex: 1, minWidth: 0 },
  accountLabel: { fontSize: 11, fontWeight: "700", color: colors.faint, letterSpacing: 0.4, textTransform: "uppercase" },
  accountName: { fontSize: 18, fontWeight: "800", color: colors.text, marginTop: 2 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: colors.text, marginBottom: 10 },
  localeRow: { flexDirection: "row", gap: 8 },
  localeBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: radii.inner,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  localeActive: { backgroundColor: "#EEF2FF", borderColor: colors.primary },
  localeText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  localeTextActive: { color: colors.primary, fontWeight: "800" },
  syncButton: {
    marginTop: 12,
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  syncPressed: { backgroundColor: colors.primaryPressed },
  syncDisabled: { backgroundColor: "#D4D4D8" },
  syncText: { color: "white", fontSize: 13, fontWeight: "800" },
  logout: {
    marginHorizontal: 14,
    marginTop: 18,
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  logoutPressed: { backgroundColor: "#FEF2F2" },
  logoutText: { color: colors.danger, fontSize: 14, fontWeight: "800" },
})
