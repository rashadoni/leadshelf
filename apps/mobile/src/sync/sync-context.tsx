// Провайдер синка: собирает движок из адаптеров, триггеры — старт,
// возврат в foreground, восстановление сети, ручной pull-to-refresh.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { AppState } from "react-native"
import NetInfo from "@react-native-community/netinfo"
import { router } from "expo-router"
import { SyncManager } from "./sync-manager"
import { nextBackoffMs } from "./backoff"
import type { SyncStatus } from "./ports"
import { syncApi } from "../api/mobile-client"
import { localStore } from "../db/local-store"
import { purgeLocalOperationalData } from "../db/local-store"
import { tokenStore } from "../auth/token-store"
import { wipeRevokedSession } from "../auth/revocation-wipe"
import { stopWorkdayTracking } from "../location/workday-tracking"
import { deleteAllEncryptedMedia } from "../media/encrypted-media-store"
import { reportHandledSyncFailure } from "../observability"

const Ctx = createContext<{
  status: SyncStatus
  sync: () => Promise<unknown>
  endSession: () => Promise<void>
} | null>(null)

export function SyncProvider({ children }: { children: ReactNode }) {
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const consecutiveErrors = useRef(0)
  const revocationWipe = useRef<Promise<void> | null>(null)
  const endSession = useCallback(async () => {
    revocationWipe.current ??= wipeRevokedSession({
      deleteMedia: async () => {
        await stopWorkdayTracking().catch(() => {})
        await deleteAllEncryptedMedia()
      },
      purgeOperationalData: () => purgeLocalOperationalData(),
      clearSession: () => tokenStore.clearSession(),
    }).then(() => {
      router.replace("/(auth)/login" as never)
    })
    await revocationWipe.current
  }, [])
  const manager = useMemo(
    () =>
      new SyncManager({
        api: syncApi,
        store: localStore,
        isOnline: async () => (await NetInfo.fetch()).isConnected ?? true,
        reportFailure: reportHandledSyncFailure,
      }),
    [],
  )
  const [status, setStatus] = useState<SyncStatus>(manager.getStatus())

  useEffect(() => {
    const clearRetry = () => {
      if (retryTimer.current) {
        clearTimeout(retryTimer.current)
        retryTimer.current = null
      }
    }
    const unsub = manager.subscribe((next) => {
      setStatus(next)
      // Backoff-ретрай только после реальной ошибки; успех/offline/upgrade
      // отменяют его (offline восстановится по NetInfo, docs/26 §2).
      if (next.phase === "authLost") {
        clearRetry()
        void endSession()
      } else if (next.phase === "upgradeRequired") {
        clearRetry()
        router.replace("/upgrade-required" as never)
      } else if (next.phase === "error") {
        consecutiveErrors.current += 1
        clearRetry()
        retryTimer.current = setTimeout(() => void manager.runSync(), nextBackoffMs(consecutiveErrors.current))
      } else if (next.phase === "idle") {
        consecutiveErrors.current = 0
        clearRetry()
      } else if (next.phase === "offline") {
        clearRetry()
      }
    })
    void manager.runSync()
    const appSub = AppState.addEventListener("change", (s) => {
      if (s === "active") void manager.runSync()
    })
    const netSub = NetInfo.addEventListener((s) => {
      if (s.isConnected) void manager.runSync()
    })
    return () => {
      unsub()
      appSub.remove()
      netSub()
      clearRetry()
    }
  }, [endSession, manager])

  return <Ctx.Provider value={{ status, sync: () => manager.runSync(), endSession }}>{children}</Ctx.Provider>
}

export function useSync() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useSync outside SyncProvider")
  return ctx
}
