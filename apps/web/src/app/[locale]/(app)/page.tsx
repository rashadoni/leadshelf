import { getTranslations } from "next-intl/server"

export default async function OverviewPage() {
  const t = await getTranslations("dashboard")
  return (
    <div>
      <h1 className="text-2xl font-semibold">{t("welcome")}</h1>
      <p className="mt-2 text-sm text-neutral-500">{t("overviewHint")}</p>
    </div>
  )
}
