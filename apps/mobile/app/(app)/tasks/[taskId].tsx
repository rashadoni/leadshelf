import { useCallback, useMemo, useRef, useState } from "react"
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
  type BarcodeType,
} from "expo-camera"
import * as Crypto from "expo-crypto"
import Constants from "expo-constants"
import {
  enqueueTaskComment,
  enqueueTaskStatus,
  getBundle,
  getStore,
  getTask,
  listTaskPhotoProofs,
  type TaskPhotoProofRow,
} from "../../../src/db/local-store"
import { tokenStore } from "../../../src/auth/token-store"
import { getCurrentDeviceLocation } from "../../../src/location/device-location"
import { buildProofExifJson } from "../../../src/photos/proof-metadata"
import { persistAndQueuePhoto } from "../../../src/photos/photo-store"
import {
  findPlacementSummaryByCode,
  listChangeSummaries,
  listPlacementSummaries,
} from "../../../src/planogram/bundle-utils"
import { PlanogramSvg, type Bundle } from "../../../src/planogram/PlanogramSvg"
import { useSync } from "../../../src/sync/sync-context"
import { SyncBar } from "../../../src/components/SyncBar"
import { t, type MessageKey } from "../../../src/i18n"
import type { MobileTaskStatus } from "@leadshelf/api-contracts/mobile/v1"
import type { TaskRow } from "../../../src/sync/ports"

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

  const reload = useCallback(() => {
    const fresh = getTask(taskId)
    setTask(fresh)
    if (fresh?.planogramVersionId) {
      setBundle(getBundle(fresh.planogramVersionId) as Bundle | null)
    }
    setPhotoProofs(listTaskPhotoProofs(taskId))
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

  async function queueProofPhoto(sourceUri: string) {
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
    const exifJson = buildProofExifJson({
      takenAt,
      userId,
      taskId: task!.id,
      storeId: task!.storeId,
      storeName: store?.name ?? null,
      locationHint: locationTitle,
      appVersion: Constants.expoConfig?.version ?? null,
      deviceLocation,
    })
    await persistAndQueuePhoto({
      taskId: task!.id,
      sourceUri,
      expectedTaskStatus,
      takenAt,
      exifJson,
    })
    Alert.alert(t("photoQueued"))
    reload()
    void sync()
  }

  async function takePhoto() {
    const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission()
    if (!permission.granted) {
      Alert.alert(t("cameraPermissionDenied"))
      return
    }
    setScannerOpen(false)
    setPhotoCameraOpen(true)
  }

  async function captureProofPhoto() {
    if (photoSaving) return
    setPhotoSaving(true)
    try {
      const picture = await photoCameraRef.current?.takePictureAsync({ quality: 0.7 })
      if (!picture?.uri) return
      await queueProofPhoto(picture.uri)
      setPhotoCameraOpen(false)
    } finally {
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
      proof.uploadedAt ? `${t("uploaded")}: ${proof.uploadedAt.slice(0, 16).replace("T", " ")}` : null,
      proof.qualityScore != null ? `${t("qualityScore")}: ${Math.round(proof.qualityScore * 100)}%` : null,
      proof.reviewStatus ? `${t("reviewStatus")}: ${proof.reviewStatus}` : null,
      proof.visionStatus ? `${t("visionStatus")}: ${proof.visionStatus}` : null,
    ]
    return parts.filter(Boolean).join(" · ")
  }

  if (photoCameraOpen) {
    return (
      <SafeAreaView style={styles.proofRoot} edges={["top", "bottom"]}>
        <CameraView ref={photoCameraRef} style={styles.proofCamera} facing="back" />
        <View style={styles.proofTop}>
          <Text style={styles.proofEyebrow}>{t("photoOverlayHint")}</Text>
          <Text style={styles.proofTitle} numberOfLines={2}>
            {selectedPlacement?.name ?? task.title}
          </Text>
          <Text style={styles.proofMeta} numberOfLines={2}>
            {selectedPlacement
              ? `${selectedPlacement.sku} · ${t("shelf")} ${selectedPlacement.shelfLabel}`
              : locationTitle}
          </Text>
        </View>
        <View style={styles.proofFrame} pointerEvents="none" />
        <View style={styles.proofBottom}>
          <Text style={styles.proofMeta} numberOfLines={2}>
            {locationTitle}
          </Text>
          <View style={styles.proofActions}>
            <Pressable
              style={styles.proofSecondary}
              disabled={photoSaving}
              onPress={() => setPhotoCameraOpen(false)}
            >
              <Text style={styles.proofSecondaryText}>{t("cancel")}</Text>
            </Pressable>
            <Pressable
              style={[styles.proofCapture, photoSaving && styles.disabled]}
              disabled={photoSaving}
              onPress={captureProofPhoto}
            >
              <Text style={styles.proofCaptureText}>
                {photoSaving ? t("savingPhoto") : t("capturePhoto")}
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
              {photoProofs.slice(0, 3).map((proof) => (
                <View key={proof.clientPhotoId} style={styles.proofRow}>
                  <View style={styles.proofRowBody}>
                    <Text style={styles.proofRowTitle}>{photoProofStatus(proof)}</Text>
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
              ))}
            </View>
          )}
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
              <Text style={styles.secondaryText}>📷 {t("takePhoto")}</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
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
  proofFrame: {
    position: "absolute",
    left: 28,
    right: 28,
    top: "29%",
    height: "34%",
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.9)",
    borderRadius: 10,
    backgroundColor: "transparent",
  },
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
  proofActions: { flexDirection: "row", gap: 10 },
  proofSecondary: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.35)",
  },
  proofSecondaryText: { color: "white", fontSize: 15, fontWeight: "700" },
  proofCapture: {
    flex: 1.2,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "white",
  },
  proofCaptureText: { color: "#171717", fontSize: 15, fontWeight: "800" },
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
  proofList: { gap: 8 },
  proofRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 8,
    backgroundColor: "#fafaf9",
    padding: 10,
  },
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
    backgroundColor: "#171717",
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
  primary: { backgroundColor: "#171717", borderRadius: 10, padding: 14, alignItems: "center" },
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
