// Пять устойчивых разделов единого Agent Mobile: сегодня, неделя, работа,
// входящие и профиль. Вложенные операционные экраны скрыты из tab bar.
import { Tabs } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { TabIcon } from "../../../src/components/TabIcon"
import { getBottomTabBarMetrics } from "../../../src/navigation/tab-bar"
import { colors } from "../../../src/theme"
import { t, useLocale } from "../../../src/i18n"
import { useField } from "../../../src/field/field-context"

export default function TabsLayout() {
  useLocale() // ре-рендер подписей вкладок при смене языка в профиле
  const insets = useSafeAreaInsets()
  const { notifications, messages } = useField()
  const inboxUnread = notifications.unread + messages.unread
  const inboxBadge = inboxUnread > 99 ? "99+" : inboxUnread || undefined
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
          borderTopWidth: 1,
          height: tabBarMetrics.height,
          paddingTop: 8,
          paddingBottom: tabBarMetrics.paddingBottom,
          elevation: 0,
        },
        tabBarItemStyle: { paddingBottom: 2 },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "700" },
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
          title: t("tabToday"),
          tabBarIcon: ({ color }) => <TabIcon name="today" color={color} />,
        }}
      />
      <Tabs.Screen
        name="week"
        options={{
          title: t("tabWeek"),
          tabBarIcon: ({ color }) => <TabIcon name="week" color={color} />,
        }}
      />
      <Tabs.Screen
        name="work"
        options={{
          title: t("tabWork"),
          tabBarIcon: ({ color }) => <TabIcon name="work" color={color} />,
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: t("tabInbox"),
          tabBarIcon: ({ color }) => <TabIcon name="inbox" color={color} />,
          tabBarBadge: inboxBadge,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("tabProfile"),
          tabBarIcon: ({ color }) => <TabIcon name="profile" color={color} />,
        }}
      />
      <Tabs.Screen name="tasks" options={{ href: null }} />
      <Tabs.Screen name="shelves" options={{ href: null }} />
      <Tabs.Screen name="planograms" options={{ href: null }} />
      <Tabs.Screen name="visit" options={{ href: null }} />
      <Tabs.Screen name="orders" options={{ href: null }} />
      <Tabs.Screen name="dashboard" options={{ href: null }} />
    </Tabs>
  )
}
