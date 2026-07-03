// Провайдер синка: собирает движок из адаптеров, триггеры — старт,
// возврат в foreground, восстановление сети, ручной pull-to-refresh.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { AppState } from "react-native"
import NetInfo from "@react-native-community/netinfo"
import { router } from "expo-router"
import { SyncManager } from "./sync-manager"
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

  useEffect(() => {
    const unsub = manager.subscribe((next) => {
      setStatus(next)
      if (next.phase === "upgradeRequired") {
        router.replace("/upgrade-required" as never)
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
    }
  }, [manager])

  return <Ctx.Provider value={{ status, sync: () => manager.runSync() }}>{children}</Ctx.Provider>
}

export function useSync() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useSync outside SyncProvider")
  return ctx
}
