import type { TaskRow } from "../sync/ports"

export type TaskQueueGroup = "active" | "today" | "upcoming" | "closed"

export interface TaskQueueGroups {
  active: TaskRow[]
  today: TaskRow[]
  upcoming: TaskRow[]
  closed: TaskRow[]
}

function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

function dueTimestamp(task: TaskRow): number {
  if (!task.dueAt) return Number.POSITIVE_INFINITY
  const timestamp = new Date(task.dueAt).getTime()
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY
}

function dueDateKey(task: TaskRow): string | null {
  if (!task.dueAt) return null
  const date = new Date(task.dueAt)
  return Number.isFinite(date.getTime()) ? localDateKey(date) : null
}

function sortTasks(items: TaskRow[]): TaskRow[] {
  return items.sort(
    (left, right) => dueTimestamp(left) - dueTimestamp(right) || left.title.localeCompare(right.title),
  )
}

export function groupTasksForWorkQueue(tasks: readonly TaskRow[], now: Date): TaskQueueGroups {
  const groups: TaskQueueGroups = { active: [], today: [], upcoming: [], closed: [] }
  const todayKey = localDateKey(now)

  for (const task of tasks) {
    if (task.status === "IN_PROGRESS" || task.status === "PHOTO_SUBMITTED") {
      groups.active.push(task)
    } else if (task.status === "NEW") {
      const dueKey = dueDateKey(task)
      if (dueKey && dueKey <= todayKey) groups.today.push(task)
      else groups.upcoming.push(task)
    } else {
      groups.closed.push(task)
    }
  }

  sortTasks(groups.active)
  sortTasks(groups.today)
  sortTasks(groups.upcoming)
  sortTasks(groups.closed)
  return groups
}
