# LeadShelf: roadmap и backlog

Обновлено 2026-07-02: scope расширен до полного порта MTM (`docs/08`),
добавлены фазы 11-13 (field force, заказы, алерты) и требования из
самокритики (`docs/10` схема/UX, `docs/11` архитектура).

## Phase 0 - Product foundation

Цель: зафиксировать scope, стек, структуру репозитория и первый прототип модели данных.

Задачи:

- Создать GitHub repo `leadshelf`. `[сделано]`
- Создать monorepo skeleton. `[сделано]`
- Настроить TypeScript, lint, formatting. `[сделано: eslint-заборы
  (no-restricted-imports core/web) + GitHub Actions CI: validate ->
  migrate -> lint -> typecheck -> тесты изоляции -> build]`
- Создать Prisma schema v0. `[сделано, прошла Codex-ревью]`
- Создать auth/tenant baseline. `[сделано: JWT+Argon2id, AuthSession
  rotation+reuse-detection, scoped tenant client]`
- Создать базовую навигацию web app. `[сделано: next-intl az/ru, login,
  dashboard shell, 8 пустых разделов]`
- Создать seed demo tenant. `[сделано: org demo, 5 ролей, точка,
  типы оборудования]`

Требования из docs/11 (архитектурная самокритика):

- Scoped tenant Prisma client в `packages/db` (auto-inject organizationId) —
  единственная дверь к БД из route handlers; до первого handler.
- Интеграционные тесты изоляции: «тенант A не видит данные тенанта B».
- Auth-решение ДО скаффолда web: JWT access/refresh (refresh переживает
  недели offline), login по employee code/телефону для STORE_STAFF без email.
- i18n-решение ДО скаффолда web: az/ru (next-intl), messages-каталог.
- CI (GitHub Actions): typecheck, prisma validate, тесты; vitest как единый
  тест-раннер; eslint c `no-restricted-imports` в `packages/core`
  (запрет prisma/next/react).
- Явный `output` у prisma generator (pnpm-монорепо грабли).
- Синхронизировать docs/01 и docs/04 с docs/08 (устранить противоречия scope).

Definition of Done:

- Есть локальный dev server.
- Есть первая миграция — ОБЯЗАТЕЛЬНО вместе с raw SQL из
  `packages/db/prisma/MIGRATION_NOTES.md` (NULLS NOT DISTINCT уникальность
  снапшотов, CHECK на assignment, publish/graph-триггеры).
- Есть demo user.
- Есть пустые разделы: Catalog, Equipment, Floor Plans, Planograms, Tasks, Analytics.

## Phase 1 - Catalog & master-data import

Цель: продуктовая база, без которой планограмма невозможна.

Решения владельца (2026-07-02):

- **Phase 1 начинается с импорта и качества master-data, не с редактора.**
  Редактор без SKU, остатков, размеров и статусов ассортимента — демо,
  а не продукт.
- **1С-интеграцию НЕ делаем универсальной.** Phase 1 = контракт импорта
  через промежуточный staging-слой (CSV/XLSX/API). Адаптер под конкретную
  1С конкретного клиента — отдельная работа после пилотного контракта.
- **Обязательные поля контракта импорта**: SKU, barcode, category tree,
  brand, price, stock, assortment status, sales.
- **Габариты — отдельный master-data процесс.** UI ручного ввода/коррекции
  размеров + статус «размеры отсутствуют» (деривативен от NULL widthMm/
  heightMm/depthMm) — обязательная часть MVP. GS1/базы поставщиков — позже,
  старт от них не зависит.
- **Фото товара — optional.** Есть фото — показываем; нет — заглушка-упаковка
  с названием/брендом/цветом. Флоу загрузки фото SKU: admin — в этой фазе,
  мобильная съемка SKU — в Phase 6.
- **Пилотный сценарий — аптечный** (остатки, матрица, планограммы, мобильное
  подтверждение, 1С). Проектируем под него, не «для всех».

Задачи:

- Staging-контракт импорта (zod в api-contracts): SKU, barcode, category
  tree, brand, price, stock, assortment status, sales. `[сделано: v1
  заморожен, все 5 сущностей]`
- Import CSV/XLSX через staging-слой (порт парсинга из MTM lib/mtm/sku).
  `[CSV сделано: парсеры ru/az/en + исполнители products/prices/stock/
  sales/assortment c идемпотентностью (42 теста), API-роуты upload/status/
  errors/products/data-quality. Осталось: XLSX, очередь для больших файлов,
  UI]`
- Product CRUD.
- Category tree.
- Brand/supplier/manufacturer attributes.
- Product dimensions: width, height, depth, weight + UI ручного
  ввода/коррекции + фильтр «без размеров».
- Barcode support.
- Product images: admin-загрузка + заглушка (название/бренд/цвет) для SKU
  без фото.
