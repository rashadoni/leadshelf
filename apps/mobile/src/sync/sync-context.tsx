// Sync provider: LeadShelf keeps one frozen combined pipeline. LeadDrive Field
// splits the independent Workforce outbox from the Shelf/route pipeline so a
// Shelf pull failure cannot hold up durable work-time delivery.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { AppState } from "react-native"
import NetInfo from "@react-native-community/netinfo"
import { router } from "expo-router"
import { SyncManager } from "./sync-manager"
import {
  WorkforceSyncManager,
  combineSyncStatuses,
  emptyWorkforceSyncStatus,
} from "./workforce-sync-manager"
import { nextBackoffMs } from "./backoff"
import type { SyncStatus } from "./ports"
import { syncApi, workforceSyncApi } from "../api/mobile-client"
import { localStore, purgeLocalOperationalData } from "../db/local-store"
import { tokenStore } from "../auth/token-store"
import { wipeRevokedSession } from "../auth/revocation-wipe"
import { stopWorkdayTracking } from "../location/workday-tracking"
import { deleteAllEncryptedMedia } from "../media/encrypted-media-store"
import { useField } from "../field/field-context"
import { IS_LEADDRIVE_FIELD } from "../config/mobile-variant"

type SyncContextValue = {
  /** Aggregate for pre-H4 consumers; use per-lane states for recovery detail. */
  status: SyncStatus
  sharedStatus: SyncStatus
  workforceStatus: SyncStatus
  sync: () => Promise<SyncStatus>
  syncWorkforce: () => Promise<SyncStatus>
}

const Ctx = createContext<SyncContextValue | null>(null)

export function SyncProvider({ children }: { children: ReactNode }) {
  const field = useField()
  const sharedManager = useMemo(
    () => new SyncManager({
      api: syncApi,
      store: localStore,
      isOnline: async () => (await NetInfo.fetch()).isConnected ?? true,
      // LeadDrive must never let the Shelf manager select Workforce rows,
      // including rows left durable after a capability is later disabled.
      outboxPipeline: IS_LEADDRIVE_FIELD ? "non-workforce" : "all",
    }),
    [],
  )
  const workforceManager = useMemo(
    () => new WorkforceSyncManager({
      api: workforceSyncApi,
      store: localStore,
      isOnline: async () => (await NetInfo.fetch()).isConnected ?? true,
    }),
    [],
  )
  const [sharedStatus, setSharedStatus] = useState<SyncStatus>(sharedManager.getStatus())
  const [workforceStatus, setWorkforceStatus] = useState<SyncStatus>(workforceManager.getStatus())
  const sharedRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const workforceRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sharedConsecutiveErrors = useRef(0)
  const workforceConsecutiveErrors = useRef(0)
  const revocationWipe = useRef<Promise<void> | null>(null)

  // Direct LeadShelf remains exactly on its legacy combined pipeline. In
  // LeadDrive the validated manifest decides whether each lane may start.
  const sharedRouteSyncEnabled = !IS_LEADDRIVE_FIELD || field.routesEnabled
  const workforceSyncEnabled = IS_LEADDRIVE_FIELD && field.workforceEnabled
  const status = useMemo(() => combineSyncStatuses([
    ...(sharedRouteSyncEnabled ? [sharedStatus] : []),
    ...(workforceSyncEnabled ? [workforceStatus] : []),
  ]), [sharedRouteSyncEnabled, sharedStatus, workforceSyncEnabled, workforceStatus])

  const handleTerminalStatus = useCallback((next: SyncStatus) => {
    if (next.phase === "authLost") {
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
    } else if (next.phase === "upgradeRequired") {
      router.replace("/upgrade-required" as never)
    }
  }, [])

  const sync = useCallback(async (): Promise<SyncStatus> => {
    const runs: Array<Promise<SyncStatus>> = []
    if (sharedRouteSyncEnabled) runs.push(sharedManager.runSync())
    if (workforceSyncEnabled) runs.push(workforceManager.runSync())
    return combineSyncStatuses(await Promise.all(runs))
  }, [sharedManager, sharedRouteSyncEnabled, workforceManager, workforceSyncEnabled])

  const syncWorkforce = useCallback((): Promise<SyncStatus> => (
    workforceSyncEnabled
      ? workforceManager.runSync()
      : Promise.resolve(emptyWorkforceSyncStatus())
  ), [workforceManager, workforceSyncEnabled])

  useEffect(() => {
    if (!sharedRouteSyncEnabled) {
      setSharedStatus(emptyWorkforceSyncStatus())
      return
    }
    const clearRetry = () => {
      if (sharedRetryTimer.current) {
        clearTimeout(sharedRetryTimer.current)
        sharedRetryTimer.current = null
      }
    }
    const unsubscribe = sharedManager.subscribe((next) => {
      setSharedStatus(next)
      handleTerminalStatus(next)
      if (next.phase === "authLost" || next.phase === "upgradeRequired" || next.phase === "offline") {
        clearRetry()
      } else if (next.phase === "error") {
        sharedConsecutiveErrors.current += 1
        clearRetry()
        sharedRetryTimer.current = setTimeout(
          () => void sharedManager.runSync(),
          nextBackoffMs(sharedConsecutiveErrors.current),
        )
      } else if (next.phase === "idle") {
        sharedConsecutiveErrors.current = 0
        clearRetry()
      }
    })
    void sharedManager.runSync()
    const appSub = AppState.addEventListener("change", (next) => {
      if (next === "active") void sharedManager.runSync()
    })
    const netSub = NetInfo.addEventListener((next) => {
      if (next.isConnected) void sharedManager.runSync()
    })
    return () => {
      unsubscribe()
      appSub.remove()
      netSub()
      clearRetry()
    }
  }, [handleTerminalStatus, sharedManager, sharedRouteSyncEnabled])

  useEffect(() => {
    if (!workforceSyncEnabled) {
      setWorkforceStatus(emptyWorkforceSyncStatus())
      return
    }
    const clearRetry = () => {
      if (workforceRetryTimer.current) {
        clearTimeout(workforceRetryTimer.current)
        workforceRetryTimer.current = null
      }
    }
    const unsubscribe = workforceManager.subscribe((next) => {
      setWorkforceStatus(next)
      handleTerminalStatus(next)
      if (next.phase === "authLost" || next.phase === "upgradeRequired" || next.phase === "offline") {
        clearRetry()
      } else if (next.phase === "error") {
        workforceConsecutiveErrors.current += 1
        clearRetry()
        workforceRetryTimer.current = setTimeout(
          () => void workforceManager.runSync(),
          nextBackoffMs(workforceConsecutiveErrors.current),
        )
      } else if (next.phase === "idle") {
        workforceConsecutiveErrors.current = 0
        clearRetry()
      }
    })
    void workforceManager.runSync()
    const appSub = AppState.addEventListener("change", (next) => {
      if (next === "active") void workforceManager.runSync()
    })
    const netSub = NetInfo.addEventListener((next) => {
      if (next.isConnected) void workforceManager.runSync()
    })
    return () => {
      unsubscribe()
      appSub.remove()
      netSub()
      clearRetry()
    }
  }, [handleTerminalStatus, workforceManager, workforceSyncEnabled])

  return (
    <Ctx.Provider value={{ status, sharedStatus, workforceStatus, sync, syncWorkforce }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSync() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useSync outside SyncProvider")
  return ctx
}
