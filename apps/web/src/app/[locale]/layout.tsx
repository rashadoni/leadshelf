import type { ReactNode } from "react"
import type { Viewport } from "next"
import { notFound } from "next/navigation"
import { NextIntlClientProvider, hasLocale } from "next-intl"
import { routing } from "@/i18n/routing"
import "../globals.css"

export const metadata = {
  title: "LeadShelf",
  description: "Field force + shelf execution",
}

// Keep pinch/browser zoom available. Next's implicit viewport may constrain
// scaling; an explicit unconstrained viewport is required for WCAG 1.4.4.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}
