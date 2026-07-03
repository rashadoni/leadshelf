import { getTranslations } from "next-intl/server"
import { getSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"
import { Link } from "@/i18n/navigation"
import { NewPlanogramForm } from "./new-planogram-form"

export default async function NewPlanogramPage() {
  const [t, session] = await Promise.all([getTranslations("planograms"), getSession()])
  if (!session) return null

  const templates = await tenantDb(session.org).equipmentTemplate.findMany({
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { widthMm: true, heightMm: true, depthMm: true },
      },
    },
    orderBy: { name: "asc" },
  })

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">{t("createNew")}</h1>
      {templates.length === 0 ? (
        <p className="text-sm text-neutral-500">
          {t("new.noEquipment")} —{" "}
          <Link href="/equipment-library/new" className="underline">
            →
          </Link>
        </p>
      ) : (
        <NewPlanogramForm
          templates={templates.map((tpl) => ({
            id: tpl.id,
            name: tpl.name,
            dims: tpl.versions[0]
              ? `${tpl.versions[0].widthMm}×${tpl.versions[0].heightMm}×${tpl.versions[0].depthMm}`
              : "",
          }))}
        />
      )}
    </div>
  )
}
