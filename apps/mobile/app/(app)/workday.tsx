import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context"
import { TabIcon } from "../../src/components/TabIcon"
import { FieldScreenChrome } from "../../src/components/FieldScreenChrome"
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
import { fieldErrorMessage } from "../../src/field/error-message"
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
import { IS_LEADDRIVE_FIELD } from "../../src/config/mobile-variant"
import { splitWorkdayActions } from "../../src/field/workday-action-layout"
import { useResponsiveLayout } from "../../src/layout/responsive"
import { safeFieldBack } from "../../src/navigation/safe-back"

type DisplayStatus = FieldWorkdayStatus | "NOT_STARTED"
type DetailSection = "policy" | "tracking" | "timeline" | "privacy"

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

function LocationTrail({ data, timeZone }: { data: FieldLocationHistoryData; timeZone: string }) {
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
        <View style={styles.emptyTrailPin}><TabIcon name="location" color={colors.primary} size={21} /></View>
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
        <Text style={styles.trailLegendText}>{t("workdayLastPoint")}: {formatTime(last.recordedAt, timeZone)}</Text>
      </View>
    </View>
  )
}

function WorkdayDisclosure({
  title,
  hint,
  icon,
  warning = false,
  expanded,
  onToggle,
  tablet = false,
  children,
}: {
  title: string
  hint: string
  icon: "qr" | "location" | "info" | "work" | "week"
  warning?: boolean
  expanded: boolean
  onToggle: () => void
  tablet?: boolean
  children: ReactNode
}) {
  const iconColor = warning ? colors.warning : colors.primary
  return (
    <View style={[styles.disclosure, tablet && styles.disclosureTablet, expanded && styles.disclosureOpen]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={hint}
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [styles.disclosureHeader, pressed && styles.pressed]}
      >
        <View style={[styles.disclosureIcon, warning && styles.disclosureIconWarning]}>
          <TabIcon name={icon} color={iconColor} size={22} />
        </View>
        <View style={styles.disclosureBody}>
          <Text style={styles.disclosureTitle}>{title}</Text>
          <Text numberOfLines={expanded ? undefined : 2} style={styles.disclosureHint}>{hint}</Text>
        </View>
        <TabIcon name={expanded ? "chevronUp" : "chevronDown"} color={colors.primary} size={21} />
      </Pressable>
      {expanded ? <View style={styles.disclosureContent}>{children}</View> : null}
    </View>
  )
}

