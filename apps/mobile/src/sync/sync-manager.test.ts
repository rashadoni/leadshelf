import { describe, expect, test, vi } from "vitest"
import { SyncManager, UpgradeRequiredError } from "./sync-manager"
import { AuthLostError, HttpError } from "./ports-error"
import type { LocalStore, OutboxRow, PhotoQueueRow, PullResponse, SyncApi, SyncCursors } from "./ports"

function makeStore(over: Partial<LocalStore> = {}): LocalStore & {
  calls: string[]
  outbox: OutboxRow[]
  photos: PhotoQueueRow[]
  quarantined: Set<string>
} {
  const calls: string[] = []
  const quarantined = new Set<string>()
  const state = {
    calls,
    outbox: [] as OutboxRow[],
    photos: [] as PhotoQueueRow[],
    quarantined,
    cursors: {
      tasks: null as string | null,
      planogramBundles: null as string | null,
      routes: null as string | null,
      visits: null as string | null,
      photoSubmissions: null as string | null,
    } as SyncCursors,
  }
  return {
    calls,
    outbox: state.outbox,
    photos: state.photos,
    quarantined,
    async applyPull() {
      calls.push("applyPull")
    },
    async getCursors() {
      calls.push("getCursors")
      return state.cursors
    },
    async setCursors(c) {
      calls.push("setCursors")
      state.cursors = c
    },
    async pendingOutbox() {
      calls.push("pendingOutbox")
      return state.outbox.filter((o) => o.status === "pending")
    },
    async outboxDiagnostics() {
      const pending = state.outbox.filter((o) => o.status === "pending")
      return {
        pendingOps: pending.length,
        conflictOps: state.outbox.filter((o) => o.status === "conflict").length,
        rejectedOps: state.outbox.filter((o) => o.status === "rejected").length,
        oldestPendingAt: pending.map((o) => o.clientCreatedAt).filter((value): value is string => Boolean(value)).sort()[0] ?? null,
      }
    },
    async markOutbox(id, status) {
      calls.push(`markOutbox:${id}:${status}`)
      const op = state.outbox.find((o) => o.clientOpId === id)
      if (op) op.status = status
    },
    async bumpOutboxAttempts(ids) {
      calls.push(`bump:${ids.length}`)
      for (const op of state.outbox) if (ids.includes(op.clientOpId)) op.attempts++
    },
    async pendingPhotos() {
      calls.push("pendingPhotos")
      return state.photos.filter((p) => !p.uploaded && !quarantined.has(p.clientPhotoId))
    },
    async unuploadedPhotoIds() {
      return state.photos.filter((p) => !p.uploaded).map((p) => p.clientPhotoId)
    },
    async markPhotoUploaded(id) {
      calls.push(`photoUploaded:${id}`)
      const p = state.photos.find((x) => x.clientPhotoId === id)
      if (p) p.uploaded = true
    },
    async bumpPhotoAttempts(ids) {
      calls.push(`bumpPhoto:${ids.length}`)
      for (const p of state.photos) if (ids.includes(p.clientPhotoId)) p.attempts = (p.attempts ?? 0) + 1
    },
    async quarantinePhoto(id) {
      calls.push(`quarantine:${id}`)
      quarantined.add(id)
    },
    async quarantinedPhotoCount() {
      return quarantined.size
    },
    ...over,
  }
}

const EMPTY_PULL: PullResponse = {
  tasks: [],
  stores: [],
  routes: [],
  visits: [],
  photoSubmissions: [],
  planogramBundles: [],
  cursors: { tasks: "c1", planogramBundles: "c2", routes: "c3", visits: "c4", photoSubmissions: "c5" },
}

function makeApi(over: Partial<SyncApi> = {}): SyncApi & { pushed: string[] } {
  const pushed: string[] = []
  return {
    pushed,
    async pull() {
      return EMPTY_PULL
    },
    async ack() {},
    async push(ops) {
      pushed.push(...ops.map((o) => o.clientOpId))
      return { results: ops.map((o) => ({ clientOpId: o.clientOpId, status: "applied" as const })) }
    },
    async uploadPhoto(p) {
      return { photoId: "ph", key: `photos/x/${p.clientPhotoId}.jpg`, mediaType: p.mediaType ?? "photo" }
    },
    ...over,
  }
}

