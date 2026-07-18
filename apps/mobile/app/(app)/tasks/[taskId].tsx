import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Alert, BackHandler, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, Vibration, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
  type BarcodeType,
} from "expo-camera"
import * as Crypto from "expo-crypto"
import * as FileSystem from "expo-file-system/legacy"
import Constants from "expo-constants"
import { Accelerometer } from "expo-sensors"
import {
  enqueueProofException,
  enqueueTaskComment,
  enqueueTaskStatus,
  getBundle,
  getStore,
  getTask,
  listTaskCaptureExceptions,
  listTaskPhotoProofs,
  type TaskCaptureExceptionRow,
  type TaskPhotoProofRow,
} from "../../../src/db/local-store"
import { tokenStore } from "../../../src/auth/token-store"
import { getCurrentDeviceLocation } from "../../../src/location/device-location"
import {
  activeRetakeStepIds,
  getCaptureStepFromProof,
  getCompletedCaptureStepIds,
  getNextRequiredCaptureStep,
  isRequiredScenarioComplete,
  resolveCaptureScenario,
  toCaptureStepMetadata,
  type CaptureScenarioStep,
} from "../../../src/photos/capture-scenario"
import { selectBestBurstShot, type BurstIssue, type BurstShot } from "../../../src/photos/burst-select"
import { captureBurstFrames } from "../../../src/photos/capture-burst"
import {
  buildEquipmentSilhouette,
  buildTelemetryPayload,
  computeTilt,
  evaluateTilt,
  type EquipmentGeometry,
} from "../../../src/photos/capture-guide"
import { buildProofExifJson } from "../../../src/photos/proof-metadata"
import { persistAndQueuePhoto } from "../../../src/photos/photo-store"
import { PhotoStorageLimitError } from "../../../src/photos/photo-storage-policy"
import {
  findPlacementSummaryByCode,
  listChangeSummaries,
  listPlacementSummaries,
} from "../../../src/planogram/bundle-utils"
import { PlanogramSvg, type Bundle } from "../../../src/planogram/PlanogramSvg"
import { useSync } from "../../../src/sync/sync-context"
import { SyncBar } from "../../../src/components/SyncBar"
import { ShelfComparisonCard } from "../../../src/components/ShelfComparisonCard"
import { t, useLocale, type MessageKey } from "../../../src/i18n"
import type { MobileTaskStatus } from "@leadshelf/api-contracts/mobile/v1"
import type { TaskRow } from "../../../src/sync/ports"

const EXCEPTION_REASONS = ["no_access", "equipment_missing", "obstruction", "other"] as const

const BARCODE_TYPES: BarcodeType[] = [
  "ean13",
  "ean8",
  "upc_a",
  "upc_e",
  "code128",
  "code39",
  "code93",
  "itf14",
  "codabar",
  "datamatrix",
  "qr",
]

