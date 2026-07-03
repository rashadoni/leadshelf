import { useCallback, useMemo, useState } from "react"
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import * as ImagePicker from "expo-image-picker"
import * as Crypto from "expo-crypto"
import {
  enqueueTaskComment,
  enqueueTaskStatus,
  getBundle,
  getStore,
  getTask,
} from "../../../src/db/local-store"
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

export default function TaskDetailScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>()
  const { sync } = useSync()
  const [task, setTask] = useState<TaskRow | null>(null)
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [comment, setComment] = useState("")
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null)
  const [barcodeQuery, setBarcodeQuery] = useState("")
  const [lastBarcodeLookup, setLastBarcodeLookup] = useState<string | null>(null)

  const reload = useCallback(() => {
    const fresh = getTask(taskId)
    setTask(fresh)
    if (fresh?.planogramVersionId) {
      setBundle(getBundle(fresh.planogramVersionId) as Bundle | null)
    }
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

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    const result = perm.granted
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 })
    if (result.canceled || !result.assets[0]) return
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
    await persistAndQueuePhoto({
      taskId: task!.id,
      sourceUri: result.assets[0].uri,
      expectedTaskStatus,
    })
    Alert.alert(t("photoQueued"))
    reload()
    void sync()
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

  function findProductByCode() {
    const query = barcodeQuery.trim()
    if (!query) {
      setLastBarcodeLookup(null)
      return
    }
    const found = findPlacementSummaryByCode(placementSummaries, query)
    if (found) setSelectedPlacementId(found.placementId)
    setLastBarcodeLookup(query)
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
          {(task.status === "IN_PROGRESS" || task.status === "NEW") && (
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
