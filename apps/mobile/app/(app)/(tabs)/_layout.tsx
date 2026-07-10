import { Tabs } from "expo-router"
import { Text } from "react-native"
import { t } from "../../../src/i18n"

// Нижняя таб-навигация. 7 разделов не влезают аккуратно на телефон, поэтому
// 5 основных вкладок + «Ещё» (İcmal / Sifarişlər / Profil — внутри «Ещё»,
// скрыты из бара через href:null, но остаются в навигаторе).
const ACTIVE = "#1c1917"
const INACTIVE = "#a8a29e"

function tabIcon(emoji: string) {
  return function Icon({ focused }: { focused: boolean }) {
    return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>
  }
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarStyle: {
          backgroundColor: "white",
          borderTopColor: "#eeece9",
          height: 62,
          paddingTop: 6,
          paddingBottom: 8,
        },
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen name="route" options={{ title: t("tabRoute"), tabBarIcon: tabIcon("🧭") }} />
      <Tabs.Screen name="visit" options={{ title: t("tabVisit"), tabBarIcon: tabIcon("✅") }} />
      <Tabs.Screen name="tasks" options={{ title: t("tabTasks"), tabBarIcon: tabIcon("📋") }} />
      <Tabs.Screen name="planograms" options={{ title: t("tabPlanograms"), tabBarIcon: tabIcon("🗄") }} />
      <Tabs.Screen name="more" options={{ title: t("tabMore"), tabBarIcon: tabIcon("☰") }} />
      {/* Скрыты из бара, доступны из «Ещё» */}
      <Tabs.Screen name="dashboard" options={{ href: null }} />
      <Tabs.Screen name="orders" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
    </Tabs>
  )
}
