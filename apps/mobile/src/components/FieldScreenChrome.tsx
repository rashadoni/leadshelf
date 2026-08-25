import { StatusBar } from "react-native"
import { colors } from "../theme"

/**
 * Keeps Android's system chrome legible when Field moves between its light
 * daylight workspace and the few deliberate dark operational headers.
 *
 * Screen-level ownership matters here: a global light theme alone leaves the
 * status bar white after navigating from a dark surface into a light one.
 */
export function FieldScreenChrome({ tone = "light" }: { tone?: "light" | "dark" }) {
  const dark = tone === "dark"
  return (
    <StatusBar
      barStyle={dark ? "light-content" : "dark-content"}
      backgroundColor={dark ? colors.navy : colors.bg}
      translucent={false}
    />
  )
}