- Stock/price/sales snapshots.
- Assortment matrix (формат) + store assortment (исключения).
- Data quality report: missing dimensions, missing barcode, missing image,
  missing category — первоклассный экран, не задворки.

Требования из docs/11:

- Импорт идемпотентен: только upsert по natural key снапшотов; тест
  «двойной прогон батча = идентичный результат».
- Маппинг единиц 1С → ProductUnit enum (шт→PCS, ящик→BOX, кг→KG, л→L,
  пачка→PACK) в import pipeline.

Не делать:

- Не строить красивый AI import до простого надежного CSV/XLSX.
- Не хранить все характеристики в одном неуправляемом JSON без индексов.

## Phase 2 - Equipment library

Цель: конструктор торгового оборудования.

Задачи:

- Equipment template library.
- Equipment dimensions.
- Shelves/rows.
- Cells/containers.
- Hooks/perforated rack support.
- Pallet/table/freezer/fridge basic types.
- Shelf fill tool: count, shelf thickness, depth, row gap, top/bottom offsets.
- Seating places/facings settings.
- Auto seating toggle.
- Auto compression toggle.
- Save to library.
- Preview in 2D.

Definition of Done:

- Пользователь может создать стеллаж 120x180x30 с 5 полками и сохранить в библиотеку.

## Phase 3 - Floor plan constructor

Цель: цифровой торговый зал.

Задачи:

- Stores list.
- Formats list.
- Create/edit floor plan.
- Place equipment instances on canvas.
- Rotate/move/resize.
- Lock/unlock.
- Labels.
- Assign floor plan to store or format.
- Copy plan from format to store.

Не делать в MVP:

- Не делать CAD-уровень сложности.
- Не делать 3D editing.

## Phase 4 - Planogram editor v1

Цель: ручное создание планограммы с точными размерами.

Задачи:

- Open equipment as planogram canvas.
- Product search/filter from catalog.
- Drag product to shelf.
- Product placement with dimensions.
- Facings X/Y/Z.
- Depth count.
- Rotation.
- Stack one-on-one.
- Shelf capacity validation.
- Manual override.
- Product details panel: name, SKU, barcode, dimensions, current price, stock.
- Zone creation on equipment.
- Save draft.
- Version history.

UX-дифференциаторы (Tier 1 из docs/10, не «потом», а требования фазы):

- Валидация как физика: невлезающий товар не встает (ghost + причина
  «глубина 320мм > полка 300мм»); математика уже в `packages/core/capacity`.
- Деньги в drag-preview: ABC-класс, оборот/день, дней запаса, доля полки —
  живые данные из снапшотов в момент перетаскивания.
- Diff-режим версий («git diff для полки»): added/removed/moved подсветка
  между двумя версиями + дельта метрик.

Definition of Done:

- Можно вручную собрать полку и увидеть, сколько товара помещается по ширине и глубине.
- Планограмма редактируется только через EquipmentVersion (заморозка
  геометрии при publish).

## Phase 5 - Auto placement v1

Цель: ускорить построение планограммы без full optimization.

Задачи:

- Zone rule editor.
- Select category/brand/supplier/attributes.
- Sorting rules: ABC, turnover, brand, price, product name, height.
- Exclusions.
- Auto-facing based on sales/profit/quantity.
- Brand share percentage.
- Load into zone.
- Auto spacing.
- Auto compression for soft packs.

Важно:

- Все авто-алгоритмы должны оставлять explainable log: что выбрано, почему, что не поместилось.

## Phase 6 - Publishing & mobile execution

Цель: закрыть офис -> торговая точка -> фото-подтверждение.

Задачи web:

- Publish planogram to store/format.
- Create execution task.
- Task statuses: New, In Progress, Photo Submit, Completed, Expired, Empty.
- Task assignee.
- Due date/SLA.
- Compare published version vs current draft.

Задачи mobile:

- Login.
- Store selection.
- Task list.
- Planogram view.
- Product detail tap.
- Changed items list.
- Barcode scanner: find where SKU should be placed.
- Floor plan location hint.
- Photo submit.
- Comment/feedback.
- Offline outbox.

Требования из docs/11 (архитектура):

- Sync-протокол спроектировать и прототипировать ДО мобильного UI;
  e2e-тест с симуляцией обрывов сети — часть DoD.
- API-версионирование: замороженный `/api/v1/mobile`, contracts в
  `packages/api-contracts/v1/`, `protocolVersion` в sync, 426 на устаревший.
- Фото-pipeline ADR: presigned upload, EXIF сохраняется (форензика,
  watermark-спека), thumbnails в worker, retention/стоимость.
- Decimal → string на границе api-contracts; мобильный считает в копейках.

UX-дифференциаторы (Tier 1 из docs/10):

- Offline-доверие как UX: видимая очередь «3 фото отправятся при сети»
  с ручным retry.