export default function TaskDetailScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>()
  const { sync } = useSync()
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const photoCameraRef = useRef<CameraView | null>(null)
  const discardRecordingRef = useRef(false)
  const [task, setTask] = useState<TaskRow | null>(null)
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [photoProofs, setPhotoProofs] = useState<TaskPhotoProofRow[]>([])
  const [comment, setComment] = useState("")
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null)
  const [barcodeQuery, setBarcodeQuery] = useState("")
  const [lastBarcodeLookup, setLastBarcodeLookup] = useState<string | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [photoCameraOpen, setPhotoCameraOpen] = useState(false)
  const [photoSaving, setPhotoSaving] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [videoRecording, setVideoRecording] = useState(false)
  const [activeCaptureStepId, setActiveCaptureStepId] = useState<string | null>(null)
  const locale = useLocale()
  const [captureExceptions, setCaptureExceptions] = useState<TaskCaptureExceptionRow[]>([])
  const [exceptionStepId, setExceptionStepId] = useState<string | null>(null)
  const [mismatchFlagged, setMismatchFlagged] = useState(false)
  const [gyroAvailable, setGyroAvailable] = useState(false)
  const [tiltSample, setTiltSample] = useState<{ x: number; y: number; z: number } | null>(null)
  const [showDone, setShowDone] = useState(false)
  const hasCapturedRef = useRef(false)
  const wasCompleteRef = useRef(false)
  const stepOpenedAtRef = useRef(0)
  const retakesRef = useRef(0)
  const wasLevelRef = useRef(false)

  const reload = useCallback(() => {
    const fresh = getTask(taskId)
    setTask(fresh)
    if (fresh?.planogramVersionId) {
      setBundle(getBundle(fresh.planogramVersionId) as Bundle | null)
    }
    setPhotoProofs(listTaskPhotoProofs(taskId))
    setCaptureExceptions(listTaskCaptureExceptions(taskId))
  }, [taskId])
  useFocusEffect(reload)

  const placementSummaries = useMemo(
    () => (bundle ? listPlacementSummaries(bundle) : []),
    [bundle],
  )
  const changeSummaries = useMemo(() => (bundle ? listChangeSummaries(bundle) : []), [bundle])
  const barcodeLookupResult = useMemo(
    () =>
      lastBarcodeLookup
        ? findPlacementSummaryByCode(placementSummaries, lastBarcodeLookup)
        : null,
    [lastBarcodeLookup, placementSummaries],
  )
  const selectedPlacement =
    placementSummaries.find((p) => p.placementId === selectedPlacementId) ??
    placementSummaries[0] ??
    null
  const scenario = useMemo(
    () => resolveCaptureScenario(task?.captureTemplate ?? null, locale),
    [task?.captureTemplate, locale],
  )
  const completedCaptureStepIds = useMemo(
    () => getCompletedCaptureStepIds(photoProofs),
    [photoProofs],
  )
  const exceptionStepIds = useMemo(
    () => new Set(captureExceptions.map((exception) => exception.stepId)),
    [captureExceptions],
  )
  const retakeStepIds = useMemo(
    () => activeRetakeStepIds(task?.captureRetakes, photoProofs),
    [task?.captureRetakes, photoProofs],
  )
  const nextRequiredCaptureStep = useMemo(
    () =>
      getNextRequiredCaptureStep(
        new Set(
          [...completedCaptureStepIds, ...exceptionStepIds].filter((id) => !retakeStepIds.has(id)),
        ),
        scenario.steps,
      ),
    [completedCaptureStepIds, exceptionStepIds, retakeStepIds, scenario.steps],
  )
  const firstCaptureStep = scenario.steps[0]!
  const activeCaptureStep =
    scenario.steps.find((step) => step.id === activeCaptureStepId) ??
    nextRequiredCaptureStep ??
    firstCaptureStep
  const requiredCaptureComplete = isRequiredScenarioComplete(
    scenario.steps,
    completedCaptureStepIds,
    exceptionStepIds,
    retakeStepIds,
  )
  const comparisonProof = photoProofs.find((proof) => proof.comparisonResult != null) ?? null
  const equipmentSilhouette = useMemo(
    () =>
      buildEquipmentSilhouette(
        ((bundle?.equipment?.[0] as unknown) as EquipmentGeometry | undefined) ?? null,
      ),
    [bundle],
  )

  // Аппаратный «Назад» закрывает открытый оверлей (камера/сканер/причина),
  // а не выкидывает весь экран задачи в список (docs/28 P0).
  useEffect(() => {
    const onBack = () => {
      if (photoCameraOpen) {
        if (videoRecording) {
          discardRecordingRef.current = true
          photoCameraRef.current?.stopRecording()
          setVideoRecording(false)
        }
        setCameraReady(false)
        setPhotoCameraOpen(false)
        return true
      }
      if (scannerOpen) {
        setScannerOpen(false)
        return true
      }
      if (exceptionStepId) {
        setExceptionStepId(null)
        return true
      }
      return false
    }
    const sub = BackHandler.addEventListener("hardwareBackPress", onBack)
    return () => sub.remove()
  }, [photoCameraOpen, scannerOpen, exceptionStepId, videoRecording])

  const captureStepIndex =
    scenario.steps.findIndex((step) => step.id === activeCaptureStep.id) + 1
  const captureStepTotal = scenario.steps.length

  // Празднуем закрытие обязательного сценария один раз — после реального
  // кадра в этой сессии (docs/28 P0: экран «Готово» + вибро).
  useEffect(() => {
    if (requiredCaptureComplete && !wasCompleteRef.current && hasCapturedRef.current) {
      setShowDone(true)
      Vibration.vibrate(60)
    }
    wasCompleteRef.current = requiredCaptureComplete
  }, [requiredCaptureComplete])

  // Пузырьковый уровень: акселерометр активен только внутри шага съемки
  // с tilt-гейтом (docs/24: батарея, деградация без гироскопа).
  const tiltToleranceDeg = activeCaptureStep.tiltToleranceDeg
  useEffect(() => {
    if (!photoCameraOpen || tiltToleranceDeg == null) return
    let removed = false
    let subscription: { remove: () => void } | null = null
    Accelerometer.isAvailableAsync()
      .catch(() => false)
      .then((available) => {
        if (removed) return
        setGyroAvailable(!!available)
        if (!available) return
        Accelerometer.setUpdateInterval(150)
        subscription = Accelerometer.addListener((sample) => setTiltSample(sample))
      })
    return () => {
      removed = true
      subscription?.remove()
      setTiltSample(null)
    }
  }, [photoCameraOpen, tiltToleranceDeg])

  const tiltLevel = useMemo(() => {
    if (tiltToleranceDeg == null || !tiltSample) return null
    return evaluateTilt(computeTilt(tiltSample), tiltToleranceDeg).level
  }, [tiltSample, tiltToleranceDeg])

  useEffect(() => {
    if (tiltLevel && !wasLevelRef.current) Vibration.vibrate(60)
    wasLevelRef.current = !!tiltLevel
  }, [tiltLevel])

  if (!task) return null
  const store = getStore(task.storeId)
  const primaryEquipmentName = task.locationHint?.equipmentName ?? bundle?.equipment[0]?.name ?? null
  const locationTitle = task.locationHint?.label ?? primaryEquipmentName ?? store?.name ?? t("noLocationHint")
  const locationPosition =
    task.locationHint?.xMm != null && task.locationHint.yMm != null
      ? `${task.locationHint.xMm}x${task.locationHint.yMm} mm`
      : null

  function start() {
    // оптимистично локально + в outbox; синк доставит
    enqueueTaskStatus({
      clientOpId: `op-${Crypto.randomUUID()}`,
      taskId: task!.id,
      expectedStatus: task!.status,
      toStatus: "IN_PROGRESS",
    })
    reload()
    void sync()
  }

  function showCaptureError(error: unknown) {
    Alert.alert(
      error instanceof PhotoStorageLimitError ? t("photoStorageFull") : t("captureCameraFailed"),
    )
  }

  async function queueProofPhoto(
    sourceUri: string,
    captureStep: CaptureScenarioStep,
    durationMs: number | null = null,
    captureFlags: Record<string, unknown> | null = null,
    captureTelemetry: Record<string, unknown> | null = null,
  ) {
    let expectedTaskStatus: MobileTaskStatus = task!.status
    if (task!.status === "NEW") {
      enqueueTaskStatus({
        clientOpId: `op-${Crypto.randomUUID()}`,
        taskId: task!.id,
        expectedStatus: "NEW",
        toStatus: "IN_PROGRESS",
      })
      expectedTaskStatus = "IN_PROGRESS"
    }
    const takenAt = new Date().toISOString()
    const userId = await tokenStore.getUserId()
    const deviceLocation = await getCurrentDeviceLocation().catch(() => null)
    const captureStepMetadata = toCaptureStepMetadata(captureStep, scenario.scenarioId)
    const exifJson = buildProofExifJson({
      takenAt,
      userId,
      taskId: task!.id,
      storeId: task!.storeId,
      storeName: store?.name ?? null,
      locationHint: locationTitle,
      appVersion: Constants.expoConfig?.version ?? null,
      deviceLocation,
      captureStep: captureStepMetadata,
    })
    await persistAndQueuePhoto({
      taskId: task!.id,
      sourceUri,
      expectedTaskStatus,
      takenAt,
      mediaType: captureStep.mediaKind,
      durationMs,
      captureStepJson: JSON.stringify(captureStepMetadata),
      exifJson,
      captureFlagsJson: captureFlags ? JSON.stringify(captureFlags) : null,
      captureTelemetryJson: captureTelemetry ? JSON.stringify(captureTelemetry) : null,
    })
    hasCapturedRef.current = true
    Vibration.vibrate(40) // тактильное «снято», без блокирующего Alert
    reload()
    void sync()
  }

  async function openProofCamera(captureStep: CaptureScenarioStep) {
    const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission()
    if (!permission.granted) {
      Alert.alert(t("cameraPermissionDenied"))
      return
    }
    setScannerOpen(false)
    setVideoRecording(false)
    discardRecordingRef.current = false
    setActiveCaptureStepId(captureStep.id)
    setMismatchFlagged(false)
    retakesRef.current = 0
    stepOpenedAtRef.current = Date.now()
    setCameraReady(false)
    setPhotoCameraOpen(true)
  }

  async function takePhoto() {
    await openProofCamera(nextRequiredCaptureStep ?? activeCaptureStep)
  }

  async function acceptBurstShot(
    shot: BurstShot,
    issues: BurstIssue[],
    manualOverride: boolean,
  ) {
    const captureFlags: Record<string, unknown> = {}
    if (mismatchFlagged) captureFlags.equipmentMismatch = true
    if (manualOverride) captureFlags.acceptedWithWarnings = true
    const captureTelemetry = buildTelemetryPayload({
      stepId: activeCaptureStep.id,
      openedAt: stepOpenedAtRef.current,
      acceptedAt: Date.now(),
      retakes: retakesRef.current,
      manualOverride,
      gyroAvailable,
      issues,
    })
    await queueProofPhoto(
      shot.uri,
      activeCaptureStep,
      null,
      Object.keys(captureFlags).length > 0 ? captureFlags : null,
      captureTelemetry,
    )
    await FileSystem.deleteAsync(shot.uri, { idempotent: true }).catch(() => {})
    setCameraReady(false)
    setPhotoCameraOpen(false)
  }

  async function captureProofPhoto() {
    if (activeCaptureStep.mediaKind === "video") {
      await toggleProofVideo()
      return
    }
    if (photoSaving || !cameraReady) return
    setPhotoSaving(true)
    try {
      // Burst-серия: лучший кадр по размеру файла, остальные удаляем.
      const burstCount = Math.max(1, activeCaptureStep.burstCount)
      const burst = await captureBurstFrames<BurstShot>({
        count: burstCount,
        capture: async () => {
          const picture = await photoCameraRef.current?.takePictureAsync({ quality: 0.7, exif: true })
          if (!picture?.uri) return null
          const info = await FileSystem.getInfoAsync(picture.uri).catch(() => null)
          return {
            uri: picture.uri,
            byteSize: info && info.exists && typeof info.size === "number" ? info.size : null,
            exif: (picture.exif as Record<string, unknown> | undefined) ?? null,
          }
        },
      })
      const shots = burst.frames.map((frame) => frame.value)
      if (shots.length === 0) {
        Alert.alert(t("captureCameraFailed"))
        return
      }
      const selection = selectBestBurstShot(shots)
      const best = shots[selection.bestIndex]!
      await Promise.all(
        shots
          .filter((_, index) => index !== selection.bestIndex)
          .map((shot) => FileSystem.deleteAsync(shot.uri, { idempotent: true }).catch(() => {})),
      )
      if (selection.issues.length === 0) {
        await acceptBurstShot(best, [], false)
        return
      }
      // Гид советует, но не блокирует (docs/24): всегда можно отправить как есть.
      const issueKey = selection.issues.includes("too_dark")
        ? "captureIssueTooDark"
        : "captureIssueLowLight"
      Alert.alert(t(issueKey as MessageKey), undefined, [
        {
          text: t("retakeShot"),
          onPress: () => {
            retakesRef.current += 1
            void FileSystem.deleteAsync(best.uri, { idempotent: true }).catch(() => {})
          },
        },
        {
          text: t("useAnyway"),
          onPress: () => {
            void acceptBurstShot(best, selection.issues, true).catch(showCaptureError)
          },
        },
      ])
    } catch (error) {
      showCaptureError(error)
    } finally {
      setPhotoSaving(false)
    }
  }

  function submitStepException(reason: (typeof EXCEPTION_REASONS)[number]) {
    const step = scenario.steps.find((item) => item.id === exceptionStepId)
    if (!step) {
      setExceptionStepId(null)
      return
    }
    enqueueProofException({
      clientOpId: `op-${Crypto.randomUUID()}`,
      taskId: task!.id,
      stepId: step.id,
      stepKind: step.kind,
      reason,
    })
    setExceptionStepId(null)
    Alert.alert(t("exceptionQueued"))
    reload()
    void sync()
  }

  async function toggleProofVideo() {
    const camera = photoCameraRef.current
    if (!camera || !cameraReady) return
    if (videoRecording) {
      camera.stopRecording()
      setVideoRecording(false)
      return
    }

    setPhotoSaving(true)
    setVideoRecording(true)
    discardRecordingRef.current = false
    const startedAt = Date.now()
    try {
      const recording = await camera.recordAsync({
        maxDuration: activeCaptureStep.maxDurationSeconds ?? 8,
        maxFileSize: 28 * 1024 * 1024,
      })
      if (!recording?.uri) return
      if (discardRecordingRef.current) {
        await FileSystem.deleteAsync(recording.uri, { idempotent: true }).catch(() => {})
        setCameraReady(false)
        setPhotoCameraOpen(false)
        return
      }
      await queueProofPhoto(recording.uri, activeCaptureStep, Date.now() - startedAt)
      await FileSystem.deleteAsync(recording.uri, { idempotent: true }).catch(() => {})
      setCameraReady(false)
      setPhotoCameraOpen(false)
    } catch (error) {
      showCaptureError(error)
    } finally {
      discardRecordingRef.current = false
      setVideoRecording(false)
      setPhotoSaving(false)
    }
  }

  function sendComment() {
    const body = comment.trim()
    if (!body) return
    enqueueTaskComment({
      clientOpId: `op-${Crypto.randomUUID()}`,
      taskId: task!.id,
      body,
    })
    setComment("")
    Alert.alert(t("commentQueued"))
    void sync()
  }

  function applyCodeLookup(rawCode: string) {
    const query = rawCode.trim()
    if (!query) {
      setLastBarcodeLookup(null)
      return
    }
    const found = findPlacementSummaryByCode(placementSummaries, query)
    if (found) setSelectedPlacementId(found.placementId)
    setLastBarcodeLookup(query)
  }

  function findProductByCode() {
    applyCodeLookup(barcodeQuery)
  }

  async function openBarcodeScanner() {
    const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission()
    if (!permission.granted) {
      Alert.alert(t("cameraPermissionDenied"))
      return
    }
    setScannerOpen(true)
    setLastBarcodeLookup(null)
  }

  function handleBarcodeScanned(result: BarcodeScanningResult) {
    setScannerOpen(false)
    setBarcodeQuery(result.data)
    applyCodeLookup(result.data)
  }

  function photoProofStatus(proof: TaskPhotoProofRow): string {
    if (!proof.uploaded) return t("photoProofWaitingUpload")
    if (proof.outboxStatus === "pending") return t("photoProofWaitingSubmit")
    if (proof.outboxStatus === "conflict") return t("photoProofConflict")
    if (proof.outboxStatus === "rejected") return t("photoProofRejected")
    if (proof.reviewStatus === "APPROVED") return t("photoProofApproved")
    if (proof.reviewStatus === "REJECTED") return t("photoProofRejected")
    if (proof.reviewStatus === "PENDING") return t("photoProofReviewPending")
    if (proof.visionStatus) return t("photoProofVisionReview")
    return t("photoProofUploaded")
  }

  function photoProofMeta(proof: TaskPhotoProofRow): string {
    const parts = [
      proof.mediaType === "video" && proof.durationMs != null
        ? `${t("proofStepVideo")}: ${Math.round(proof.durationMs / 1000)}s`
        : null,
      proof.uploadedAt ? `${t("uploaded")}: ${proof.uploadedAt.slice(0, 16).replace("T", " ")}` : null,
      proof.qualityScore != null ? `${t("qualityScore")}: ${Math.round(proof.qualityScore * 100)}%` : null,
      proof.reviewStatus ? `${t("reviewStatus")}: ${proof.reviewStatus}` : null,
      proof.visionStatus ? `${t("visionStatus")}: ${proof.visionStatus}` : null,
    ]
    return parts.filter(Boolean).join(" · ")
  }

  function stepTitle(step: CaptureScenarioStep): string {
    return step.titleText ?? t(step.titleKey)
  }

  function stepInstruction(step: CaptureScenarioStep): string {
    return step.instructionText ?? t(step.instructionKey)
  }

  function photoProofStepTitle(proof: TaskPhotoProofRow): string | null {
    const capturedStep = getCaptureStepFromProof(proof)
    const step = scenario.steps.find((item) => item.id === capturedStep?.stepId)
    return step ? stepTitle(step) : (capturedStep?.stepId ?? null)
  }

  if (showDone) {
    return (
      <SafeAreaView style={styles.doneRoot} edges={["top", "bottom"]}>
        <View style={styles.doneCard}>
          <Text style={styles.doneCheck}>✅</Text>
          <Text style={styles.doneTitle}>{t("doneTitle")}</Text>
          <Text style={styles.doneMeta} numberOfLines={2}>
            {t("doneMeta")}
          </Text>
        </View>
        <Pressable style={styles.doneButton} onPress={() => setShowDone(false)}>
          <Text style={styles.doneButtonText}>{t("doneNext")}</Text>
        </Pressable>
      </SafeAreaView>
    )
  }

  if (photoCameraOpen) {
    return (
      <SafeAreaView style={styles.proofRoot} edges={["top", "bottom"]}>
        <CameraView
          ref={photoCameraRef}
          style={styles.proofCamera}
          facing="back"
          mode={activeCaptureStep.mediaKind === "video" ? "video" : "picture"}
          onCameraReady={() => setCameraReady(true)}
          onMountError={() => {
            setCameraReady(false)
            setPhotoCameraOpen(false)
            Alert.alert(t("captureCameraFailed"))
          }}
          mute
          videoQuality="720p"
        />
        <View style={styles.proofTop}>
          <Text style={styles.proofEyebrow}>
            {t("stepWord")} {captureStepIndex}/{captureStepTotal}
          </Text>
          <Text style={styles.proofTitle} numberOfLines={2}>
            {stepTitle(activeCaptureStep)}
          </Text>
          <Text style={styles.proofMeta} numberOfLines={2}>
            {stepInstruction(activeCaptureStep)}
          </Text>
        </View>
        {/* Гид зависит от шага: прямой силуэт (front/top_down), косой под
            углом (left/right depth), прицел по центру (detail) — docs/28. */}
        <View style={styles.silhouetteWrap} pointerEvents="none">
          {activeCaptureStep.kind === "detail" ? (
            <View style={styles.detailTarget} />
          ) : (
            <View
              style={[
                styles.silhouette,
                { aspectRatio: equipmentSilhouette?.aspect ?? 0.72 },
                activeCaptureStep.kind === "left_depth" && styles.silhouetteAngleLeft,
                activeCaptureStep.kind === "right_depth" && styles.silhouetteAngleRight,
                tiltLevel === true && styles.silhouetteLevel,
              ]}
            >
              {(equipmentSilhouette?.shelfFractions ?? []).map((fraction) => (
                <View
                  key={fraction}
                  style={[styles.silhouetteShelf, { top: `${Math.round(fraction * 100)}%` }]}
                />
              ))}
            </View>
          )}
          {activeCaptureStep.kind === "left_depth" ? (
            <Text style={[styles.guideArrow, styles.guideArrowLeft]}>◀</Text>
          ) : activeCaptureStep.kind === "right_depth" ? (
            <Text style={[styles.guideArrow, styles.guideArrowRight]}>▶</Text>
          ) : null}
        </View>
        <View style={styles.proofBottom}>
          {tiltToleranceDeg != null && gyroAvailable ? (
            <View style={styles.levelRow}>
              <View style={[styles.levelDot, tiltLevel ? styles.levelDotOk : styles.levelDotBad]} />
              <Text style={styles.proofMeta}>
                {tiltLevel ? t("guideLevelOk") : t("guideHoldLevel")}
              </Text>
            </View>
          ) : null}
          <Pressable
            style={[styles.mismatchButton, mismatchFlagged && styles.mismatchButtonOn]}
            onPress={() => setMismatchFlagged((value) => !value)}
          >
            <Text style={styles.mismatchButtonText}>
              {mismatchFlagged ? t("equipmentMismatchOn") : t("equipmentMismatchButton")}
            </Text>
          </Pressable>
          <Text style={styles.proofMeta} numberOfLines={2}>
            {videoRecording
              ? `${t("recordingVideo")} · ${locationTitle}`
              : activeCaptureStep.mediaKind === "video"
                ? `${t("proofStepVideo")} ${activeCaptureStep.minDurationSeconds}-${activeCaptureStep.maxDurationSeconds}s · ${locationTitle}`
                : `${t("proofStepPhoto")} · ${locationTitle}`}
          </Text>
          <View style={styles.proofActions}>
            <Pressable
              style={styles.proofSecondary}
              disabled={photoSaving && !videoRecording}
              onPress={() => {
                if (videoRecording) {
                  discardRecordingRef.current = true
                  photoCameraRef.current?.stopRecording()
                  setVideoRecording(false)
                  return
                }
                setCameraReady(false)
                setPhotoCameraOpen(false)
              }}
            >
              <Text style={styles.proofSecondaryText}>{t("cancel")}</Text>
            </Pressable>
            <Pressable
              style={[
                styles.proofCapture,
                (!cameraReady || (photoSaving && !videoRecording)) && styles.disabled,
              ]}
              disabled={!cameraReady || (photoSaving && !videoRecording)}
              onPress={captureProofPhoto}
            >
              <Text style={styles.proofCaptureText}>
                {!cameraReady
                  ? t("cameraPreparing")
                  : activeCaptureStep.mediaKind === "video"
                  ? videoRecording
                    ? t("stopVideo")
                    : photoSaving
                      ? t("savingPhoto")
                      : t("recordVideo")
                  : photoSaving
                    ? activeCaptureStep.burstCount > 1
                      ? t("captureBurst")
                      : t("savingPhoto")
                    : t("captureStepPhoto")}
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {task.title}
          </Text>
          <Text style={styles.meta}>
            {store?.name ?? ""} · {t(`status_${task.status}` as MessageKey)}
          </Text>
        </View>
      </View>
      <SyncBar />
      <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
        <View style={styles.proofSummaryCard}>
          <View style={styles.proofSummaryHeader}>
            <Text style={styles.proofSummaryTitle}>{t("photoProof")}</Text>
            <Text style={styles.proofSummaryCount}>
              {photoProofs.length} {t("photos")}
            </Text>
          </View>
          {photoProofs.length === 0 ? (
            <Text style={styles.proofSummaryEmpty}>{t("noPhotoProofs")}</Text>
          ) : (
            <View style={styles.proofList}>
              {photoProofs.slice(0, 3).map((proof) => {
                const stepTitle = photoProofStepTitle(proof)
                return (
                  <View key={proof.clientPhotoId} style={styles.proofRow}>
                    {proof.fileUri && proof.mediaType === "photo" ? (
                      <Image source={{ uri: proof.fileUri }} style={styles.proofThumb} />
                    ) : (
                      <View style={[styles.proofThumb, styles.proofThumbEmpty]}>
                        <Text style={styles.proofThumbIcon}>{proof.mediaType === "video" ? "🎬" : "🖼"}</Text>
                      </View>
                    )}
                    <View style={styles.proofRowBody}>
                      <Text style={styles.proofRowTitle}>
                        {stepTitle ? `${stepTitle} · ${photoProofStatus(proof)}` : photoProofStatus(proof)}
                      </Text>
                      <Text style={styles.proofRowMeta} numberOfLines={2}>
                        {photoProofMeta(proof) || `${t("takenAt")}: ${proof.takenAt.slice(0, 16).replace("T", " ")}`}
                      </Text>
                      {proof.reviewNote || proof.visionReason ? (
                        <Text style={styles.proofRowWarning} numberOfLines={2}>
                          {proof.reviewNote ?? proof.visionReason}
                        </Text>
                      ) : null}
                    </View>
                    <View style={[styles.proofStateDot, proof.uploaded && styles.proofStateDotDone]} />
                  </View>
                )
              })}
            </View>
          )}
        </View>
        {comparisonProof?.comparisonResult ? (
          <ShelfComparisonCard
            result={comparisonProof.comparisonResult}
            photoUri={comparisonProof.mediaType === "photo" ? comparisonProof.fileUri : null}
          />
        ) : null}
        <View style={styles.guidedProofCard}>
          <View style={styles.proofSummaryHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.proofSummaryTitle}>{t("guidedProof")}</Text>
              <Text style={styles.guidedProofSubtitle}>
                {requiredCaptureComplete ? t("proofScenarioComplete") : t("proofScenarioIncomplete")}
              </Text>
            </View>
            <Text style={[styles.scenarioBadge, requiredCaptureComplete && styles.scenarioBadgeDone]}>
              {completedCaptureStepIds.size}/{scenario.steps.length}
            </Text>
          </View>
          <View style={styles.captureStepList}>
            {scenario.steps.map((step) => {
              const retake = retakeStepIds.has(step.id)
              const done = completedCaptureStepIds.has(step.id) && !retake
              const excepted = !done && !retake && exceptionStepIds.has(step.id)
              const retakeNote = retake
                ? (task.captureRetakes?.find((item) => item.stepId === step.id)?.note ?? null)
                : null
              return (
                <View
                  key={step.id}
                  style={[
                    styles.captureStepRow,
                    done && styles.captureStepRowDone,
                    retake && styles.captureStepRowRetake,
                  ]}
                >
                  <View style={styles.captureStepNumber}>
                    <Text style={styles.captureStepNumberText}>{step.sequence}</Text>
                  </View>
                  <View style={styles.captureStepBody}>
                    <Text style={styles.captureStepTitle}>{stepTitle(step)}</Text>
                    <Text style={styles.captureStepInstruction} numberOfLines={2}>
                      {stepInstruction(step)}
                    </Text>
                    <Text
                      style={[
                        styles.captureStepStatus,
                        done && styles.captureStepStatusDone,
                        retake && styles.captureStepStatusRetake,
                      ]}
                    >
                      {step.mediaKind === "video"
                        ? `${t("proofStepVideo")} ${step.minDurationSeconds}-${step.maxDurationSeconds}s · `
                        : `${t("proofStepPhoto")} · `}
                      {retake
                        ? t("retakeRequested")
                        : done
                          ? t("proofStepDone")
                          : excepted
                            ? t("stepExceptionBadge")
                            : step.required
                              ? t("proofStepRequired")
                              : t("proofStepOptional")}
                    </Text>
                    {retakeNote ? (
                      <Text style={styles.captureStepRetakeNote} numberOfLines={2}>
                        {retakeNote}
                      </Text>
                    ) : null}
                    {step.required && !done && !excepted && !retake ? (
                      <Pressable onPress={() => setExceptionStepId(step.id)}>
                        <Text style={styles.captureStepExceptionLink}>{t("cantCaptureStep")}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <Pressable style={styles.captureStepButton} onPress={() => openProofCamera(step)}>
                    <Text style={styles.captureStepButtonText}>
                      {done || retake ? t("retakeStep") : t("startStep")}
                    </Text>
                  </Pressable>
                </View>
              )
            })}
          </View>
        </View>
        <Text style={styles.section}>{t("locationHint")}</Text>
        <View style={styles.locationCard}>
          <Text style={styles.locationTitle}>{locationTitle}</Text>
          <View style={styles.locationGrid}>
            {task.locationHint?.floorPlanName ? (
              <>
                <Text style={styles.detailLabel}>{t("floorPlan")}</Text>
                <Text style={styles.detailValue}>{task.locationHint.floorPlanName}</Text>
              </>
            ) : null}
            {primaryEquipmentName ? (
              <>
                <Text style={styles.detailLabel}>{t("equipment")}</Text>
                <Text style={styles.detailValue}>{primaryEquipmentName}</Text>
              </>
            ) : null}
            {locationPosition ? (
              <>
                <Text style={styles.detailLabel}>{t("position")}</Text>
                <Text style={styles.detailValue}>{locationPosition}</Text>
              </>
            ) : null}
            {task.locationHint?.rotationDeg != null ? (
              <>
                <Text style={styles.detailLabel}>{t("rotation")}</Text>
                <Text style={styles.detailValue}>{task.locationHint.rotationDeg}°</Text>
              </>
            ) : null}
            {store?.address ? (
              <>
                <Text style={styles.detailLabel}>{t("storeAddress")}</Text>
                <Text style={styles.detailValue}>{store.address}</Text>
              </>
            ) : null}
            {!task.locationHint ? (
              <Text style={styles.locationMeta}>{t("noLocationHint")}</Text>
            ) : null}
          </View>
        </View>
        {bundle ? (
          <>
            <Text style={styles.section}>{t("planogram")}</Text>
            <PlanogramSvg
              bundle={bundle}
              selectedPlacementId={selectedPlacement?.placementId ?? null}
              onPlacementPress={setSelectedPlacementId}
            />
            <Text style={styles.section}>{t("productDetail")}</Text>
            {selectedPlacement ? (
              <View style={styles.detailCard}>
                <Text style={styles.detailTitle}>{selectedPlacement.name}</Text>
                <Text style={styles.detailMeta}>
                  {selectedPlacement.sku}
                  {selectedPlacement.brandName ? ` · ${selectedPlacement.brandName}` : ""}
                </Text>
                <View style={styles.detailGrid}>
                  <Text style={styles.detailLabel}>{t("shelf")}</Text>
                  <Text style={styles.detailValue}>{selectedPlacement.shelfLabel}</Text>
                  <Text style={styles.detailLabel}>{t("dimensions")}</Text>
                  <Text style={styles.detailValue}>{selectedPlacement.dimensionsLabel}</Text>
                  <Text style={styles.detailLabel}>{t("facings")}</Text>
                  <Text style={styles.detailValue}>{selectedPlacement.facingsLabel}</Text>
                  <Text style={styles.detailLabel}>{t("units")}</Text>
                  <Text style={styles.detailValue}>{selectedPlacement.totalUnits}</Text>
                  <Text style={styles.detailLabel}>{t("barcode")}</Text>
                  <Text style={styles.detailValue}>{selectedPlacement.barcode ?? "-"}</Text>
                </View>
              </View>
            ) : null}
            {placementSummaries.length > 0 ? (
              <>
                <Text style={styles.section}>{t("barcodeFinder")}</Text>
                <View style={styles.finderCard}>
                  <View style={styles.finderRow}>
                    <TextInput
                      value={barcodeQuery}
                      onChangeText={(value) => {
                        setBarcodeQuery(value)
                        setLastBarcodeLookup(null)
                      }}
                      placeholder={t("barcodePlaceholder")}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      returnKeyType="search"
                      onSubmitEditing={findProductByCode}
                      style={styles.finderInput}
                    />
                    <Pressable
                      style={[styles.finderButton, !barcodeQuery.trim() && styles.disabled]}
                      disabled={!barcodeQuery.trim()}
                      onPress={findProductByCode}
                    >
                      <Text style={styles.finderButtonText}>{t("findProduct")}</Text>
                    </Pressable>
                  </View>
                  <Pressable style={styles.scanButton} onPress={openBarcodeScanner}>
                    <Text style={styles.scanButtonText}>{t("scanBarcode")}</Text>
                  </Pressable>
                  {scannerOpen ? (
                    <View style={styles.scannerCard}>
                      <CameraView
                        style={styles.scannerCamera}
                        facing="back"
                        barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
                        onBarcodeScanned={handleBarcodeScanned}
                      />
                      <View style={styles.scannerFooter}>
                        <Text style={styles.scannerHint}>{t("scannerHint")}</Text>
                        <Pressable style={styles.scannerClose} onPress={() => setScannerOpen(false)}>
                          <Text style={styles.scannerCloseText}>{t("closeScanner")}</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                  {lastBarcodeLookup ? (
                    <Text
                      style={[
                        styles.finderMessage,
                        barcodeLookupResult ? styles.finderSuccess : styles.finderError,
                      ]}
                    >
                      {barcodeLookupResult ? t("barcodeFound") : t("barcodeNotFound")}
                    </Text>
                  ) : null}
                </View>
              </>
            ) : null}
            {placementSummaries.length > 0 ? (
              <>
                <Text style={styles.section}>{t("productList")}</Text>
                <View style={styles.productList}>
                  {placementSummaries.map((item) => {
                    const selected = selectedPlacement?.placementId === item.placementId
                    return (
                      <Pressable
                        key={item.placementId}
                        onPress={() => setSelectedPlacementId(item.placementId)}
                        style={[styles.productRow, selected && styles.productRowSelected]}
                      >
                        <View style={styles.productRowBody}>
                          <Text style={styles.productName} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={styles.productMeta}>
                            {item.sku} · {t("shelf")} {item.shelfLabel}
                          </Text>
                        </View>
                        <Text style={styles.productUnits}>{item.totalUnits}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </>
            ) : null}
            {changeSummaries.length > 0 ? (
              <>
                <Text style={styles.section}>{t("changedItems")}</Text>
                <View style={styles.changeList}>
                  {changeSummaries.map((item) => {
                    const canSelect = !!item.placementId
                    return (
                      <Pressable
                        key={item.id}
                        disabled={!canSelect}
                        onPress={() => item.placementId && setSelectedPlacementId(item.placementId)}
                        style={styles.changeRow}
                      >
                        <Text style={[styles.changeBadge, styles[`change_${item.kind}`]]}>
                          {t(`change_${item.kind}` as MessageKey)}
                        </Text>
                        <View style={styles.productRowBody}>
                          <Text style={styles.productName} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={styles.productMeta}>
                            {item.sku}
                            {item.detail ? ` · ${item.detail}` : ""}
                          </Text>
                        </View>
                      </Pressable>
                    )
                  })}
                </View>
              </>
            ) : null}
          </>
        ) : null}
        <View style={styles.actions}>
          <Text style={styles.section}>{t("comment")}</Text>
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder={t("commentPlaceholder")}
            multiline
            maxLength={2000}
            style={styles.commentInput}
          />
          <Pressable
            style={[styles.secondary, !comment.trim() && styles.disabled]}
            disabled={!comment.trim()}
            onPress={sendComment}
          >
            <Text style={styles.secondaryText}>{t("sendComment")}</Text>
          </Pressable>
          {task.status === "NEW" && (
            <Pressable style={styles.primary} onPress={start}>
              <Text style={styles.primaryText}>{t("start")}</Text>
            </Pressable>
          )}
          {(task.status === "IN_PROGRESS" || task.status === "NEW" || task.status === "PHOTO_SUBMITTED") && (
            <Pressable style={styles.secondary} onPress={takePhoto}>
              <Text style={styles.secondaryText}>{t("takePhoto")}</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
      <Modal
        visible={exceptionStepId != null}
        transparent
        animationType="fade"
        onRequestClose={() => setExceptionStepId(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t("exceptionReasonTitle")}</Text>
            {EXCEPTION_REASONS.map((reason) => (
              <Pressable
                key={reason}
                style={styles.modalOption}
                onPress={() => submitStepException(reason)}
              >
                <Text style={styles.modalOptionText}>
                  {t(`exceptionReason_${reason}` as MessageKey)}
                </Text>
              </Pressable>
            ))}
            <Pressable style={styles.modalCancel} onPress={() => setExceptionStepId(null)}>
              <Text style={styles.modalCancelText}>{t("cancel")}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fafaf9" },
  proofRoot: { flex: 1, backgroundColor: "#171717" },
  proofCamera: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  proofTop: {
    margin: 12,
    borderRadius: 10,
    backgroundColor: "rgba(23, 23, 23, 0.78)",
    padding: 12,
    gap: 4,
  },
  proofEyebrow: { color: "#d6d3d1", fontSize: 11, fontWeight: "700" },
  proofTitle: { color: "white", fontSize: 18, fontWeight: "800" },
  proofMeta: { color: "#e7e5e4", fontSize: 12, fontWeight: "600" },
  silhouetteWrap: {
    position: "absolute",
    top: "16%",
    bottom: "26%",
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  silhouette: {
    width: "76%",
    maxHeight: "100%",
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.85)",
    borderRadius: 10,
    backgroundColor: "transparent",
  },
  silhouetteLevel: { borderColor: "rgba(74, 222, 128, 0.95)" },
  silhouetteAngleLeft: { transform: [{ perspective: 900 }, { rotateY: "30deg" }] },
  silhouetteAngleRight: { transform: [{ perspective: 900 }, { rotateY: "-30deg" }] },
  detailTarget: {
    width: "46%",
    aspectRatio: 1,
    borderWidth: 3,
    borderColor: "rgba(255, 255, 255, 0.9)",
    borderStyle: "dashed",
    borderRadius: 18,
  },
  guideArrow: {
    position: "absolute",
    color: "rgba(255, 255, 255, 0.92)",
    fontSize: 44,
    fontWeight: "900",
  },
  guideArrowLeft: { left: 16 },
  guideArrowRight: { right: 16 },
  silhouetteShelf: {
    position: "absolute",
    left: 4,
    right: 4,
    height: 1.5,
    backgroundColor: "rgba(255, 255, 255, 0.55)",
  },
  levelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  levelDot: { width: 12, height: 12, borderRadius: 6 },
  levelDotOk: { backgroundColor: "#4ade80" },
  levelDotBad: { backgroundColor: "#f59e0b" },
  mismatchButton: {
    alignSelf: "flex-start",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.4)",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  mismatchButtonOn: { backgroundColor: "#b45309", borderColor: "#b45309" },
  mismatchButtonText: { color: "white", fontSize: 12, fontWeight: "700" },
  captureStepExceptionLink: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: "700",
    color: "#b45309",
    textDecorationLine: "underline",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(23, 23, 23, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    borderRadius: 12,
    backgroundColor: "white",
    padding: 16,
    gap: 8,
  },
  modalTitle: { fontSize: 15, fontWeight: "800", color: "#171717", marginBottom: 4 },
  modalOption: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e7e5e4",
    paddingHorizontal: 12,
    backgroundColor: "#fafaf9",
  },
  modalOptionText: { fontSize: 14, fontWeight: "600", color: "#171717" },
  modalCancel: { minHeight: 40, alignItems: "center", justifyContent: "center" },
  modalCancelText: { fontSize: 13, fontWeight: "700", color: "#737373" },
  proofBottom: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 10,
    backgroundColor: "rgba(23, 23, 23, 0.78)",
    padding: 12,
    gap: 10,
  },
  proofActions: { flexDirection: "row", gap: 12, alignItems: "center" },
  proofSecondary: {
    flex: 1,
    minHeight: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.35)",
  },
  proofSecondaryText: { color: "white", fontSize: 16, fontWeight: "700" },
  proofCapture: {
    flex: 2,
    minHeight: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "white",
  },
  proofCaptureText: { color: "#171717", fontSize: 18, fontWeight: "900" },
  doneRoot: {
    flex: 1,
    backgroundColor: "#052e16",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 24,
  },
  doneCard: { alignItems: "center", gap: 10 },
  doneCheck: { fontSize: 96 },
  doneTitle: { color: "white", fontSize: 26, fontWeight: "900", textAlign: "center" },
  doneMeta: { color: "#bbf7d0", fontSize: 15, fontWeight: "600", textAlign: "center" },
  doneButton: {
    minHeight: 64,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "#22c55e",
  },
  doneButtonText: { color: "#052e16", fontSize: 18, fontWeight: "900" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  back: { fontSize: 32, color: "#404040", paddingHorizontal: 6 },
  title: { fontSize: 17, fontWeight: "700" },
  meta: { fontSize: 12, color: "#737373" },
  section: { fontSize: 13, fontWeight: "600", color: "#525252" },
  actions: { gap: 8, marginTop: 8 },
  proofSummaryCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e7e5e4",
    backgroundColor: "white",
    padding: 12,
    gap: 8,
  },
  proofSummaryHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  proofSummaryTitle: { fontSize: 15, fontWeight: "800", color: "#171717" },
  proofSummaryCount: { fontSize: 12, fontWeight: "700", color: "#737373" },
  proofSummaryEmpty: { fontSize: 12, color: "#737373" },
  guidedProofCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d6d3d1",
    backgroundColor: "white",
    padding: 12,
    gap: 10,
  },
  guidedProofSubtitle: { marginTop: 2, fontSize: 12, color: "#525252", fontWeight: "600" },
  scenarioBadge: {
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: "#fef3c7",
    color: "#92400e",
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: "800",
  },
  scenarioBadgeDone: { backgroundColor: "#dcfce7", color: "#166534" },
  captureStepList: { gap: 8 },
  captureStepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e7e5e4",
    backgroundColor: "#fafaf9",
    padding: 10,
  },
  captureStepRowDone: { borderColor: "#bbf7d0", backgroundColor: "#f0fdf4" },
  captureStepRowRetake: { borderColor: "#fed7aa", backgroundColor: "#fff7ed" },
  captureStepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#6366F1",
  },
  captureStepNumberText: { color: "white", fontSize: 12, fontWeight: "800" },
  captureStepBody: { flex: 1, gap: 2 },
  captureStepTitle: { fontSize: 13, fontWeight: "800", color: "#171717" },
  captureStepInstruction: { fontSize: 11, color: "#525252", lineHeight: 15 },
  captureStepStatus: { fontSize: 11, color: "#92400e", fontWeight: "700" },
  captureStepStatusDone: { color: "#166534" },
  captureStepStatusRetake: { color: "#c2410c" },
  captureStepRetakeNote: { marginTop: 2, fontSize: 11, color: "#c2410c", fontWeight: "600" },
  captureStepButton: {
    minHeight: 36,
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#6366F1",
    paddingHorizontal: 10,
  },
  captureStepButtonText: { color: "white", fontSize: 12, fontWeight: "800" },
  proofList: { gap: 8 },
  proofRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 8,
    backgroundColor: "#fafaf9",
    padding: 10,
  },
  proofThumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: "#e7e5e4" },
  proofThumbEmpty: { alignItems: "center", justifyContent: "center" },
  proofThumbIcon: { fontSize: 22 },
  proofRowBody: { flex: 1, gap: 2 },
  proofRowTitle: { fontSize: 13, fontWeight: "800", color: "#171717" },
  proofRowMeta: { fontSize: 11, color: "#525252" },
  proofRowWarning: { marginTop: 2, fontSize: 11, color: "#92400e", fontWeight: "600" },
  proofStateDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#d97706" },
  proofStateDotDone: { backgroundColor: "#16a34a" },
  locationCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e7e5e4",
    backgroundColor: "white",
    padding: 12,
    gap: 8,
  },
  locationTitle: { fontSize: 15, fontWeight: "700", color: "#171717" },
  locationGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: 6 },
  locationMeta: { fontSize: 12, color: "#737373" },
  detailCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e7e5e4",
    backgroundColor: "white",
    padding: 12,
    gap: 8,
  },
  detailTitle: { fontSize: 15, fontWeight: "700", color: "#171717" },
  detailMeta: { fontSize: 12, color: "#737373" },
  detailGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 6,
  },
  detailLabel: { width: "38%", fontSize: 12, color: "#737373" },
  detailValue: { width: "62%", fontSize: 12, fontWeight: "600", color: "#404040" },
  finderCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e7e5e4",
    backgroundColor: "white",
    padding: 10,
    gap: 8,
  },
  finderRow: { flexDirection: "row", gap: 8 },
  finderInput: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 8,
    paddingHorizontal: 10,
    color: "#171717",
    backgroundColor: "#fafaf9",
  },
  finderButton: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#6366F1",
    paddingHorizontal: 12,
  },
  finderButtonText: { color: "white", fontSize: 13, fontWeight: "700" },
  scanButton: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d4d4d4",
    backgroundColor: "#fafaf9",
  },
  scanButtonText: { color: "#171717", fontSize: 13, fontWeight: "700" },
  scannerCard: {
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#d4d4d4",
    backgroundColor: "#171717",
  },
  scannerCamera: { height: 220, width: "100%" },
  scannerFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
  },
  scannerHint: { flex: 1, color: "white", fontSize: 12, fontWeight: "600" },
  scannerClose: {
    borderRadius: 6,
    backgroundColor: "white",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  scannerCloseText: { color: "#171717", fontSize: 12, fontWeight: "700" },
  finderMessage: { fontSize: 12, fontWeight: "600" },
  finderSuccess: { color: "#166534" },
  finderError: { color: "#991b1b" },
  productList: { borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: "#e7e5e4" },
  productRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#f5f5f4",
  },
  productRowSelected: { backgroundColor: "#f5f5f4" },
  productRowBody: { flex: 1 },
  productName: { fontSize: 13, fontWeight: "600", color: "#171717" },
  productMeta: { marginTop: 2, fontSize: 11, color: "#737373" },
  productUnits: { fontSize: 13, fontWeight: "700", color: "#171717" },
  changeList: { borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: "#e7e5e4" },
  changeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#f5f5f4",
  },
  changeBadge: {
    minWidth: 72,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    textAlign: "center",
    fontSize: 10,
    fontWeight: "700",
    overflow: "hidden",
  },
  change_added: { backgroundColor: "#dcfce7", color: "#166534" },
  change_removed: { backgroundColor: "#fee2e2", color: "#991b1b" },
  change_moved: { backgroundColor: "#dbeafe", color: "#1d4ed8" },
  change_changed: { backgroundColor: "#fef3c7", color: "#92400e" },
  change_current: { backgroundColor: "#f5f5f4", color: "#525252" },
  commentInput: {
    minHeight: 84,
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "white",
    color: "#171717",
    textAlignVertical: "top",
  },
  primary: { backgroundColor: "#6366F1", borderRadius: 10, padding: 14, alignItems: "center" },
  primaryText: { color: "white", fontWeight: "600", fontSize: 16 },
  secondary: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
    backgroundColor: "white",
  },
  disabled: { opacity: 0.5 },
  secondaryText: { fontWeight: "600", fontSize: 16, color: "#171717" },
})
