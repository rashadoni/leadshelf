import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { router, useFocusEffect } from "expo-router"
import * as Crypto from "expo-crypto"
import Svg, { Circle, Path } from "react-native-svg"
import { SafeAreaView } from "react-native-safe-area-context"
import { TabIcon } from "../../src/components/TabIcon"
import {
  enqueueFieldLocation,
  enqueueFieldWorkdayEvent,
  fieldOutboxResult,
} from "../../src/db/local-store"
import type {
  FieldLocationHistoryData,
  FieldWorkdayAction,
  FieldWorkdayStatus,
} from "../../src/field/contracts"
import { useField } from "../../src/field/field-context"
import { presentFieldAttendancePolicy } from "../../src/field/attendance-policy"
import {
  appendOptimisticFieldLocation,
  applyOptimisticWorkdayAction,
  emptyFieldWorkdayData,
} from "../../src/field/workday-state"
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
  type WorkdayTrackingNotification,
  type WorkdayTrackingRecovery,
  type WorkdayTrackingState,
} from "../../src/location/workday-tracking"
import { useSync } from "../../src/sync/sync-context"
import { colors, cardShadow, radii } from "../../src/theme"

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
  const locale = useLocale()
  const field = useField()
  const { sync, status: syncStatus } = useSync()
  const [busyAction, setBusyAction] = useState<FieldWorkdayAction | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [tracking, setTracking] = useState<WorkdayTrackingState>(() => stoppedWorkdayTrackingState())
  const [trackingBusy, setTrackingBusy] = useState(false)
  const [feedback, setFeedback] = useState<MessageKey | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())

  const date = field.workday?.date ?? field.profile?.todaySummary.date ?? field.week?.today ?? new Date().toISOString().slice(0, 10)
  const timezone = field.workday?.timezone ?? field.profile?.todaySummary.timezone ?? field.week?.timezone ?? "UTC"
  const intervalSeconds = field.workday?.gpsIntervalSeconds ?? field.locations?.gpsIntervalSeconds ?? 30
  const workdayData = field.workday ?? emptyFieldWorkdayData(date, timezone, intervalSeconds)
  const locationData = field.locations?.date === date
    ? field.locations
    : { date, timezone, gpsIntervalSeconds: intervalSeconds, distanceMeters: 0, locations: [] }
  const workday = workdayData.workday
  const attendancePresentation = presentFieldAttendancePolicy(workdayData.attendancePolicy)
  const attendancePolicy = attendancePresentation.policy
  const {
    requiresQrBeforeStart,
    capturesEventGps,
    runsContinuousTracking,
    usesGps,
    evidenceKey: policyEvidenceKey,
    hintKey: policyHintKey,
    privacyBodyKey,
  } = attendancePresentation
  const displayStatus: DisplayStatus = workday?.status ?? "NOT_STARTED"
  const workedSeconds = currentWorkedSeconds(workday, nowMs)
  const pausedSeconds = currentPausedSeconds(workday, nowMs)
  const trackingNotification = useMemo<WorkdayTrackingNotification>(() => ({
    title: t("workdayTrackingNotificationTitle"),
    body: t("workdayTrackingNotificationBody"),
  }), [locale])

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  useFocusEffect(useCallback(() => {
    void field.refreshActivity()
  }, [field.refreshActivity]))

  const refreshTracking = useCallback(async () => {
    const state = await reconcileWorkdayTracking(
      workday?.status ?? null,
      intervalSeconds,
      runsContinuousTracking,
      trackingNotification,
    )
      .catch((): WorkdayTrackingState => ({
        mode: "unavailable",
        issue: "tracking_start_failed",
        recovery: "retry_tracking",
        observedAt: new Date().toISOString(),
      }))
    setTracking(state)
  }, [intervalSeconds, runsContinuousTracking, trackingNotification, workday?.status])

  useEffect(() => {
    if (busyAction) return
    let active = true
    void reconcileWorkdayTracking(
      workday?.status ?? null,
      intervalSeconds,
      runsContinuousTracking,
      trackingNotification,
    )
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
  }, [busyAction, intervalSeconds, runsContinuousTracking, trackingNotification, workday?.status])

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && !busyAction && !trackingBusy) void refreshTracking()
    })
    return () => subscription.remove()
  }, [busyAction, refreshTracking, trackingBusy])

  async function refresh() {
    setRefreshing(true)
    try {
      await sync()
      await field.refreshActivity()
    } finally {
      setRefreshing(false)
    }
  }

  async function applyAction(action: FieldWorkdayAction) {
    const current = field.workday ?? emptyFieldWorkdayData(date, timezone, intervalSeconds)
    if (!current.availableActions.includes(action)) return
    if (requiresQrBeforeStart && (action === "START" || action === "RESUME")) {
      Alert.alert(t("workdayQrNotReadyTitle"), t("workdayQrNotReady"))
      return
    }
    let queuedClientOpId: string | null = null
    setBusyAction(action)
    setFeedback(null)
    try {
      const occurredAt = new Date().toISOString()
      const location = capturesEventGps
        ? await getCurrentDeviceLocation().catch(() => null)
        : null
      const workdayId = action === "START"
        ? `mobile-workday-${Crypto.randomUUID()}`
        : current.workday?.id
      if (!workdayId) throw new Error("Workday id is missing")

      const queued = enqueueFieldWorkdayEvent({
        action,
        workdayId,
        workDate: date,
        occurredAt,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        accuracy: location?.accuracyM ?? null,
        note: null,
      })
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

      if (location) {
        const payload = workdayLocationPayload({
          timestamp: Date.parse(occurredAt),
          coords: {
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracyM,
          },
        })
        enqueueFieldLocation(payload)
        field.applyLocalLocations(appendOptimisticFieldLocation(locationData, payload))
      }

      if ((action === "START" || action === "RESUME") && runsContinuousTracking) {
        try {
          const state = await startWorkdayTracking(intervalSeconds, { notification: trackingNotification })
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

      await sync()
      const result = fieldOutboxResult(queued.clientOpId)
      if (result?.status === "conflict" || result?.status === "rejected") {
        Alert.alert(t("workdayActionConflict"))
      } else if (result?.status !== "applied") {
        setFeedback("workdayQueueSaved")
      }
      await field.refreshActivity()
    } catch (error) {
      if (queuedClientOpId) setFeedback("workdayQueueSaved")
      Alert.alert(t("fieldDataError"), error instanceof Error ? error.message : String(error))
    } finally {
      setBusyAction(null)
    }
  }

  function pressAction(action: FieldWorkdayAction) {
    if (action !== "FINISH") {
      void applyAction(action)
      return
    }
    Alert.alert(t("workdayFinishTitle"), t("workdayFinishBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("workdayFinish"), style: "destructive", onPress: () => void applyAction("FINISH") },
    ])
  }

  async function recoverTracking() {
    if (!runsContinuousTracking || tracking.recovery === "none" || trackingBusy) return
    setTrackingBusy(true)
    setFeedback(null)
    try {
      if (tracking.recovery === "open_settings") {
        await Linking.openSettings()
        setFeedback("workdayTrackingSettingsOpened")
        return
      }
      const next = await startWorkdayTracking(intervalSeconds, { notification: trackingNotification })
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
            {(workday?.syncState === "PENDING" || syncStatus.pendingOps > 0) ? (
              <View style={styles.pendingPill}><Text style={styles.pendingText}>{t("workdayPending")}</Text></View>
            ) : null}
          </View>
          <Text style={styles.timerLabel}>{t("workdayWorked")}</Text>
          <Text style={styles.timer}>{formatDuration(workedSeconds)}</Text>
          <Text style={styles.statusHint}>{t(policyHintKey)}</Text>

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{formatDuration(pausedSeconds)}</Text>
              <Text style={styles.statLabel}>{t("workdayPaused")}</Text>
            </View>
            {usesGps ? (
              <>
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
              </>
            ) : null}
          </View>
        </View>

        <View style={[
          styles.policyCard,
          requiresQrBeforeStart
            ? styles.policyCardQr
            : usesGps
              ? styles.policyCardGps
              : styles.policyCardNoLocation,
        ]}>
          <View style={[
            styles.policyIcon,
            requiresQrBeforeStart
              ? styles.policyIconQr
              : usesGps
                ? styles.policyIconGps
                : styles.policyIconNoLocation,
          ]}>
            <TabIcon
              name={requiresQrBeforeStart ? "qr" : usesGps ? "location" : "work"}
              color={requiresQrBeforeStart ? colors.warning : colors.primary}
              size={25}
            />
          </View>
          <View style={styles.policyBody}>
            <Text style={styles.cardEyebrow}>{t("workdayPolicyTitle")}</Text>
            <Text style={styles.cardTitle}>{t(policyEvidenceKey)}</Text>
            <Text style={styles.cardHint}>{t(policyHintKey)}</Text>
            {attendancePolicy.allowDifferentStartEndSites ? (
              <Text style={styles.policyFlexibility}>{t("workdayPolicyFlexibleSites")}</Text>
            ) : null}
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

        {runsContinuousTracking ? (
          <View style={styles.trackingCard}>
            <View style={[styles.trackingIcon, tracking.mode === "background" ? styles.trackingIconOn : tracking.mode === "denied" || tracking.mode === "services_disabled" || tracking.mode === "unavailable" ? styles.trackingIconWarn : styles.trackingIconOff]}>
              <TabIcon name="location" color={colors.primary} size={25} />
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
          </View>
        ) : null}

        {usesGps ? (
          <>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>{t("workdayLocationTrail")}</Text>
                <Text style={styles.sectionHint}>
                  {t(runsContinuousTracking ? "workdayLocationTrailHint" : "workdayEventGpsTrailHint")}
                </Text>
              </View>
              <Text style={styles.sectionMetric}>
                {runsContinuousTracking
                  ? formatDistance(locationData.distanceMeters)
                  : t("workdayGpsPoints", { count: locationData.locations.length })}
              </Text>
            </View>
            <View style={styles.card}><LocationTrail data={locationData} /></View>
          </>
        ) : null}

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
                  {formatTime(event.occurredAt)} · {event.latitude == null ? t("workdayWithoutGps") : t("workdayWithGps")}
                </Text>
              </View>
              {event.syncState === "PENDING" ? <Text style={styles.eventPending}>{t("queued")}</Text> : null}
            </View>
          ))}
        </View>

        <View style={styles.privacyCard}>
          <Text style={styles.privacyIcon}>i</Text>
          <View style={styles.privacyBody}>
            <Text style={styles.privacyTitle}>{t("workdayPrivacyTitle")}</Text>
            <Text style={styles.privacyText}>{t(privacyBodyKey)}</Text>
          </View>
        </View>
      </ScrollView>
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
  policyCard: { flexDirection: "row", alignItems: "center", gap: 13, borderRadius: radii.card, borderWidth: 1, padding: 15, marginTop: 14, ...cardShadow },
  policyCardNoLocation: { backgroundColor: colors.card, borderColor: colors.border },
  policyCardGps: { backgroundColor: colors.primarySoft, borderColor: "#D8D7F2" },
  policyCardQr: { backgroundColor: colors.warningBg, borderColor: "#F6D788" },
  policyIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  policyIconNoLocation: { backgroundColor: colors.draftBg },
  policyIconGps: { backgroundColor: colors.card },
  policyIconQr: { backgroundColor: colors.cardOverlay },
  policyBody: { flex: 1 },
  policyFlexibility: { color: colors.primary, fontSize: 10, lineHeight: 15, fontWeight: "800", marginTop: 6 },
  trackingCard: { flexDirection: "row", alignItems: "center", gap: 13, backgroundColor: colors.card, borderRadius: radii.card, padding: 15, marginTop: 14, ...cardShadow },
  trackingIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  trackingIconOn: { backgroundColor: colors.successBg },
  trackingIconWarn: { backgroundColor: colors.warningBg },
  trackingIconOff: { backgroundColor: colors.draftBg },
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