describe("SyncManager", () => {
  test("порядок фаз: pull -> apply -> ack -> photos -> push; ack после apply", async () => {
    const store = makeStore()
    const api = makeApi()
    const ackSpy = vi.fn(async () => {
      // к моменту ack локальный apply уже был
      expect(store.calls).toContain("applyPull")
    })
    api.ack = ackSpy
    const m = new SyncManager({ api, store })
    const s = await m.runSync()
    expect(s.phase).toBe("idle")
    expect(ackSpy).toHaveBeenCalled()
    expect(store.calls.indexOf("applyPull")).toBeLessThan(store.calls.indexOf("setCursors"))
  })

  test("очистка подтверждённых media-файлов запускается после push", async () => {
    const cleanup = vi.fn(async () => 1)
    const store = makeStore({ cleanupUploadedPhotoFiles: cleanup })
    const api = makeApi()
    const m = new SyncManager({ api, store })

    const s = await m.runSync()

    expect(s.phase).toBe("idle")
    expect(cleanup).toHaveBeenCalledOnce()
  })

  test("упавший apply НЕ доводит до ack (курсор не потерян)", async () => {
    const store = makeStore({
      applyPull: async () => {
        throw new Error("disk full")
      },
    })
    const api = makeApi()
    const ackSpy = vi.fn(async () => {})
    api.ack = ackSpy
    const m = new SyncManager({ api, store })
    const s = await m.runSync()
    expect(s.phase).toBe("error")
    expect(ackSpy).not.toHaveBeenCalled()
  })

  test("фото грузятся ДО push и помечаются", async () => {
    const store = makeStore()
    store.photos.push({
      clientPhotoId: "photo-abc-0001",
      taskId: "t1",
      fileUri: "file:///x.jpg",
      takenAt: "2026-07-03T10:00:00Z",
      exifJson: "{\"Software\":\"LeadShelf Mobile\"}",
      uploaded: false,
    })
    store.outbox.push({
      clientOpId: "op-abc-00000001",
      kind: "photo.submit",
      payload: { clientPhotoId: "photo-abc-0001", taskId: "t1" },
      status: "pending",
      attempts: 0,
    })
    const api = makeApi()
    const m = new SyncManager({ api, store })
    const s = await m.runSync()
    expect(s.pendingPhotos).toBe(0)
    expect(s.pendingOps).toBe(0)
    const upIdx = store.calls.findIndex((c) => c.startsWith("photoUploaded"))
    const pushIdx = store.calls.findIndex((c) => c.startsWith("markOutbox"))
    expect(upIdx).toBeGreaterThan(-1)
    expect(upIdx).toBeLessThan(pushIdx)
  })

  test("битое фото (4xx) уходит в карантин, остальные грузятся, push идёт", async () => {
    const store = makeStore()
    store.photos.push(
      { clientPhotoId: "photo-bad-0001", taskId: "t1", fileUri: "file:///bad.mp4", takenAt: "2026-07-03T10:00:00Z", uploaded: false },
      { clientPhotoId: "photo-ok-0002", taskId: "t1", fileUri: "file:///ok.jpg", takenAt: "2026-07-03T10:01:00Z", uploaded: false },
    )
    store.outbox.push({
      clientOpId: "op-after-photo01",
      kind: "task.comment",
      payload: { taskId: "t1", body: "done" },
      status: "pending",
      attempts: 0,
    })
    const api = makeApi({
      async uploadPhoto(p) {
        if (p.clientPhotoId === "photo-bad-0001") throw new HttpError(415, "unsupported_type")
        return { photoId: "ph", key: `photos/x/${p.clientPhotoId}.jpg`, mediaType: p.mediaType ?? "photo" }
      },
    })
    const m = new SyncManager({ api, store })
    const s = await m.runSync()

    expect(s.phase).toBe("idle")
    expect(store.quarantined.has("photo-bad-0001")).toBe(true)
    // хорошее фото загрузилось, несмотря на соседний битый файл
    expect(store.photos.find((p) => p.clientPhotoId === "photo-ok-0002")!.uploaded).toBe(true)
    // push всё равно выполнился
    expect(api.pushed).toContain("op-after-photo01")
    expect(s.quarantinedPhotos).toBe(1)
  })

  test("транзиентная ошибка (5xx) не карантинит — счётчик попыток и ретрай", async () => {
    const store = makeStore()
    store.photos.push({
      clientPhotoId: "photo-flaky-001",
      taskId: "t1",
      fileUri: "file:///f.jpg",
      takenAt: "2026-07-03T10:00:00Z",
      uploaded: false,
      attempts: 0,
    })
    const api = makeApi({
      async uploadPhoto() {
        throw new HttpError(503, "service_unavailable")
      },
    })
    const m = new SyncManager({ api, store })
    const s = await m.runSync()

    expect(s.phase).toBe("idle")
    expect(store.quarantined.size).toBe(0)
    expect(store.photos[0]!.attempts).toBe(1)
    expect(store.photos[0]!.uploaded).toBe(false)
  })

  test("photo.submit не пушится до успешной загрузки файла, другие операции не блокируются", async () => {
    const store = makeStore()
    store.photos.push({
      clientPhotoId: "photo-flaky-002",
      taskId: "t1",
      fileUri: "file:///f.jpg",
      takenAt: "2026-07-03T10:00:00Z",
      uploaded: false,
    })
    store.outbox.push(
      {
        clientOpId: "op-photo-flaky02",
        kind: "photo.submit",
        payload: { clientPhotoId: "photo-flaky-002", taskId: "t1" },
        status: "pending",
        attempts: 0,
      },
      {
        clientOpId: "op-comment-after",
        kind: "task.comment",
        payload: { taskId: "t1", body: "offline note" },
        status: "pending",
        attempts: 0,
      },
    )
    const api = makeApi({
      async uploadPhoto() {
        throw new HttpError(503, "service_unavailable")
      },
    })

    const status = await new SyncManager({ api, store }).runSync()

    expect(api.pushed).toEqual(["op-comment-after"])
    expect(store.outbox[0]).toMatchObject({ status: "pending", attempts: 0 })
    expect(status.pendingOps).toBe(1)
    expect(status.pendingPhotos).toBe(1)
  })

  test("photo.submit для quarantined файла не отправляется", async () => {
    const store = makeStore()
    store.photos.push({
      clientPhotoId: "photo-bad-0003",
      taskId: "t1",
      fileUri: "file:///bad.bin",
      takenAt: "2026-07-03T10:00:00Z",
      uploaded: false,
    })
    store.outbox.push({
      clientOpId: "op-photo-bad003",
      kind: "photo.submit",
      payload: { clientPhotoId: "photo-bad-0003", taskId: "t1" },
      status: "pending",
      attempts: 0,
    })
    const api = makeApi({
      async uploadPhoto() {
        throw new HttpError(415, "unsupported_type")
      },
    })

    await new SyncManager({ api, store }).runSync()

    expect(api.pushed).toHaveLength(0)
    expect(store.outbox[0]).toMatchObject({ status: "pending", attempts: 0 })
    expect(store.quarantined.has("photo-bad-0003")).toBe(true)
  })

  test("conflict от сервера помечает операцию, sync не падает", async () => {
    const store = makeStore()
    store.outbox.push({
      clientOpId: "op-conflict-0001",
      kind: "task.status",
      payload: { taskId: "t1", expectedStatus: "NEW", toStatus: "IN_PROGRESS" },
      status: "pending",
      attempts: 0,
    })
    const api = makeApi({
      push: async (ops) => ({
        results: ops.map((o) => ({
          clientOpId: o.clientOpId,
          status: "conflict" as const,
          detail: { serverStatus: "COMPLETED" },
        })),
      }),
    })
    const m = new SyncManager({ api, store })
    const s = await m.runSync()
    expect(s.phase).toBe("idle")
    expect(store.outbox[0]!.status).toBe("conflict")
  })

  test("зависимые task.status -> photo.submit пушатся в порядке outbox", async () => {
    const store = makeStore()
    store.outbox.push(
      {
        clientOpId: "op-start-000001",
        kind: "task.status",
        payload: { taskId: "t1", expectedStatus: "NEW", toStatus: "IN_PROGRESS" },
        status: "pending",
        attempts: 0,
      },
      {
        clientOpId: "op-photo-000001",
        kind: "photo.submit",
        payload: {
          clientPhotoId: "photo-abc-0001",
          taskId: "t1",
          expectedTaskStatus: "IN_PROGRESS",
        },
        status: "pending",
        attempts: 0,
      },
      {
        clientOpId: "op-comment-0001",
        kind: "task.comment",
        payload: { taskId: "t1", body: "Shelf is ready" },
        status: "pending",
        attempts: 0,
      },
    )
    const pushedKinds: string[] = []
    const api = makeApi({
      push: async (ops) => {
        pushedKinds.push(...ops.map((op) => op.kind))
        return { results: ops.map((op) => ({ clientOpId: op.clientOpId, status: "applied" as const })) }
      },
    })
    const m = new SyncManager({ api, store })
    const s = await m.runSync()
    expect(s.phase).toBe("idle")
    expect(pushedKinds).toEqual(["task.status", "photo.submit", "task.comment"])
  })

  test("offline: цикл не стартует, счетчики обновлены", async () => {
    const store = makeStore()
    store.outbox.push({
      clientOpId: "op-offline-0001",
      kind: "task.status",
      payload: { taskId: "t1", expectedStatus: "NEW", toStatus: "IN_PROGRESS" },
      clientCreatedAt: "2026-07-10T09:55:00.000Z",
      status: "pending",
      attempts: 0,
    }, {
      clientOpId: "op-offline-conflict",
      kind: "task.status",
      payload: { taskId: "t1", expectedStatus: "NEW", toStatus: "IN_PROGRESS" },
      status: "conflict",
      attempts: 1,
    }, {
      clientOpId: "op-offline-rejected",
      kind: "task.status",
      payload: { taskId: "t1", expectedStatus: "NEW", toStatus: "IN_PROGRESS" },
      status: "rejected",
      attempts: 1,
    })
    const api = makeApi()
    const pullSpy = vi.spyOn(api, "pull")
    const m = new SyncManager({
      api,
      store,
      now: () => new Date("2026-07-10T10:00:00.000Z"),
      isOnline: async () => false,
    })
    const s = await m.runSync()
    expect(s.phase).toBe("offline")
    expect(s.pendingOps).toBe(1)
    expect(s.conflictOps).toBe(1)
    expect(s.rejectedOps).toBe(1)
    expect(s.oldestPendingAgeMs).toBe(5 * 60 * 1000)
    expect(pullSpy).not.toHaveBeenCalled()
  })

  test("426 переводит в upgradeRequired", async () => {
    const store = makeStore()
    const api = makeApi({
      pull: async () => {
        throw new UpgradeRequiredError()
      },
    })
    const m = new SyncManager({ api, store })
    const s = await m.runSync()
    expect(s.phase).toBe("upgradeRequired")
  })

  test("отзыв сессии переводит sync в terminal authLost без retryable error", async () => {
    const store = makeStore()
    const api = makeApi({
      pull: async () => {
        throw new AuthLostError()
      },
    })
    const m = new SyncManager({ api, store })
    const s = await m.runSync()
    expect(s.phase).toBe("authLost")
    expect(s.error).toBeNull()
  })

  test("операции с исчерпанными попытками не шлются повторно", async () => {
    const store = makeStore()
    store.outbox.push({
      clientOpId: "op-dead-000001",
      kind: "task.status",
      payload: { taskId: "t1", expectedStatus: "NEW", toStatus: "IN_PROGRESS" },
      status: "pending",
      attempts: 99,
    })
    const api = makeApi()
    const m = new SyncManager({ api, store })
    await m.runSync()
    expect(api.pushed).toHaveLength(0)
  })

  test("параллельный runSync — no-op (single flight)", async () => {
    const store = makeStore()
    let pullCount = 0
    const api = makeApi({
      pull: async () => {
        pullCount++
        await new Promise((r) => setTimeout(r, 20))
        return EMPTY_PULL
      },
    })
    const m = new SyncManager({ api, store })
    await Promise.all([m.runSync(), m.runSync(), m.runSync()])
    expect(pullCount).toBe(1)
  })
})
