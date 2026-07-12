export interface LocalPlanogramBundleRow {
  versionId: string
  json: string
  taskId: string | null
}

export interface LocalPlanogramSummary {
  versionId: string
  name: string | null
  versionNumber: number | null
  publishedAt: string | null
  equipmentCount: number
  shelfCount: number
  productCount: number
  taskId: string | null
}

export interface LocalEquipmentSummary {
  id: string
  versionId: string
  planogramName: string | null
  name: string | null
  widthMm: number | null
  heightMm: number | null
  depthMm: number | null
  shelfCount: number
  taskId: string | null
}

export interface LocalPlanogramLibrary {
  planograms: LocalPlanogramSummary[]
  equipment: LocalEquipmentSummary[]
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function parseLocalPlanogramLibrary(rows: LocalPlanogramBundleRow[]): LocalPlanogramLibrary {
  const planograms: LocalPlanogramSummary[] = []
  const equipment: LocalEquipmentSummary[] = []

  for (const row of rows) {
    try {
      const bundle = record(JSON.parse(row.json) as unknown)
      if (!bundle) continue
      const planogram = record(bundle.planogram)
      const planogramName = stringValue(planogram?.name)
      const bundleEquipment = Array.isArray(bundle.equipment) ? bundle.equipment : []
      const placements = Array.isArray(bundle.placements) ? bundle.placements : []
      const productIds = new Set<string>()

      for (const placementValue of placements) {
        const product = record(record(placementValue)?.product)
        const productKey = stringValue(product?.id) ?? stringValue(product?.sku)
        if (productKey) productIds.add(productKey)
      }

      let shelfCount = 0
      bundleEquipment.forEach((equipmentValue, index) => {
        const item = record(equipmentValue)
        if (!item) return
        const shelves = Array.isArray(item.shelves) ? item.shelves : []
        shelfCount += shelves.length
        equipment.push({
          id: stringValue(item.planogramEquipmentId) ?? `${row.versionId}-${index}`,
          versionId: row.versionId,
          planogramName,
          name: stringValue(item.name),
          widthMm: numberValue(item.widthMm),
          heightMm: numberValue(item.heightMm),
          depthMm: numberValue(item.depthMm),
          shelfCount: shelves.length,
          taskId: row.taskId,
        })
      })

      planograms.push({
        versionId: row.versionId,
        name: planogramName,
        versionNumber: numberValue(bundle.versionNumber),
        publishedAt: stringValue(bundle.publishedAt),
        equipmentCount: bundleEquipment.length,
        shelfCount,
        productCount: productIds.size,
        taskId: row.taskId,
      })
    } catch {
      // Старый или повреждённый bundle не должен ломать локальную библиотеку.
    }
  }

  return {
    planograms: planograms.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")),
    equipment: equipment.sort(
      (a, b) => (a.name ?? "").localeCompare(b.name ?? "") || a.id.localeCompare(b.id),
    ),
  }
}
