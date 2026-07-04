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
  `[CSV+XLSX сделано: парсеры ru/az/en + исполнители products/prices/stock/
  sales/assortment c идемпотентностью, API-роуты upload/status/errors/
  products/data-quality, UI каталога (таблица/импорт/качество/размеры);
  большие файлы уходят в durable ImportQueueJob + file-backed worker queue,
  runner `pnpm --filter @leadshelf/worker import:queue`]`
- Product CRUD. `[сделано: POST product + PATCH metadata/status/barcode,
  create/edit/deactivate UI; delete заменен deactivate из-за исторических снапшотов]`
- Category tree. `[сделано: normalizedPath tree используется в import и
  catalog create/edit selector]`
- Brand/supplier/manufacturer attributes. `[сделано: поля Product +
  import upsert + catalog create/edit selectors]`
- Product dimensions: width, height, depth, weight + UI ручного
  ввода/коррекции + фильтр «без размеров». `[сделано: inline-редактор в
  таблице каталога + PATCH API + фильтр]`
- Barcode support.
- Product images: admin-загрузка + заглушка (название/бренд/цвет) для SKU
  без фото. `[сделано: MinIO/S3 storage, media-proxy с tenant-guard,
  клик-загрузка в таблице каталога, цветная заглушка, фильтр «без фото»]`
- Stock/price/sales snapshots.
- Assortment matrix (формат) + store assortment (исключения).
- Data quality report: missing dimensions, missing barcode, missing image,
  missing category — первоклассный экран, не задворки. `[сделано: вкладка
  «Качество данных» с кликабельными карточками -> фильтры каталога +
  история импортов; таблица товаров и форма импорта с ошибками — тоже]`

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

Статус (2026-07-03): срез 1 сделан — core-математика раскладки полок
(равные просветы, валидация clearance>=50мм), parent-path repo с версионной
семантикой (draft на месте / frozen -> клон, optimistic lock), API
templates/types/save-version, UI: библиотека карточками с SVG-превью,
конструктор с shelf fill tool и живым превью (az/ru). DoD пройден вживую.
План: docs/15. Cells/hooks и copy template закрыты в Phase 2 follow-up.

Задачи:

- Equipment template library.
- Equipment dimensions.
- Shelves/rows.
- Cells/containers. `[сделано: EquipmentCell сохраняется в version,
  UI генерирует grid cells и preview показывает ячейки]`
- Hooks/perforated rack support. `[сделано: EquipmentHook сохраняется в
  version, UI генерирует hook row и preview показывает крючки]`
- Pallet/table/freezer/fridge basic types.
- Shelf fill tool: count, shelf thickness, depth, row gap, top/bottom offsets.
- Seating places/facings settings.
- Auto seating toggle.
- Auto compression toggle.
- Save to library.
- Copy template. `[сделано: API copy latest geometry/shelves/cells/hooks +
  кнопка copy в форме шаблона]`
- Preview in 2D.

Definition of Done:

- Пользователь может создать стеллаж 120x180x30 с 5 полками и сохранить в библиотеку.

## Phase 3 - Floor plan constructor

Цель: цифровой торговый зал.

Задачи:

- Stores list.
- Formats list.
- Create/edit floor plan. `[сделано: POST /api/v1/floor-plans создает
  published v1; PATCH /api/v1/floor-plans/:id создает новую published
  version с заменой оборудования; inline edit в /floor-plans]`
- Place equipment instances on canvas. `[сделано: form rows create
  FloorPlanEquipment instances with linked latest equipment version]`
- Rotate/move/resize. `[move/rotate сделано через x/y/rotationDeg fields;
  resize не делаем для versioned equipment, меняется через equipment library]`
- Lock/unlock. `[сделано: isLocked в create form/API]`
- Labels. `[сделано: label в create form/API и viewer]`
- Assign floor plan to store or format. `[сделано: storeId XOR formatId in API/form]`
- Copy plan from format to store. `[сделано: API copy-to-store копирует
  latest version/equipment из format plan в store plan + кнопка в карточке]`

Не делать в MVP:

- Не делать CAD-уровень сложности.
- Не делать 3D editing.

