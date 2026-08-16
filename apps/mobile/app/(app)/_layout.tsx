import { Stack } from "expo-router"
import { useEffect } from "react"
import { AppState } from "react-native"
import { SyncProvider } from "../../src/sync/sync-context"
import { FieldProvider } from "../../src/field/field-context"
import { fieldApi } from "../../src/api/mobile-client"
import { IS_LEADDRIVE_FIELD } from "../../src/config/mobile-variant"
import { startFieldPresenceHeartbeat } from "../../src/field/presence-heartbeat"
import { colors } from "../../src/theme"
import { useResponsiveLayout } from "../../src/layout/responsive"

export default function AppLayout() {
  const layout = useResponsiveLayout()

  useEffect(() => {
    if (!IS_LEADDRIVE_FIELD) return
    return startFieldPresenceHeartbeat({
      heartbeat: fieldApi.heartbeat,
      currentState: () => AppState.currentState,
      subscribe: (listener) => {
        const subscription = AppState.addEventListener("change", listener)
        return () => subscription.remove()
      },
    })
  }, [])

  return (
    <FieldProvider>
      <SyncProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: layout.isTablet
              ? {
                  width: "100%",
                  maxWidth: layout.contentMaxWidth,
                  alignSelf: "center",
                  backgroundColor: colors.bg,
                }
              : undefined,
          }}
        />
      </SyncProvider>
    </FieldProvider>
  )
}
