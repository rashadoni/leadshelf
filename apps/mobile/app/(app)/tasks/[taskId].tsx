import { useCallback, useState } from "react"
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

  const reload = useCallback(() => {
    const fresh = getTask(taskId)
    setTask(fresh)
    if (fresh?.planogramVersionId) {
      setBundle(getBundle(fresh.planogramVersionId) as Bundle | null)
    }
  }, [taskId])
  useFocusEffect(reload)

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
            <PlanogramSvg bundle={bundle} />
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