export default function WorkdayScreen() {
  const locale = useLocale()
  const field = useField()
  const layout = useResponsiveLayout()
  const insets = useSafeAreaInsets()
  const { sync, status: syncStatus } = useSync()
  const [busyAction, setBusyAction] = useState<FieldWorkdayAction | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [tracking, setTracking] = useState<WorkdayTrackingState>(() => stoppedWorkdayTrackingState())
  const [trackingBusy, setTrackingBusy] = useState(false)
  const [feedback, setFeedback] = useState<MessageKey | null>(null)
  const [openDetailSection, setOpenDetailSection] = useState<DetailSection | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())

  const date = field.workday?.date ?? field.profile?.todaySummary.date ?? field.week?.today ?? new Date().toISOString().slice(0, 10)
  const timezone = field.workday?.timezone ?? field.profile?.todaySummary.timezone ?? field.week?.timezone ?? "UTC"
  const intervalSeconds = field.workday?.gpsIntervalSeconds ?? field.locations?.gpsIntervalSeconds ?? 30
  const workdayKnown = Boolean(field.workday)
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
  const workdayStatusLabel = workdayKnown ? t(statusKeys[displayStatus]) : t("workdayLoading")
  const workdayLoading = !workdayKnown && (field.activityPhase === "loading" || field.activityPhase === "refreshing")
  const workdayNotice = workdayLoading
    ? t("workdayLoadingHint")
    : field.activityPhase === "stale"
      ? t("fieldDataStale")
      : field.activityError ?? t("fieldDataError")
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

  useEffect(() => {
    if (requiresQrBeforeStart) setOpenDetailSection("policy")
  }, [requiresQrBeforeStart])

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
    if (!field.workday) {
      setFeedback("workdayLoading")
      void field.refreshActivity()
      return
    }
    const current = field.workday
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
        // A server rejection is factual: retain the last known workday instead of
        // leaving the optimistic clock state and background tracker running.
        // Pending/offline events intentionally keep their optimistic state.
        field.applyLocalWorkday(current)
        const restoredTracking = await reconcileWorkdayTracking(
          current.workday?.status ?? null,
          intervalSeconds,
          runsContinuousTracking,
          trackingNotification,
        ).catch((): WorkdayTrackingState => ({
          mode: "unavailable",
          issue: "tracking_start_failed",
          recovery: "retry_tracking",
          observedAt: new Date().toISOString(),
        }))
        setTracking(restoredTracking)
        Alert.alert(t("workdayActionConflict"))
      } else if (result?.status !== "applied") {
        setFeedback("workdayQueueSaved")
      }
      await field.refreshActivity()
    } catch (error) {
      if (queuedClientOpId) setFeedback("workdayQueueSaved")
      Alert.alert(t("fieldDataError"), fieldErrorMessage(error, "workdayActionConflict"))
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
      setFeedback("workdayTrackingPermissionNeeded")
    } finally {
      setTrackingBusy(false)
    }
  }

  const statusPillTone = displayStatus === "STARTED"
    ? styles.statusPillStarted
    : displayStatus === "PAUSED"
      ? styles.statusPillPaused
      : displayStatus === "COMPLETED"
        ? styles.statusPillCompleted
        : styles.statusPillReady
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
  const { primary: primaryWorkdayAction, secondary: secondaryWorkdayActions } = splitWorkdayActions(
    workdayKnown ? workdayData.availableActions : [],
  )
  const stickyActionSpace = primaryWorkdayAction
    ? Math.max(insets.bottom, 10) + (secondaryWorkdayActions.length > 0 ? 136 : 86)
    : Math.max(insets.bottom, 28)

  function actionIcon(action: FieldWorkdayAction): "play" | "pause" | "stop" {
    return action === "START" || action === "RESUME" ? "play" : action === "PAUSE" ? "pause" : "stop"
  }

  function toggleDetailSection(section: DetailSection) {
    setOpenDetailSection((current) => current === section ? null : section)
  }

  function renderWorkdayAction(action: FieldWorkdayAction, primary: boolean) {
    const finishing = action === "FINISH"
    const busy = busyAction === action
    const actionColor = primary ? colors.headerText : colors.primary
    return (
      <Pressable
        key={action}
        accessibilityRole="button"
        accessibilityLabel={t(actionKeys[action])}
        accessibilityState={{ busy, disabled: busyAction !== null }}
        disabled={busyAction !== null}
        onPress={() => pressAction(action)}
        style={({ pressed }) => [
          primary ? styles.primaryActionButton : styles.secondaryActionButton,
          primary
            ? styles.primaryActionTone
            : styles.secondaryActionTone,
          pressed && styles.pressed,
          busyAction !== null && styles.disabled,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={actionColor} />
        ) : (
          <View style={styles.actionContent}>
            <TabIcon name={actionIcon(action)} color={actionColor} size={18} />
            <Text style={[styles.actionText, !primary && (finishing ? styles.secondaryFinishText : styles.secondaryPauseText)]}>{t(actionKeys[action])}</Text>
          </View>
        )}
      </Pressable>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <FieldScreenChrome />
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => safeFieldBack("/(app)/(tabs)")} style={styles.backButton}>
          <TabIcon name="chevronLeft" color={colors.text} size={23} />
        </Pressable>
        <View style={styles.headerBody}>
          <Text style={styles.eyebrow}>{t("workdayToday").toUpperCase()}</Text>
          <Text style={styles.title}>{t("workdayTitle")}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} onPress={() => void refresh()} style={styles.refreshButton}>
          <TabIcon name="refresh" color={colors.primary} size={22} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: stickyActionSpace }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <View style={[styles.content, layout.isTablet && styles.contentTablet]}>
          <View style={styles.statusCard}>
            <View style={styles.statusTop}>
              <View style={[styles.statusPill, statusPillTone]}>
                <View style={[styles.statusDot, { backgroundColor: statusDot }]} />
                <Text style={styles.statusText}>{workdayStatusLabel}</Text>
              </View>
              {(workday?.syncState === "PENDING" || syncStatus.pendingOps > 0) ? (
                <View style={styles.pendingPill}><Text style={styles.pendingText}>{t("workdayPending")}</Text></View>
              ) : null}
            </View>
            <Text style={styles.timerLabel}>{t("workdayWorked")}</Text>
            <Text style={styles.timer}>{workdayKnown ? formatDuration(workedSeconds) : "—"}</Text>
            <Text style={styles.statusHint}>{workdayKnown ? t(policyHintKey) : t("workdayLoadingHint")}</Text>

            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{workdayKnown ? formatDuration(pausedSeconds) : "—"}</Text>
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

          {!workdayKnown ? (
            <View accessible accessibilityRole={workdayLoading ? undefined : "alert"} accessibilityLiveRegion="polite" style={[styles.activityNotice, !workdayLoading && styles.activityNoticeError]}>
              <TabIcon name={workdayLoading ? "refresh" : "alert"} color={workdayLoading ? colors.info : colors.warning} size={19} />
              <Text style={[styles.activityNoticeText, !workdayLoading && styles.activityNoticeErrorText]}>{workdayNotice}</Text>
              {!workdayLoading ? <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} onPress={() => void field.refreshActivity()} style={styles.activityRetry}><Text style={styles.activityRetryText}>{t("refresh")}</Text></Pressable> : null}
            </View>
          ) : null}

          {feedback ? (
            <View style={styles.feedback}><Text style={styles.feedbackText}>{t(feedback)}</Text></View>
          ) : null}

        {workdayKnown ? <View style={[styles.detailGroups, layout.isTablet && styles.detailGroupsTablet]}>
          <WorkdayDisclosure
            title={t("workdayPolicyTitle")}
            hint={t(policyHintKey)}
            icon={requiresQrBeforeStart ? "qr" : usesGps ? "location" : "work"}
            warning={requiresQrBeforeStart}
            expanded={openDetailSection === "policy"}
            onToggle={() => toggleDetailSection("policy")}
            tablet={layout.isTablet}
          >
            <View style={styles.policyDetail}>
              <Text style={styles.cardTitle}>{t(policyEvidenceKey)}</Text>
              {attendancePolicy.allowDifferentStartEndSites ? (
                <Text style={styles.policyFlexibility}>{t("workdayPolicyFlexibleSites")}</Text>
              ) : null}
            </View>
          </WorkdayDisclosure>

          {usesGps ? (
            <WorkdayDisclosure
              title={t(runsContinuousTracking ? "workdayTracking" : "workdayLocationTrail")}
              hint={runsContinuousTracking ? trackingHint : t("workdayEventGpsTrailHint")}
              icon="location"
              expanded={openDetailSection === "tracking"}
              onToggle={() => toggleDetailSection("tracking")}
              tablet={layout.isTablet}
            >
              {runsContinuousTracking ? (
                <View style={styles.trackingDetail}>
                  <View style={[styles.trackingIcon, tracking.mode === "background" ? styles.trackingIconOn : tracking.mode === "denied" || tracking.mode === "services_disabled" || tracking.mode === "unavailable" ? styles.trackingIconWarn : styles.trackingIconOff]}>
                    <TabIcon name="location" color={colors.primary} size={23} />
                  </View>
                  <View style={styles.trackingBody}>
                    <Text style={styles.cardTitle}>{t(trackingKeys[tracking.mode])}</Text>
                    <Text style={styles.trackingObserved}>{t("workdayTrackingObservedAt", { time: formatTime(tracking.observedAt, timezone) })}</Text>
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
              <View style={[styles.locationDetail, runsContinuousTracking && styles.locationDetailBorder]}>
                <View style={styles.locationDetailTop}>
                  <Text style={styles.locationDetailLabel}>{t("workdayLocationTrail")}</Text>
                  <Text style={styles.sectionMetric}>
                    {runsContinuousTracking
                      ? formatDistance(locationData.distanceMeters)
                      : t("workdayGpsPoints", { count: locationData.locations.length })}
                  </Text>
                </View>
                <View style={styles.insetPanel}><LocationTrail data={locationData} timeZone={timezone} /></View>
              </View>
            </WorkdayDisclosure>
          ) : null}

          <WorkdayDisclosure
            title={t("workdayTimeline")}
            hint={t("workdayTimelineHint")}
            icon="week"
            expanded={openDetailSection === "timeline"}
            onToggle={() => toggleDetailSection("timeline")}
            tablet={layout.isTablet}
          >
            <View style={styles.timelineDetail}>
              {!workday || workday.events.length === 0 ? (
                <Text style={styles.emptyText}>{t("workdayNoEvents")}</Text>
              ) : workday.events.slice().reverse().map((event, index) => (
                <View key={event.id} style={[styles.eventRow, index > 0 && styles.eventBorder]}>
                  <View style={[styles.eventMark, event.syncState === "PENDING" && styles.eventMarkPending]} />
                  <View style={styles.eventBody}>
                    <Text style={styles.eventTitle}>{t(eventKeys[event.type])}</Text>
                    <Text style={styles.eventMeta}>
                      {formatTime(event.occurredAt, timezone)} · {event.latitude == null ? t("workdayWithoutGps") : t("workdayWithGps")}
                    </Text>
                  </View>
                  {event.syncState === "PENDING" ? <Text style={styles.eventPending}>{t("queued")}</Text> : null}
                </View>
              ))}
            </View>
          </WorkdayDisclosure>

          <WorkdayDisclosure
            title={t("workdayPrivacyTitle")}
            hint={t(privacyBodyKey)}
            icon="info"
            expanded={openDetailSection === "privacy"}
            onToggle={() => toggleDetailSection("privacy")}
            tablet={layout.isTablet}
          >
            <Text style={styles.privacyText}>{t(privacyBodyKey)}</Text>
          </WorkdayDisclosure>
        </View> : null}

        {IS_LEADDRIVE_FIELD ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("moduleHrm")}
            accessibilityHint={t("fieldHrmEntryHint")}
            onPress={() => router.push("/(app)/hrm" as never)}
            style={({ pressed }) => [styles.hrmEntry, pressed && styles.pressed]}
          >
            <View style={styles.hrmIcon}><TabIcon name="week" color={colors.primary} size={22} /></View>
            <View style={styles.hrmBody}>
              <Text style={styles.hrmTitle}>{t("moduleHrm")}</Text>
              <Text style={styles.hrmHint}>{t("fieldHrmEntryHint")}</Text>
            </View>
            <TabIcon name="chevronRight" color={colors.primary} size={21} />
          </Pressable>
        ) : null}
        </View>
      </ScrollView>
      {primaryWorkdayAction ? (
        <View style={[styles.stickyActionTray, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          {renderWorkdayAction(primaryWorkdayAction, true)}
          {secondaryWorkdayActions.length > 0 ? (
            <View style={styles.secondaryActionRow}>
              {secondaryWorkdayActions.map((action) => renderWorkdayAction(action, false))}
            </View>
          ) : null}
        </View>
      ) : null}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { minHeight: 72, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", backgroundColor: colors.bg },
  backButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", ...cardShadow },
  headerBody: { flex: 1, paddingHorizontal: 12 },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 0.9 },
  title: { color: colors.text, fontSize: 22, fontWeight: "900", letterSpacing: -0.4, marginTop: 2 },
  refreshButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", ...cardShadow },
  scroll: { paddingHorizontal: 14 },
  content: { width: "100%", maxWidth: 680, alignSelf: "center" },
  contentTablet: { maxWidth: 1_060 },
  statusCard: { borderRadius: 24, padding: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, ...cardShadow },
  statusTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 7, borderRadius: radii.pill, paddingHorizontal: 11, paddingVertical: 7 },
  statusPillReady: { backgroundColor: colors.surfaceMuted },
  statusPillStarted: { backgroundColor: colors.successBg },
  statusPillPaused: { backgroundColor: colors.warningBg },
  statusPillCompleted: { backgroundColor: colors.primarySoft },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: colors.text, fontSize: 12, fontWeight: "900" },
  activityNotice: { minHeight: 54, marginTop: 10, borderRadius: radii.inner, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.infoBg, borderWidth: 1, borderColor: colors.infoBorder, flexDirection: "row", alignItems: "center", gap: 9 },
  activityNoticeError: { backgroundColor: colors.warningBg, borderColor: colors.warningBorder },
  activityNoticeText: { flex: 1, color: colors.info, fontSize: 11, lineHeight: 16, fontWeight: "800" },
  activityNoticeErrorText: { color: colors.warning },
  activityRetry: { minHeight: 36, borderRadius: 12, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card },
  activityRetryText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  pendingPill: { backgroundColor: colors.cardOverlay, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 7 },
  pendingText: { color: colors.warning, fontSize: 11, fontWeight: "900" },
  timerLabel: { color: colors.muted, fontSize: 11, fontWeight: "800", marginTop: 16, textTransform: "uppercase", letterSpacing: 0.7 },
  timer: { color: colors.text, fontSize: 38, fontWeight: "900", letterSpacing: -1.2, fontVariant: ["tabular-nums"], marginTop: 2 },
  statusHint: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 6, maxWidth: 330 },
  statsRow: { backgroundColor: colors.surfaceMuted, borderRadius: 17, flexDirection: "row", alignItems: "center", marginTop: 14, paddingVertical: 11 },
  stat: { flex: 1, alignItems: "center", paddingHorizontal: 4 },
  statValue: { color: colors.text, fontSize: 14, fontWeight: "900", fontVariant: ["tabular-nums"] },
  statLabel: { color: colors.muted, fontSize: 11, fontWeight: "700", marginTop: 4, textAlign: "center" },
  statDivider: { width: 1, height: 28, backgroundColor: colors.border },
  primaryActionButton: { minHeight: 60, borderRadius: 17, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  primaryActionTone: { backgroundColor: colors.primary },
  secondaryActionRow: { flexDirection: "row", gap: 9 },
  secondaryActionButton: { flex: 1, minHeight: 48, borderRadius: 15, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, borderWidth: 1 },
  secondaryActionTone: { backgroundColor: colors.card, borderColor: colors.border },
  actionText: { color: colors.headerText, fontSize: 14, fontWeight: "900" },
  secondaryPauseText: { color: colors.primary },
  secondaryFinishText: { color: colors.primary },
  actionContent: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.55 },
  feedback: { backgroundColor: colors.infoBg, borderColor: colors.infoBorder, borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 12 },
  feedbackText: { color: colors.info, fontSize: 12, lineHeight: 18, fontWeight: "700" },
  detailGroups: { gap: 10, marginTop: 14 },
  detailGroupsTablet: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", columnGap: 12, rowGap: 12 },
  disclosure: { width: "100%", borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: "hidden", ...cardShadow },
  disclosureTablet: { width: "48.9%" },
  disclosureOpen: { borderColor: colors.primary },
  disclosureHeader: { minHeight: 72, paddingHorizontal: 13, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 11 },
  disclosureIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  disclosureIconWarning: { backgroundColor: colors.warningBg },
  disclosureBody: { flex: 1, minWidth: 0 },
  disclosureTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  disclosureHint: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  disclosureContent: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, padding: 13, paddingTop: 12 },
  stickyActionTray: { position: "absolute", left: 0, right: 0, bottom: 0, gap: 8, paddingHorizontal: 14, paddingTop: 10, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, ...cardShadow },
  policyDetail: { minHeight: 44, justifyContent: "center" },
  policyFlexibility: { color: colors.primary, fontSize: 12, lineHeight: 18, fontWeight: "800", marginTop: 6 },
  trackingDetail: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12 },
  trackingIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  trackingIconOn: { backgroundColor: colors.successBg },
  trackingIconWarn: { backgroundColor: colors.warningBg },
  trackingIconOff: { backgroundColor: colors.draftBg },
  trackingBody: { flex: 1, minWidth: 0 },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: "900", marginTop: 2 },
  trackingObserved: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 5 },
  trackingRecovery: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", borderRadius: 12, backgroundColor: colors.primarySoft, paddingHorizontal: 13, marginTop: 10 },
  trackingRecoveryText: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  locationDetail: { marginTop: 12 },
  locationDetailBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 12 },
  locationDetailTop: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 8 },
  locationDetailLabel: { flex: 1, color: colors.text, fontSize: 13, fontWeight: "900" },
  sectionMetric: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  insetPanel: { borderRadius: radii.inner, backgroundColor: colors.surfaceMuted, padding: 12 },
  trailCanvas: { minHeight: 172, overflow: "hidden" },
  trailLegend: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 10 },
  trailLegendText: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  emptyTrail: { minHeight: 150, alignItems: "center", justifyContent: "center", padding: 20 },
  emptyTrailPin: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  emptyTrailText: { color: colors.muted, fontSize: 12, textAlign: "center", lineHeight: 18, marginTop: 10 },
  timelineDetail: { minHeight: 52 },
  emptyText: { color: colors.muted, fontSize: 12, textAlign: "center", paddingVertical: 20 },
  eventRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 11 },
  eventBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  eventMark: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success },
  eventMarkPending: { backgroundColor: colors.warning },
  eventBody: { flex: 1, paddingVertical: 10 },
  eventTitle: { color: colors.text, fontSize: 12, fontWeight: "900" },
  eventMeta: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  eventPending: { color: colors.warning, fontSize: 11, fontWeight: "900" },
  privacyText: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  hrmEntry: { minHeight: 74, marginTop: 12, padding: 13, borderRadius: radii.card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 11, ...cardShadow },
  hrmIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  hrmBody: { flex: 1, minWidth: 0 },
  hrmTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  hrmHint: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
})
