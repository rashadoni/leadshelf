// Демо-тенант для Phase 0 DoD. Идемпотентен: повторный запуск ничего не дублирует.
// Запуск: pnpm --filter @leadshelf/db seed:demo
import "dotenv/config"
import { hash } from "@node-rs/argon2"
import { Prisma } from "@prisma/client"
import { calculateShelfCompliance } from "@leadshelf/core"
import { createSystemClient, createTenantClient } from "../src/index.ts"

const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 }
const DEMO_PASSWORD = "demo1234"

const prisma = createSystemClient("seed-demo")

const USERS = [
  ["admin@leadshelf.com", "Демо администратор", "ADMIN"],
  ["category@demo.leadshelf.local", "Категорийный менеджер", "CATEGORY_MANAGER"],
  ["merch@demo.leadshelf.local", "Мерчендайзер офиса", "MERCHANDISER"],
  ["supervisor@demo.leadshelf.local", "Супервайзер сети", "SUPERVISOR"],
  ["analyst@demo.leadshelf.local", "Аналитик выкладки", "ANALYST"],
] as const

const DEMO_PRODUCTS = [
  {
    sku: "OTC-001",
    name: "Парацетамол 500 мг N20",
    barcode: "4761000000011",
    categoryPath: "otc/cold-pain/tablets",
    categoryName: "Простуда и боль",
    brand: "MedLine",
    supplier: "ФармДистрибьюция",
    manufacturer: "Baku Pharma",
    widthMm: 72,
    heightMm: 115,
    depthMm: 34,
    weightG: 38,
  },
  {
    sku: "OTC-002",
    name: "Ибупрофен 200 мг N20",
    barcode: "4761000000028",
    categoryPath: "otc/cold-pain/tablets",
    categoryName: "Простуда и боль",
    brand: "AzeriMed",
    supplier: "ФармДистрибьюция",
    manufacturer: "Caspian Health",
    widthMm: 76,
    heightMm: 118,
    depthMm: 36,
    weightG: 42,
  },
  {
    sku: "OTC-003",
    name: "Спрей для горла 30 мл",
    barcode: "4761000000035",
    categoryPath: "otc/cold-pain/throat",
    categoryName: "Горло и простуда",
    brand: "NaturaCare",
    supplier: "Аптека Сервис",
    manufacturer: "Natura Labs",
    widthMm: 52,
    heightMm: 128,
    depthMm: 45,
    weightG: 70,
  },
  {
    sku: "OTC-004",
    name: "Витамин C 1000 мг N20",
    barcode: "4761000000042",
    categoryPath: "vitamins/immunity",
    categoryName: "Витамины и иммунитет",
    brand: "VitaPlus",
    supplier: "Аптека Сервис",
    manufacturer: "Caspian Health",
    widthMm: 83,
    heightMm: 122,
    depthMm: 38,
    weightG: 56,
  },
  {
    sku: "OTC-005",
    name: "Назальный спрей 10 мл",
    barcode: "4761000000059",
    categoryPath: "otc/cold-pain/nasal",
    categoryName: "Нос и дыхание",
    brand: "MedLine",
    supplier: "Baku Wholesale",
    manufacturer: "Baku Pharma",
    widthMm: 46,
    heightMm: 104,
    depthMm: 39,
    weightG: 48,
  },
  {
    sku: "OTC-006",
    name: "Электролит раствор 10 саше",
    barcode: "4761000000066",
    categoryPath: "otc/digestive",
    categoryName: "ЖКТ",
    brand: "ReHydro",
    supplier: "Baku Wholesale",
    manufacturer: "Natura Labs",
    widthMm: 95,
    heightMm: 132,
    depthMm: 42,
    weightG: 110,
  },
] as const

const ANALYTICS_PROFILES = {
  "OTC-001": { price: 3.9, cost: 2.45, previousQty: 7.2, currentQty: 8.1, stockQty: 120 },
  "OTC-002": { price: 4.4, cost: 2.75, previousQty: 8.0, currentQty: 8.3, stockQty: 130 },
  "OTC-003": { price: 8.8, cost: 4.95, previousQty: 11.8, currentQty: 15.2, stockQty: 45 },
  "OTC-004": { price: 6.6, cost: 3.7, previousQty: 6.4, currentQty: 7.1, stockQty: 105 },
  "OTC-005": { price: 7.4, cost: 4.15, previousQty: 8.7, currentQty: 10.5, stockQty: 75 },
  "OTC-006": { price: 5.9, cost: 3.45, previousQty: 2.3, currentQty: 2.5, stockQty: 430 },
} as const

