// Демо-тенант для Phase 0 DoD. Идемпотентен: повторный запуск ничего не дублирует.
// Запуск: pnpm --filter @leadshelf/db seed:demo
import "dotenv/config"
import { hash } from "@node-rs/argon2"
import { createSystemClient, createTenantClient } from "../src/index.ts"

const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 }
const DEMO_PASSWORD = "demo1234"

const prisma = createSystemClient("seed-demo")

const USERS = [
  ["admin@demo.leadshelf.local", "Demo Admin", "ADMIN"],
  ["category@demo.leadshelf.local", "Demo Category Manager", "CATEGORY_MANAGER"],
  ["merch@demo.leadshelf.local", "Demo Merchandiser", "MERCHANDISER"],
  ["supervisor@demo.leadshelf.local", "Demo Supervisor", "SUPERVISOR"],
  ["analyst@demo.leadshelf.local", "Demo Analyst", "ANALYST"],
] as const

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
      update: {},
      create: { organizationId: org.id, email, name, role, passwordHash },
    })
  }

  // Дальше — через tenant client: seed заодно прогоняет главную дверь к данным.
  // organizationId в data обязателен для ТИПОВ Prisma; клиент сверяет его со
  // своим скоупом (чужой -> ошибка), так что подмена невозможна.
  const db = createTenantClient(prisma, org.id)
  const scope = { organizationId: org.id }

  const region =
    (await db.region.findFirst({ where: { name: "Bakı" } })) ??
    (await db.region.create({ data: { name: "Bakı", ...scope } }))

  const format =
    (await db.storeFormat.findFirst({ where: { name: "Standart" } })) ??
    (await db.storeFormat.create({
      data: { name: "Standart", description: "Standart aptek formatı", ...scope },
    }))

  if (!(await db.store.findFirst({ where: { code: "DEMO-001" } }))) {
    await db.store.create({
      data: {
        name: "Demo Aptek №1",
        code: "DEMO-001",
        address: "Bakı, Nizami küç. 1",
        regionId: region.id,
        formatId: format.id,
        ...scope,
      },
    })
  }

  for (const [name, kind] of [
    ["Rəf", "rack"],
    ["Palet", "pallet"],
    ["Soyuducu vitrin", "fridge"],
  ] as const) {
    if (!(await db.equipmentType.findFirst({ where: { name } }))) {
      await db.equipmentType.create({ data: { name, kind, ...scope } })
    }
  }

  console.log(`Demo tenant готов: org=${org.slug} (${org.id})`)
  console.log(`Логины (пароль у всех: ${DEMO_PASSWORD}):`)
  for (const [email, , role] of USERS) console.log(`  ${email}  [${role}]`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
