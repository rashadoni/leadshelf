import { getTranslations } from "next-intl/server"
import { getSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"
import { EquipmentForm } from "../equipment-form"

export default async function NewEquipmentPage() {
  const [t, session] = await Promise.all([getTranslations("equipment"), getSession()])
  if (!session) return null

  const types = await tenantDb(session.org).equipmentType.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, kind: true },
  })

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">{t("createNew")}</h1>
      <EquipmentForm types={types} />
    </div>
  )
}