const MARS_ROUTE_STORES = [
  { code: "BRV-NSM", name: "Bravo Nəsimi", address: "Nizami Küçəsi 76, Bakı, Nəsimi", lat: 40.3712, lon: 49.8421, region: "Baku" },
  { code: "BRV-YSM", name: "Bravo Yasamal", address: "Hasan bey Zardabi 88, Bakı, Yasamal", lat: 40.3925, lon: 49.8225, region: "Baku" },
  { code: "BIZ-XTI", name: "Bizim Tarla Xətai", address: "Babək prospekti 17, Bakı, Xətai", lat: 40.3835, lon: 49.9133, region: "Baku" },
  { code: "ARZ-SBL", name: "Araz Səbail", address: "Nizami Küçəsi 12, Bakı, Səbail", lat: 40.3633, lon: 49.8344, region: "Baku" },
  { code: "NPT-BNG", name: "Neptun Binəqədi", address: "Binəqədi Şossesi 4, Bakı, Binəqədi", lat: 40.4521, lon: 49.8217, region: "Baku" },
  { code: "PIR-XTI", name: "Pyramid Express Xətai", address: "Babək prospekti 22, Bakı, Xətai", lat: 40.3812, lon: 49.9215, region: "Baku" },
  { code: "MGZ-AHM", name: "Mağaza Əhməd", address: "Hüseyn Cavid 14, Bakı, Yasamal", lat: 40.3878, lon: 49.8456, region: "Baku" },
  { code: "MGZ-NIK", name: "Mağaza Nikbin", address: "Sahil bağı yanı, Bakı, Səbail", lat: 40.3681, lon: 49.8347, region: "Baku" },
  { code: "MGZ-25", name: "Магазин № 25", address: "28 May küçəsi 31, Bakı", lat: 40.3795, lon: 49.8412, region: "Baku" },
  { code: "REST-KFC1", name: "KFC Park Bulvar", address: "Park Bulvar AVM, Bakı, Səbail", lat: 40.3582, lon: 49.8458, region: "Baku" },
  { code: "REST-MCD1", name: "McDonald's 28 May", address: "28 May metrosу yanı, Bakı", lat: 40.3789, lon: 49.8479, region: "Baku" },
  { code: "REST-RST1", name: "Ramada Cafe", address: "Üzeyir Hacıbəyli 1, Bakı, Səbail", lat: 40.3691, lon: 49.8367, region: "Baku" },
  { code: "BRV-GNJ1", name: "Bravo Gəncə Mərkəz", address: "Atatürk prospekti 33, Gəncə", lat: 40.6828, lon: 46.3606, region: "Ganja" },
  { code: "ARZ-GNJ1", name: "Araz Gəncə", address: "Heydər Əliyev prospekti 8, Gəncə", lat: 40.6794, lon: 46.3589, region: "Ganja" },
  { code: "MGZ-GNJ1", name: "Mağaza Gəncəbazar", address: "Şah İsmayıl Xətai küçəsi 24, Gəncə", lat: 40.6804, lon: 46.3578, region: "Ganja" },
  { code: "MGZ-GNJ2", name: "Магазин Низами", address: "Nizami küçəsi 14, Gəncə", lat: 40.6831, lon: 46.3622, region: "Ganja" },
  { code: "BIZ-SMQ1", name: "Bizim Tarla Sumqayıt", address: "Sülh küçəsi 17, Sumqayıt", lat: 40.5851, lon: 49.6473, region: "Sumqayit" },
  { code: "NPT-SMQ1", name: "Neptun Sumqayıt", address: "28 May küçəsi 11, Sumqayıt", lat: 40.5832, lon: 49.6491, region: "Sumqayit" },
  { code: "MGZ-SMQ1", name: "Mağaza Xəzər", address: "Cəfər Cabbarlı küçəsi 9, Sumqayıt", lat: 40.5867, lon: 49.6502, region: "Sumqayit" },
  { code: "MGZ-SMQ2", name: "Mağaza Sahil", address: "Sahil küçəsi 22, Sumqayıt", lat: 40.5912, lon: 49.6534, region: "Sumqayit" },
  { code: "GAS-SOC1", name: "SOCAR АЗС-12", address: "Heydar Aliyev pr. 67, Bakı", lat: 40.4012, lon: 49.8682, region: "Baku" },
  { code: "GAS-SOC2", name: "SOCAR АЗС-44", address: "Binəqədi şossesi 88, Bakı", lat: 40.4612, lon: 49.8175, region: "Baku" },
  { code: "CINEMA-1", name: "CinemaPlus 28 Mall", address: "28 Mall, Bakı", lat: 40.3782, lon: 49.8489, region: "Baku" },
  { code: "AVM-GZ", name: "Gənclik AVM food court", address: "Fətəli Xan Xoyski pr., Bakı", lat: 40.3978, lon: 49.8506, region: "Baku" },
  { code: "REST-CHX", name: "Çörək Xanası Köhnə Bazar", address: "İçəri Şəhər, Bakı", lat: 40.3661, lon: 49.8367, region: "Baku" },
] as const

const MARS_ROUTE_AGENTS = [
  { code: "M-001", name: "Farid Aliyev", email: "farid@demo.leadshelf.local", phone: "+994 50 555 10 01", role: "SUPERVISOR" },
  { code: "M-002", name: "Elnur Mammadov", email: "elnur@demo.leadshelf.local", phone: "+994 50 555 10 02", role: "SUPERVISOR" },
  { code: "M-003", name: "Tural Quliyev", email: "tural@demo.leadshelf.local", phone: "+994 50 555 10 03", role: "MERCHANDISER" },
  { code: "M-004", name: "Nigar Hüseynova", email: "nigar@demo.leadshelf.local", phone: "+994 50 555 10 04", role: "MERCHANDISER" },
  { code: "M-005", name: "Rashad Babayev", email: "rashad@demo.leadshelf.local", phone: "+994 50 555 10 05", role: "MERCHANDISER" },
] as const

const MARS_ROUTE_SCENARIOS = [
  { name: "Mars Baku morning execution", agentCode: "M-003", storeCodes: ["BRV-NSM", "BRV-YSM", "BIZ-XTI", "ARZ-SBL", "NPT-BNG", "PIR-XTI"], status: "IN_PROGRESS", offsetDays: 0, completedStops: 2 },
  { name: "Mars Baku HoReCa audit", agentCode: "M-004", storeCodes: ["REST-KFC1", "REST-MCD1", "REST-RST1", "AVM-GZ", "REST-CHX"], status: "PLANNED", offsetDays: 0, completedStops: 0 },
  { name: "Mars Ganja coverage", agentCode: "M-005", storeCodes: ["BRV-GNJ1", "ARZ-GNJ1", "MGZ-GNJ1", "MGZ-GNJ2"], status: "PLANNED", offsetDays: 0, completedStops: 0 },
  { name: "Mars Baku completed route", agentCode: "M-003", storeCodes: ["MGZ-AHM", "MGZ-NIK", "MGZ-25", "GAS-SOC1", "CINEMA-1"], status: "COMPLETED", offsetDays: -1, completedStops: 5 },
  { name: "Mars Sumqayit completed route", agentCode: "M-002", storeCodes: ["BIZ-SMQ1", "NPT-SMQ1", "MGZ-SMQ1", "MGZ-SMQ2"], status: "COMPLETED", offsetDays: -1, completedStops: 4 },
] as const

function startOfToday(offsetDays = 0) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offsetDays)
  return d
}

async function ensureRegion(organizationId: string) {
  const existing =
    (await prisma.region.findFirst({ where: { organizationId, name: "Баку" } })) ??
    (await prisma.region.findFirst({ where: { organizationId, name: "Bakı" } }))
  if (existing) {
    return prisma.region.update({ where: { id: existing.id }, data: { name: "Баку" } })
  }
  return prisma.region.create({ data: { organizationId, name: "Баку" } })
}

async function ensureFormat(organizationId: string) {
  const existing =
    (await prisma.storeFormat.findFirst({ where: { organizationId, name: "Стандартная аптека" } })) ??
    (await prisma.storeFormat.findFirst({ where: { organizationId, name: "Standart" } }))
  const data = {
    name: "Стандартная аптека",
    description: "Формат 70-90 м²: OTC-зона, касса, холодильная витрина",
  }
  if (existing) return prisma.storeFormat.update({ where: { id: existing.id }, data })
  return prisma.storeFormat.create({ data: { organizationId, ...data } })
}

