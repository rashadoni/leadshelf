// Демо-тенант для Phase 0 DoD. Идемпотентен: повторный запуск ничего не дублирует.
// Запуск: pnpm --filter @leadshelf/db seed:demo
import "dotenv/config"
import { hash } from "@node-rs/argon2"
import { createSystemClient, createTenantClient } from "../src/index.ts"

const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 }
const DEMO_PASSWORD = "demo1234"

const prisma = createSystemClient("seed-demo")

const USERS = [
  ["admin@demo.leadshelf.local", "Демо администратор", "ADMIN"],
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

async function ensureEquipment(organizationId: string) {
  const rackType = await ensureEquipmentType(organizationId, "rack", "Стеллаж")
  await ensureEquipmentType(organizationId, "pallet", "Паллета")
  await ensureEquipmentType(organizationId, "fridge", "Холодильная витрина")

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

  return { assignment, task, photo, review, goldenReference }
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
  const mobileUser = await prisma.user.upsert({
    where: {
      organizationId_employeeCode: { organizationId: org.id, employeeCode: "M-001" },
    },
    update: { name: "Полевой мерчендайзер", role: "MERCHANDISER" },
    create: {
      organizationId: org.id,
      employeeCode: "M-001",
      name: "Полевой мерчендайзер",
      role: "MERCHANDISER",
      passwordHash: await hash(MOBILE_PIN, ARGON_OPTS),
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
  await ensureAssignmentTaskAndProof({
    organizationId: org.id,
    storeId: store.id,
    formatId: format.id,
    planogramId: planogram.id,
    planogramVersionId: planogramVersion.id,
    mobileUserId: mobileUser.id,
  })
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
