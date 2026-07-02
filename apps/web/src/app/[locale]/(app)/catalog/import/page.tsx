import { getTranslations } from "next-intl/server"
import { CatalogTabs } from "../catalog-tabs"
import { ImportForm } from "./import-form"

export default async function CatalogImportPage() {
  const [t, tNav] = await Promise.all([
    getTranslations("catalog.import"),
    getTranslations("nav"),
  ])
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">{tNav("catalog")}</h1>
      <CatalogTabs active="import" />
      <h2 className="mb-4 text-lg font-medium">{t("title")}</h2>
      <ImportForm />
    </div>
  )
}
