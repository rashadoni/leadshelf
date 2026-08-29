import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { router, useFocusEffect } from "expo-router"
import * as Crypto from "expo-crypto"
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
  type BarcodeType,
} from "expo-camera"
import Svg, { Circle, Path } from "react-native-svg"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  enqueueFieldLocation,
  enqueueFieldWorkdayEvent,
  fieldOutboxResult,
  newFieldWorkdayClientOperationId,
  readFieldCache,
} from "../../src/db/local-store"
import type {
  FieldLocationHistoryData,
  FieldWorkdayAction,
  FieldWorkdayData,
  FieldWorkdayStatus,
} from "../../src/field/contracts"
import { fieldApi } from "../../src/api/mobile-client"
import {
  tokenStore,
  type WorkforceAttendanceActivePointer,
  type WorkforceAttendanceEnrollmentPointer,
} from "../../src/auth/token-store"
import { useField } from "../../src/field/field-context"
import { parseFieldEphemeralWorkdayEventPayload } from "../../src/field/execution-outbox"
import {
  FieldAttendanceContractError,
  fieldAttendanceRequirementsForAction,
  workforceDeviceAttendanceChallenge,
  workforceDeviceEnrollmentChallenge,
  type FieldAttendanceRequirements,
  type FieldDeviceAttendanceEvidence,
} from "../../src/field/workforce-attendance"
import {
  appendOptimisticFieldLocation,
  applyOptimisticWorkdayAction,
  emptyFieldWorkdayData,
} from "../../src/field/workday-state"
import {
  lockWorkdayActionsUntilRefresh,
  workdayRecoveryDetail,
} from "../../src/field/workday-recovery"
import { t, type MessageKey, useLocale } from "../../src/i18n"
import { formatTime } from "../../src/i18n/date-format"
import { getCurrentDeviceLocation } from "../../src/location/device-location"
import { workdayLocationPayload } from "../../src/location/workday-location"
import {
  reconcileWorkdayTracking,
  startWorkdayTracking,
  stoppedWorkdayTrackingState,
  stopWorkdayTracking,
  type WorkdayTrackingIssue,
  type WorkdayTrackingRecovery,
  type WorkdayTrackingState,
} from "../../src/location/workday-tracking"
import { useSync } from "../../src/sync/sync-context"
import { colors, cardShadow, radii } from "../../src/theme"
import { workforceAttendanceTrust } from "../../modules/workforce-attendance-trust"

type DisplayStatus = FieldWorkdayStatus | "NOT_STARTED"

const statusKeys: Record<DisplayStatus, MessageKey> = {
  NOT_STARTED: "workdayStatus_NOT_STARTED",
  STARTED: "workdayStatus_STARTED",
  PAUSED: "workdayStatus_PAUSED",
  COMPLETED: "workdayStatus_COMPLETED",
}

const actionKeys: Record<FieldWorkdayAction, MessageKey> = {
  START: "workdayStart",
  PAUSE: "workdayPause",
  RESUME: "workdayResume",
  FINISH: "workdayFinish",
}

const eventKeys: Record<FieldWorkdayAction, MessageKey> = {
  START: "workdayEvent_START",
  PAUSE: "workdayEvent_PAUSE",
  RESUME: "workdayEvent_RESUME",
  FINISH: "workdayEvent_FINISH",
}

const QR_BARCODE_TYPES: BarcodeType[] = ["qr"]

type QrScanSession = { action: FieldWorkdayAction; session: number }
type WorkforceAttendanceScope = { organizationId: string; agentId: string }

function workforceAttendanceTrustErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null
  const code = (error as { code?: unknown }).code
  return typeof code === "string" ? code : null
}

function workdayConflictMessage(detail: unknown): string {
  const recovery = workdayRecoveryDetail(detail)
  if (!recovery.serverStatus) return t("workdayActionConflict")
  const actions = recovery.allowedActions === null
    ? t("workdayActionConflictActionsUnknown")
    : recovery.allowedActions.length === 0
      ? t("workdayActionConflictNoActions")
      : recovery.allowedActions.map((action) => t(actionKeys[action])).join(", ")
  return t("workdayActionConflictState", {
    status: t(statusKeys[recovery.serverStatus]),
    actions,
  })
}

const trackingKeys: Record<WorkdayTrackingState["mode"], MessageKey> = {
  background: "workdayTracking_background",
  foreground: "workdayTracking_foreground",
  denied: "workdayTracking_denied",
  services_disabled: "workdayTracking_servicesDisabled",
  unavailable: "workdayTracking_unavailable",
  stopped: "workdayTracking_stopped",
}

const trackingIssueHintKeys: Record<WorkdayTrackingIssue, MessageKey | null> = {
  none: null,
  services_disabled: "workdayTrackingHintServicesDisabled",
  foreground_permission_required: "workdayTrackingHintForegroundPermission",
  foreground_permission_blocked: "workdayTrackingHintForegroundBlocked",
  background_permission_required: "workdayTrackingHintBackgroundPermission",
  background_permission_blocked: "workdayTrackingHintBackgroundBlocked",
  background_unavailable: "workdayTrackingHintBackgroundUnavailable",
  tracking_start_failed: "workdayTrackingHintUnavailable",
}

const trackingRecoveryKeys: Record<Exclude<WorkdayTrackingRecovery, "none">, MessageKey> = {
  request_permission: "workdayTrackingRequestPermission",
  open_settings: "workdayTrackingOpenSettings",
  retry_tracking: "workdayTrackingRetry",
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":")
}

function currentWorkedSeconds(
  workday: ReturnType<typeof emptyFieldWorkdayData>["workday"],
  nowMs: number,
): number {
  if (!workday) return 0
  if (workday.status !== "STARTED") return workday.workedSeconds
  const startedAt = new Date(workday.startedAt).getTime()
  if (!Number.isFinite(startedAt)) return workday.workedSeconds
  return Math.max(
    workday.workedSeconds,
    Math.floor((nowMs - startedAt) / 1_000) - workday.totalPausedSeconds,
  )
}

