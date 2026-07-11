// Основная shelf-навигация: маршрут, задачи, оборудование, планограммы и профиль.
import { useCallback, useEffect, useState } from "react"
import { Tabs, useFocusEffect } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { TabIcon } from "../../../src/components/TabIcon"
import { countOpenTasks } from "../../../src/db/local-store"
import { getBottomTabBarMetrics } from "../../../src/navigation/tab-bar"
import { colors } from "../../../src/theme"
import { t, useLocale } from "../../../src/i18n"
import { useSync } from "../../../src/sync/sync-context"

export default function TabsLayout() {
  useLocale() // ре-рендер подписей вкладок при смене языка в профиле
  const insets = useSafeAreaInsets()
  const { status } = useSync()
  const [openTaskCount, setOpenTaskCount] = useState(0)
  const reloadBadge = useCallback(() => setOpenTaskCount(countOpenTasks()), [])
  useFocusEffect(reloadBadge)

  useEffect(() => {
    if (status.phase === "idle") reloadBadge()
  }, [reloadBadge, status.lastSyncAt, status.phase])

  const taskBadge = openTaskCount > 99 ? "99+" : openTaskCount || undefined
  const tabBarMetrics = getBottomTabBarMetrics(insets.bottom)

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: tabBarMetrics.height,
          paddingTop: 6,
          paddingBottom: tabBarMetrics.paddingBottom,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarBadgeStyle: {
          backgroundColor: colors.danger,
          color: colors.headerText,
          fontSize: 10,
          fontWeight: "800",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabRoute"),
          tabBarIcon: ({ color }) => <TabIcon name="route" color={color} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: t("tabTasks"),
          tabBarIcon: ({ color }) => <TabIcon name="tasks" color={color} />,
          tabBarBadge: taskBadge,
        }}
      />
      <Tabs.Screen
        name="shelves"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="planograms"
        options={{
          title: t("tabPlanograms"),
          tabBarIcon: ({ color }) => <TabIcon name="planograms" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("tabProfile"),
          tabBarIcon: ({ color }) => <TabIcon name="profile" color={color} />,
        }}
      />
      <Tabs.Screen name="visit" options={{ href: null }} />
      <Tabs.Screen name="orders" options={{ href: null }} />
      <Tabs.Screen name="dashboard" options={{ href: null }} />
    </Tabs>
  )
}
