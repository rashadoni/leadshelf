import { PrismaClient } from "@prisma/client"

// Модели с колонкой organizationId — им скоуп инжектится автоматически.
// Список ЗАХАРДКОЖЕН осознанно (политика важнее автодетекта); тест
// tenant-models-audit сверяет его со schema.prisma и падает при расхождении.
export const TENANT_MODELS = new Set([
  "User",
  "AuthSession",
  "ApiToken",
  "AuditLog",
  "Region",
  "StoreFormat",
  "Store",
  "StoreGroup",
  "FloorPlan",
  "Category",
  "Brand",
  "Supplier",
  "Manufacturer",
  "Product",
  "ProductBarcode",
  "ProductAttributeDefinition",
  "Warehouse",
  "PriceSnapshot",
  "StockSnapshot",
  "SalesSnapshot",
  "ImportBatch",
  "ImportQueueJob",
  "ExternalIdMap",
  "EquipmentType",
  "EquipmentTemplate",
  "EquipmentAsset",
  "Planogram",
  "Task",
  "PhotoSubmission",
  "GoldenReference",
  "HumanReview",
  "ShelfAnalysisRun",
  "ShelfMetricSnapshot",
  "Team",
  "FieldAgent",
  "FieldForceSetting",
  "Route",
  "Visit",
  "Order",
  "Promotion",
  "ProductEvent",
  "Alert",
  "NotificationDelivery",
  "CaptureTemplate",
  "CaptureStepException",
  "CaptureRetakeRequest",
])

// Операции, где скоуп добавляется в where.
const SCOPED_WHERE_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
])

// Операции по unique-ключу: скоуп в where добавить нельзя -> запрещены.
// Вместо findUnique({id}) использовать findFirst({where:{id}}).
const BLOCKED_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "update",
  "delete",
  "upsert",
])

// Свойства клиента, недоступные из tenant-контекста (обход скоупа).
const BLOCKED_CLIENT_PROPS = new Set([
  "$queryRaw",
  "$queryRawUnsafe",
  "$executeRaw",
  "$executeRawUnsafe",
  "$connect",
  "$disconnect",
  "$use",
  "$on",
  "$extends",
])

const NESTED_WRITE_KEYS = new Set([
  "create",
  "createMany",
  "connect",
  "connectOrCreate",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
  "disconnect",
  "set",
])

// Nested writes обходят query-extension (Prisma известное ограничение) —
// запрещаем их эвристикой по форме объекта. Ложные срабатывания на JSON-полях
// с ключами вида "set" — осознанная плата за безопасность: пишите такие JSON
// через system client в worker или без вложенного объекта.
function assertNoNestedWrites(data: unknown, path: string): void {
  if (Array.isArray(data)) {
    data.forEach((item, i) => assertNoNestedWrites(item, `${path}[${i}]`))
    return
  }
  if (!data || typeof data !== "object" || data instanceof Date) return
  for (const [key, value] of Object.entries(data)) {
    if (!value || typeof value !== "object" || value instanceof Date) continue
    const keys = Array.isArray(value) ? [] : Object.keys(value)
    if (keys.some((k) => NESTED_WRITE_KEYS.has(k))) {
      throw new Error(
        `[tenant-client] nested write "${path}.${key}" запрещен: query-extension его не скоупит. Используйте плоские create/связывайте по id.`,
      )
    }
  }
}

function scopeWhere(args: Record<string, unknown>, organizationId: string) {
  args.where = { AND: [{ organizationId }, (args.where as object) ?? {}] }
}

/**
 * Единственная разрешенная дверь к БД из route handlers.
 * - Модели с organizationId: скоуп инжектится в where/create автоматически.
 * - Дочерние модели без organizationId: генерический доступ запрещен —
 *   доступ только через доменные репозитории (добавляются по фазам).
 * - findUnique/update/delete/upsert по unique-ключу запрещены (скоуп
 *   не добавить): findFirst/updateMany/deleteMany с where.
 * - Raw SQL и Organization запрещены полностью.
 */
export function createTenantClient(prisma: PrismaClient, organizationId: string) {
  if (!organizationId?.trim()) {
    throw new Error("[tenant-client] organizationId обязателен")
  }

  const extended = prisma.$extends({
    name: "tenantScope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model === "Organization") {
            throw new Error("[tenant-client] доступ к Organization запрещен")
          }
          if (!TENANT_MODELS.has(model)) {
            throw new Error(
              `[tenant-client] ${model} не имеет organizationId — только через доменный репозиторий (parent-path)`,
            )
          }
          if (BLOCKED_OPS.has(operation)) {
            throw new Error(
              `[tenant-client] ${model}.${operation} запрещен (unique-ключ не скоупится): используйте findFirst/updateMany/deleteMany с where`,
            )
          }

          const a = (args ?? {}) as Record<string, unknown>

          if (SCOPED_WHERE_OPS.has(operation)) {
            scopeWhere(a, organizationId)
          } else if (operation === "create") {
            const data = (a.data ?? {}) as Record<string, unknown>
            if (data.organizationId && data.organizationId !== organizationId) {
              throw new Error(`[tenant-client] ${model}.create с чужим organizationId`)
            }
            assertNoNestedWrites(data, "data")
            a.data = { ...data, organizationId }
          } else if (operation === "createMany") {
            const rows = Array.isArray(a.data) ? a.data : [a.data]
            a.data = rows.map((row: Record<string, unknown>) => {
              if (row.organizationId && row.organizationId !== organizationId) {
                throw new Error(`[tenant-client] ${model}.createMany с чужим organizationId`)
              }
              return { ...row, organizationId }
            })
          } else {
            throw new Error(`[tenant-client] ${model}.${operation} не поддержан tenant-клиентом`)
          }

          return query(a as never)
        },
      },
    },
  })

  return new Proxy(extended, {
    get(target, prop, receiver) {
      if (typeof prop === "string") {
        if (BLOCKED_CLIENT_PROPS.has(prop)) {
          throw new Error(`[tenant-client] ${prop} запрещен из tenant-контекста`)
        }
        if (prop === "organization") {
          throw new Error("[tenant-client] доступ к Organization запрещен")
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as typeof extended
}

export type TenantClient = ReturnType<typeof createTenantClient>

/**
 * Escape hatch для worker/seed/миграций. НЕ для route handlers.
 * Обязательная причина — след для аудита и greppability.
 */
export function createSystemClient(reason: string): PrismaClient {
  if (!reason?.trim()) {
    throw new Error("[system-client] укажите причину (seed | import-worker | ...)")
  }
  if (process.env.NODE_ENV !== "production") {
    console.debug(`[db] system client: ${reason}`)
  }
  return new PrismaClient()
}
