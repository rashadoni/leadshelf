import { Redirect } from "expo-router"
import { useEffect, useState } from "react"
import { tokenStore } from "../src/auth/token-store"

export default function Index() {
  const [dest, setDest] = useState<string | null>(null)
  useEffect(() => {
    void tokenStore.getAccess().then((token) => setDest(token ? "/(app)/(tabs)" : "/(auth)/login"))
  }, [])
  if (!dest) return null
  return <Redirect href={dest as never} />
}
