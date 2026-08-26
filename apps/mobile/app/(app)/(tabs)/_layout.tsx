// Пять устойчивых разделов единого Agent Mobile: сегодня, неделя, работа,
// входящие и профиль. Вложенные операционные экраны скрыты из tab bar.
import { Tabs } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { TabIcon } from "../../../src/components/TabIcon"
import { getBottomTabBarMetrics } from "../../../src/navigation/tab-bar"
import { colors } from "../../../src/theme"
import { t, useLocale } from "../../../src/i18n"
import { useField } from "../../../src/field/field-context"
import { TABLET_RAIL_WIDTH, useResponsiveLayout } from "../../../src/layout/responsive"

export default function TabsLayout() {
  useLocale() // ре-рендер подписей вкладок при смене языка в профиле
  const insets = useSafeAreaInsets()
  const { notifications, messages } = useField()
  const inboxUnread = notifications.unread + messages.unread
  const inboxBadge = inboxUnread > 99 ? "99+" : inboxUnread || undefined
  const tabBarMetrics = getBottomTabBarMetrics(insets.bottom)
  const layout = useResponsiveLayout()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarPosition: layout.isTablet ? "left" : "bottom",
        tabBarVariant: layout.isTablet ? "material" : "uikit",
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarActiveBackgroundColor: layout.isTablet ? colors.primarySoft : undefined,
        sceneStyle: layout.isTablet
          ? { width: "100%", maxWidth: layout.contentMaxWidth, alignSelf: "center" }
          : undefined,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: layout.isTablet ? "transparent" : colors.border,
          borderTopWidth: layout.isTablet ? 0 : 1,
          borderRightColor: layout.isTablet ? colors.border : "transparent",
          borderRightWidth: layout.isTablet ? 1 : 0,
          width: layout.isTablet ? TABLET_RAIL_WIDTH : undefined,
          height: layout.isTablet ? "100%" : tabBarMetrics.height,
          paddingTop: layout.isTablet ? Math.max(insets.top, 20) : 8,
          paddingBottom: layout.isTablet ? Math.max(insets.bottom, 16) : tabBarMetrics.paddingBottom,
          paddingHorizontal: layout.isTablet ? 8 : 0,
          elevation: 0,
        },
        tabBarItemStyle: layout.isTablet
          ? { minHeight: 74, maxHeight: 82, marginVertical: 4, borderRadius: 12, paddingVertical: 9 }
          : { paddingBottom: 2 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
        tabBarBadgeStyle: {
          backgroundColor: colors.danger,
          color: colors.headerText,
          fontSize: 11,
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
          title: t("tabCalendar"),
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
