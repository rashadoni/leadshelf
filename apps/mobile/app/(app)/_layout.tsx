import { Stack } from "expo-router"
import { SyncProvider } from "../../src/sync/sync-context"
import { FieldProvider } from "../../src/field/field-context"

export default function AppLayout() {
  return (
    <FieldProvider>
      <SyncProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </SyncProvider>
    </FieldProvider>
  )
}
