import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts")

const config: NextConfig = {
  // workspace-пакеты с "main": "src/index.ts" транспилируются Next-ом
  transpilePackages: ["@leadshelf/db", "@leadshelf/core"],
  // нативные/Node-only пакеты не бандлим
  serverExternalPackages: ["@prisma/client", "@node-rs/argon2"],
}

export default withNextIntl(config)
