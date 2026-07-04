import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts")

const config: NextConfig = {
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
}

export default withNextIntl(config)
