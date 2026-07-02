import { createSystemClient, createTenantClient } from "@leadshelf/db"

// Singleton голого клиента (dev hot-reload плодит подключения без этого).
// Голый клиент НЕ экспортируется — наружу только tenantDb и authDb.
const globalForPrisma = globalThis as unknown as {
  __leadshelfPrisma?: ReturnType<typeof createSystemClient>
}

const prisma =
  globalForPrisma.__leadshelfPrisma ?? createSystemClient("web server singleton")

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__leadshelfPrisma = prisma
}

/** Единственная дверь к данным для route handlers и server components. */
export function tenantDb(organizationId: string) {
  return createTenantClient(prisma, organizationId)
}

/**
 * Identity boundary: только для /api/auth/* и session-store, где тенант
 * ещё не известен (поиск пользователя по email, refresh-сессии).
 * Использование где-либо ещё — нарушение правил доступа (docs/12).
 */
export const authDb = prisma