- Камера-оверлей: полупрозрачная планограмма поверх видоискателя при
  фото-подтверждении (без AI; дисциплинирует ракурс — данные для Phase 10).

Definition of Done:

- Центральный офис публикует планограмму.
- Мобильный пользователь видит задание.
- Пользователь отправляет фото.
- Офис видит задачу как выполненную/на проверке.
- e2e-тест sync переживает обрыв сети посреди пуша без дублей и потерь.

## Phase 7 - Analytics v1

Цель: дать управленческую пользу без тяжелого BI.

Задачи:

- Planogram product table.
- Column chooser.
- Group by brand/category/supplier.
- Excel export.
- ABC by turnover/cost/profit/quantity.
- Sales heatmap by planogram.
- Color by brand/supplier/markup/stock days.
- Assortment gaps: active in assortment but absent in planogram.
- Obsolete in planogram but inactive in assortment.
- Task KPI report.
- Basic dashboard: stores with planograms, active planograms, placed SKUs, linear meters, turnover, profit.

## Phase 8 - Like-for-like and space productivity

Цель: отвечать на вопрос "стала ли выкладка лучше".

Задачи:

- Like-for-like period comparison.
- Compare store/format/planogram.
- Metrics: turnover, profit, sales qty, turnover per meter, profit per meter, stock days, turnover ratio.
- Space productivity: share in shelf vs share in sales/profit.
- Shelf share by brand/category/supplier.

## Phase 9 - 3D viewer

Цель: визуальная проверка.

Задачи:

- 3D view from 2D planogram data.
- Shelf/equipment perspective.
- Screenshot export.
- Store/floor plan viewer later.

Не делать:

- Не превращать 3D в основной редактор на старте.

## Phase 10 - AI / computer vision

Цель: автоматическая проверка фото против планограммы.

Задачи:

- Golden reference photo.
- Reference slots.
- Photo quality check.
- Detector/embedding service.
- Compliance score.
- Missing/wrong/extra products.
- Human review queue.
- Model/data quality dashboard.

Рекомендация:

- Начать с golden reference + human review.
- Не начинать с обучения собственного детектора на 50 SKU до проверки бизнес-ценности.

## Phase 11 - Field force: маршруты, визиты, live map

Добавлено по docs/08 (полный порт MTM). Стартует ПОСЛЕ Phase 6 (мобильное
фото-подтверждение стабильно), может идти параллельно Phase 7. Порт
поведения из MTM `routes`, `visits`, `map`, `visit-anomaly/*`,
`territory-scope.ts`.

Задачи:

- Teams/FieldAgent поверх User.
- Routes + RouteStop, привязка к магазинам.
- Visits: check-in/out c geofence, anomaly-флаги (порт visit-anomaly).
- AgentLocation + live map в web.
- Territory scoping (порт в packages/core).
- Мобильный флоу визита: маршрут дня -> точка -> чек-ин -> задачи точки.

Definition of Done:

- Агент проходит маршрут в мобильном, офис видит визиты и аномалии на карте.

## Phase 12 - Заказы, промо, кредитные лимиты

Порт чистых алгоритмов MTM (`promotion-engine`, `credit-limit`,
`invoice-generator`, `price-ocr`) с тестами ДО UI — финансово-смежная логика.
Только после стабильных Phase 1-6.

Задачи:

- Order/OrderLine из визита или напрямую.
- Promotion engine (скидки/бонусы/бандлы) с тестами на портированных кейсах.
- Credit limit проверка при создании заказа.
- Invoice generation.
- Offline-заказ через outbox (идемпотентность deviceId+clientOpId).

## Phase 13 - Алерты и активность

- Продуктовая событийная система (не порт MtmAlert как есть).
- Типы: task.overdue, visit.anomaly, stock.gap, import.errors.
- Push через MobileDevice.pushToken.
- Утренний дайджест офису (Tier 3 UX из docs/10).

## UX-бэклог (Tier 2/3 из docs/10, вплетать по фазам)

- Рентген-слои метрик поверх полки (клавиши 1/2/3/4) — с Phase 7.
- Explainable autofill с таймлайном шагов — Phase 5.
- Cmd+K палитра + omnisearch — с Phase 3.
- Комменты-пины на полке — Phase 4/5.
- Сканер-навигатор «куда ставить SKU» + точка на плане зала — Phase 6+.
- Сегментный чек-лист выкладки с фото по сегментам — Phase 6+.
- QR-паспорт полки — v1.5.
- Печатный PDF-режим планограммы — Phase 7.
- NL-запросы к каталогу/аналитике (LLM раньше CV) — Phase 7+.
- Голосовые комментарии с транскрипцией — v1.5.

Анти-scope (не делать, docs/10): AR-очки, 3D-first редактор, AI-first
compliance.
