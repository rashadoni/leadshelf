import type { ReactNode } from "react"
import { requireSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"
import { DashboardShell } from "@/components/shell/dashboard-shell"
import { HelpVideoLauncher } from "@/components/help/help-video-launcher"
import { isDemoTenantReady } from "@/server/demo/readiness"

export const dynamic = "force-dynamic"

export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const session = await requireSession(locale)
  // tenant client — единственная дверь к данным (docs/12)
  const db = tenantDb(session.org)
  const [user, demoReady] = await Promise.all([
    db.user.findFirst({
      where: { id: session.sub },
      select: { email: true },
    }),
    isDemoTenantReady(db),
  ])

  return (
    <DashboardShell userEmail={user?.email ?? ""} demoReady={demoReady}>
      {children}
      <HelpVideoLauncher />
    </DashboardShell>
  )
}
