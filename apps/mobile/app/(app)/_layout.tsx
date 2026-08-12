import { Stack } from "expo-router"
import { SyncProvider } from "../../src/sync/sync-context"
import { FieldProvider } from "../../src/field/field-context"
import { colors } from "../../src/theme"
import { useResponsiveLayout } from "../../src/layout/responsive"

export default function AppLayout() {
  const layout = useResponsiveLayout()

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
