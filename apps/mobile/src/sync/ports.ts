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
import type { FieldNotificationReadPushOperation } from "../field/notification-read-outbox"
import type {
  FieldDocumentUploadPushOperation,
  FieldExecutionPushOperation,
  FieldLocationPushOperation,
  FieldVisitPhotoPushOperation,
} from "../field/execution-outbox"

export type TaskRow = MobileTaskRow
export type StoreRow = MobileStoreRow
export type RouteRow = MobileRouteRow
export type RouteStopRow = MobileRouteStopRow
export type VisitRow = MobileVisitRow
export type PullResponse = MobileSyncPullResponse
export type PushOperation = MobilePushOperation | FieldRoutePushOperation | FieldNotificationReadPushOperation | FieldExecutionPushOperation | FieldVisitPhotoPushOperation | FieldLocationPushOperation | FieldDocumentUploadPushOperation
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
  markOutbox(clientOpId: string, status: OutboxRow["status"], detail?: unknown): Promise<void>
  bumpOutboxAttempts(clientOpIds: string[]): Promise<void>
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

export type SyncFailureStage =
  | "cursors"
  | "pull"
  | "apply"
  | "ack"
  | "upload"
  | "push"
  | "cleanup"
  | "network"
  | "http"
  | "response"
  | "contract"

/** Safe-to-log metadata for a handled sync failure. Never carries raw errors. */
export type SyncFailureDiagnostic = {
  operation: string
  stage: SyncFailureStage
  errorClass: "HTTP" | "NETWORK" | "CONTRACT" | "LOCAL"
  statusCode: number | null
  correlationId: string | null
}

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
  failure: SyncFailureDiagnostic | null
}