## Phase 4 - Planogram editor v1

Цель: ручное создание планограммы с точными размерами.

Статус (2026-07-03): срез 1 сделан — физика размещения в core (просвет до
полки ВЫШЕ, коллизии, nextFreeX; 9 тестов), parent-path repo с инвариантами
(DRAFT-only, снапшот габаритов, revision-lock; 6 тестов), API placements
CRUD, редактор: SVG-канвас с фото/цвет-заглушками и границами фейсов,
click-to-place с авто-позицией, пикер товаров (без размеров — заблокированы),
панель фейсингов X/Y/Z, индикатор свободного места по полкам. Физическая
валидация возвращает причину в мм («нет свободных 1350мм»). DoD пройден
вживую. План: docs/16. Срез 2: зоны, история версий, drag, деньги в preview.

Задачи:

- Open equipment as planogram canvas.
- Product search/filter from catalog.
- Drag product to shelf. `[сделано: SVG pointer drag с ghost-позицией,
  snap 10мм и сохранением через PATCH placement + серверная физика]`
- Product placement with dimensions.
- Facings X/Y/Z.
- Depth count.
- Rotation.
- Stack one-on-one.
- Shelf capacity validation.
- Manual override.
- Product details panel: name, SKU, barcode, dimensions, current price, stock.
- Zone creation on equipment. `[сделано: DRAFT-only zone API с
  revision-lock/bounds-check + SVG overlay и панель создания/удаления зон]`
- Save draft.
- Version history. `[сделано: боковая история версий + diff к предыдущей
  версии по added/removed/moved, цветовая подсветка current placements]`

UX-дифференциаторы (Tier 1 из docs/10, не «потом», а требования фазы):

- Валидация как физика: невлезающий товар не встает (ghost + причина
  «глубина 320мм > полка 300мм»); математика уже в `packages/core/capacity`.
- Деньги в drag-preview: ABC-класс, оборот/день, дней запаса, доля полки —
  живые данные из снапшотов в момент перетаскивания. `[сделано:
  server-side placementMetrics из Sales/Stock/Price snapshots, карточка
  товара + drag label с ABC/turnover/day/stock days/shelf share]`
- Diff-режим версий («git diff для полки»): added/removed/moved подсветка
  между двумя версиями + дельта метрик. `[сделано: placement diff и
  подсветка; метрики рядом с selected/drag placement]`

Definition of Done:

- Можно вручную собрать полку и увидеть, сколько товара помещается по ширине и глубине.
- Планограмма редактируется только через EquipmentVersion (заморозка
  геометрии при publish).

## Phase 5 - Auto placement v1

Цель: ускорить построение планограммы без full optimization.

Задачи:

- Zone rule editor. `[сделано: editor выбирает zone + фильтры +
  sortBy/facingsBy/limit и запускает autofill]`
- Select category/brand/supplier/attributes. `[сделано: category/brand/
  supplier filters; attributes оставлены после атрибутного UI]`
- Sorting rules: ABC, turnover, brand, price, product name, height.
  `[сделано: turnover/profit/quantity/name/height; ABC/brand/price позже,
  когда появится отдельная ABC materialization/price picker]`
- Exclusions. `[сделано: autofill принимает excludeSkus и UI поле
  исключений]`
- Auto-facing based on sales/profit/quantity. `[сделано: facingsBy
  turnover/profit/quantity; placement metadata хранит score/reason]`
- Brand share percentage. `[сделано: maxBrandSharePct cap в autofill rule]`
- Load into zone. `[сделано: POST zone autofill создает placements
  внутри зоны с physical validation и explainable log]`
- Auto spacing. `[сделано: sequential free-slot spacing внутри zone range]`
- Auto compression for soft packs. `[сделано: явный Product.isSoftPack
  в каталоге/import/API; autofill с autoCompressSoftPacks сжимает только
  soft-pack SKU через compressionX; core collision/capacity и analytics
  linear meters учитывают сжатую ширину]`

Важно:

- Все авто-алгоритмы должны оставлять explainable log: что выбрано, почему, что не поместилось.

