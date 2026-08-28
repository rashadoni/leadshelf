// Порты sync-движка. Sync-manager — чистый TS: НИКАКИХ импортов expo/*,
// все side-effects инжектятся (docs/19) — поэтому он тестируется в CI.

import type {
  MobilePushOperation,
  MobilePushResult,
  MobileCommercialMediaPurpose,
  MobileCommercialMediaUploadResponse,
  MobilePhotoUploadResponse,
  MobileRouteRow,
  MobileRouteStopRow,
  MobileStoreRow,
  MobileSyncPullResponse,
  MobileTaskRow,
  MobileVisitRow,
} from "@leadshelf/api-contracts/mobile/v1"
import type { FieldRoutePushOperation } from "../field/route-outbox"
import type {
  FieldDocumentUploadPushOperation,
  FieldExecutionPushOperation,
  FieldExecutionPushResult,
  FieldLocationPushOperation,
  FieldVisitPhotoPushOperation,
} from "../field/execution-outbox"

export type TaskRow = MobileTaskRow
export type StoreRow = MobileStoreRow
export type RouteRow = MobileRouteRow
export type RouteStopRow = MobileRouteStopRow
export type VisitRow = MobileVisitRow
export type PullResponse = MobileSyncPullResponse
export type PushOperation = MobilePushOperation | FieldRoutePushOperation | FieldExecutionPushOperation | FieldVisitPhotoPushOperation | FieldLocationPushOperation | FieldDocumentUploadPushOperation
export type PushResult = MobilePushResult

/**
 * Independent outbox lanes.  Workforce must never be selected by the shared
 * Shelf/route pipeline: that pipeline starts with a Shelf pull and can be
 * unavailable while time events still need delivery.
 */
export type OutboxPipeline = "all" | "workforce" | "non-workforce"

export type WorkforcePushOperation = Extract<
  FieldExecutionPushOperation,
  { kind: "field.workday.event" | "field.hrm.create" | "field.hrm.cancel" }
>

export interface WorkforceSyncApi {
  push(operations: WorkforcePushOperation[]): Promise<FieldExecutionPushResult[]>
}

/** Persisted only on-device; `cursor` is server-authoritative when supplied by bootstrap. */
export interface WorkforceStreamState {
  cursor: string | null
  configVersion: string | null
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
}

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
    mediaType?: "photo" | "video"
    durationMs?: number | null
    captureStepJson?: string | null
    exifJson?: string | null
    captureFlagsJson?: string | null
    captureTelemetryJson?: string | null
  }): Promise<MobilePhotoUploadResponse>
  uploadCommercialMedia(media: CommercialMediaQueueRow): Promise<MobileCommercialMediaUploadResponse>
  cleanupCommercialMedia(media: CommercialMediaQueueRow): Promise<void>
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
  mediaType?: "photo" | "video"
  durationMs?: number | null
  captureStepJson?: string | null
  exifJson?: string | null
  captureFlagsJson?: string | null
  captureTelemetryJson?: string | null
  attempts?: number
  uploaded: boolean
}

export interface CommercialMediaQueueRow {
  clientMediaId: string
  clientOpId: string
  purpose: MobileCommercialMediaPurpose
  fileUri: string
  takenAt: string
  attempts: number
  uploaded: boolean
}

/** Локальное хранилище (реализация: db/local-store на expo-sqlite). */
export interface LocalStore {
  applyPull(data: PullResponse): Promise<void>
  getCursors(): Promise<SyncCursors>
  setCursors(c: SyncCursors): Promise<void>
  pendingOutbox(limit?: number): Promise<OutboxRow[]>
  outboxDiagnostics(): Promise<OutboxDiagnostics>
  /** Optional while old in-memory test stores and pre-H4 adapters coexist. */
  pendingOutboxForPipeline?(pipeline: OutboxPipeline, limit?: number): Promise<OutboxRow[]>
  outboxDiagnosticsForPipeline?(pipeline: OutboxPipeline): Promise<OutboxDiagnostics>
  markOutbox(clientOpId: string, status: OutboxRow["status"], detail?: unknown): Promise<void>
  bumpOutboxAttempts(clientOpIds: string[]): Promise<void>
  getWorkforceStreamState?(): Promise<WorkforceStreamState>
  recordWorkforceSyncAttempt?(at: string): Promise<void>
  recordWorkforceSyncSuccess?(at: string): Promise<void>
  recordWorkforceSyncFailure?(at: string, error: string): Promise<void>
  pendingPhotos(): Promise<PhotoQueueRow[]>
  unuploadedPhotoIds(): Promise<string[]>
  markPhotoUploaded(clientPhotoId: string, result: MobilePhotoUploadResponse): Promise<void>
  bumpPhotoAttempts(clientPhotoIds: string[], reason?: string): Promise<void>
  quarantinePhoto(clientPhotoId: string, reason: string): Promise<void>
  quarantinedPhotoCount(): Promise<number>
  cleanupUploadedPhotoFiles?(): Promise<number>
  pendingCommercialMedia(): Promise<CommercialMediaQueueRow[]>
  markCommercialMediaUploaded(
    clientMediaId: string,
    result: MobileCommercialMediaUploadResponse,
  ): Promise<void>
  bumpCommercialMediaAttempts(clientMediaIds: string[], reason?: string): Promise<void>
  quarantineCommercialMedia(clientMediaId: string, reason: string): Promise<void>
}

export interface OutboxDiagnostics {
  pendingOps: number
  conflictOps: number
  rejectedOps: number
  oldestPendingAt: string | null
}

export type SyncPhase =
  | "idle"
  | "pulling"
  | "acking"
  | "uploadingPhotos"
  | "pushing"
  | "error"
  | "offline"
  | "authLost"
  | "upgradeRequired"

export interface SyncStatus {
  phase: SyncPhase
  lastSyncAt: string | null
  pendingOps: number
  pendingPhotos: number
  quarantinedPhotos: number
  conflictOps: number
  rejectedOps: number
  oldestPendingAgeMs: number | null
  lastDurationMs: number | null
  error: string | null
}
