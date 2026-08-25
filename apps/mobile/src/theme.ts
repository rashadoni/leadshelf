// LeadShelf mobile design system.
// Daylight-first field surfaces: one blue action colour, neutral navigation,
// and semantic status colours only when they carry an operational fact.
export const colors = {
  primary: "#2367F5",
  primaryPressed: "#174FC6",
  primarySoft: "#E8F0FF",
  navy: "#0C1F33",
  navyRaised: "#15324D",
  accent: "#42D3A7",
  headerText: "#FFFFFF",
  headerSubtext: "rgba(255,255,255,0.66)",
  bg: "#F3F6FA",
  card: "#FFFFFF",
  surfaceMuted: "#EEF3F8",
  cardOverlay: "rgba(255,255,255,0.94)",
  text: "#10263D",
  muted: "#53657A",
  faint: "#66788D",
  border: "#D7E0EA",
  borderStrong: "#C7D1DC",
  skeleton: "#E8EDF2",
  skeletonStrong: "#D9E1E8",
  disabled: "#B8C2CC",
  successBg: "#E9F8F2",
  successBorder: "#B8E8D7",
  success: "#168763",
  successDark: "#0C6549",
  danger: "#D94747",
  dangerPressed: "#B72F35",
  dangerBg: "#FFF0F0",
  dangerBorder: "#F3C8C8",
  warningBg: "#FFF5DF",
  warning: "#A56412",
  infoBg: "#EAF1FF",
  infoBorder: "#C5D7FF",
  info: "#245CC7",
  draftBg: "#F1F4F7",
  draftBorder: "#D6DEE6",
  draft: "#667789",
  missedBg: "#FFF0F0",
  missedBorder: "#F3C8C8",
  missed: "#B72F35",
  holidayBg: "#F2EFFA",
  holidayBorder: "#DAD1F0",
  holiday: "#65528F",
  tabInactive: "#8493A3",
} as const

export const radii = {
  card: 14,
  inner: 10,
  pill: 999,
} as const

export const spacing = {
  screen: 20,
  section: 24,
  card: 16,
  compact: 10,
} as const

export const cardShadow = {
  shadowColor: "#0C1F33",
  shadowOpacity: 0.045,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 1,
} as const
