// Порты sync-движка. Sync-manager — чистый TS: НИКАКИХ импортов expo/*,
// все side-effects инжектятся (docs/19) — поэтому он тестируется в CI.

import type {
  MobilePushOperation,
  MobilePushResult,
  MobilePhotoUploadResponse,
  MobileRouteRow,
  MobileRouteStopRow,
  MobileStoreRow,
  MobileSyncPullResponse,
  MobileTaskRow,
  MobileVisitRow,
} from "@leadshelf/api-contracts/mobile/v1"

export type TaskRow = MobileTaskRow
export type StoreRow = MobileStoreRow
export type RouteRow = MobileRouteRow
export type RouteStopRow = MobileRouteStopRow
export type VisitRow = MobileVisitRow
export type PullResponse = MobileSyncPullResponse
export type PushOperation = MobilePushOperation
export type PushResult = MobilePushResult

export type SyncCursors = {
  tasks: string | null
  planogramBundles: string | null
  routes?: string | null
  visits?: string | null
  photoSubmissions?: string | null
}

/** Транспорт к замороженному mobile API (реализация: api/mobile-client). */
export interface SyncApi {
  pull(cursors: Partial<SyncCursors>): Promise<PullResponse>
  push(operations: PushOperation[]): Promise<{ results: PushResult[] }>
  ack(cursors: Partial<SyncCursors>): Promise<void>
  uploadPhoto(photo: {
    clientPhotoId: string
    taskId: string
    fileUri: string
    takenAt: string
    exifJson?: string | null
  }): Promise<MobilePhotoUploadResponse>
}

export type OutboxRow = PushOperation & {
  status: "pending" | "applied" | "conflict" | "rejected"
  attempts: number
}

export interface PhotoQueueRow {
  clientPhotoId: string
  taskId: string
  fileUri: string
  takenAt: string
  exifJson?: string | null
  uploaded: boolean
}

/** Локальное хранилище (реализация: db/local-store на expo-sqlite). */
export interface LocalStore {
  applyPull(data: PullResponse): Promise<void>
  getCursors(): Promise<SyncCursors>
  setCursors(c: SyncCursors): Promise<void>
  pendingOutbox(limit?: number): Promise<OutboxRow[]>
  markOutbox(clientOpId: string, status: OutboxRow["status"], detail?: unknown): Promise<void>
  bumpOutboxAttempts(clientOpIds: string[]): Promise<void>
  pendingPhotos(): Promise<PhotoQueueRow[]>
  markPhotoUploaded(clientPhotoId: string, result: MobilePhotoUploadResponse): Promise<void>
}

export type SyncPhase =
  | "idle"
  | "pulling"
  | "acking"
  | "uploadingPhotos"
  | "pushing"
  | "error"
  | "offline"
  | "upgradeRequired"

export interface SyncStatus {
  phase: SyncPhase
  lastSyncAt: string | null
  pendingOps: number
  pendingPhotos: number
  error: string | null
}
