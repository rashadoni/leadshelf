import { useWindowDimensions } from "react-native"

export const TABLET_MIN_WIDTH = 768
export const TABLET_MIN_SHORTEST_SIDE = 600
export const TABLET_CONTENT_MAX_WIDTH = 1180
export const TABLET_RAIL_WIDTH = 104

export type ResponsiveLayout = {
  width: number
  height: number
  isTablet: boolean
  isLandscape: boolean
  isTabletLandscape: boolean
  contentMaxWidth: number
  columns: 1 | 2
}

export function resolveResponsiveLayout(width: number, height: number): ResponsiveLayout {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 320
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 640
  const isLandscape = safeWidth > safeHeight
  // A phone can report 768+ logical pixels while rotated. The smaller side
  // distinguishes that case from a genuine touch tablet, so a phone never
  // receives the truncated tablet navigation rail in landscape.
  const isTablet = safeWidth >= TABLET_MIN_WIDTH && Math.min(safeWidth, safeHeight) >= TABLET_MIN_SHORTEST_SIDE

  return {
    width: safeWidth,
    height: safeHeight,
    isTablet,
    isLandscape,
    isTabletLandscape: isTablet && isLandscape,
    contentMaxWidth: TABLET_CONTENT_MAX_WIDTH,
    columns: isTablet ? 2 : 1,
  }
}

export function useResponsiveLayout(): ResponsiveLayout {
  const { width, height } = useWindowDimensions()
  return resolveResponsiveLayout(width, height)
}
