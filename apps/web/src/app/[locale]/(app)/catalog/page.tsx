import { getTranslations } from "next-intl/server"
import { getSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"
import { Link } from "@/i18n/navigation"
import { CatalogTabs } from "./catalog-tabs"
import { DimensionsEditor } from "./dimensions-editor"
import { PhotoCell } from "./photo-cell"
import { ProductCreateForm, ProductMetaEditor, type CatalogRefs } from "./product-management"

const PAGE_SIZE = 25

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const [t, tNav, session, params] = await Promise.all([
    getTranslations("catalog"),
    getTranslations("nav"),
    getSession(),
    searchParams,
  ])
  if (!session) return null // (app) layout уже редиректит

  const q = params.q?.trim() || undefined
  const missingDimensions = params.missingDimensions === "true"
  const missingBarcode = params.missingBarcode === "true"
  const missingImage = params.missingImage === "true"
  const cursor = params.cursor

  const db = tenantDb(session.org)
  const [products, categories, brands, suppliers, manufacturers] = await Promise.all([
    db.product.findMany({
    where: {
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { sku: { contains: q, mode: "insensitive" } },
              { barcodes: { some: { barcode: { startsWith: q } } } },
            ],
          }
        : {}),
      ...(missingDimensions
        ? { OR: [{ widthMm: null }, { heightMm: null }, { depthMm: null }] }
        : {}),
      ...(missingBarcode ? { barcodes: { none: {} } } : {}),
      ...(missingImage ? { images: { none: {} } } : {}),
    },
    include: {
      brand: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
      manufacturer: { select: { id: true, name: true } },
      category: { select: { id: true, name: true, normalizedPath: true } },
      barcodes: { where: { isPrimary: true }, select: { barcode: true } },
      images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
    db.category.findMany({ orderBy: [{ normalizedPath: "asc" }], select: { id: true, name: true, normalizedPath: true } }),
    db.brand.findMany({ orderBy: [{ name: "asc" }], select: { id: true, name: true } }),
    db.supplier.findMany({ orderBy: [{ name: "asc" }], select: { id: true, name: true } }),
    db.manufacturer.findMany({ orderBy: [{ name: "asc" }], select: { id: true, name: true } }),
  ])
  const refs: CatalogRefs = { categories, brands, suppliers, manufacturers }

  const hasMore = products.length > PAGE_SIZE
  const page = hasMore ? products.slice(0, PAGE_SIZE) : products

  const nextPageHref = () => {
    const sp = new URLSearchParams()
    if (q) sp.set("q", q)
    if (missingDimensions) sp.set("missingDimensions", "true")
    if (missingBarcode) sp.set("missingBarcode", "true")
    if (missingImage) sp.set("missingImage", "true")
    sp.set("cursor", page[page.length - 1]!.id)
    return `/catalog?${sp.toString()}`
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">{tNav("catalog")}</h1>
      <CatalogTabs active="products" />
      <ProductCreateForm refs={refs} />

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={t("search")}
          className="w-72 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <label className="flex items-center gap-1 text-sm text-neutral-600">
          <input
            type="checkbox"
            name="missingDimensions"
            value="true"
            defaultChecked={missingDimensions}
          />
          {t("filterMissingDimensions")}
        </label>
        <label className="flex items-center gap-1 text-sm text-neutral-600">
          <input
            type="checkbox"
            name="missingBarcode"
            value="true"
            defaultChecked={missingBarcode}
          />
          {t("filterMissingBarcode")}
        </label>
        <label className="flex items-center gap-1 text-sm text-neutral-600">
          <input type="checkbox" name="missingImage" value="true" defaultChecked={missingImage} />
          {t("filterMissingImage")}
        </label>
        <button className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white">
          {t("apply")}
        </button>
        <Link href="/catalog" className="text-sm text-neutral-500 hover:underline">
          {t("reset")}
        </Link>
      </form>

      {page.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
          {t("table.empty")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
                <th className="px-3 py-2" />
                <th className="px-3 py-2">{t("table.sku")}</th>
                <th className="px-3 py-2">{t("table.name")}</th>
                <th className="px-3 py-2">{t("table.barcode")}</th>
                <th className="px-3 py-2">{t("table.category")}</th>
                <th className="px-3 py-2">{t("table.brand")}</th>
                <th className="px-3 py-2">{t("table.supplier")}</th>
                <th className="px-3 py-2">{t("table.manufacturer")}</th>
                <th className="px-3 py-2">{t("table.unit")}</th>
                <th className="px-3 py-2">{t("table.dimensions")}</th>
                <th className="px-3 py-2">{t("table.weight")}</th>
                <th className="px-3 py-2">{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {page.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                >
                  <td className="px-3 py-2">
                    <PhotoCell
                      productId={p.id}
                      name={p.name}
                      brandName={p.brand?.name ?? null}
                      imageKey={p.images[0]?.url ?? null}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                  <td className="px-3 py-2">{p.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {p.barcodes[0]?.barcode ?? <span className="text-amber-600">—</span>}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{p.category?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-neutral-500">{p.brand?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-neutral-500">{p.supplier?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-neutral-500">{p.manufacturer?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-neutral-500">{p.unit}</td>
                  <td className="px-3 py-2">
                    <DimensionsEditor
                      productId={p.id}
                      dims={{
                        widthMm: p.widthMm,
                        heightMm: p.heightMm,
                        depthMm: p.depthMm,
                        weightG: p.weightG,
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{p.weightG ?? "—"}</td>
                  <td className="px-3 py-2">
                    <ProductMetaEditor
                      productId={p.id}
                      refs={refs}
                      initial={{
                        sku: p.sku,
                        name: p.name,
                        unit: p.unit,
                        barcode: p.barcodes[0]?.barcode ?? "",
                        categoryId: p.category?.id ?? "",
                        brandId: p.brand?.id ?? "",
                        supplierId: p.supplier?.id ?? "",
                        manufacturerId: p.manufacturer?.id ?? "",
                        widthMm: p.widthMm?.toString() ?? "",
                        heightMm: p.heightMm?.toString() ?? "",
                        depthMm: p.depthMm?.toString() ?? "",
                        weightG: p.weightG?.toString() ?? "",
                        isActive: p.isActive,
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && (
        <div className="mt-4">
          <Link
            href={nextPageHref()}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
          >
            {t("table.next")} →
          </Link>
        </div>
      )}
    </div>
  )
}