function currentPausedSeconds(
  workday: ReturnType<typeof emptyFieldWorkdayData>["workday"],
  nowMs: number,
): number {
  if (!workday) return 0
  if (workday.status !== "PAUSED" || !workday.pausedAt) return workday.totalPausedSeconds
  const pausedAt = new Date(workday.pausedAt).getTime()
  return workday.totalPausedSeconds + (
    Number.isFinite(pausedAt) ? Math.max(0, Math.floor((nowMs - pausedAt) / 1_000)) : 0
  )
}

function formatDistance(meters: number): string {
  return meters >= 1_000 ? `${(meters / 1_000).toFixed(1)} km` : `${Math.round(meters)} m`
}

function LocationTrail({ data }: { data: FieldLocationHistoryData }) {
  const points = useMemo(() => {
    const source = data.locations.slice(-120)
    if (source.length === 0) return []
    const latitudes = source.map((point) => point.latitude)
    const longitudes = source.map((point) => point.longitude)
    const minLat = Math.min(...latitudes)
    const maxLat = Math.max(...latitudes)
    const minLng = Math.min(...longitudes)
    const maxLng = Math.max(...longitudes)
    const latRange = Math.max(maxLat - minLat, 0.0001)
    const lngRange = Math.max(maxLng - minLng, 0.0001)
    return source.map((point) => ({
      ...point,
      x: 18 + ((point.longitude - minLng) / lngRange) * 284,
      y: 122 - ((point.latitude - minLat) / latRange) * 104,
    }))
  }, [data.locations])

  if (points.length === 0) {
    return (
      <View style={styles.emptyTrail}>
        <View style={styles.emptyTrailPin}><Text style={styles.emptyTrailPinText}>⌖</Text></View>
        <Text style={styles.emptyTrailText}>{t("workdayNoLocations")}</Text>
      </View>
    )
  }

  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ")
  const first = points[0]!
  const last = points.at(-1)!
  return (
    <View style={styles.trailCanvas}>
      <Svg width="100%" height={140} viewBox="0 0 320 140" accessibilityLabel={t("workdayLocationTrail")}>
        <Path d={path} stroke={colors.primary} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.82} />
        <Circle cx={first.x} cy={first.y} r={7} fill={colors.card} stroke={colors.primary} strokeWidth={3} />
        <Circle cx={last.x} cy={last.y} r={8} fill={colors.success} stroke={colors.card} strokeWidth={3} />
      </Svg>
      <View style={styles.trailLegend}>
        <Text style={styles.trailLegendText}>{t("workdayGpsPoints", { count: data.locations.length })}</Text>
        <Text style={styles.trailLegendText}>{t("workdayLastPoint")}: {formatTime(last.recordedAt)}</Text>
      </View>
    </View>
  )
}

