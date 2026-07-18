import type {
  FieldAgentTask,
  FieldAgentTaskEvent,
  FieldAgentTaskEventType,
  FieldAgentTaskStatus,
  FieldAgentTasksData,
} from "./contracts"
import type {
  FieldTaskCreatePayload,
  FieldTaskEventPayload,
  FieldTaskUpdatePayload,
} from "./execution-outbox"

export const FIELD_AGENT_TASKS_CACHE_KEY = "field.agent-tasks"

export type FieldTaskCustomerPreview = {
  id: string
  name: string
  objectType: string
  address: string | null
  city: string | null
}

type TaskOperationKind = "field.task.create" | "field.task.update" | "field.task.event"
type TaskOperationPayload = FieldTaskCreatePayload | FieldTaskUpdatePayload | FieldTaskEventPayload
type SyncResultStatus = "applied" | "conflict" | "rejected"

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function effectiveStatus(status: FieldAgentTaskStatus, dueDate: string | null, now = Date.now()): FieldAgentTaskStatus {
  return status !== "COMPLETED" && status !== "CANCELLED" && dueDate && new Date(dueDate).getTime() < now
    ? "OVERDUE"
    : status
}

function localEvent(input: {
  id: string
  type: FieldAgentTaskEventType
  occurredAt: string
  comment?: string | null
  evidence?: unknown | null
  fromStatus?: FieldAgentTaskStatus | null
  toStatus?: FieldAgentTaskStatus | null
  oldDueDate?: string | null
  newDueDate?: string | null
}): FieldAgentTaskEvent {
  return {
    id: input.id,
    clientEventId: input.id,
    type: input.type,
    occurredAt: input.occurredAt,
    comment: input.comment ?? null,
    evidence: input.evidence ?? null,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    oldDueDate: input.oldDueDate ?? null,
    newDueDate: input.newDueDate ?? null,
    syncState: "PENDING",
  }
}

function updateEventType(task: FieldAgentTask, payload: FieldTaskUpdatePayload): FieldAgentTaskEventType {
  if (payload.status === "IN_PROGRESS" && task.persistedStatus !== "IN_PROGRESS") return "STARTED"
  if (payload.status === "COMPLETED" && task.persistedStatus !== "COMPLETED") return "COMPLETED"
  if (payload.status === "CANCELLED" && task.persistedStatus !== "CANCELLED") return "CANCELLED"
  if (payload.acceptedAt && !task.acceptedAt) return "ACCEPTED"
  if (payload.dueDate !== undefined && payload.dueDate !== task.dueDate) return "RESCHEDULED"
  return "EDITED"
}

export function addOptimisticAgentTask(
  data: FieldAgentTasksData,
  payload: FieldTaskCreatePayload,
  meta: { clientOpId: string; occurredAt: string; customer?: FieldTaskCustomerPreview | null },
): FieldAgentTasksData {
  const task: FieldAgentTask = {
    id: payload.taskId,
    title: payload.title,
    description: payload.description ?? null,
    status: effectiveStatus("PENDING", payload.dueDate ?? null),
    persistedStatus: "PENDING",
    priority: payload.priority,
    dueDate: payload.dueDate ?? null,
    completedAt: null,
    acceptedAt: null,
    startedAt: null,
    result: null,
    version: 1,
    customerId: payload.customerId ?? null,
    visitId: payload.visitId ?? null,
    sourceKey: `mobile-self:${payload.taskId}`,
    copiedFromId: payload.copiedFromId ?? null,
    recurrenceRule: payload.recurrence?.rule ?? null,
    recurrenceInterval: payload.recurrence?.interval ?? null,
    recurrenceUntil: payload.recurrence?.until ?? null,
    recurrenceParentId: null,
    canEditContent: true,
    customer: meta.customer ? {
      id: meta.customer.id,
      name: meta.customer.name,
      objectType: meta.customer.objectType,
      address: meta.customer.address,
      city: meta.customer.city,
    } : null,
    events: [localEvent({
      id: meta.clientOpId,
      type: payload.copiedFromId ? "COPIED" : "CREATED",
      occurredAt: meta.occurredAt,
      toStatus: "PENDING",
    })],
    syncState: "PENDING",
  }
  return { ...data, tasks: [task, ...data.tasks.filter((item) => item.id !== task.id)] }
}

