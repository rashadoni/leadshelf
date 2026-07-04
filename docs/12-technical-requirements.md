# Технические требования (2026-07-02)

Консолидация решений из docs/02 (стек), docs/09 (план миграции), docs/11
(архитектурная самокритика) + конкретика, которой не хватало. Статусы:
`[решено]` — делаем так; `[открыто: до X]` — решить до указанной фазы.

## Runtime и версии

- `[решено]` Node.js >= 20 LTS (локально 20.20.2), pnpm 9, TypeScript 5.8 strict.
- `[решено]` Next.js 15 App Router, React 19 — apps/web.
- `[решено]` Prisma 6 + Postgres **16** (минимум 15 — NULLS NOT DISTINCT
  из MIGRATION_NOTES обязателен).
- `[решено]` Явный `output` у prisma generator (pnpm-монорепо).

## Dev-окружение

- `[решено]` docker-compose в корне: postgres:16 + minio (S3-эмуляция).
  Один `docker compose up` — и dev-среда готова; никакой облачной
  зависимости для разработки.
- `[решено 2026-07-02]` Postgres проброшен на **127.0.0.1:55432** (не 5432):
  у владельца loopback:5432 занят нативным Postgres, а :5433 — SSH-туннелем;
  оба перехватывают подключения раньше docker (specific bind > wildcard).
  Высокий свободный порт + явный bind на loopback это исключают. Внутри
  контейнера и в проде Postgres остаётся на 5432. DATABASE_URL в
  `packages/db/.env` указывает на 55432.
- `[решено]` `.env.example` в каждом workspace, реальные `.env` в gitignore.

## Auth

- `[решено]` Собственный JWT-флоу (без NextAuth — мобильному нужен полный
  контроль): access 15 мин + refresh 30 дней с ротацией; refresh переживает
  недели offline (проверяется только при sync).
- `[решено]` Пароли — Argon2id. Web: httpOnly cookie. Mobile: secure storage.
- `[решено]` STORE_STAFF/FIELD_AGENT логинятся по employee code + PIN/паролю
  (email не обязателен — у сотрудника аптеки его часто нет).
- `[решено]` Роли v0 — enum UserRole; кастомные Permission-таблицы — v2.

## i18n

- `[решено]` next-intl, локали `az` (default) и `ru`; `en` — когда будет
  спрос. Все UI-строки через messages с первого экрана — ретрофит дороже.
- `[решено]` Данные (названия товаров/точек) — на языке тенанта, без
  мультиязычных полей в v0.

## Доступ к данным

- `[решено]` Scoped tenant client (Prisma client extension в packages/db,
  auto-inject organizationId) — единственный путь из route handlers.
  Голый клиент — только worker и seed.
- `[решено]` Route handler = zod-парсинг → вызов core/сервиса →
  сериализация. Бизнес-логики в handlers нет.
- `[решено]` Decimal → string на границе api-contracts; деньги в мобильном —
  целые копейки.
- `[решено]` Всё, что нужно мобильному — route handlers `/api/v1/mobile/*`
  (замороженный контракт, protocolVersion в sync, 426 на устаревший клиент).
  Server actions — только для web-внутренних мутаций.

## Файлы/медиа

- `[решено]` S3-совместимый API с первого дня (dev: MinIO); presigned upload
  с мобильного; EXIF сохраняется (форензика фото); thumbnails — worker.
- `[решено]` Прод-провайдер v0: MinIO на том же Hetzner VPS через S3-совместимый
  API. Cloudflare R2 остается миграционным вариантом при росте объема/трафика.

## Фоновые задачи

- `[решено]` pg-boss (очередь в том же Postgres) для импорта/публикаций/
  агрегаций. Redis/BullMQ — только когда упрёмся.

## Mobile

- `[решено]` Expo + dev-client (не bare RN): WatermelonDB и VisionCamera
  подключаются config-плагинами, а DX Expo сильно дешевле. Пересобрать в
  bare можно позже без переписывания.
- `[уточнено 2026-07-03, docs/19]` Хранилище пилота — **expo-sqlite**
  (работает в Expo Go: демо на телефоне владельца без нативной сборки);
  WatermelonDB — миграция позже через LocalStore-интерфейс (clientOpId/
  clientPhotoId/курсоры сохраняются). Требование docs/05 — про НАЛИЧИЕ
  outbox, не про движок. Outbox по mtm-offline-sync-spec, идемпотентность
  deviceId+clientOpId — без изменений.

## Тестирование и CI

- `[решено]` vitest везде (packages/core мигрирует с node:test); Playwright
  smoke для editor — с Phase 4.
- `[решено]` GitHub Actions: typecheck + prisma validate + vitest на PR;
  тесты изоляции тенанта — блокирующие.
- `[решено]` eslint 9 flat config + prettier; в packages/core —
  no-restricted-imports (@prisma/*, next, react).

## Деплой

- `[решено 2026-07-02, владелец]` **Новый Hetzner VPS сразу**, деплой с
  первого дня: CI (GitHub Actions) → сервер. Один хост:
  web + worker + Postgres 16 + MinIO + Caddy (reverse proxy, авто-TLS),
  всё в Docker. Спецификация: CPX31 (4 vCPU/8GB) или CX32, Ubuntu 24.04.
  Setup-чеклист: `deploy/SERVER_SETUP.md`.
- `[решено]` Фото v0 — MinIO на том же VPS (volume + бэкап); миграция на
  Cloudflare R2 — когда объем/трафик вырастет (S3 API совместим, переезд
  дешевый).
- `[решено]` Бэкапы: ночной pg_dump + бэкап MinIO-volume на Hetzner Storage
  Box (или borgbackup); настроить ДО загрузки пилотных данных.
- `[решено]` Секреты: GitHub Actions secrets + `.env` на сервере (не в git).
- `[решено 2026-07-02, владелец]` Dev и prod на одном VPS ЖЁСТКО разделены:
  `/opt/leadshelf/prod` и `/opt/leadshelf/dev`, разные compose-имена
  (`leadshelf-prod`/`leadshelf-dev`) и volumes, prod-`.env` root-only (600),
  dev-порт 3100 не публикуется (SSH-туннель/basic auth). Dev НЕ видит
  prod-БД. Подробности: deploy/SERVER_SETUP.md шаг 3.
- `[решено 2026-07-02, владелец]` **Пока работаем по IP** `157.90.227.191`
  без домена. Демо-доступ — `http://157.90.227.191` (Caddy на 80). TLS через
  Let's Encrypt для голого IP невозможен; вариант при необходимости —
  Caddy `tls internal` (самоподписанный, будет warning в браузере). Домен +
  авто-TLS подключим позже, реверс-прокси уже готов к смене на домен.

## Порядок ближайших работ (Phase 0, остаток)

1. docker-compose + первая миграция вместе с raw SQL из MIGRATION_NOTES.md.
2. Scoped tenant client + тесты изоляции.
3. Скаффолд apps/web: Next.js 15 + next-intl (az/ru) + auth-флоу + пустые
   разделы (Catalog, Equipment, Floor Plans, Planograms, Tasks, Field Force,
   Analytics) + seed demo tenant.
4. CI + vitest-миграция + eslint-заборы.
5. → Phase 1: порт каталога и CSV-импорта (первый домен из docs/09 B1).
