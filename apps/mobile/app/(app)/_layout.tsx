import { router, Stack, usePathname } from "expo-router"
import { useEffect } from "react"
import { AppState } from "react-native"
import { SyncProvider } from "../../src/sync/sync-context"
import { FieldProvider } from "../../src/field/field-context"
import { fieldApi } from "../../src/api/mobile-client"
import { IS_LEADDRIVE_FIELD } from "../../src/config/mobile-variant"
import { startFieldPresenceHeartbeat } from "../../src/field/presence-heartbeat"
import { colors } from "../../src/theme"
import { useResponsiveLayout } from "../../src/layout/responsive"
import { isLegacyCommercialFieldPath } from "../../src/field/legacy-field-paths"
import { FieldScreenChrome } from "../../src/components/FieldScreenChrome"

export default function AppLayout() {
  const layout = useResponsiveLayout()
  const pathname = usePathname()
  const legacyFieldPath = IS_LEADDRIVE_FIELD && isLegacyCommercialFieldPath(pathname)

  useEffect(() => {
    if (legacyFieldPath) router.replace("/(app)/(tabs)/work" as never)
  }, [legacyFieldPath])

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

  if (legacyFieldPath) return null

  return (
    <FieldProvider>
      <SyncProvider>
        <FieldScreenChrome />
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