async function ensureStore(organizationId: string, regionId: string, formatId: string) {
  const data = {
    name: "Аптека №1 - Низами",
    code: "DEMO-001",
    address: "Баку, ул. Низами, 1",
    regionId,
    formatId,
    latitude: 40.3777,
    longitude: 49.892,
    isActive: true,
  }
  const existing = await prisma.store.findFirst({ where: { organizationId, code: data.code } })
  if (existing) return prisma.store.update({ where: { id: existing.id }, data })
  return prisma.store.create({ data: { organizationId, ...data } })
}

async function ensureEquipmentType(organizationId: string, kind: string, name: string) {
  const byName = await prisma.equipmentType.findFirst({ where: { organizationId, name } })
  if (byName) return byName
  const byKind = await prisma.equipmentType.findFirst({ where: { organizationId, kind } })
  if (byKind) return prisma.equipmentType.update({ where: { id: byKind.id }, data: { name, kind } })
  return prisma.equipmentType.create({ data: { organizationId, name, kind } })
}

async function ensureCatalog(organizationId: string, formatId: string, storeId: string) {
  const products = []

  for (const row of DEMO_PRODUCTS) {
    const category = await prisma.category.upsert({
      where: { organizationId_normalizedPath: { organizationId, normalizedPath: row.categoryPath } },
      update: { name: row.categoryName },
      create: {
        organizationId,
        name: row.categoryName,
        normalizedPath: row.categoryPath,
      },
    })
    const brand = await prisma.brand.upsert({
      where: { organizationId_name: { organizationId, name: row.brand } },
      update: {},
      create: { organizationId, name: row.brand },
    })
    const supplier = await prisma.supplier.upsert({
      where: { organizationId_name: { organizationId, name: row.supplier } },
      update: {},
      create: { organizationId, name: row.supplier },
    })
    const manufacturer = await prisma.manufacturer.upsert({
      where: { organizationId_name: { organizationId, name: row.manufacturer } },
      update: {},
      create: { organizationId, name: row.manufacturer },
    })
    const product = await prisma.product.upsert({
      where: { organizationId_sku: { organizationId, sku: row.sku } },
      update: {
        name: row.name,
        categoryId: category.id,
        brandId: brand.id,
        supplierId: supplier.id,
        manufacturerId: manufacturer.id,
        widthMm: row.widthMm,
        heightMm: row.heightMm,
        depthMm: row.depthMm,
        weightG: row.weightG,
        isActive: true,
      },
      create: {
        organizationId,
        sku: row.sku,
        name: row.name,
        categoryId: category.id,
        brandId: brand.id,
        supplierId: supplier.id,
        manufacturerId: manufacturer.id,
        widthMm: row.widthMm,
        heightMm: row.heightMm,
        depthMm: row.depthMm,
        weightG: row.weightG,
      },
    })
    await prisma.productBarcode.upsert({
      where: { organizationId_barcode: { organizationId, barcode: row.barcode } },
      update: { productId: product.id, isPrimary: true },
      create: { organizationId, productId: product.id, barcode: row.barcode, isPrimary: true },
    })
    await prisma.assortmentMatrix.upsert({
      where: { formatId_productId: { formatId, productId: product.id } },
      update: { isActive: true },
      create: { formatId, productId: product.id, isActive: true, validFrom: startOfToday(-30) },
    })
    await prisma.storeAssortment.upsert({
      where: { storeId_productId: { storeId, productId: product.id } },
      update: { isActive: true },
      create: { storeId, productId: product.id, isActive: true, validFrom: startOfToday(-30) },
    })
    if (!(await prisma.productImage.findFirst({ where: { productId: product.id } }))) {
      await prisma.productImage.create({
        data: {
          productId: product.id,
          url: `products/${organizationId}/${product.id}/demo-pack.svg`,
          kind: "front",
          sortOrder: 0,
        },
      })
    }
    products.push(product)
  }

  return products
}

async function ensureCatalogCompleteness(organizationId: string) {
  const products = await prisma.product.findMany({
    where: { organizationId, isActive: true },
    include: { barcodes: true, images: true },
    orderBy: [{ sku: "asc" }, { id: "asc" }],
  })
  const existingBarcodes = new Set(
    (await prisma.productBarcode.findMany({
      where: { organizationId },
      select: { barcode: true },
    })).map((row) => row.barcode),
  )

  let barcodeOffset = 0
  for (const product of products) {
    if (product.widthMm == null || product.heightMm == null || product.depthMm == null) {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          widthMm: product.widthMm ?? 72,
          heightMm: product.heightMm ?? 116,
          depthMm: product.depthMm ?? 36,
          weightG: product.weightG ?? 45,
        },
      })
    }
    if (product.barcodes.length === 0) {
      let barcode = ""
      do {
        barcodeOffset += 1
        barcode = `476199${String(barcodeOffset).padStart(7, "0")}`
      } while (existingBarcodes.has(barcode))
      existingBarcodes.add(barcode)
      await prisma.productBarcode.create({
        data: { organizationId, productId: product.id, barcode, isPrimary: true },
      })
    }
    const demoImageUrl = `products/${organizationId}/${product.id}/demo-pack.svg`
    const demoImage = product.images.find((image) => image.url === demoImageUrl)
    if (demoImage) {
      await prisma.productImage.update({
        where: { id: demoImage.id },
        data: { sortOrder: -1, kind: "front" },
      })
    } else {
      await prisma.productImage.create({
        data: {
          productId: product.id,
          url: demoImageUrl,
          kind: "front",
          sortOrder: -1,
        },
      })
    }
  }
}

// Guided Capture шаблоны (docs/24 slice 1): photo-first, burst 3 кадра.
// Форма шагов = mobileCaptureTemplateStepSchema из api-contracts mobile/v1.
async function ensureCaptureTemplate(
  organizationId: string,
  equipmentTypeId: string | null,
  name: string,
  steps: object[],
) {
  const existing = await prisma.captureTemplate.findFirst({
    where: { organizationId, equipmentTypeId },
  })
  if (existing) {
    return prisma.captureTemplate.update({
      where: { id: existing.id },
      data: { name, steps, isActive: true },
    })
  }
  return prisma.captureTemplate.create({
    data: { organizationId, equipmentTypeId, name, steps },
  })
}

