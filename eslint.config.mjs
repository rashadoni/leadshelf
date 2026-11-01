import tseslint from "typescript-eslint"

// Минимальный конфиг: не стиль, а ЗАБОРЫ архитектуры (docs/11 п.9, docs/12).
// Стилевые правила добавим позже, когда появится команда.
export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      // Генерат Prisma: мегабайты CJS и 9 МБ .d.ts, править нечего.
      "packages/prisma-client/generated/**",
    ],
  },
  // packages/core — чистая доменная математика: без Prisma, БД и UI-фреймворков
  {
    files: ["packages/core/**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@prisma/client", "@prisma/*", "@leadshelf/prisma-client"],
              message: "packages/core — чистые функции, Prisma запрещен (docs/11 п.9)",
            },
            {
              group: ["@leadshelf/db", "@leadshelf/db/*"],
              message: "packages/core не ходит в БД",
            },
            {
              group: ["next", "next/*", "react", "react-dom", "react/*"],
              message: "packages/core без UI-фреймворков",
            },
          ],
        },
      ],
    },
  },
  // apps/web — к данным только через @leadshelf/db (tenantDb/authDb)
  {
    files: ["apps/web/src/**/*.ts", "apps/web/src/**/*.tsx"],
    languageOptions: { parser: tseslint.parser },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@prisma/client",
              message:
                "route handlers не импортируют Prisma напрямую — только tenantDb/authDb из @/server/db/client (docs/12)",
            },
            {
              // Генерат переехал в свой пакет, забор должен знать новое имя.
              name: "@leadshelf/prisma-client",
              message:
                "route handlers не импортируют Prisma напрямую — только tenantDb/authDb из @/server/db/client (docs/12)",
            },
          ],
        },
      ],
    },
  },
]
