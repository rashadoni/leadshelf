import { describe, expect, it } from "vitest"
import type { FieldAgentTasksData } from "./contracts"
import {
  addOptimisticAgentTask,
  appendOptimisticAgentTaskEvent,
  reconcileAgentTaskOperation,
  updateOptimisticAgentTask,
} from "./task-cache"

const empty: FieldAgentTasksData = {
  tasks: [],
  capabilities: { createSelfTask: true, recurringTasks: true },
}

describe("agent task offline cache", () => {
  it("creates and advances a local task with causal versions", () => {
    const created = addOptimisticAgentTask(empty, {
      taskId: "field-task-1",
      title: "Call clinic",
      description: null,
      customerId: "clinic-1",
      priority: "HIGH",
      dueDate: "2099-07-16T09:00:00.000Z",
      recurrence: { rule: "WEEKLY", interval: 1, until: null },
    }, {
      clientOpId: "op-create",
      occurredAt: "2026-07-15T08:00:00.000Z",
      customer: { id: "clinic-1", name: "Clinic", objectType: "CLINIC", address: null, city: "Baku" },
    })
    const started = updateOptimisticAgentTask(created, {
      taskId: "field-task-1",
      expectedVersion: 1,
      status: "IN_PROGRESS",
    }, { clientOpId: "op-start", occurredAt: "2026-07-15T08:05:00.000Z" })

    expect(started.tasks[0]).toMatchObject({
      status: "IN_PROGRESS",
      persistedStatus: "IN_PROGRESS",
      version: 2,
      syncState: "PENDING",
      customer: { name: "Clinic" },
    })
    expect(started.tasks[0]?.events.map((event) => event.type)).toEqual(["STARTED", "CREATED"])
  })

  it("appends comments and reconciles server versions or conflicts", () => {
    const created = addOptimisticAgentTask(empty, {
      taskId: "field-task-1",
      title: "Call clinic",
      priority: "MEDIUM",
      dueDate: null,
    }, { clientOpId: "op-create", occurredAt: "2026-07-15T08:00:00.000Z" })
    const commented = appendOptimisticAgentTaskEvent(created, {
      taskId: "field-task-1",
      type: "COMMENTED",
      occurredAt: "2026-07-15T08:10:00.000Z",
      comment: "Waiting for response",
    }, "op-comment")
    const applied = reconcileAgentTaskOperation(commented, {
      kind: "field.task.event",
      payload: {
        taskId: "field-task-1",
        type: "COMMENTED",
        occurredAt: "2026-07-15T08:10:00.000Z",
        comment: "Waiting for response",
      },
      clientOpId: "op-comment",
    }, "applied", {
      id: "server-event-1",
      taskId: "field-task-1",
      type: "COMMENTED",
      occurredAt: "2026-07-15T08:10:00.000Z",
      comment: "Waiting for response",
    })
    expect(applied.tasks[0]?.events[0]).toMatchObject({ id: "server-event-1", syncState: undefined })

    const conflict = reconcileAgentTaskOperation(applied, {
      kind: "field.task.update",
      payload: { taskId: "field-task-1", expectedVersion: 1, status: "COMPLETED" },
      clientOpId: "op-complete",
    }, "conflict", { task: { id: "field-task-1", status: "IN_PROGRESS", version: 4 } })
    expect(conflict.tasks[0]).toMatchObject({ persistedStatus: "IN_PROGRESS", version: 4, syncState: "CONFLICT" })
  })
})