## Phase 6 - Publishing & mobile execution

Цель: закрыть офис -> торговая точка -> фото-подтверждение.

Статус (2026-07-03): web-срез сделан — publish DRAFT->PUBLISHED c
ревалидацией геометрии (stale-guard), заморозкой EquipmentVersion,
assignment (формат XOR точки), авто-задачами по точкам и overlap-reject;
next-draft клонирует выкладку в новую версию; FSM статусов задач с
историей; DB-триггеры инвариантов (MIGRATION_NOTES п.3 закрыт); UI:
publish-диалог в редакторе, read-only опубликованной версии, страница
задач со статус-фильтрами и переходами. План: docs/17. Mobile API (срез 1, 2026-07-03) сделан: замороженный
/api/v1/mobile (protocolVersion+426), вход employeeCode+PIN с привязкой
устройства, refresh-ротация с grace-ретраем и reuse-детекцией,
pull/push/ack delta-sync с per-collection курсорами, идемпотентный push
(clientOpId -> записанный результат), фото multipart + photo.submit,
media по bearer; назначение задач в web (assignee-select). План: docs/18.
Expo-приложение (срез 2, 2026-07-03) сделано: login, task list/detail,
planogram view, offline status/photo/comment outbox, ручной sync retry,
shared mobile contracts, Android export smoke. Автопросрочка EXPIRED и
SLA-счетчики сделаны. Product detail tap сделан: кликабельная SVG-планограмма,
карточка товара и список товаров из published bundle. Changed items list
сделан в mobile: показывает diff payload, если он есть, иначе текущие позиции
как проверочный список. Barcode/SKU finder, camera scanner binding,
floor-plan location hint и camera overlay сделаны. Остатки Phase 6 mobile
на этом срезе закрыты.

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
- Product detail tap. `[сделано: кликабельная SVG-позиция + карточка товара]`
- Changed items list. `[сделано: diff/current list в mobile]`
- Barcode scanner: find where SKU should be placed. `[сделано: ручной barcode/SKU finder + expo-camera scanner binding]`
- Floor plan location hint. `[сделано: store-aware task locationHint из published floor plan + fallback в mobile]`
- Photo submit. `[сделано: offline queue + CameraView proof overlay]`
- Comment/feedback. `[сделано: mobile task.comment outbox + web tasks
  feedback column + DB idempotency test]`
- Offline outbox. `[сделано: SQLite outbox, retry counters, sync-manager
  ordering tests; DB e2e lost-response replay for status/photo/comment]`

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
  `[сделано: repo integration test повторяет потерянный ответ push batch
  status/photo/comment и проверяет отсутствие дублей]`

## Phase 7 - Analytics v1

Цель: дать управленческую пользу без тяжелого BI.

Задачи:

- Planogram product table. `[сделано: /analytics server table по planogramVersion+SKU, placements/units/linear meters]`
- Column chooser. `[сделано: server-driven cols query + toggle chips]`
- Group by brand/category/supplier. `[сделано: server-driven group query + summary table]`
- Excel export. `[сделано: SpreadsheetML .xls export route + кнопка в /analytics]`
- ABC by turnover/cost/profit/quantity. `[сделано: ABC table по SalesSnapshot с A/B/C классами]`
- Sales heatmap by planogram. `[сделано: /analytics heatmap table по planogram+SKU turnover]`
- Color by brand/supplier/markup/stock days. `[сделано: color overlay table по brand/supplier/markup/stock days]`
- Assortment gaps: active in assortment but absent in planogram. `[сделано:
  /analytics показывает активные SKU из форматной матрицы и store-исключений,
  которых нет в назначенной планограмме]`
- Obsolete in planogram but inactive in assortment. `[сделано: /analytics
  показывает SKU, оставшиеся в назначенных планограммах, но выключенные,
  истекшие или отсутствующие в активной ассортиментной логике]`
- Task KPI report. `[сделано: /analytics показывает task KPI summary,
  разрез по магазинам и планограммам, completion/on-time/photo proof метрики]`
