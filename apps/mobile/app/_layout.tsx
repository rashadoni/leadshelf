import { Stack } from "expo-router"
import { useEffect, useState } from "react"
import { StyleSheet, Text, View } from "react-native"
import { initDb } from "../src/db/local-store"
import { getOrCreateDeviceId } from "../src/auth/device-id"
import { tokenStore } from "../src/auth/token-store"
import { setLocale, type Locale } from "../src/i18n"
import { initErrorReporting } from "../src/observability"

export default function RootLayout() {
  const [ready, setReady] = useState(false)
  const [storageUnavailable, setStorageUnavailable] = useState(false)

  useEffect(() => {
    initErrorReporting()
    void (async () => {
      try {
        await initDb()
        await getOrCreateDeviceId()
        const saved = await tokenStore.getLocale()
        if (saved === "ru" || saved === "az") setLocale(saved as Locale)
        setReady(true)
      } catch {
        setStorageUnavailable(true)
      }
    })()
  }, [])

  if (storageUnavailable) {
    return (
      <View style={styles.failure} accessibilityRole="alert">
        <Text style={styles.title}>Защищённое хранилище недоступно</Text>
        <Text style={styles.body}>
          Не очищайте данные приложения, если осталась несинхронизированная работа. Обратитесь в поддержку и сообщите код LS-MDB-INIT.
        </Text>
        <Text style={styles.title}>Qorunan yaddaş əlçatan deyil</Text>
        <Text style={styles.body}>
          Sinxronlaşdırılmamış iş ola bilərsə, tətbiq məlumatlarını silməyin. Dəstəyə LS-MDB-INIT kodunu bildirin.
        </Text>
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
})
