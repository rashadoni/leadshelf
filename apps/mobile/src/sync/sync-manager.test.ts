import { describe, expect, test, vi } from "vitest"
import { SyncManager, UpgradeRequiredError } from "./sync-manager"
import type { LocalStore, OutboxRow, PhotoQueueRow, PullResponse, SyncApi } from "./ports"

function makeStore(over: Partial<LocalStore> = {}): LocalStore & {
  calls: string[]
  outbox: OutboxRow[]
  photos: PhotoQueueRow[]
} {
  const calls: string[] = []
  const state = {
    calls,
    outbox: [] as OutboxRow[],
    photos: [] as PhotoQueueRow[],
    cursors: { tasks: null as string | null, planogramBundles: null as string | null },
  }
  return {
    calls,
    outbox: state.outbox,
    photos: state.photos,
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
      return state.photos.filter((p) => !p.uploaded)
    },
    async markPhotoUploaded(id) {
      calls.push(`photoUploaded:${id}`)
      const p = state.photos.find((x) => x.clientPhotoId === id)
      if (p) p.uploaded = true
    },
    ...over,
  }
}

const EMPTY_PULL: PullResponse = {
  tasks: [],
  stores: [],
  planogramBundles: [],
  cursors: { tasks: "c1", planogramBundles: "c2" },
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
      return { photoId: "ph", key: `photos/x/${p.clientPhotoId}.jpg` }
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
      status: "pending",
      attempts: 0,
    })
    const api = makeApi()
    const pullSpy = vi.spyOn(api, "pull")
    const m = new SyncManager({ api, store, isOnline: async () => false })
    const s = await m.runSync()
    expect(s.phase).toBe("offline")
    expect(s.pendingOps).toBe(1)
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