- Basic dashboard: stores with planograms, active planograms, placed SKUs, linear meters, turnover, profit.
  `[сделано: верхний /analytics summary считает магазины под активными
  assignment, активные версии, SKU, linear meters, turnover и profit]`
- Test coverage for analytics calculations.
  `[сделано: apps/web Vitest покрывает ABC-классы, активные assignment,
  assortment gaps, obsolete planogram reasons и task KPI метрики; analytics
  child-модели без organizationId читаются через parent-path workerDb с
  organizationId-фильтрами, /az/analytics и Excel export smoke = 200]`

## Phase 8 - Like-for-like and space productivity

Цель: отвечать на вопрос "стала ли выкладка лучше".

Задачи:

- Like-for-like period comparison. `[сделано: /analytics сравнивает
  последние 30 дней продаж с предыдущими 30 днями по turnover/profit/qty]`
- Compare store/format/planogram. `[сделано: LFL breakdown в /analytics
  сравнивает turnover по store, format и active assignment planogram]`
- Metrics: turnover, profit, sales qty, turnover per meter, profit per meter, stock days, turnover ratio.
  `[сделано: /analytics показывает current LFL turnover/profit/qty,
  turnover per meter, profit per meter, avg stock days и turnover ratio]`
- Space productivity: share in shelf vs share in sales/profit. `[сделано:
  /analytics показывает SKU imbalance table: shelf share vs sales/profit share]`
- Shelf share by brand/category/supplier. `[сделано: /analytics показывает
  shelf share breakdown по brand/category/supplier]`
- Test coverage and deterministic period math. `[сделано: apps/web Vitest
  покрывает LFL periods/breakdown, per-meter metrics, space productivity и
  shelf share; периодные даты считаются по UTC-day arithmetic без timezone drift]`

## Phase 9 - 3D viewer

Цель: визуальная проверка.

Задачи:

- 3D view from 2D planogram data. `[сделано: Three.js viewer строит
  оборудование, полки и product blocks из текущих mm placement данных;
  scene geometry вынесена в тестируемую модель]`
- Shelf/equipment perspective. `[сделано: orbit camera показывает глубину,
  полки, стойки и размещение по x/y/z; стартовая сцена центрирует
  оборудование и ставит product blocks на видимую сторону полки]`
- Screenshot export. `[сделано: PNG export из WebGL canvas]`
- Store/floor plan viewer later. `[сделано: /floor-plans read-only viewer
  показывает published floor plans, equipment placement и linked planograms]`
- Responsive visual shell. `[сделано: app shell не держит desktop sidebar на
  mobile viewport; навигация становится горизонтальной, user email truncates]`
- Test coverage for 3D scene geometry. `[сделано: apps/web Vitest покрывает
  mm conversion, camera/floor/posts/shelves/products geometry и пропуск
  placements с неизвестной shelf]`

Не делать:

- Не превращать 3D в основной редактор на старте.

## Phase 10 - AI / computer vision

Цель: автоматическая проверка фото против планограммы.

Задачи:

- Golden reference photo. `[сделано: Prisma GoldenReference/Slot слой +
  API/UI для создания эталонного фото из PhotoSubmission по planogram version]`
- Reference slots. `[сделано: API create/delete + UI overlay-разметка зон
  эталонного фото в процентах изображения, привязка к placement/product]`
- Photo quality check. `[сделано: core photo-proof quality scorer по
  MIME/размерам/takenAt/EXIF, сохранение qualityScore + details при mobile upload]`
- Detector/embedding service. `[сделано: packages/api-contracts vision/v1 +
  optional services/vision HTTP boundary с stub provider, /health и /v1/scan;
  покрыто services/vision Vitest: health, invalid scan, schema-valid scan,
  no-reference-slots failure]`
- Compliance score. `[сделано: core scorer slots vs detections + compliance
  summary в vision/v1 scan response]`
- Missing/wrong/extra products. `[сделано: core compliance findings +
  missing/wrong/extra arrays в vision/v1 scan response; stub provider test
  фиксирует low-confidence detection + missing-slot finding]`
- Human review queue. `[сделано: Prisma HumanReview + /reviews queue,
  approve/reject API, auto-enqueue poor/review photo quality uploads]`
