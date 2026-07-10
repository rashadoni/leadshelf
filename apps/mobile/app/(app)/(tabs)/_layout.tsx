// Нижняя навигация приложения агента: Маршрут / Визит / Панель / Заказы / Профиль.
import { useCallback, useEffect, useState } from "react"
import { Tabs, useFocusEffect } from "expo-router"
import { TabIcon } from "../../../src/components/TabIcon"
import { countOpenTasks } from "../../../src/db/local-store"
import { colors } from "../../../src/theme"
import { t, useLocale } from "../../../src/i18n"
import { useSync } from "../../../src/sync/sync-context"

export default function TabsLayout() {
  useLocale() // ре-рендер подписей вкладок при смене языка в профиле
  const { status } = useSync()
  const [openTaskCount, setOpenTaskCount] = useState(0)
  const reloadBadge = useCallback(() => setOpenTaskCount(countOpenTasks()), [])
  useFocusEffect(reloadBadge)

  useEffect(() => {
    if (status.phase === "idle") reloadBadge()
  }, [reloadBadge, status.lastSyncAt, status.phase])

  const routeBadge = openTaskCount > 99 ? "99+" : openTaskCount || undefined

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: 62,
          paddingTop: 6,
          paddingBottom: 8,
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
          tabBarBadge: routeBadge,
        }}
      />
      <Tabs.Screen
        name="visit"
        options={{
          title: t("tabVisit"),
          tabBarIcon: ({ color }) => <TabIcon name="visit" color={color} />,
        }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{
          title: t("tabDashboard"),
          tabBarIcon: ({ color }) => <TabIcon name="dashboard" color={color} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: t("tabOrders"),
          tabBarIcon: ({ color }) => <TabIcon name="orders" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("tabProfile"),
          tabBarIcon: ({ color }) => <TabIcon name="profile" color={color} />,
        }}
      />
    </Tabs>
  )
}
