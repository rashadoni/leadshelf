import "server-only"
import type { TenantClient } from "@leadshelf/db"
import { evaluateDemoReadiness } from "./readiness-state"

export async function isDemoTenantReady(db: TenantClient): Promise<boolean> {
  const demoStore = await db.store.findFirst({
    where: { code: "DEMO-001", isActive: true },
    select: { id: true },
  })
  if (!demoStore) return false

  const canonicalTasks = await db.task.findMany({
    where: { storeId: demoStore.id, title: "Выполнить выкладку OTC-зоны" },
    select: { id: true, status: true, dueAt: true },
  })
  const canonicalTask = canonicalTasks[0] ?? null
  const [activeProducts, canonicalProofs, pendingReviews, fieldAgents, activeRoutes, visits, e2eRoutes, e2eTasks] =
    await Promise.all([
      db.product.count({ where: { isActive: true } }),
      canonicalTask
        ? db.photoSubmission.count({ where: { taskId: canonicalTask.id, clientPhotoId: "demo-proof-001" } })
        : Promise.resolve(0),
      canonicalTask
        ? db.humanReview.count({ where: { taskId: canonicalTask.id, status: "PENDING" } })
        : Promise.resolve(0),
      db.fieldAgent.count(),
      db.route.count({ where: { isActive: true } }),
      db.visit.count(),
      db.route.count({
        where: {
          OR: [{ name: { startsWith: "Codex smoke" } }, { name: { startsWith: "UI E2E" } }],
        },
      }),
      db.task.count({
        where: {
          OR: [
            { id: { startsWith: "task-mob-e2e" } },
            { title: { contains: "мобильный тест" } },
            { title: { contains: "UI E2E" } },
          ],
        },
      }),
    ])

  return evaluateDemoReadiness({
    hasDemoStore: true,
    activeProducts,
    canonicalTasks: canonicalTasks.length,
    canonicalTaskStatus: canonicalTask?.status ?? null,
    canonicalTaskDueAt: canonicalTask?.dueAt ?? null,
    canonicalProofs,
    pendingReviews,
    fieldAgents,
    activeRoutes,
    visits,
    e2eRoutes,
    e2eTasks,
  })
}