export function updateOptimisticAgentTask(
  data: FieldAgentTasksData,
  payload: FieldTaskUpdatePayload,
  meta: { clientOpId: string; occurredAt: string },
): FieldAgentTasksData {
  return {
    ...data,
    tasks: data.tasks.map((task) => {
      if (task.id !== payload.taskId) return task
      const nextPersistedStatus = payload.status ?? task.persistedStatus
      const nextDueDate = payload.dueDate === undefined ? task.dueDate : payload.dueDate
      const eventType = updateEventType(task, payload)
      return {
        ...task,
        title: payload.title ?? task.title,
        description: payload.description === undefined ? task.description : payload.description,
        priority: payload.priority ?? task.priority,
        dueDate: nextDueDate,
        result: payload.result === undefined ? task.result : payload.result,
        status: effectiveStatus(nextPersistedStatus, nextDueDate),
        persistedStatus: nextPersistedStatus,
        acceptedAt: payload.acceptedAt ?? task.acceptedAt,
        startedAt: payload.status === "IN_PROGRESS" ? task.startedAt ?? meta.occurredAt : task.startedAt,
        completedAt: payload.status === "COMPLETED"
          ? meta.occurredAt
          : payload.status === "PENDING" ? null : task.completedAt,
        version: task.version + 1,
        events: [localEvent({
          id: meta.clientOpId,
          type: eventType,
          occurredAt: meta.occurredAt,
          fromStatus: task.persistedStatus,
          toStatus: nextPersistedStatus,
          oldDueDate: task.dueDate,
          newDueDate: nextDueDate,
        }), ...task.events],
        syncState: "PENDING",
      }
    }),
  }
}

export function appendOptimisticAgentTaskEvent(
  data: FieldAgentTasksData,
  payload: FieldTaskEventPayload,
  clientOpId: string,
): FieldAgentTasksData {
  return {
    ...data,
    tasks: data.tasks.map((task) => task.id !== payload.taskId ? task : {
      ...task,
      events: [localEvent({
        id: clientOpId,
        type: payload.type,
        occurredAt: payload.occurredAt,
        comment: payload.comment,
        evidence: payload.evidence,
      }), ...task.events],
      syncState: "PENDING",
    }),
  }
}

function taskIdOf(payload: TaskOperationPayload): string {
  return payload.taskId
}

export function reconcileAgentTaskOperation(
  data: FieldAgentTasksData,
  operation: { kind: TaskOperationKind; payload: TaskOperationPayload; clientOpId: string },
  status: SyncResultStatus,
  detail: unknown,
): FieldAgentTasksData {
  const detailRecord = record(detail)
  const conflictTask = record(detailRecord?.task)
  const serverRecord = status === "applied" ? detailRecord : conflictTask
  const taskId = taskIdOf(operation.payload)
  const syncState = status === "conflict" ? "CONFLICT" : status === "rejected" ? "REJECTED" : null

  return {
    ...data,
    tasks: data.tasks.map((task) => {
      if (task.id !== taskId) return task
      const events: FieldAgentTaskEvent[] = task.events.map((event): FieldAgentTaskEvent => {
        if (event.clientEventId !== operation.clientOpId) return event
        if (operation.kind === "field.task.event" && status === "applied" && serverRecord?.id) {
          return {
            ...event,
            ...(serverRecord as Partial<FieldAgentTaskEvent>),
            clientEventId: operation.clientOpId,
            syncState: undefined,
          }
        }
        return { ...event, syncState: syncState ?? undefined }
      })
      const next: FieldAgentTask = serverRecord && operation.kind !== "field.task.event"
        ? {
            ...task,
            ...(serverRecord as Partial<FieldAgentTask>),
            status: effectiveStatus(
              (serverRecord.status as FieldAgentTaskStatus | undefined) ?? task.persistedStatus,
              serverRecord.dueDate === null || typeof serverRecord.dueDate === "string"
                ? serverRecord.dueDate
                : task.dueDate,
            ),
            persistedStatus: (serverRecord.status as FieldAgentTaskStatus | undefined) ?? task.persistedStatus,
            events,
          }
        : { ...task, events }
      if (syncState) next.syncState = syncState
      else delete next.syncState
      return next
    }),
  }
}