export default function WorkdayScreen() {
  useLocale()
  const field = useField()
  const { syncWorkforce, workforceStatus } = useSync()
  const workforceEnabled = field.workforceEnabled
  const routesEnabled = field.routesEnabled
  const [busyAction, setBusyAction] = useState<FieldWorkdayAction | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [tracking, setTracking] = useState<WorkdayTrackingState>(() => stoppedWorkdayTrackingState())
  const [trackingBusy, setTrackingBusy] = useState(false)
  const [feedback, setFeedback] = useState<MessageKey | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  /** Only the action/session is stateful. A raw QR stays handler-local. */
  const [qrScanAction, setQrScanAction] = useState<QrScanSession | null>(null)
  const qrScanConsumed = useRef(false)
  const qrScanSession = useRef(0)
  const activeQrScanSession = useRef<number | null>(null)

  const date = field.workday?.date ?? field.profile?.todaySummary.date ?? field.week?.today ?? new Date().toISOString().slice(0, 10)
  const timezone = field.workday?.timezone ?? field.profile?.todaySummary.timezone ?? field.week?.timezone ?? field.bootstrap?.timezone ?? "UTC"
  const intervalSeconds = field.workday?.gpsIntervalSeconds ?? field.locations?.gpsIntervalSeconds ?? 30
  const workdayData = field.workday ?? emptyFieldWorkdayData(date, timezone, intervalSeconds)
  const locationData = field.locations?.date === date
    ? field.locations
    : { date, timezone, gpsIntervalSeconds: intervalSeconds, distanceMeters: 0, locations: [] }
  const workday = workdayData.workday
  const displayStatus: DisplayStatus = workday?.status ?? "NOT_STARTED"
  const workedSeconds = currentWorkedSeconds(workday, nowMs)
  const pausedSeconds = currentPausedSeconds(workday, nowMs)
  const attendanceManifest = field.bootstrap?.modules.workforce.attendance

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  useFocusEffect(useCallback(() => {
    if (workforceEnabled) void field.refreshActivity()
  }, [field.refreshActivity, workforceEnabled]))

  const refreshTracking = useCallback(async () => {
    if (!routesEnabled || !workforceEnabled) {
      setTracking(stoppedWorkdayTrackingState())
      return
    }
    const state = await reconcileWorkdayTracking(workday?.status ?? null, intervalSeconds)
      .catch((): WorkdayTrackingState => ({
        mode: "unavailable",
        issue: "tracking_start_failed",
        recovery: "retry_tracking",
        observedAt: new Date().toISOString(),
      }))
    setTracking(state)
  }, [intervalSeconds, routesEnabled, workforceEnabled, workday?.status])

  useEffect(() => {
    if (!routesEnabled || !workforceEnabled) {
      void stopWorkdayTracking().catch(() => {})
      setTracking(stoppedWorkdayTrackingState())
      return
    }
    if (busyAction) return
    let active = true
    void reconcileWorkdayTracking(workday?.status ?? null, intervalSeconds)
      .then((state) => { if (active) setTracking(state) })
      .catch(() => {
        if (active) setTracking({
          mode: "unavailable",
          issue: "tracking_start_failed",
          recovery: "retry_tracking",
          observedAt: new Date().toISOString(),
        })
      })
    return () => { active = false }
  }, [busyAction, intervalSeconds, routesEnabled, workforceEnabled, workday?.status])

  useEffect(() => {
    if (!routesEnabled || !workforceEnabled) return
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && !busyAction && !trackingBusy) void refreshTracking()
    })
    return () => subscription.remove()
  }, [busyAction, refreshTracking, routesEnabled, trackingBusy, workforceEnabled])

  async function refresh() {
    setRefreshing(true)
    try {
      await syncWorkforce()
      await field.refreshActivity()
    } finally {
      setRefreshing(false)
    }
  }

  function attendanceRequirements(action: FieldWorkdayAction): FieldAttendanceRequirements | null {
    try {
      return fieldAttendanceRequirementsForAction(attendanceManifest, action)
    } catch (error) {
      if (!(error instanceof FieldAttendanceContractError)) throw error
      return null
    }
  }

  function showAttendanceAlert(message: MessageKey) {
    Alert.alert(t("workdayAttendancePolicyBlockedTitle"), t(message))
  }

  async function openQrScanner(action: FieldWorkdayAction) {
    try {
      const permission = cameraPermission?.granted
        ? cameraPermission
        : await requestCameraPermission()
      if (!permission.granted) {
        showAttendanceAlert("workdayAttendanceVerificationFailed")
        return
      }
      const session = qrScanSession.current + 1
      qrScanSession.current = session
      qrScanConsumed.current = false
      activeQrScanSession.current = session
      setQrScanAction({ action, session })
    } catch {
      showAttendanceAlert("workdayAttendanceVerificationFailed")
    }
  }

  function closeQrScanner() {
    // Invalidate before unmounting. Camera callbacks can arrive after the
    // user cancels, including one retained by a prior scanner session.
    activeQrScanSession.current = null
    qrScanConsumed.current = true
    setQrScanAction(null)
  }

  function handleQrScanned(result: BarcodeScanningResult) {
    if (
      qrScanConsumed.current ||
      !qrScanAction ||
      activeQrScanSession.current !== qrScanAction.session
    ) return
    // This raw token is intentionally handler-local: no state, ref, cache,
    // log, error text or durable outbox record may retain it.
    const action = qrScanAction.action
    const qrToken = result.data.trim()
    qrScanConsumed.current = true
    activeQrScanSession.current = null
    setQrScanAction(null)
    if (!qrToken || qrToken.length > 4_096) {
      showAttendanceAlert("workdayAttendanceVerificationFailed")
      return
    }
    void applyAction(action, qrToken)
  }

  async function clearAttendanceEnrollment(pointer: WorkforceAttendanceEnrollmentPointer): Promise<void> {
    await tokenStore.setWorkforceAttendanceEnrollment(null)
    await workforceAttendanceTrust.removeEnrollmentKey(pointer.keyAlias).catch(() => {})
  }

  async function createAttendanceEnrollmentPointer(input: {
    scope: WorkforceAttendanceScope
    biometricRequired: boolean
    replacesEnrollmentId?: string
  }): Promise<WorkforceAttendanceEnrollmentPointer> {
    const keyAlias = `workforce-attendance-${Crypto.randomUUID()}`
    const key = await workforceAttendanceTrust.createEnrollmentKey(keyAlias, input.biometricRequired)
    if (key.biometricBound !== input.biometricRequired) {
      await workforceAttendanceTrust.removeEnrollmentKey(keyAlias).catch(() => {})
      throw new Error("Attendance enrollment key protection mismatch")
    }
    const pointer: WorkforceAttendanceEnrollmentPointer = {
      ...input.scope,
      keyAlias,
      biometricBound: key.biometricBound,
      status: "STARTING",
      ...(input.replacesEnrollmentId ? { replacesEnrollmentId: input.replacesEnrollmentId } : {}),
    }
    // Persist before the first request. If its response or a subsequent proof
    // response is lost, we can safely obtain the same public key again and ask
    // the server to resume/rechallenge rather than losing the only private key.
    await tokenStore.setWorkforceAttendanceEnrollment(pointer)
    return pointer
  }

  async function beginAndProveAttendanceEnrollment(input: {
    scope: WorkforceAttendanceScope
    pointer: WorkforceAttendanceEnrollmentPointer
    biometricRequired: boolean
  }): Promise<void> {
    const publicKeySpki = await workforceAttendanceTrust.getEnrollmentPublicKeySpki(input.pointer.keyAlias)
    const enrollment = await fieldApi.beginAttendanceDeviceEnrollment({
      deviceLabel: "Android Field",
      publicKeySpki,
      ...(input.pointer.status === "STARTING" && input.pointer.replacesEnrollmentId
        ? { replacesEnrollmentId: input.pointer.replacesEnrollmentId }
        : {}),
    })
    const proving: WorkforceAttendanceEnrollmentPointer = {
      ...input.scope,
      enrollmentId: enrollment.enrollment.id,
      keyAlias: input.pointer.keyAlias,
      biometricBound: input.pointer.biometricBound,
      status: "PROVING",
    }
    // Store the server enrollment ID before the one-time proof. An ambiguous
    // proof response is then reconciled from lifecycle rather than retried
    // blindly or deleting the Keystore key.
    await tokenStore.setWorkforceAttendanceEnrollment(proving)
    const challenge = workforceDeviceEnrollmentChallenge({
      organizationId: input.scope.organizationId,
      agentId: input.scope.agentId,
      enrollmentId: enrollment.enrollment.id,
      challenge: enrollment.challenge,
    })
    const signature = await workforceAttendanceTrust.sign(
      proving.keyAlias,
      challenge,
      input.biometricRequired,
    )
    const proven = await fieldApi.proveAttendanceDeviceEnrollment({
      enrollmentId: enrollment.enrollment.id,
      challenge: enrollment.challenge,
      signature,
    })
    if (proven.enrollmentId !== enrollment.enrollment.id) {
      throw new Error("Attendance enrollment proof mismatch")
    }
    await tokenStore.setWorkforceAttendanceEnrollment({ ...proving, status: "PENDING" })
    showAttendanceAlert("workdayAttendanceApprovalPending")
  }

  async function beginReplacementAttendanceEnrollment(input: {
    scope: WorkforceAttendanceScope
    pointer: WorkforceAttendanceActivePointer
    biometricRequired: boolean
  }): Promise<void> {
    await clearAttendanceEnrollment(input.pointer)
    const replacement = await createAttendanceEnrollmentPointer({
      scope: input.scope,
      biometricRequired: input.biometricRequired,
      replacesEnrollmentId: input.pointer.enrollmentId,
    })
    await beginAndProveAttendanceEnrollment({
      scope: input.scope,
      pointer: replacement,
      biometricRequired: input.biometricRequired,
    })
  }

  async function deviceAttendanceEvidence(input: {
    action: FieldWorkdayAction
    workdayId: string
    clientOpId: string
    occurredAt: string
    requirements: FieldAttendanceRequirements
  }): Promise<FieldDeviceAttendanceEvidence | null> {
    const bootstrap = field.bootstrap
    if (!bootstrap) {
      showAttendanceAlert("workdayAttendancePolicyBlockedBody")
      return null
    }
    const availability = workforceAttendanceTrust.getAvailability()
    if (!availability.available || (input.requirements.biometricRequired && !availability.biometricStrongAvailable)) {
      showAttendanceAlert("workdayAttendanceDeviceUnsupported")
      return null
    }

    const scope: WorkforceAttendanceScope = { organizationId: bootstrap.tenant.id, agentId: bootstrap.principal.id }
    const storedPointer = await tokenStore.getWorkforceAttendanceEnrollment(scope)
    let pointer: WorkforceAttendanceEnrollmentPointer = storedPointer ??
      await createAttendanceEnrollmentPointer({
        scope,
        biometricRequired: input.requirements.biometricRequired,
      })

    if (pointer.status === "STARTING") {
      try {
        await beginAndProveAttendanceEnrollment({
          scope,
          pointer,
          biometricRequired: input.requirements.biometricRequired,
        })
      } catch (error) {
        if (workforceAttendanceTrustErrorCode(error) === "ERR_WORKFORCE_ATTENDANCE_REENROLL") {
          await clearAttendanceEnrollment(pointer)
        }
        throw error
      }
      return null
    }

    // All lifecycle states before ACTIVE are checked online. A lost begin/proof
    // response retains this pointer and is reconciled without retaining any
    // one-time proof material. Once ACTIVE, device-only actions may work
    // offline; server-side verification still rejects a revoked key on receipt.
    if (pointer.status === "PROVING" || pointer.status === "PENDING") {
      const enrollment = (await fieldApi.attendanceDeviceEnrollments())
        .find((candidate) => candidate.id === pointer.enrollmentId)
      if (!enrollment || enrollment.status === "REVOKED" || enrollment.status === "REPLACED") {
        await clearAttendanceEnrollment(pointer)
        showAttendanceAlert("workdayAttendanceVerificationFailed")
        return null
      }
      if (enrollment.status !== "ACTIVE" && enrollment.keyVerifiedAt) {
        await tokenStore.setWorkforceAttendanceEnrollment({ ...pointer, status: "PENDING" })
        showAttendanceAlert("workdayAttendanceApprovalPending")
        return null
      }
      if (enrollment.status !== "ACTIVE") {
        try {
          await beginAndProveAttendanceEnrollment({
            scope,
            pointer,
            biometricRequired: input.requirements.biometricRequired,
          })
        } catch (error) {
          if (workforceAttendanceTrustErrorCode(error) === "ERR_WORKFORCE_ATTENDANCE_REENROLL") {
            await clearAttendanceEnrollment(pointer)
          }
          throw error
        }
        return null
      }
      const activePointer: WorkforceAttendanceEnrollmentPointer = { ...pointer, status: "ACTIVE" }
      pointer = activePointer
      await tokenStore.setWorkforceAttendanceEnrollment(activePointer)
    }

    if (pointer.status !== "ACTIVE") return null
    if (input.requirements.biometricRequired && !pointer.biometricBound) {
      await beginReplacementAttendanceEnrollment({
        scope,
        pointer,
        biometricRequired: true,
      })
      return null
    }
    const challenge = workforceDeviceAttendanceChallenge({
      organizationId: scope.organizationId,
      agentId: scope.agentId,
      enrollmentId: pointer.enrollmentId,
      clientEventId: input.clientOpId,
      action: input.action,
      workdayId: input.workdayId,
      occurredAt: input.occurredAt,
    })
    try {
      return {
        enrollmentId: pointer.enrollmentId,
        signature: await workforceAttendanceTrust.sign(
          pointer.keyAlias,
          challenge,
          input.requirements.biometricRequired,
        ),
      }
    } catch (error) {
      if (workforceAttendanceTrustErrorCode(error) !== "ERR_WORKFORCE_ATTENDANCE_REENROLL") throw error
      await beginReplacementAttendanceEnrollment({
        scope,
        pointer,
        biometricRequired: input.requirements.biometricRequired,
      })
      return null
    }
  }

  async function applyAcceptedAction(input: {
    action: FieldWorkdayAction
    occurredAt: string
    location: Awaited<ReturnType<typeof getCurrentDeviceLocation>> | null
  }) {
    if (routesEnabled && input.location) {
      const payload = workdayLocationPayload({
        timestamp: Date.parse(input.occurredAt),
        coords: {
          latitude: input.location.latitude,
          longitude: input.location.longitude,
          accuracy: input.location.accuracyM,
        },
      })
      enqueueFieldLocation(payload)
      field.applyLocalLocations(appendOptimisticFieldLocation(locationData, payload))
    }

    if (!routesEnabled) {
      setTracking(stoppedWorkdayTrackingState())
    } else if (input.action === "START" || input.action === "RESUME") {
      try {
        const state = await startWorkdayTracking(intervalSeconds)
        setTracking(state)
        if (state.mode === "denied" || state.mode === "services_disabled" || state.mode === "unavailable") {
          setFeedback("workdayTrackingPermissionNeeded")
        }
      } catch {
        setTracking({
          mode: "unavailable",
          issue: "tracking_start_failed",
          recovery: "retry_tracking",
          observedAt: new Date().toISOString(),
        })
        setFeedback("workdayTrackingPermissionNeeded")
      }
    } else {
      await stopWorkdayTracking().catch(() => {})
      setTracking(stoppedWorkdayTrackingState())
    }
  }

  async function applyAction(action: FieldWorkdayAction, qrToken?: string) {
    if (!workforceEnabled) return
    const current = field.workday ?? emptyFieldWorkdayData(date, timezone, intervalSeconds)
    if (!current.availableActions.includes(action)) return
    const requirements = attendanceRequirements(action)
    if (!requirements || requirements.blocked) {
      showAttendanceAlert("workdayAttendancePolicyBlockedBody")
      return
    }
    if (requirements.qrRequired && !qrToken) {
      showAttendanceAlert("workdayAttendanceOnlineRequired")
      return
    }
    if (!requirements.qrRequired && qrToken) {
      showAttendanceAlert("workdayAttendanceVerificationFailed")
      return
    }

    let queuedClientOpId: string | null = null
    setBusyAction(action)
    setFeedback(null)
    try {
      const occurredAt = new Date().toISOString()
      const workdayId = action === "START"
        ? `mobile-workday-${Crypto.randomUUID()}`
        : current.workday?.id
      if (!workdayId) throw new Error("Workday id is missing")
      const clientOpId = newFieldWorkdayClientOperationId()
      const locationPromise = routesEnabled
        ? getCurrentDeviceLocation().catch(() => null)
        : Promise.resolve(null)
      const devicePromise = requirements.deviceTrustRequired
        ? deviceAttendanceEvidence({ action, workdayId, clientOpId, occurredAt, requirements })
        : Promise.resolve<FieldDeviceAttendanceEvidence | null>(null)
      const [location, device] = await Promise.all([locationPromise, devicePromise])
      if (requirements.deviceTrustRequired && !device) return

      const eventPayload = {
        action,
        workdayId,
        workDate: date,
        occurredAt,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        accuracy: location?.accuracyM ?? null,
        note: null,
      }

      if (requirements.requiresEphemeralQrSubmission) {
        const result = await fieldApi.pushEphemeralWorkday({
          clientOpId,
          clientCreatedAt: occurredAt,
          kind: "field.workday.event",
          payload: parseFieldEphemeralWorkdayEventPayload({
            ...eventPayload,
            attendance: {
              qrToken: qrToken!,
              ...(device ? { device } : {}),
            },
          }),
        })
        if (result.status !== "applied") {
          // QR is one-shot. Never enqueue, replay or show token-derived error
          // details; the next attempt must scan a fresh current code.
          await field.refreshActivity().catch(() => {})
          showAttendanceAlert("workdayAttendanceVerificationFailed")
          return
        }
        const nextWorkday = applyOptimisticWorkdayAction(current, action, {
          workdayId,
          clientEventId: clientOpId,
          occurredAt,
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null,
          accuracy: location?.accuracyM ?? null,
          note: null,
        })
        field.applyLocalWorkday(nextWorkday)
        await applyAcceptedAction({ action, occurredAt, location })
        void field.refreshActivity().catch(() => {})
        return
      }

      const queued = enqueueFieldWorkdayEvent({
        ...eventPayload,
        ...(device ? { attendance: { device } } : {}),
      }, clientOpId)
      queuedClientOpId = queued.clientOpId
      const nextWorkday = applyOptimisticWorkdayAction(current, action, {
        workdayId,
        clientEventId: queued.clientOpId,
        occurredAt,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        accuracy: location?.accuracyM ?? null,
        note: null,
      })
      field.applyLocalWorkday(nextWorkday)
      await applyAcceptedAction({ action, occurredAt, location })

      await syncWorkforce()
      const result = fieldOutboxResult(queued.clientOpId)
      if (result?.status === "conflict" || result?.status === "rejected") {
        // markOutbox has already reconciled the cache with any disclosed
        // server workday. Lock the live context as well before this alert can
        // be dismissed, then let the canonical activity refresh re-enable the
        // real next action.
        const reconciled = readFieldCache<FieldWorkdayData>("field.workday.current")?.value ?? nextWorkday
        field.applyLocalWorkday(lockWorkdayActionsUntilRefresh(reconciled))
        Alert.alert(t("workdayActionConflictTitle"), workdayConflictMessage(result.detail), [
          { text: t("cancel"), style: "cancel" },
          { text: t("workdayOpenSyncCenter"), onPress: () => router.push("/(app)/sync-center" as never) },
        ])
      } else if (result?.status !== "applied") {
        setFeedback("workdayQueueSaved")
      }
      // The optimistic workday is already durable locally and the dedicated
      // Workforce push above has completed. Route location refresh is useful
      // enrichment in Both mode, but must not hold the action confirmation.
      void field.refreshActivity().catch(() => {})
    } catch (error) {
      if (queuedClientOpId) setFeedback("workdayQueueSaved")
      if (requirements.qrRequired || requirements.deviceTrustRequired) {
        await field.refreshActivity().catch(() => {})
        showAttendanceAlert(requirements.qrRequired
          ? "workdayAttendanceOnlineRequired"
          : "workdayAttendanceVerificationFailed")
      } else {
        Alert.alert(t("fieldDataError"), error instanceof Error ? error.message : String(error))
      }
    } finally {
      setBusyAction(null)
    }
  }

  function beginAction(action: FieldWorkdayAction) {
    const requirements = attendanceRequirements(action)
    if (!requirements || requirements.blocked) {
      showAttendanceAlert("workdayAttendancePolicyBlockedBody")
      return
    }
    if (requirements.qrRequired) {
      void openQrScanner(action)
      return
    }
    void applyAction(action)
  }

  function pressAction(action: FieldWorkdayAction) {
    if (action !== "FINISH") {
      beginAction(action)
      return
    }
    Alert.alert(t("workdayFinishTitle"), t("workdayFinishBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("workdayFinish"), style: "destructive", onPress: () => beginAction("FINISH") },
    ])
  }

  async function recoverTracking() {
    if (!routesEnabled || tracking.recovery === "none" || trackingBusy) return
    setTrackingBusy(true)
    setFeedback(null)
    try {
      if (tracking.recovery === "open_settings") {
        await Linking.openSettings()
        setFeedback("workdayTrackingSettingsOpened")
        return
      }
      const next = await startWorkdayTracking(intervalSeconds)
      setTracking(next)
      if (next.mode === "background" || next.mode === "foreground") {
        setFeedback("workdayTrackingRecovered")
      }
    } catch {
      setTracking({
        mode: "unavailable",
        issue: "tracking_start_failed",
        recovery: "retry_tracking",
        observedAt: new Date().toISOString(),
      })
    } finally {
      setTrackingBusy(false)
    }
  }

  const statusTone = displayStatus === "STARTED"
    ? styles.statusStarted
    : displayStatus === "PAUSED"
      ? styles.statusPaused
      : displayStatus === "COMPLETED"
        ? styles.statusCompleted
        : styles.statusReady
  const statusDot = displayStatus === "STARTED"
    ? colors.success
    : displayStatus === "PAUSED"
      ? colors.warning
      : displayStatus === "COMPLETED"
        ? colors.primary
        : colors.faint
  const issueHintKey = trackingIssueHintKeys[tracking.issue]
  const trackingHint = issueHintKey
    ? t(issueHintKey)
    : tracking.mode === "background"
      ? t("workdayTrackingHintBackground")
      : tracking.mode === "foreground"
        ? t("workdayTrackingHintForeground")
        : tracking.mode === "denied"
          ? t("workdayTrackingHintDenied")
          : tracking.mode === "services_disabled"
            ? t("workdayTrackingHintServicesDisabled")
            : tracking.mode === "unavailable"
              ? t("workdayTrackingHintUnavailable")
              : t("workdayTrackingHintStopped")
  const trackingRecoveryKey = tracking.recovery === "none"
    ? null
    : trackingRecoveryKeys[tracking.recovery]

  if (!workforceEnabled) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>‹</Text>
          </Pressable>
        </View>
        <View style={styles.unavailableCard} accessibilityRole="alert">
          <Text style={styles.unavailableTitle}>{t("workforceUnavailableTitle")}</Text>
          <Text style={styles.unavailableBody}>{t("workforceUnavailableBody")}</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headerBody}>
          <Text style={styles.eyebrow}>{t("workdayToday").toUpperCase()}</Text>
          <Text style={styles.title}>{t("workdayTitle")}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} onPress={() => void refresh()} style={styles.refreshButton}>
          <Text style={styles.refreshText}>↻</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <View style={[styles.statusCard, statusTone]}>
          <View style={styles.statusTop}>
            <View style={styles.statusPill}>
              <View style={[styles.statusDot, { backgroundColor: statusDot }]} />
              <Text style={styles.statusText}>{t(statusKeys[displayStatus])}</Text>
            </View>
            {(workday?.syncState === "PENDING" || workforceStatus.pendingOps > 0) ? (
              <View style={styles.pendingPill}><Text style={styles.pendingText}>{t("workdayPending")}</Text></View>
            ) : null}
          </View>
          <Text style={styles.timerLabel}>{t("workdayWorked")}</Text>
          <Text style={styles.timer}>{formatDuration(workedSeconds)}</Text>
          <Text style={styles.statusHint}>{routesEnabled ? t("workdaySubtitle") : t("workforceWorkdayHint")}</Text>

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{formatDuration(pausedSeconds)}</Text>
              <Text style={styles.statLabel}>{t("workdayPaused")}</Text>
            </View>
            {routesEnabled ? <>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>{formatDistance(locationData.distanceMeters)}</Text>
                <Text style={styles.statLabel}>{t("workdayDistance")}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>{locationData.locations.length}</Text>
                <Text style={styles.statLabel}>{t("workdayGpsShort")}</Text>
              </View>
            </> : null}
          </View>
        </View>

        {workdayData.availableActions.length > 0 ? (
          <View style={styles.actionRow}>
            {workdayData.availableActions.map((action) => {
              const destructive = action === "FINISH"
              const secondary = action === "PAUSE"
              return (
                <Pressable
                  key={action}
                  accessibilityRole="button"
                  accessibilityLabel={t(actionKeys[action])}
                  accessibilityState={{ disabled: busyAction !== null }}
                  disabled={busyAction !== null}
                  onPress={() => pressAction(action)}
                  style={({ pressed }) => [
                    styles.actionButton,
                    destructive ? styles.actionDanger : secondary ? styles.actionSecondary : styles.actionPrimary,
                    pressed && styles.pressed,
                    busyAction !== null && styles.disabled,
                  ]}
                >
                  {busyAction === action ? (
                    <ActivityIndicator color={destructive || !secondary ? colors.headerText : colors.warning} />
                  ) : (
                    <Text style={[styles.actionText, secondary && styles.actionSecondaryText]}>
                      {action === "START" ? "▶  " : action === "PAUSE" ? "Ⅱ  " : action === "RESUME" ? "▶  " : "■  "}
                      {t(actionKeys[action])}
                    </Text>
                  )}
                </Pressable>
              )
            })}
          </View>
        ) : null}

        {feedback ? (
          <View style={styles.feedback}><Text style={styles.feedbackText}>{t(feedback)}</Text></View>
        ) : null}

        {routesEnabled ? <View style={styles.trackingCard}>
          <View style={[styles.trackingIcon, tracking.mode === "background" ? styles.trackingIconOn : tracking.mode === "denied" || tracking.mode === "services_disabled" || tracking.mode === "unavailable" ? styles.trackingIconWarn : styles.trackingIconOff]}>
            <Text style={styles.trackingIconText}>⌖</Text>
          </View>
          <View style={styles.trackingBody}>
            <Text style={styles.cardEyebrow}>{t("workdayTracking")}</Text>
            <Text style={styles.cardTitle}>{t(trackingKeys[tracking.mode])}</Text>
            <Text style={styles.cardHint}>{trackingHint}</Text>
            <Text style={styles.trackingObserved}>{t("workdayTrackingObservedAt", { time: formatTime(tracking.observedAt) })}</Text>
            {trackingRecoveryKey && workday?.status === "STARTED" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(trackingRecoveryKey)}
                disabled={trackingBusy}
                onPress={() => void recoverTracking()}
                style={({ pressed }) => [styles.trackingRecovery, pressed && styles.pressed, trackingBusy && styles.disabled]}
              >
                {trackingBusy ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={styles.trackingRecoveryText}>{t(trackingRecoveryKey)}</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        </View> : null}

        {routesEnabled ? <>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>{t("workdayLocationTrail")}</Text>
            <Text style={styles.sectionHint}>{t("workdayLocationTrailHint")}</Text>
          </View>
          <Text style={styles.sectionMetric}>{formatDistance(locationData.distanceMeters)}</Text>
        </View>
        <View style={styles.card}><LocationTrail data={locationData} /></View>
        </> : null}

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>{t("workdayTimeline")}</Text>
            <Text style={styles.sectionHint}>{t("workdayTimelineHint")}</Text>
          </View>
        </View>
        <View style={styles.card}>
          {!workday || workday.events.length === 0 ? (
            <Text style={styles.emptyText}>{t("workdayNoEvents")}</Text>
          ) : workday.events.slice().reverse().map((event, index) => (
            <View key={event.id} style={[styles.eventRow, index > 0 && styles.eventBorder]}>
              <View style={[styles.eventMark, event.syncState === "PENDING" && styles.eventMarkPending]} />
              <View style={styles.eventBody}>
                <Text style={styles.eventTitle}>{t(eventKeys[event.type])}</Text>
                <Text style={styles.eventMeta}>
                  {routesEnabled
                    ? `${formatTime(event.occurredAt)} · ${event.latitude == null ? t("workdayWithoutGps") : t("workdayWithGps")}`
                    : formatTime(event.occurredAt)}
                </Text>
              </View>
              {event.syncState === "PENDING" ? <Text style={styles.eventPending}>{t("queued")}</Text> : null}
            </View>
          ))}
        </View>

        {routesEnabled ? <View style={styles.privacyCard}>
          <Text style={styles.privacyIcon}>i</Text>
          <View style={styles.privacyBody}>
            <Text style={styles.privacyTitle}>{t("workdayPrivacyTitle")}</Text>
            <Text style={styles.privacyText}>{t("workdayPrivacyBody")}</Text>
          </View>
        </View> : null}
      </ScrollView>

      <Modal
        visible={qrScanAction !== null}
        animationType="slide"
        onRequestClose={closeQrScanner}
      >
        <SafeAreaView style={styles.qrScannerRoot} edges={["top", "bottom"]}>
          <View style={styles.qrScannerHeader}>
            <View style={styles.qrScannerHeaderBody}>
              <Text style={styles.qrScannerTitle}>{t("workdayAttendanceQrTitle")}</Text>
              <Text style={styles.qrScannerHint}>{t("workdayAttendanceQrHint")}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("workdayAttendanceQrCancel")}
              onPress={closeQrScanner}
              style={({ pressed }) => [styles.qrScannerClose, pressed && styles.pressed]}
            >
              <Text style={styles.qrScannerCloseText}>×</Text>
            </Pressable>
          </View>
          {cameraPermission?.granted ? (
            <CameraView
              style={styles.qrScannerCamera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: QR_BARCODE_TYPES }}
              onBarcodeScanned={handleQrScanned}
            >
              <View pointerEvents="none" style={styles.qrScannerOverlay}>
                <View style={styles.qrScannerFrame} />
              </View>
            </CameraView>
          ) : (
            <View style={styles.qrScannerUnavailable}>
              <Text style={styles.qrScannerUnavailableText}>{t("workdayAttendanceVerificationFailed")}</Text>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("workdayAttendanceQrCancel")}
            onPress={closeQrScanner}
            style={({ pressed }) => [styles.qrScannerCancel, pressed && styles.pressed]}
          >
            <Text style={styles.qrScannerCancelText}>{t("workdayAttendanceQrCancel")}</Text>
          </Pressable>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { minHeight: 72, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", backgroundColor: colors.bg },
  backButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", ...cardShadow },
  backText: { color: colors.text, fontSize: 33, fontWeight: "400", lineHeight: 35, marginTop: -3 },
  headerBody: { flex: 1, paddingHorizontal: 12 },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  title: { color: colors.text, fontSize: 22, fontWeight: "900", letterSpacing: -0.4, marginTop: 2 },
  refreshButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", ...cardShadow },
  refreshText: { color: colors.primary, fontSize: 24, fontWeight: "800" },
  unavailableCard: { margin: 16, borderRadius: radii.card, padding: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  unavailableTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  unavailableBody: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 7 },
  scroll: { paddingHorizontal: 14, paddingBottom: 36 },
  statusCard: { borderRadius: 26, padding: 20, borderWidth: 1, ...cardShadow },
  statusReady: { backgroundColor: colors.card, borderColor: colors.border },
  statusStarted: { backgroundColor: colors.successBg, borderColor: colors.successBorder },
  statusPaused: { backgroundColor: colors.warningBg, borderColor: "#F6D788" },
  statusCompleted: { backgroundColor: colors.primarySoft, borderColor: "#D8D7F2" },
  statusTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.cardOverlay, borderRadius: radii.pill, paddingHorizontal: 11, paddingVertical: 7 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: colors.text, fontSize: 11, fontWeight: "900" },
  pendingPill: { backgroundColor: colors.cardOverlay, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 7 },
  pendingText: { color: colors.warning, fontSize: 10, fontWeight: "900" },
  timerLabel: { color: colors.muted, fontSize: 11, fontWeight: "800", marginTop: 24, textTransform: "uppercase", letterSpacing: 0.7 },
  timer: { color: colors.text, fontSize: 43, fontWeight: "900", letterSpacing: -1.5, fontVariant: ["tabular-nums"], marginTop: 2 },
  statusHint: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 6, maxWidth: 330 },
  statsRow: { backgroundColor: colors.cardOverlay, borderRadius: 17, flexDirection: "row", alignItems: "center", marginTop: 20, paddingVertical: 13 },
  stat: { flex: 1, alignItems: "center", paddingHorizontal: 4 },
  statValue: { color: colors.text, fontSize: 14, fontWeight: "900", fontVariant: ["tabular-nums"] },
  statLabel: { color: colors.muted, fontSize: 9, fontWeight: "700", marginTop: 4, textAlign: "center" },
  statDivider: { width: 1, height: 28, backgroundColor: colors.border },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  actionButton: { flex: 1, minHeight: 56, borderRadius: 17, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  actionPrimary: { backgroundColor: colors.primary },
  actionSecondary: { backgroundColor: colors.warning, borderWidth: 1, borderColor: colors.warning },
  actionDanger: { backgroundColor: colors.danger },
  actionText: { color: colors.headerText, fontSize: 14, fontWeight: "900" },
  actionSecondaryText: { color: colors.headerText },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.55 },
  feedback: { backgroundColor: colors.infoBg, borderColor: colors.infoBorder, borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 12 },
  feedbackText: { color: colors.info, fontSize: 11, lineHeight: 17, fontWeight: "700" },
  qrScannerRoot: { flex: 1, backgroundColor: colors.bg },
  qrScannerHeader: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 16, backgroundColor: colors.card },
  qrScannerHeaderBody: { flex: 1 },
  qrScannerTitle: { color: colors.text, fontSize: 17, fontWeight: "900" },
  qrScannerHint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  qrScannerClose: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  qrScannerCloseText: { color: colors.primary, fontSize: 28, fontWeight: "400", lineHeight: 30 },
  qrScannerCamera: { flex: 1, margin: 16, overflow: "hidden", borderRadius: 26, backgroundColor: colors.text },
  qrScannerOverlay: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.16)" },
  qrScannerFrame: { width: "68%", aspectRatio: 1, borderRadius: 22, borderColor: colors.headerText, borderWidth: 3, backgroundColor: "transparent" },
  qrScannerUnavailable: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  qrScannerUnavailableText: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center" },
  qrScannerCancel: { minHeight: 52, marginHorizontal: 16, marginBottom: 16, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  qrScannerCancelText: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  trackingCard: { flexDirection: "row", alignItems: "center", gap: 13, backgroundColor: colors.card, borderRadius: radii.card, padding: 15, marginTop: 14, ...cardShadow },
  trackingIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  trackingIconOn: { backgroundColor: colors.successBg },
  trackingIconWarn: { backgroundColor: colors.warningBg },
  trackingIconOff: { backgroundColor: colors.draftBg },
  trackingIconText: { color: colors.primary, fontSize: 24, fontWeight: "900" },
  trackingBody: { flex: 1 },
  cardEyebrow: { color: colors.faint, fontSize: 9, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: "900", marginTop: 2 },
  cardHint: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  trackingObserved: { color: colors.faint, fontSize: 9, lineHeight: 13, marginTop: 5 },
  trackingRecovery: { alignSelf: "flex-start", minHeight: 40, justifyContent: "center", borderRadius: 12, backgroundColor: colors.primarySoft, paddingHorizontal: 13, marginTop: 10 },
  trackingRecoveryText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 24, marginBottom: 9, paddingHorizontal: 2 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "900" },
  sectionHint: { color: colors.muted, fontSize: 10, marginTop: 3 },
  sectionMetric: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  card: { backgroundColor: colors.card, borderRadius: radii.card, padding: 14, ...cardShadow },
  trailCanvas: { minHeight: 172, overflow: "hidden" },
  trailLegend: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 10 },
  trailLegendText: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  emptyTrail: { minHeight: 150, alignItems: "center", justifyContent: "center", padding: 20 },
  emptyTrailPin: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  emptyTrailPinText: { color: colors.primary, fontSize: 24, fontWeight: "900" },
  emptyTrailText: { color: colors.muted, fontSize: 11, textAlign: "center", lineHeight: 17, marginTop: 10 },
  emptyText: { color: colors.muted, fontSize: 12, textAlign: "center", paddingVertical: 20 },
  eventRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 11 },
  eventBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  eventMark: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success },
  eventMarkPending: { backgroundColor: colors.warning },
  eventBody: { flex: 1, paddingVertical: 10 },
  eventTitle: { color: colors.text, fontSize: 12, fontWeight: "900" },
  eventMeta: { color: colors.muted, fontSize: 10, marginTop: 3 },
  eventPending: { color: colors.warning, fontSize: 9, fontWeight: "900" },
  privacyCard: { flexDirection: "row", gap: 11, backgroundColor: colors.infoBg, borderRadius: radii.card, borderWidth: 1, borderColor: colors.infoBorder, padding: 14, marginTop: 18 },
  privacyIcon: { width: 25, height: 25, borderRadius: 13, backgroundColor: colors.info, color: colors.headerText, textAlign: "center", textAlignVertical: "center", fontSize: 14, lineHeight: 25, fontWeight: "900" },
  privacyBody: { flex: 1 },
  privacyTitle: { color: colors.info, fontSize: 12, fontWeight: "900" },
  privacyText: { color: colors.info, fontSize: 10, lineHeight: 16, marginTop: 3 },
})
