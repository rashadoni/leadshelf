import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts")

const config: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.basemaps.cartocdn.com",
              "media-src 'self' blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
            ].join("; "),
          },
        ],
      },
    ]
  },
  // прод-образ: самодостаточный сервер с trace-нутыми зависимостями
  output: "standalone",
  // В monorepo эти gates запускаются отдельными командами (`pnpm lint`,
  // `pnpm typecheck`). Встроенный Next checker может зависать после webpack
  // compile, поэтому build не должен дублировать эти проверки.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  // workspace-пакеты с "main": "src/index.ts" транспилируются Next-ом
  transpilePackages: [
    "@leadshelf/db",
    "@leadshelf/core",
    "@leadshelf/api-contracts",
    "@leadshelf/worker",
  ],
  // нативные/Node-only пакеты не бандлим
  serverExternalPackages: ["@prisma/client", "@node-rs/argon2"],
  // Route-level guards ограничивают фото 15 MiB и видео 35 MiB. Transport
  // должен пропускать multipart overhead, иначе валидные видео обрезаются до
  // выполнения route и превращаются в неочевидный 400.
  experimental: {
    // Этот host держит production-сервисы и ограничивает interactive user.slice.
    // Последовательная static generation не позволяет build-worker'ам выбить
    // общий memory high-water mark во время локальной проверки и деплоя.
    cpus: 1,
    middlewareClientMaxBodySize: 40 * 1024 * 1024,
  },
}

export default withNextIntl(config)
