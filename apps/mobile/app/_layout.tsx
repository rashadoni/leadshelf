import { Stack } from "expo-router"
import { useEffect, useState } from "react"
import { StyleSheet, Text, View } from "react-native"
import { initDb } from "../src/db/local-store"
import { getOrCreateDeviceId } from "../src/auth/device-id"
import { tokenStore } from "../src/auth/token-store"
import { setLocale, t, type Locale } from "../src/i18n"
import { initErrorReporting } from "../src/observability"

export default function RootLayout() {
  const [ready, setReady] = useState(false)
  const [storageFailure, setStorageFailure] = useState<{ stage: string } | null>(null)

  useEffect(() => {
    initErrorReporting()
    void (async () => {
      let stage = "database"
      try {
        await initDb()
        stage = "device"
        await getOrCreateDeviceId()
        stage = "locale"
        const saved = await tokenStore.getLocale()
        if (saved === "ru" || saved === "az") setLocale(saved as Locale)
        setReady(true)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        console.error(`[mobile-startup] ${stage}: ${detail}`)
        // Keep the raw diagnostic in local logs for support, but never render
        // implementation details or storage paths in the recovery screen.
        setStorageFailure({ stage })
      }
    })()
  }, [])

  if (storageFailure) {
    return (
      <View style={styles.failure} accessibilityRole="alert">
        <Text style={styles.title}>{t("secureStorageUnavailableTitle")}</Text>
        <Text style={styles.body}>
          {t("secureStorageUnavailableBody")}
        </Text>
        <Text selectable style={styles.diagnostic}>LS-MST-INIT/{storageFailure.stage}</Text>
      </View>
    )
  }
  if (!ready) return null
  return <Stack screenOptions={{ headerShown: false }} />
}

const styles = StyleSheet.create({
  failure: { flex: 1, justifyContent: "center", padding: 24, gap: 12, backgroundColor: "#fff" },
  title: { fontSize: 20, fontWeight: "700", color: "#17202a" },
  body: { fontSize: 16, lineHeight: 24, color: "#34495e" },
  diagnostic: { marginTop: 8, fontSize: 12, lineHeight: 17, color: "#6b7280" },
})
