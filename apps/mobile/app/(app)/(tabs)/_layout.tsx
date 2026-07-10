// Нижняя навигация приложения агента: Маршрут / Визит / Панель / Заказы / Профиль.
import { Tabs } from "expo-router"
import { TabIcon } from "../../../src/components/TabIcon"
import { colors } from "../../../src/theme"
import { t, useLocale } from "../../../src/i18n"

export default function TabsLayout() {
  useLocale() // ре-рендер подписей вкладок при смене языка в профиле
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
