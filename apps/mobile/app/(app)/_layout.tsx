import { Stack } from "expo-router"
import { SyncProvider } from "../../src/sync/sync-context"

export default function AppLayout() {
  return (
    <SyncProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </SyncProvider>
  )
}