const RACK_CAPTURE_STEPS = [
  {
    id: "front",
    kind: "front",
    required: true,
    sequence: 1,
    mediaKind: "photo",
    burstCount: 3,
    tiltToleranceDeg: 6,
    depthMode: null,
  },
  {
    id: "left-depth",
    kind: "left_depth",
    required: true,
    sequence: 2,
    mediaKind: "photo",
    burstCount: 3,
    tiltToleranceDeg: null,
    compositionHint: "edge_left",
    depthMode: "angle_photo",
  },
  {
    id: "right-depth",
    kind: "right_depth",
    required: true,
    sequence: 3,
    mediaKind: "photo",
    burstCount: 3,
    tiltToleranceDeg: null,
    compositionHint: "edge_right",
    depthMode: "angle_photo",
  },
  {
    id: "detail",
    kind: "detail",
    required: false,
    sequence: 4,
    mediaKind: "photo",
    burstCount: 1,
    compositionHint: "close_up",
  },
]

const FRIDGE_CAPTURE_STEPS = [
  {
    id: "front",
    kind: "front",
    required: true,
    sequence: 1,
    mediaKind: "photo",
    burstCount: 3,
    tiltToleranceDeg: 6,
    doorPolicy: "open_allowed",
  },
  {
    id: "top-down",
    kind: "top_down",
    required: true,
    sequence: 2,
    mediaKind: "photo",
    burstCount: 3,
    compositionHint: "top_down",
    doorPolicy: "open_allowed",
    depthMode: "angle_photo",
  },
  {
    id: "detail",
    kind: "detail",
    required: false,
    sequence: 3,
    mediaKind: "photo",
    burstCount: 1,
    compositionHint: "close_up",
  },
]

async function ensureEquipment(organizationId: string) {
  const rackType = await ensureEquipmentType(organizationId, "rack", "Стеллаж")
  await ensureEquipmentType(organizationId, "pallet", "Паллета")
  const fridgeType = await ensureEquipmentType(organizationId, "fridge", "Холодильная витрина")

  await ensureCaptureTemplate(
    organizationId,
    rackType.id,
    "Стеллаж: front + глубина слева/справа",
    RACK_CAPTURE_STEPS,
  )
  await ensureCaptureTemplate(
    organizationId,
    fridgeType.id,
    "Холодильник: front + сверху",
    FRIDGE_CAPTURE_STEPS,
  )
  await ensureCaptureTemplate(
    organizationId,
    null,
    "Общий сценарий полки",
    RACK_CAPTURE_STEPS,
  )

  const template =
    (await prisma.equipmentTemplate.findFirst({
      where: { organizationId, name: "Стеллаж OTC 1200×1800" },
    })) ??
    (await prisma.equipmentTemplate.create({
      data: { organizationId, typeId: rackType.id, name: "Стеллаж OTC 1200×1800" },
    }))

  let version = await prisma.equipmentVersion.findFirst({
    where: { templateId: template.id },
    orderBy: { versionNumber: "desc" },
    include: { shelves: true },
  })
  if (!version) {
    version = await prisma.equipmentVersion.create({
      data: {
        templateId: template.id,
        versionNumber: 1,
        widthMm: 1200,
        heightMm: 1800,
        depthMm: 420,
        shelves: {
          create: [180, 500, 820, 1140, 1460].map((yMm, shelfIndex) => ({
            shelfIndex,
            yMm,
            thicknessMm: 24,
            depthMm: 380,
            maxLoadKg: 25,
          })),
        },
      },
      include: { shelves: true },
    })
  }

  return { template, version }
}

async function ensurePlanogram(organizationId: string, products: Awaited<ReturnType<typeof ensureCatalog>>, equipmentVersionId: string) {
  const category = await prisma.category.findFirst({
    where: { organizationId, normalizedPath: "otc/cold-pain/tablets" },
  })
  const planogram =
    (await prisma.planogram.findFirst({
      where: { organizationId, name: "OTC: простуда и боль - базовая выкладка" },
    })) ??
    (await prisma.planogram.create({
      data: {
        organizationId,
        name: "OTC: простуда и боль - базовая выкладка",
        description: "Демо-планограмма для OTC-зоны у входа",
        categoryId: category?.id ?? null,
      },
    }))

  const existingPublished = await prisma.planogramVersion.findFirst({
    where: { planogramId: planogram.id, state: "PUBLISHED" },
    orderBy: { versionNumber: "desc" },
    include: {
      equipment: true,
      placements: true,
      zones: true,
    },
  })
  if (existingPublished?.placements.length) return { planogram, version: existingPublished }
  if (existingPublished && existingPublished.placements.length === 0) {
    await prisma.planogramVersion.update({
      where: { id: existingPublished.id },
      data: { state: "ARCHIVED", changeNote: "Archived empty demo version from interrupted seed" },
    })
  }

  const latest = await prisma.planogramVersion.findFirst({
    where: { planogramId: planogram.id },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  })
  const shelves = await prisma.equipmentShelf.findMany({
    where: { equipmentVersionId },
    orderBy: { shelfIndex: "asc" },
  })
  const version = await prisma.planogramVersion.create({
    data: {
      planogramId: planogram.id,
      versionNumber: (latest?.versionNumber ?? 0) + 1,
      state: "DRAFT",
      changeNote: "Demo baseline for product-ready walkthrough",
    },
  })
  const planogramEquipment = await prisma.planogramEquipment.create({
    data: {
      planogramVersionId: version.id,
      equipmentVersionId,
      label: "OTC стеллаж у входа",
      sortOrder: 0,
    },
  })
  const zones = await Promise.all([
    prisma.planogramZone.create({
      data: {
        planogramVersionId: version.id,
        planogramEquipmentId: planogramEquipment.id,
        name: "Обезболивание",
        color: "#dbeafe",
        xMm: 0,
        yMm: 170,
        widthMm: 620,
        heightMm: 700,
      },
    }),
    prisma.planogramZone.create({
      data: {
        planogramVersionId: version.id,
        planogramEquipmentId: planogramEquipment.id,
        name: "Простуда и иммунитет",
        color: "#dcfce7",
        xMm: 620,
        yMm: 170,
        widthMm: 580,
        heightMm: 700,
      },
    }),
  ])

  const placementRows = products.slice(0, 6).map((product, index) => {
    const shelf = shelves[index < 3 ? 1 : 2] ?? shelves[0]!
    return {
      planogramVersionId: version.id,
      planogramEquipmentId: planogramEquipment.id,
      shelfId: shelf.id,
      zoneId: zones[index < 3 ? 0 : 1]!.id,
      productId: product.id,
      xMm: 45 + (index % 3) * 230,
      yMm: shelf.yMm + shelf.thicknessMm,
      zMm: 0,
      widthMm: product.widthMm ?? 70,
      heightMm: product.heightMm ?? 110,
      depthMm: product.depthMm ?? 35,
      facingsX: index === 0 ? 4 : 3,
      facingsY: 1,
      facingsZ: index === 2 ? 2 : 1,
      sortOrder: index,
    }
  })
  await prisma.planogramPlacement.createMany({ data: placementRows })
  await prisma.equipmentVersion.update({ where: { id: equipmentVersionId }, data: { isFrozen: true } })
  await prisma.planogramVersion.update({
    where: { id: version.id },
    data: { state: "PUBLISHED", publishedAt: new Date() },
  })

  return {
    planogram,
    version: await prisma.planogramVersion.findFirstOrThrow({
      where: { id: version.id },
      include: { equipment: true, placements: true, zones: true },
    }),
  }
}

