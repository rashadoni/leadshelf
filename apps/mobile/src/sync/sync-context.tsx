// Провайдер синка: собирает движок из адаптеров, триггеры — старт,
// возврат в foreground, восстановление сети, ручной pull-to-refresh.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { AppState } from "react-native"
import NetInfo from "@react-native-community/netinfo"
import { router } from "expo-router"
import { SyncManager } from "./sync-manager"
import { nextBackoffMs } from "./backoff"
import type { SyncStatus } from "./ports"
import { syncApi } from "../api/mobile-client"
import { localStore } from "../db/local-store"

const Ctx = createContext<{ status: SyncStatus; sync: () => Promise<unknown> } | null>(null)

export function SyncProvider({ children }: { children: ReactNode }) {
  const manager = useMemo(
    () =>
      new SyncManager({
        api: syncApi,
        store: localStore,
        isOnline: async () => (await NetInfo.fetch()).isConnected ?? true,
      }),
    [],
  )
  const [status, setStatus] = useState<SyncStatus>(manager.getStatus())
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const consecutiveErrors = useRef(0)

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
      if (next.phase === "upgradeRequired") {
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
  }, [manager])

  return <Ctx.Provider value={{ status, sync: () => manager.runSync() }}>{children}</Ctx.Provider>
}

export function useSync() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useSync outside SyncProvider")
  return ctx
}
