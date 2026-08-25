import { router } from "expo-router"

/**
 * A cold authenticated deep link has no in-app history.  Keep header Back
 * useful in that case, while preserving the real previous screen for normal
 * navigation.
 */
export function safeFieldBack(fallback: string) {
  if (router.canGoBack()) {
    router.back()
    return
  }
  router.replace(fallback as never)
}
