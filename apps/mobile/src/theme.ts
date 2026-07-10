// Палитра мобильного приложения (редизайн по образцу владельца):
// индиго-хедер, тёплый светлый фон, зелёный статус визита, красное действие завершения.
export const colors = {
  primary: "#6366F1",
  primaryPressed: "#4F46E5",
  headerText: "#FFFFFF",
  headerSubtext: "rgba(255,255,255,0.78)",
  bg: "#F4F4F6",
  card: "#FFFFFF",
  text: "#171717",
  muted: "#737373",
  faint: "#A3A3A3",
  border: "#ECECEF",
  successBg: "#E9F8EF",
  successBorder: "#BBE8CC",
  success: "#16A34A",
  successDark: "#166534",
  danger: "#EF4444",
  dangerPressed: "#DC2626",
  warning: "#B45309",
  tabInactive: "#9CA3AF",
} as const

export const radii = {
  card: 18,
  inner: 12,
  pill: 999,
} as const

export const cardShadow = {
  shadowColor: "#101828",
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const