- Model/data quality dashboard. `[сделано: KPI cards в /reviews по
  pending/approved/rejected, avg score и reason breakdown]`

Рекомендация:

- Начать с golden reference + human review.
- Не начинать с обучения собственного детектора на 50 SKU до проверки бизнес-ценности.

## Phase 11 - Field force: маршруты, визиты, live map

Добавлено по docs/08 (полный порт MTM). Стартует ПОСЛЕ Phase 6 (мобильное
фото-подтверждение стабильно), может идти параллельно Phase 7. Порт
поведения из MTM `routes`, `visits`, `map`, `visit-anomaly/*`,
`territory-scope.ts`.

Задачи:

- Teams/FieldAgent поверх User. `[сделано: FieldAgent tenant scope +
  /field-force agents dashboard + API добавления агента из User]`
- Routes + RouteStop, привязка к магазинам. `[сделано: API создания route
  с ordered RouteStop по storeIds + /field-force routes table/form]`
- Visits: check-in/out c geofence, anomaly-флаги (порт visit-anomaly).
  `[сделано: core geofence helper + check-in/check-out API + recent visits
  anomaly table в /field-force]`
- AgentLocation + live map в web. `[сделано: location ingest API +
  /field-force live map panel по последней AgentLocation каждого агента]`
- Territory scoping (порт в packages/core). `[сделано: pure core
  territory-scope helper + tests для all-store/store/region доступа]`
- Мобильный флоу визита: маршрут дня -> точка -> чек-ин -> задачи точки.
  `[сделано: mobile sync routes/visits + visit/location outbox ops +
  mobile routes screen со stop/task view и queued check-in; DB integration
  coverage добавлено для pull route, replay-safe check-in/location и checkout]`

Definition of Done:

- Агент проходит маршрут в мобильном, офис видит визиты и аномалии на карте.

## Phase 12 - Заказы, промо, кредитные лимиты

Порт чистых алгоритмов MTM (`promotion-engine`, `credit-limit`,
`invoice-generator`, `price-ocr`) с тестами ДО UI — финансово-смежная логика.
Только после стабильных Phase 1-6.

Задачи:

- Order/OrderLine из визита или напрямую.
  `[сделано: Prisma totals/idempotency поля + orders/v1 contract +
  createOrder repo + POST /api/v1/orders с visit/direct support]`
- Promotion engine (скидки/бонусы/бандлы) с тестами на портированных кейсах.
  `[сделано: pure core engine, порядок bulk -> bundle -> percent -> bogo ->
  gift, money-in-cents, тесты на stack/bundle/category/date]`
- Credit limit проверка при создании заказа.
  `[сделано: pure core check с APPROVED/EXCEEDED/BLOCKED, explicit overLimit
  payload для mobile/API; DB test изолированно фиксирует, что rejected order
  не увеличивает usedAmount]`
- Invoice generation.
  `[сделано: pure core invoice document + HTML template для PDF job,
  totals/discount/tax в cents, deterministic invoice number, HTML escaping]`
- Offline-заказ через outbox (идемпотентность deviceId+clientOpId).
  `[сделано: mobile order.create push op + local enqueueOrderCreate +
  server applyOrderCreate через outbox и unique Order(clientDeviceId,clientOpId)]`

## Phase 13 - Алерты и активность

- Продуктовая событийная система (не порт MtmAlert как есть).
  `[сделано: ProductEvent append-only source + Alert projection +
  NotificationDelivery push outbox, idempotent dedupeKey; P2002 race-safe
  повтор воркера возвращает existing event]`
- Типы: task.overdue, visit.anomaly, stock.gap, import.errors.
  `[сделано: emitters для task.overdue (auto-expire), visit.anomaly
  (geofence), import.errors (worker imports), stock.gap detector]`
- Push через MobileDevice.pushToken.
  `[сделано: office-role devices OWNER/ADMIN/SUPERVISOR with pushToken
  get PENDING NotificationDelivery rows]`
- Утренний дайджест офису (Tier 3 UX из docs/10).
  `[сделано: buildOfficeMorningDigest + enqueueOfficeMorningDigest]`

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
