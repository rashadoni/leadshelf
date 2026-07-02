import { getTranslations } from "next-intl/server"
import type { NavKey } from "./nav-items"

export async function EmptySection({ sectionKey }: { sectionKey: Exclude<NavKey, "overview"> }) {
  const tNav = await getTranslations("nav")
  const tEmpty = await getTranslations("emptyStates")
  return (
    <div>
      <h1 className="text-2xl font-semibold">{tNav(sectionKey)}</h1>
      <div className="mt-6 rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
        {tEmpty(sectionKey)}
      </div>
    </div>
  )
}
