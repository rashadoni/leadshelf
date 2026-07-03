import { Stack } from "expo-router"
import { useEffect, useState } from "react"
import { initDb } from "../src/db/local-store"
import { getOrCreateDeviceId } from "../src/auth/device-id"
import { tokenStore } from "../src/auth/token-store"
import { setLocale, type Locale } from "../src/i18n"

export default function RootLayout() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void (async () => {
      initDb()
      await getOrCreateDeviceId()
      const saved = await tokenStore.getLocale()
      if (saved === "ru" || saved === "az") setLocale(saved as Locale)
      setReady(true)
    })()
  }, [])

  if (!ready) return null
  return <Stack screenOptions={{ headerShown: false }} />
}