async function ensureAssignmentTaskAndProof(input: {
  organizationId: string
  storeId: string
  formatId: string
  planogramId: string
  planogramVersionId: string
  mobileUserId: string
}) {
  const assignment =
    (await prisma.planogramAssignment.findFirst({
      where: { planogramVersionId: input.planogramVersionId, storeId: input.storeId, activeTo: null },
    })) ??
    (await prisma.planogramAssignment.create({
      data: {
        planogramVersionId: input.planogramVersionId,
        storeId: input.storeId,
        activeFrom: startOfToday(-7),
      },
    }))

  const task =
    (await prisma.task.findFirst({
      where: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        planogramVersionId: input.planogramVersionId,
        title: "Выполнить выкладку OTC-зоны",
      },
    })) ??
    (await prisma.task.create({
      data: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        planogramVersionId: input.planogramVersionId,
        assignmentId: assignment.id,
        assigneeId: input.mobileUserId,
        title: "Выполнить выкладку OTC-зоны",
        description: "Проверить стеллаж у входа, выложить товары по опубликованной планограмме и отправить фото.",
        status: "PHOTO_SUBMITTED",
        dueAt: startOfToday(2),
      },
    }))
  await prisma.task.update({
    where: { id: task.id },
    data: {
      assignmentId: assignment.id,
      assigneeId: input.mobileUserId,
      status: "PHOTO_SUBMITTED",
      dueAt: startOfToday(2),
    },
  })
  if (!(await prisma.taskStatusHistory.findFirst({ where: { taskId: task.id, toStatus: "PHOTO_SUBMITTED" } }))) {
    await prisma.taskStatusHistory.createMany({
      data: [
        { taskId: task.id, fromStatus: null, toStatus: "NEW" },
        { taskId: task.id, fromStatus: "NEW", toStatus: "IN_PROGRESS", byUserId: input.mobileUserId },
        {
          taskId: task.id,
          fromStatus: "IN_PROGRESS",
          toStatus: "PHOTO_SUBMITTED",
          byUserId: input.mobileUserId,
        },
      ],
    })
  }

  const photoKey = `photos/${input.organizationId}/${task.id}/demo-proof-001.svg`
  const photo =
    (await prisma.photoSubmission.findFirst({
      where: { organizationId: input.organizationId, clientPhotoId: "demo-proof-001" },
    })) ??
    (await prisma.photoSubmission.create({
      data: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        taskId: task.id,
        userId: input.mobileUserId,
        url: photoKey,
        thumbnailUrl: photoKey,
        clientPhotoId: "demo-proof-001",
        takenAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        qualityScore: 0.74,
        exif: {
          qualityCheck: {
            status: "REVIEW",
            score: 0.74,
            dimensions: { width: 1280, height: 960 },
            issues: ["demo_photo_review"],
            checkedAt: new Date().toISOString(),
          },
        },
      },
    }))

  const review =
    (await prisma.humanReview.findFirst({
      where: {
        organizationId: input.organizationId,
        photoSubmissionId: photo.id,
        reason: "PHOTO_QUALITY",
      },
    })) ??
    (await prisma.humanReview.create({
      data: {
        organizationId: input.organizationId,
        reason: "PHOTO_QUALITY",
        status: "PENDING",
        taskId: task.id,
        photoSubmissionId: photo.id,
        planogramVersionId: input.planogramVersionId,
        score: 0.74,
        findings: {
          qualityCheck: {
            status: "REVIEW",
            score: 0.74,
            issues: ["demo_photo_review"],
            checkedAt: new Date().toISOString(),
          },
        },
        note: "Демо: фото отправлено из мобильного сценария и ожидает проверки офиса.",
      },
    }))

  const goldenReference =
    (await prisma.goldenReference.findFirst({
      where: { organizationId: input.organizationId, planogramVersionId: input.planogramVersionId },
    })) ??
    (await prisma.goldenReference.create({
      data: {
        organizationId: input.organizationId,
        planogramVersionId: input.planogramVersionId,
        photoSubmissionId: photo.id,
        imageUrl: photoKey,
        status: "ACTIVE",
        createdById: input.mobileUserId,
      },
    }))

  const slotPlacements = await prisma.planogramPlacement.findMany({
    where: { planogramVersionId: input.planogramVersionId },
    include: { product: { select: { sku: true, name: true } } },
    orderBy: { sortOrder: "asc" },
    take: 6,
  })
  const slotRects = [
    { xPct: 5, yPct: 26, widthPct: 12, heightPct: 12 },
    { xPct: 19, yPct: 26, widthPct: 12, heightPct: 12 },
    { xPct: 33, yPct: 26, widthPct: 12, heightPct: 12 },
    { xPct: 51, yPct: 47, widthPct: 12, heightPct: 12 },
    { xPct: 65, yPct: 47, widthPct: 12, heightPct: 12 },
    { xPct: 79, yPct: 47, widthPct: 12, heightPct: 12 },
  ]
  for (const [index, placement] of slotPlacements.entries()) {
    const existingSlot = await prisma.goldenReferenceSlot.findFirst({
      where: { goldenReferenceId: goldenReference.id, placementId: placement.id },
      select: { id: true },
    })
    const rect = slotRects[index] ?? slotRects[slotRects.length - 1]!
    const data = {
      productId: placement.productId,
      xPct: rect.xPct,
      yPct: rect.yPct,
      widthPct: rect.widthPct,
      heightPct: rect.heightPct,
      label: placement.product.name,
      sortOrder: index,
    }
    if (existingSlot) {
      await prisma.goldenReferenceSlot.update({ where: { id: existingSlot.id }, data })
    } else {
      await prisma.goldenReferenceSlot.create({
        data: {
          goldenReferenceId: goldenReference.id,
          placementId: placement.id,
          ...data,
        },
      })
    }
  }

  const referenceSlots = await prisma.goldenReferenceSlot.findMany({
    where: { goldenReferenceId: goldenReference.id },
    include: { product: { select: { sku: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  })
  const demoDetections = referenceSlots.map((slot) => ({
    slotId: slot.id,
    productId: slot.productId,
    productSku: slot.product?.sku ?? null,
    confidence: 0.35,
  }))
  const compliance = calculateShelfCompliance({
    slots: referenceSlots.map((slot) => ({
      id: slot.id,
      productId: slot.productId,
      productSku: slot.product?.sku ?? null,
    })),
    detections: demoDetections,
  })
  const visionFindings = {
    vision: {
      scannedAt: new Date().toISOString(),
      protocolVersion: 1,
      provider: "leadshelf-stub",
      modelVersion: "stub-reference-slots-v1",
      status: "needs_human_review",
      compliance: {
        score: compliance.score,
        status: compliance.status,
        totalSlots: compliance.totalSlots,
        matchedSlots: compliance.matchedSlots,
        missingSlots: compliance.missingSlots,
        wrongProducts: compliance.wrongProducts,
        extraDetections: compliance.extraDetections,
      },
      findings: {
        missing: compliance.findings.missing.map((item) => ({
          slotId: item.slotId,
          expectedProductId: item.expectedProductId,
          expectedProductSku: item.expectedProductSku,
        })),
        wrong: compliance.findings.wrong.map((item) => ({
          slotId: item.slotId,
          expectedProductId: item.expectedProductId,
          expectedProductSku: item.expectedProductSku,
          detectedProductId: item.detectedProductId,
          detectedProductSku: item.detectedProductSku,
          confidence: item.confidence,
        })),
        extra: compliance.findings.extra.map((item) => ({
          slotId: item.slotId,
          detectedProductId: item.detectedProductId,
          detectedProductSku: item.detectedProductSku,
          confidence: item.confidence,
        })),
      },
      detections: referenceSlots.map((slot) => ({
        slotId: slot.id,
        productId: slot.productId,
        productSku: slot.product?.sku ?? null,
        label: slot.label,
        confidence: 0.35,
        bbox: {
          xPct: slot.xPct,
          yPct: slot.yPct,
          widthPct: slot.widthPct,
          heightPct: slot.heightPct,
        },
      })),
      warnings: ["stub_provider_uses_reference_slots_without_image_inference"],
    },
  } satisfies Prisma.InputJsonObject
  const existingVisionReview = await prisma.humanReview.findFirst({
    where: {
      organizationId: input.organizationId,
      photoSubmissionId: photo.id,
      reason: "VISION_COMPLIANCE",
    },
    select: { id: true, status: true },
  })
  if (existingVisionReview?.status === "PENDING") {
    await prisma.humanReview.update({
      where: { id: existingVisionReview.id },
      data: {
        taskId: task.id,
        planogramVersionId: input.planogramVersionId,
        goldenReferenceId: goldenReference.id,
        score: compliance.score,
        findings: visionFindings,
        note: "Демо: vision compliance создан на stub-провайдере и требует ручной проверки.",
      },
    })
  } else if (!existingVisionReview) {
    await prisma.humanReview.create({
      data: {
        organizationId: input.organizationId,
        reason: "VISION_COMPLIANCE",
        status: "PENDING",
        taskId: task.id,
        photoSubmissionId: photo.id,
        planogramVersionId: input.planogramVersionId,
        goldenReferenceId: goldenReference.id,
        score: compliance.score,
        findings: visionFindings,
        note: "Демо: vision compliance создан на stub-провайдере и требует ручной проверки.",
      },
    })
  }

  return { assignment, task, photo, review, goldenReference }
}

async function ensureRouteRegion(organizationId: string, name: string) {
  const existing = await prisma.region.findFirst({ where: { organizationId, name } })
  if (existing) return existing
  return prisma.region.create({ data: { organizationId, name } })
}

async function ensureMarsRouteStores(organizationId: string, formatId: string) {
  const stores = new Map<string, Awaited<ReturnType<typeof prisma.store.upsert>>>()
  const regions = new Map<string, Awaited<ReturnType<typeof ensureRouteRegion>>>()

  for (const row of MARS_ROUTE_STORES) {
    let region = regions.get(row.region)
    if (!region) {
      region = await ensureRouteRegion(organizationId, row.region)
      regions.set(row.region, region)
    }
    const store = await prisma.store.upsert({
      where: { organizationId_code: { organizationId, code: row.code } },
      update: {
        name: row.name,
        address: row.address,
        latitude: row.lat,
        longitude: row.lon,
        regionId: region.id,
        formatId,
        isActive: true,
      },
      create: {
        organizationId,
        name: row.name,
        code: row.code,
        address: row.address,
        latitude: row.lat,
        longitude: row.lon,
        regionId: region.id,
        formatId,
        isActive: true,
      },
    })
    stores.set(row.code, store)
  }

  return stores
}

async function ensureMarsRouteAgents(organizationId: string, passwordHash: string) {
  const firstAgentCode = MARS_ROUTE_AGENTS[0]!.code
  const firstUser = await prisma.user.findUnique({
    where: { organizationId_employeeCode: { organizationId, employeeCode: firstAgentCode } },
    select: { id: true },
  })
  const team = await prisma.team.upsert({
    where: { organizationId_name: { organizationId, name: "Mars field execution" } },
    update: { leadUserId: firstUser?.id ?? null },
    create: {
      organizationId,
      name: "Mars field execution",
      leadUserId: firstUser?.id ?? null,
    },
  })
  const usersByCode = new Map<string, Awaited<ReturnType<typeof prisma.user.upsert>>>()
  const agentsByCode = new Map<string, Awaited<ReturnType<typeof prisma.fieldAgent.upsert>>>()

  for (const row of MARS_ROUTE_AGENTS) {
    const user = await prisma.user.upsert({
      where: { organizationId_employeeCode: { organizationId, employeeCode: row.code } },
      update: {
        email: row.email,
        name: row.name,
        role: row.role,
        passwordHash,
        isActive: true,
      },
      create: {
        organizationId,
        employeeCode: row.code,
        email: row.email,
        name: row.name,
        role: row.role,
        passwordHash,
      },
    })
    const agent = await prisma.fieldAgent.upsert({
      where: { userId: user.id },
      update: {
        organizationId,
        teamId: team.id,
        employeeCode: row.code,
        phone: row.phone,
      },
      create: {
        organizationId,
        userId: user.id,
        teamId: team.id,
        employeeCode: row.code,
        phone: row.phone,
      },
    })
    usersByCode.set(row.code, user)
    agentsByCode.set(row.code, agent)
  }

  return { team, usersByCode, agentsByCode }
}

async function ensureFieldForceScenario(input: {
  organizationId: string
  formatId: string
  mobilePasswordHash: string
}) {
  const storesByCode = await ensureMarsRouteStores(input.organizationId, input.formatId)
  const { team, agentsByCode } = await ensureMarsRouteAgents(input.organizationId, input.mobilePasswordHash)

  await prisma.route.updateMany({
    where: {
      organizationId: input.organizationId,
      name: { notIn: MARS_ROUTE_SCENARIOS.map((scenario) => scenario.name) },
    },
    data: { isActive: false },
  })

  const visits = []
  for (const scenario of MARS_ROUTE_SCENARIOS) {
    const agent = agentsByCode.get(scenario.agentCode)
    if (!agent) continue
    const routeData = {
      organizationId: input.organizationId,
      name: scenario.name,
      agentId: agent.id,
      weekdays: scenario.offsetDays === 0 ? [1, 2, 3, 4, 5] : [],
      isActive: true,
    }
    const route =
      (await prisma.route.findFirst({ where: { organizationId: input.organizationId, name: scenario.name } })) ??
      (await prisma.route.create({ data: routeData }))
    await prisma.route.update({ where: { id: route.id }, data: routeData })

    for (const [index, storeCode] of scenario.storeCodes.entries()) {
      const store = storesByCode.get(storeCode)
      if (!store) continue
      const plannedAt = new Date(startOfToday(scenario.offsetDays).getTime() + (9 + index) * 60 * 60 * 1000)
      const routeStop =
        (await prisma.routeStop.findUnique({
          where: { routeId_sortOrder: { routeId: route.id, sortOrder: index + 1 } },
        })) ??
        (await prisma.routeStop.create({
          data: {
            routeId: route.id,
            storeId: store.id,
            sortOrder: index + 1,
            plannedAt,
          },
        }))
      await prisma.routeStop.update({
        where: { id: routeStop.id },
        data: { storeId: store.id, plannedAt },
      })

      const isCompleted = index < scenario.completedStops
      const isCurrent = scenario.status === "IN_PROGRESS" && index === scenario.completedStops
      const checkInAt = isCompleted || isCurrent ? new Date(plannedAt.getTime() + 8 * 60 * 1000) : null
      const checkOutAt = isCompleted ? new Date(plannedAt.getTime() + 42 * 60 * 1000) : null
      const status = isCurrent ? "IN_PROGRESS" : isCompleted ? "COMPLETED" : scenario.status
      const visitData = {
        organizationId: input.organizationId,
        agentId: agent.id,
        storeId: store.id,
        routeStopId: routeStop.id,
        status,
        checkInAt,
        checkOutAt,
        checkInLat: checkInAt ? store.latitude : null,
        checkInLng: checkInAt ? store.longitude : null,
        anomalyFlags: checkInAt
          ? ({
              geofence: { outside: false, distanceM: 12 + index * 3, limitM: 150 },
              duration: { status: checkOutAt ? "ok" : "in_progress", minutes: checkOutAt ? 34 : null },
              offlineSync: { status: "ok", pendingOps: isCurrent ? 2 : 0 },
            } satisfies Prisma.InputJsonObject)
          : Prisma.JsonNull,
      }
      const visit =
        (await prisma.visit.findFirst({
          where: {
            organizationId: input.organizationId,
            agentId: agent.id,
            storeId: store.id,
            routeStopId: routeStop.id,
          },
        })) ??
        (await prisma.visit.create({ data: visitData }))
      visits.push(await prisma.visit.update({ where: { id: visit.id }, data: visitData }))
    }
  }

  await prisma.agentLocation.deleteMany({ where: { agentId: { in: [...agentsByCode.values()].map((agent) => agent.id) } } })
  await prisma.agentLocation.createMany({
    data: [
      { agentId: agentsByCode.get("M-001")!.id, latitude: 40.3712, longitude: 49.8421, accuracyM: 12, recordedAt: new Date(Date.now() - 10 * 60 * 1000) },
      { agentId: agentsByCode.get("M-002")!.id, latitude: 40.5867, longitude: 49.6502, accuracyM: 18, recordedAt: new Date(Date.now() - 18 * 60 * 1000) },
      { agentId: agentsByCode.get("M-003")!.id, latitude: 40.3835, longitude: 49.9133, accuracyM: 15, recordedAt: new Date(Date.now() - 5 * 60 * 1000) },
      { agentId: agentsByCode.get("M-004")!.id, latitude: 40.3582, longitude: 49.8458, accuracyM: 20, recordedAt: new Date(Date.now() - 24 * 60 * 1000) },
      { agentId: agentsByCode.get("M-005")!.id, latitude: 40.6828, longitude: 46.3606, accuracyM: 16, recordedAt: new Date(Date.now() - 14 * 60 * 1000) },
    ],
  })

  return { team, storesByCode, agentsByCode, visits }
}

async function ensureFloorPlan(input: {
  organizationId: string
  storeId: string
  formatId: string
  equipmentVersionId: string
  planogramId: string
}) {
  const floorPlan =
    (await prisma.floorPlan.findFirst({
      where: { organizationId: input.organizationId, name: "План зала - Аптека №1 Низами" },
    })) ??
    (await prisma.floorPlan.create({
      data: {
        organizationId: input.organizationId,
        name: "План зала - Аптека №1 Низами",
        storeId: input.storeId,
      },
    }))

  let version = await prisma.floorPlanVersion.findFirst({
    where: { floorPlanId: floorPlan.id, isPublished: true },
    orderBy: { versionNumber: "desc" },
  })
  if (!version) {
    version = await prisma.floorPlanVersion.create({
      data: {
        floorPlanId: floorPlan.id,
        versionNumber: 1,
        widthMm: 9000,
        depthMm: 6200,
        isPublished: true,
        publishedAt: new Date(),
      },
    })
  }
  if (!(await prisma.floorPlanEquipment.findFirst({ where: { floorPlanVersionId: version.id } }))) {
    await prisma.floorPlanEquipment.createMany({
      data: [
        {
          floorPlanVersionId: version.id,
          equipmentVersionId: input.equipmentVersionId,
          planogramId: input.planogramId,
          label: "OTC стеллаж у входа",
          xMm: 760,
          yMm: 820,
          rotationDeg: 0,
          isLocked: true,
        },
        {
          floorPlanVersionId: version.id,
          equipmentVersionId: input.equipmentVersionId,
          label: "Резервный стеллаж сезонных товаров",
          xMm: 2680,
          yMm: 820,
          rotationDeg: 0,
          isLocked: false,
        },
      ],
    })
  }

  return { floorPlan, version }
}

async function ensureAnalyticsSnapshots(input: {
  organizationId: string
  storeId: string
  products: Awaited<ReturnType<typeof ensureCatalog>>
}) {
  const productIds = input.products.map((product) => product.id)
  const windowStart = startOfToday(-65)
  await Promise.all([
    prisma.salesSnapshot.deleteMany({
      where: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        productId: { in: productIds },
        date: { gte: windowStart },
      },
    }),
    prisma.stockSnapshot.deleteMany({
      where: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        productId: { in: productIds },
        date: { gte: windowStart },
      },
    }),
    prisma.priceSnapshot.deleteMany({
      where: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        productId: { in: productIds },
        date: { gte: windowStart },
      },
    }),
  ])

  const weekdayFactor = [0.9, 1.04, 1.0, 1.08, 1.13, 1.18, 0.86]
  const salesRows = []
  const stockRows = []
  const priceRows = []

  for (const product of input.products) {
    const profile = ANALYTICS_PROFILES[product.sku as keyof typeof ANALYTICS_PROFILES]
    if (!profile) continue

    priceRows.push({
      organizationId: input.organizationId,
      storeId: input.storeId,
      productId: product.id,
      date: startOfToday(0),
      price: profile.price,
      costPrice: profile.cost,
      currency: "AZN",
    })

    for (const offset of [-60, -45, -30, -15, 0]) {
      const age = Math.abs(offset)
      stockRows.push({
        organizationId: input.organizationId,
        storeId: input.storeId,
        productId: product.id,
        date: startOfToday(offset),
        quantity: Math.max(0, profile.stockQty + Math.round(age * profile.currentQty * 0.18)),
      })
    }

    for (let offset = -59; offset <= 0; offset += 1) {
      const date = startOfToday(offset)
      const baseQty = offset >= -29 ? profile.currentQty : profile.previousQty
      const factor = weekdayFactor[date.getUTCDay()] ?? 1
      const quantity = Math.max(0.1, Math.round(baseQty * factor * 10) / 10)
      const revenue = Math.round(quantity * profile.price * 100) / 100
      const profit = Math.round(quantity * (profile.price - profile.cost) * 100) / 100
      salesRows.push({
        organizationId: input.organizationId,
        storeId: input.storeId,
        productId: product.id,
        date,
        quantity,
        revenue,
        profit,
      })
    }
  }

  await Promise.all([
    salesRows.length ? prisma.salesSnapshot.createMany({ data: salesRows }) : Promise.resolve(),
    stockRows.length ? prisma.stockSnapshot.createMany({ data: stockRows }) : Promise.resolve(),
    priceRows.length ? prisma.priceSnapshot.createMany({ data: priceRows }) : Promise.resolve(),
  ])

  return {
    salesRows: salesRows.length,
    stockRows: stockRows.length,
    priceRows: priceRows.length,
  }
}

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: "demo" },
    update: {},
    create: { name: "LeadShelf Demo", slug: "demo" },
  })

  const passwordHash = await hash(DEMO_PASSWORD, ARGON_OPTS)
  for (const [email, name, role] of USERS) {
    await prisma.user.upsert({
      where: { organizationId_email: { organizationId: org.id, email } },
      update: { name, role },
      create: { organizationId: org.id, email, name, role, passwordHash },
    })
  }

  // Полевой сотрудник: вход с телефона по employeeCode + PIN (docs/18)
  const MOBILE_PIN = "1234"
  const mobilePasswordHash = await hash(MOBILE_PIN, ARGON_OPTS)
  const mobileUser = await prisma.user.upsert({
    where: {
      organizationId_employeeCode: { organizationId: org.id, employeeCode: "M-001" },
    },
    update: { name: "Полевой мерчендайзер", role: "MERCHANDISER", passwordHash: mobilePasswordHash },
    create: {
      organizationId: org.id,
      employeeCode: "M-001",
      name: "Полевой мерчендайзер",
      role: "MERCHANDISER",
      passwordHash: mobilePasswordHash,
    },
  })

  // Дальше — через tenant client: seed заодно прогоняет главную дверь к данным.
  // organizationId в data обязателен для ТИПОВ Prisma; клиент сверяет его со
  // своим скоупом (чужой -> ошибка), так что подмена невозможна.
  const db = createTenantClient(prisma, org.id)
  const region = await ensureRegion(org.id)
  const format = await ensureFormat(org.id)
  const store = await ensureStore(org.id, region.id, format.id)
  const products = await ensureCatalog(org.id, format.id, store.id)
  await ensureCatalogCompleteness(org.id)
  const { version: equipmentVersion } = await ensureEquipment(org.id)
  const { planogram, version: planogramVersion } = await ensurePlanogram(
    org.id,
    products,
    equipmentVersion.id,
  )
  await ensureFloorPlan({
    organizationId: org.id,
    storeId: store.id,
    formatId: format.id,
    equipmentVersionId: equipmentVersion.id,
    planogramId: planogram.id,
  })
  const proof = await ensureAssignmentTaskAndProof({
    organizationId: org.id,
    storeId: store.id,
    formatId: format.id,
    planogramId: planogram.id,
    planogramVersionId: planogramVersion.id,
    mobileUserId: mobileUser.id,
  })
  const fieldForce = await ensureFieldForceScenario({
    organizationId: org.id,
    formatId: format.id,
    mobilePasswordHash,
  })
  const proofVisit = fieldForce.visits.find((visit) => visit.status === "COMPLETED") ?? fieldForce.visits[0]
  if (proofVisit) await prisma.photoSubmission.update({ where: { id: proof.photo.id }, data: { visitId: proofVisit.id } })
  await ensureAnalyticsSnapshots({
    organizationId: org.id,
    storeId: store.id,
    products,
  })

  // Smoke-check через tenant client: если скоуп сломан, seed падает здесь.
  await Promise.all([
    db.store.count(),
    db.product.count(),
    db.floorPlan.count(),
    db.planogram.count(),
    db.task.count(),
    db.humanReview.count(),
    db.fieldAgent.count(),
    db.route.count(),
    db.visit.count(),
    db.salesSnapshot.count(),
    db.stockSnapshot.count(),
    db.priceSnapshot.count(),
  ])

  console.log(`Demo tenant готов: org=${org.slug} (${org.id})`)
  console.log(`Логины (пароль у всех: ${DEMO_PASSWORD}):`)
  for (const [email, , role] of USERS) console.log(`  ${email}  [${role}]`)
  console.log(`Мобильный вход: org=demo, employeeCode=M-001, PIN=${MOBILE_PIN}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
