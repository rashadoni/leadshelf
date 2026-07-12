const TAB_BAR_CONTENT_HEIGHT = 62
const TAB_BAR_CONTENT_BOTTOM_PADDING = 8

export function getBottomTabBarMetrics(bottomInset: number) {
  const safeBottomInset = Math.max(0, bottomInset)

  return {
    height: TAB_BAR_CONTENT_HEIGHT + safeBottomInset,
    paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + safeBottomInset,
  }
}
