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
- Barcode support. `[сделано: ProductBarcode model + unique tenant barcode,
  import/API create/edit/search, mobile bundle и barcode/SKU finder используют barcode]`
- Product images: admin-загрузка + заглушка (название/бренд/цвет) для SKU
  без фото. `[сделано: MinIO/S3 storage, media-proxy с tenant-guard,
  клик-загрузка в таблице каталога, цветная заглушка, фильтр «без фото»]`
- Stock/price/sales snapshots. `[сделано: Price/Stock/SalesSnapshot models,
  CSV/XLSX import executors, natural-key idempotency и analytics consumers]`
- Assortment matrix (формат) + store assortment (исключения).
  `[сделано: AssortmentMatrix/StoreAssortment models + import executor,
  analytics assortment gaps/obsolete и stock.gap detector используют слой]`
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

- Equipment template library. `[сделано: EquipmentTemplate/Version repo, API,
  library page и detail editor]`
- Equipment dimensions. `[сделано: width/height/depth geometry в versioned
  EquipmentVersion, API/UI validation и preview]`
- Shelves/rows. `[сделано: EquipmentShelf model, shelf fill tool, validation и preview]`
- Cells/containers. `[сделано: EquipmentCell сохраняется в version,
  UI генерирует grid cells и preview показывает ячейки]`
- Hooks/perforated rack support. `[сделано: EquipmentHook сохраняется в
  version, UI генерирует hook row и preview показывает крючки]`
- Pallet/table/freezer/fridge basic types. `[сделано: EquipmentType seed/reference
  и type selector в equipment library]`
- Shelf fill tool: count, shelf thickness, depth, row gap, top/bottom offsets.
  `[сделано: UI генерирует shelves через core layout/validation]`
- Seating places/facings settings. `[сделано: shelf/cell/hook geometry fields
  сохранены в version, facings управляются на уровне planogram placement]`
- Auto seating toggle. `[сделано как rule-driven autofill в Phase 5, не как
  отдельный глобальный toggle оборудования]`
- Auto compression toggle. `[сделано на уровне Phase 5 autofill soft-pack
  rule/compressionX, не как отдельный toggle оборудования]`
- Save to library. `[сделано: createTemplateWithVersion/saveVersion API + UI save]`
- Copy template. `[сделано: API copy latest geometry/shelves/cells/hooks +
  кнопка copy в форме шаблона]`
- Preview in 2D. `[сделано: EquipmentPreviewSvg показывает shelves/cells/hooks]`

Definition of Done:

- Пользователь может создать стеллаж 120x180x30 с 5 полками и сохранить в библиотеку.

## Phase 3 - Floor plan constructor

Цель: цифровой торговый зал.

Задачи:

- Stores list. `[сделано: Store model, seed/demo stores, floor-plan/mobile
  consumers и /stores page со списком точек/форматов, counts по планам,
  assignments, tasks, routes/visits]`
- Formats list. `[сделано: StoreFormat model, seed/demo format и floor-plan
  target selector]`
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

- Open equipment as planogram canvas. `[сделано: planogram page открывает
  linked EquipmentVersion с shelves и SVG canvas]`
- Product search/filter from catalog. `[сделано: product picker/filter lists
  active catalog SKU/category/brand/supplier refs]`
- Drag product to shelf. `[сделано: SVG pointer drag с ghost-позицией,
  snap 10мм и сохранением через PATCH placement + серверная физика]`
- Product placement with dimensions. `[сделано: placement сохраняет snapshot
  width/height/depth и серверная физика валидирует placement]`
- Facings X/Y/Z. `[сделано: API/UI PATCH facingsX/facingsY/facingsZ +
  core capacity/collision tests]`
- Depth count. `[сделано: facingsZ x depth валидируется против shelf.depthMm]`
- Rotation. `[сделано: placement API/UI принимает rotationX/Y/Z с шагом 90°,
  core считает effective bounding box, publish/mobile/analytics используют
  rotation-aware occupied width]`
- Stack one-on-one. `[сделано: placement API/UI сохраняет StackMode
  NONE/ON_TOP/LYING; вертикальная стопка валидируется физикой через facingsY
  и просвет полки]`
- Shelf capacity validation. `[сделано: core validatePlacementOnShelf +
  repo rejection details и UI shelf capacity panel]`
- Manual override. `[сделано: selected placement panel позволяет вручную
  менять shelf/x/facings через PATCH с revision guard]`
- Product details panel: name, SKU, barcode, dimensions, current price, stock.
  `[сделано: selected placement panel показывает name/SKU/primary barcode/
  brand/dimensions/units/current price/stock qty/stock days и live metrics]`
- Zone creation on equipment. `[сделано: DRAFT-only zone API с
  revision-lock/bounds-check + SVG overlay и панель создания/удаления зон]`
- Save draft. `[сделано: DRAFT versions редактируются in-place с revision lock,
  published versions read-only и next-draft clone]`
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
planogram view (включая compressionX из published bundle для soft-pack
выкладки), offline status/photo/comment outbox, ручной sync retry,
shared mobile contracts, Android export smoke. Автопросрочка EXPIRED и
SLA-счетчики сделаны. Product detail tap сделан: кликабельная SVG-планограмма,
карточка товара и список товаров из published bundle. Changed items list
сделан в mobile: показывает diff payload, если он есть, иначе текущие позиции
как проверочный список. Barcode/SKU finder, camera scanner binding,
floor-plan location hint и camera overlay сделаны. Остатки Phase 6 mobile
на этом срезе закрыты.

Задачи web:

- Publish planogram to store/format. `[сделано: publish dialog/API для FORMAT/STORES,
  overlap reject и active assignment]`
- Create execution task. `[сделано: publish создает задачи по store target]`
- Task statuses: New, In Progress, Photo Submit, Completed, Expired, Empty.
  `[сделано: FSM transitionTaskStatus + web/mobile status actions]`
- Task assignee. `[сделано: web assignee-select + mobile pull только assignee tasks]`
- Due date/SLA. `[сделано: dueAt при publish, auto-expire open tasks,
  analytics SLA counters]`
- Compare published version vs current draft. `[сделано: next-draft clone,
  diff/current changed-items payload и mobile changed-items list]`

Задачи mobile:

- Login. `[сделано: mobile employeeCode/PIN auth + refresh/device binding]`
- Store selection. `[сделано через assigned task/store context и routes stop view;
  отдельный свободный store picker не требуется для MVP execution]`
- Task list. `[сделано: mobile task list from local SQLite pull]`
- Planogram view. `[сделано: mobile SVG planogram view from immutable published bundle]`
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
- Фото-pipeline ADR: presigned upload, EXIF-like capture metadata сохраняется
  (форензика, GPS/task/store/user/capture-step), thumbnails в worker,
  retention/стоимость.
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
  assignment, активные версии, SKU, compressionX-aware linear meters, turnover
  и profit строго по активным назначениям]`
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
  turnover per meter, profit per meter, avg stock days и turnover ratio по
  активным assignment versions]`
- Space productivity: share in shelf vs share in sales/profit. `[сделано:
  /analytics показывает SKU imbalance table: shelf share vs sales/profit share
  по активным assignment versions]`
- Shelf share by brand/category/supplier. `[сделано: /analytics показывает
  shelf share breakdown по brand/category/supplier по активным assignment
  versions]`
- Test coverage and deterministic period math. `[сделано: apps/web Vitest
  покрывает LFL periods/breakdown, per-meter metrics, space productivity и
  shelf share; периодные даты считаются по UTC-day arithmetic без timezone drift]`

## Phase 9 - 3D viewer

Цель: визуальная проверка.

Задачи:

- 3D view from 2D planogram data. `[сделано: Three.js viewer строит
  оборудование, полки и product blocks из текущих mm placement данных,
  включая compressionX для soft-pack; scene geometry вынесена в тестируемую
  модель]`
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
  фиксирует low-confidence detection + missing-slot finding; core regression
  не засчитывает unidentified detection как совпадение ожидаемого SKU]`
- Human review queue. `[сделано: Prisma HumanReview + /reviews queue,
  approve/reject API, auto-enqueue poor/review photo quality uploads]`
- Model/data quality dashboard. `[сделано: KPI cards в /reviews по
  pending/approved/rejected, avg score и reason breakdown]`

Рекомендация:

- Начать с golden reference + human review.
- Не начинать с обучения собственного детектора на 50 SKU до проверки бизнес-ценности.

### Phase 10.5 - Guided Shelf Proof

Цель: превратить фото/видео-подтверждение в обязательный сценарий съемки,
как в приложениях аренды самоката/велосипеда: сотрудник проходит шаги
front/left-depth/right-depth/detail, а система принимает только доказательные
media с capture metadata.

План: `docs/23-guided-shelf-proof-plan.md`.

Задачи первого среза:

- Убрать watermarks как обязательную proof-семантику; доказательство строить
  на user/task/store/GPS/time/device/capture-step metadata.
- Добавить mobile capture scenario: front, left depth, right depth, detail.
- Хранить `captureScenario` и `captureStep` в EXIF-like JSON каждого proof.
- Показать progress по обязательным шагам в mobile task detail.
- Backend validator должен принимать proof metadata без watermark marker и
  возвращать review только по реальным нарушениям identity/GPS/timestamp.
- Подготовить модель под видео: оригинал хранить, AI анализировать через
  extracted frames, но нативную запись видео не делать первым блокером.

Статус 2026-07-06:

- `[сделано]` Mobile wizard хранит шаги proof scenario в локальной очереди;
  обязательные front/left/right depth шаги пишутся как короткие video media,
  optional detail остается photo.
- `[сделано]` Upload/API/DB поддерживают `mediaType`, `durationMs`,
  `captureStepJson`, capture step fields в `PhotoSubmission` и sync обратно
  на мобильное приложение.
- `[сделано]` Storage guard расширен на `videos/{org}/`; web reviews/tasks
  показывают video proof через `<video controls>`.
- `[сделано]` Добавлен frame timestamp planner для selected-frame AI анализа.
- `[сделано]` Добавлен `ProofAnalysisStatus` и `worker-proof-analysis`:
  video submissions попадают в очередь, worker скачивает оригинал из S3,
  извлекает JPEG frames через ffmpeg, сохраняет `frames/{org}/...` и
  обновляет `HumanReview` selected-frame findings.
- `[сделано/требует env]` OpenAI/GPT provider boundary добавлен для selected
  frames (`VISION_PROVIDER=openai`, `OPENAI_API_KEY`, optional
  `OPENAI_VISION_MODEL`). Без ключа worker честно пишет stub/manual-review
  результат и не выдает его за GPT inference.
- `[сделано]` `/reviews` показывает analysis status, worker status,
  selected frames и AI findings для video proof.
- `[не проверено устройством]` Native camera video flow требует проверки на
  физическом iOS/Android или dev-client build.
- `[не проверено на production secret]` Реальный OpenAI вызов не может быть
  подтвержден без production `OPENAI_API_KEY`/provider env.

Definition of Done:

- Мобильный сотрудник не снимает proof "как хочет", а идет по шагам сценария.
- Каждая proof media связана с конкретным шагом сценария.
- Если глубина не снята, система честно видит незакрытый depth step.
- Водяной знак не требуется для принятия proof.

### Phase 10.6 - Guided Capture assistant

Цель: гид в видоискателе ведет мерчендайзера внутри каждого шага съемки
(силуэт оборудования из мм-модели, наклон, свет, автозатвор), а сервер
выпрямляет кадр и калибрует его в миллиметрах для наложения зон
планограммы. Обязательные шаги переводятся на photo-first (burst-серия),
видео становится опциональным аудит-артефактом.

План: `docs/24-guided-capture-plan.md`. Сквозной сценарий продукта и
режимы depth-проверки по типам клиентов: `docs/25-product-scenario.md`.

Задачи первого среза (уровень 1, без нативных модулей):

- `CaptureTemplate`: шаги съемки задаются типом оборудования/задачей.
  `[сделано: Prisma model + seed rack/fridge/default, резолв в sync pull,
  снапшот на task row, контрактная валидация на границе API, мобильный
  fallback на встроенный сценарий]`
- Wizard: силуэт из geometry, гироскоп-уровень, вибрация, burst-фото с
  локальным отбором лучшего кадра, немедленный совет пересъемки.
  `[сделано: силуэт с аспектом и полками из planogram bundle, expo-sensors
  Accelerometer + Vibration, burst 3 кадра с выбором по размеру файла и
  EXIF-эвристиками; совет не блокирует — accepted_with_warnings]`
- Люк `equipment_mismatch` (полевая ревизия оборудования) и
  `manual_exception` с причиной. `[сделано: captureFlags на
  PhotoSubmission + forced review + событие capture.equipment_mismatch;
  push op proof.exception + CaptureStepException + событие
  capture.step_exception; офис видит бейджи и панель исключений]`
- Photo-first для обязательных шагов; видео -> optional/lazy по WiFi.
  `[сделано: встроенный сценарий переведен на burst-фото; видео осталось
  поддержанным для шаблонных шагов; lazy-upload видео не делался — видео
  больше не в обязательном пути]`
- Базовая телеметрия гида (время до принятого кадра, пересъемки).
  `[сделано: captureTelemetry JSON на PhotoSubmission]`

Статус 2026-07-07: срез 1 реализован и покрыт тестами (см. docs/24
Implementation status). Не проверено на физическом устройстве — device
smoke остается блокером перед пилотом.

## Phase 11 - Field force: маршруты, визиты, live map

Добавлено по docs/08 (полный порт MTM). Стартует ПОСЛЕ Phase 6 (мобильное
фото-подтверждение стабильно), может идти параллельно Phase 7. Порт
поведения из MTM `routes`, `visits`, `map`, `visit-anomaly/*`,
`territory-scope.ts`.

Текущая карта честного переноса Mars/LeadDrive MTM -> LeadShelf:
`docs/22-mars-mtm-port-map.md`.

Задачи:

- Teams/FieldAgent поверх User. `[сделано: FieldAgent tenant scope +
  /field-force agents dashboard + API добавления агента из User; добавлен
  UI create/edit agent для User -> FieldAgent, team и phone]`
- Routes + RouteStop, привязка к магазинам. `[сделано: API создания route
  с ordered RouteStop по storeIds + /field-force routes table/form; добавлен
  PATCH/DELETE route, UI create/edit/cancel, выбор агента, дата, ordered
  store picker с reorder/remove]`
- Visits: check-in/out c geofence, anomaly-флаги (порт visit-anomaly).
  `[сделано: core geofence helper + check-in/check-out API + recent visits
  anomaly table в /field-force; web/mobile check-in не создает дубль для
  уже активного visit по тому же agent/store/routeStop]`
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
  не увеличивает usedAmount; createOrder резервирует usedAmount через atomic
  conditional increment и DB regression фиксирует конкурентные заказы]`
- Invoice generation.
  `[сделано: pure core invoice document + HTML template для PDF job,
  totals/discount/tax в cents, deterministic invoice number, HTML escaping,
  org-scoped invoiceNumber unique index + repo retry на concurrent collision]`
- Offline-заказ через outbox (идемпотентность deviceId+clientOpId).
  `[сделано: mobile order.create push op + local enqueueOrderCreate +
  server applyOrderCreate через outbox и unique Order(clientDeviceId,clientOpId);
  repo ловит concurrent unique replay и возвращает существующий order]`

## Phase 13 - Алерты и активность

- Продуктовая событийная система (не порт MtmAlert как есть).
  `[сделано: ProductEvent append-only source + Alert projection +
  NotificationDelivery push outbox, idempotent dedupeKey; P2002 race-safe
  повтор воркера возвращает existing event; emitProductEvent отклоняет
  cross-tenant storeId без записи event/alert артефактов]`
- Типы: task.overdue, visit.anomaly, stock.gap, import.errors.
  `[сделано: emitters для task.overdue (auto-expire), visit.anomaly
  (geofence), import.errors (worker imports), stock.gap detector]`
- Push через MobileDevice.pushToken.
  `[сделано: office-role devices OWNER/ADMIN/SUPERVISOR with pushToken
  get PENDING NotificationDelivery rows only for active users; repo-level claim
  переводит PENDING -> SENDING и markSent/markFailed закрывают delivery
  lifecycle без дублей; worker notifications runner отправляет через Expo
  sender abstraction и помечает SENT/FAILED]`
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

## Demo / product-readiness слой

После закрытия Phase 1-13 отдельный рабочий слой — доведение live UI и
demo-story до уверенного показа. Он зафиксирован в
`docs/20-demo-product-readiness-plan.md` и включает dashboard, demo-data
cleanup, floor-plan demo, photo-proof demo, table/responsive polish,
planogram/3D consistency, task/store detail, analytics demo data и
field-force/mobile walkthrough.

Активный слой согласованности полевого приложения и офисного интерфейса
зафиксирован в `docs/29-mobile-web-execution-coherence-roadmap.md`.
Первый срез закрыт 2026-07-10: единая семантика открытых задач и read-only
web-раздел синхронизированных заказов без изменения mobile sync/API-
контрактов. Native preview baseline выполнен частично: зависимости
выровнены, свежая EAS preview/dev-client APK ещё нужна для device smoke.

## Production-readiness roadmap — полноценная рабочая версия

Добавлено 2026-07-18 после повторного аудита. Наличие функции само по себе не
означает production-ready. `[сделано]` ставится только при наличии теста,
релизного артефакта или зафиксированного полевого прогона; иначе статус —
`[реализовано, не проверено]`.

### Phase 14 — P0: сохранность данных и управляемый релиз

- [ ] Разделить demo и client production: `seed-demo` не запускается в
  клиентском deploy-профиле, demo tenant не является зависимостью приложения.
  `[реализовано/проверено статически 2026-07-18: DEPLOY_MODE=client по умолчанию,
  seed только при явном demo. BLOCKED — production deploy access/release owner]`
- [ ] Ночной backup PostgreSQL и external S3 во внешнее хранилище: шифрование,
  ротация минимум 14 дней и алерт на пропуск.
  `[реализовано/локально проверено 2026-07-18: pg_dump + media mirror + encrypted
  restic retention. BLOCKED — external repository credentials, production
  scheduler/alert endpoint и infrastructure owner]`
- [ ] Автоматическая проверка backup и ежемесячный restore drill в изоляции;
  зафиксировать RPO/RTO.
  `[реализовано/локально проверено 2026-07-18: backup -> 100% restic check ->
  restore PostgreSQL (23 migrations) + media checksum/bytes. BLOCKED —
  production backup repository и monthly drill owner/window]`
- [ ] Разделить liveness процесса и readiness PostgreSQL/критических сервисов.
  `[реализовано/проверено тестами 2026-07-18: /api/ready fail-closed для DB+S3,
  Compose healthchecks web/workers/vision и readiness DB+external S3. BLOCKED —
  production rollout/storage access. Read-only smoke 2026-07-18 22:56 UTC:
  текущий https://hermescrm.xyz/api/health=200, но /api/ready=404 и
  /api/metrics=404; direct endpoint /api/ready также 404. Это доказывает, что
  hardening build ещё не развёрнут и production readiness сейчас FAIL]`
- [ ] Runbook: pre-migration backup, deploy, migrate, smoke, rollback/forward-fix
  схемы и disaster recovery.
  `[реализовано/локально проверено 2026-07-18: operations runbook,
  production-safe migrate deploy, rollback/forward-fix и DR; production
  release/rollback BLOCKED — release access/window/owner]`
- [ ] Проверять миграции на обезличенной production-подобной БД.
  `[реализовано/локально проверено 2026-07-18: изолированный PostgreSQL 16,
  restore local demo копии и migrate deploy, 23 migrations; свежий обезличенный
  production dump клиента BLOCKED — client data owner/access]`
- [ ] Post-deploy smoke: web, auth, import, publish, mobile sync, media и workers.
  `[частично реализовано/проверено local 2026-07-18: health/readiness и mobile
  login/pull/logout прошли; opt-in task.comment создал ровно 1 row и cleanup
  оставил 0 artifacts. BLOCKED — deployed production environment/access для
  import/publish/media/workers smoke]`

Definition of Done: БД и медиа восстановлены в чистом окружении; отказ
зависимостей вызывает алерт; неудачный релиз откатывается без потери данных.

### Phase 15 — P0/P1: мобильный field-ready релиз

- [ ] Подписанные preview/production APK/AAB и IPA; build/runtime/protocol
  compatibility, internal distribution, обязательное обновление и rollback.
  `[BLOCKED — external signing/distribution access и release owner: кодовый
  protocol/426 guard покрыт, но подписанные artifacts ещё не выпущены]`
- [ ] Device matrix: iOS, актуальный Android и low-end Android.
  `[BLOCKED — physical devices и signed build]`
- [ ] Сквозной smoke: login/refresh -> route -> check-in -> planogram -> barcode
  -> guided photo/burst/video -> comment -> checkout -> review/retake.
  `[BLOCKED — physical devices, signed build и client-like environment;
  DB-level core workflow отдельно проверен и не подменяет этот smoke]`
- [ ] Offline matrix: потеря сети на каждом шаге, kill/restart между
  save/enqueue/upload/push, повтор без дублей.
  `[BLOCKED — physical device process lifecycle и signed build; pure sync
  retry/idempotency paths покрыты unit/integration, но kill/restart не заявлен]`
- [ ] Camera-ready, частичный отказ burst, EXIF/orientation, отзыв permissions,
  media limits и очистка временных файлов.
  `[реализовано/проверено unit+typecheck 2026-07-18: camera-ready gate,
  mount error, burst partial failure/fallback, temp cleanup и server media
  limits. BLOCKED — EXIF/orientation/permission revoke требуют device matrix]`

- [ ] Лимит очереди/диска; quarantine/conflict/rejected с понятным recovery.
  `[реализовано/проверено тестами 2026-07-18: 100 media/512 MiB fail-closed,
  RU/AZ recovery, quarantine/retry counters, удаление media только после
  upload+applied+server pull. BLOCKED — physical device disk-full smoke]`
- [ ] Контракт-тесты old app <-> new server и new app <-> old server.
  `[частично проверено: server protocol mismatch=426 и mobile
  upgradeRequired покрыты unit-тестами; реальные пары release artifacts
  BLOCKED — signed old/new release artifacts и distribution access]`
- [ ] Профиль батареи, памяти и SQLite за полевую смену.
  `[частично реализовано/проверено mobile tests 2026-07-18: профиль показывает
  allocated SQLite bytes и files/bytes offline media; media warning срабатывает
  на 80% существующего hard limit 100 files/512 MiB, расчёт PRAGMA pages и
  уровни покрыты unit. BLOCKED — battery/RSS/SQLite growth за реальную смену
  требуют signed build, low-end/Android/iOS devices и 8h field run]`

Definition of Done: двухнедельный прогон не теряет данные; после offline/kill
операции сходятся автоматически и без дублей.

### Phase 16 — P1: security и privacy hardening

- [ ] Rate limiting login/PIN, sync, uploads, imports и AI; lockout/backoff и
  аудит неуспешной аутентификации.
  `[частично реализовано/проверено unit+PostgreSQL integration 2026-07-18:
  web/mobile login, sync, upload и import используют общий durable fixed-window
  limiter с atomic upsert, hashed keys и Retry-After; 12 concurrent consumers
  доказали 5 allow/7 deny. Общий limiter вынесен в db package; внешний
  OpenAI/Gemini proof worker использует durable per-tenant budget (default
  100/час, bounded env), а over-limit до чтения media/AI call сохраняет
  human-review fallback; PostgreSQL test доказал 1 allow/1 deny при max=1.
  Account-wide lockout частично реализован/проверен 2026-07-19: отдельная
  durable PostgreSQL state machine использует только HMAC-SHA-256 principal key
  с runtime pepper без IP/email/employeeCode, atomic threshold/window/duration,
  не продлевает lock новыми атаками, возвращает generic invalid_credentials с
  одинаковым коротким backoff без раскрытия точного duration, пишет allowlisted
  audit, сбрасывает failures только после успешной проверки и автоматически
  открывает аккаунт по окончании duration. 12 concurrent failures точно
  остановились на threshold=5; PostgreSQL integration 2/2 и route/policy/
  readiness 10/10 PASS. Web login и его limiter/lockout теперь обязательно
  tenant-qualified через `organizationSlug + email`; одинаковый email в двух
  tenants не разделяет authentication state. Migration 32 добавляет
  case-insensitive unique indexes для organization slug, tenant email и
  employee code с PII-safe collision preflight. Controlled manual unlock
  реализован disabled-by-default: principal принимается только из bounded
  mode-0600/O_NOFOLLOW файла, preview выдаёт digest+exact confirmation, execute
  требует два независимых approval ID, ticket/reason, serializable advisory+
  row lock, zero-residue verification и минимальный tenant audit без principal.
  Все четыре `AUTH_LOCKOUT_*`, включая secret-manager pepper, задаются только
  вместе без developer defaults; `/api/ready` fail-closed, если approved policy
  отсутствует. Проверка: clean 33-migration PostgreSQL, DB profile 6/6, web auth
  10/10, full suite 610/610 и tenant-qualified browser smoke 15/15 PASS.
  `[BLOCKED — business/production evidence]`: нужны утверждённые threshold,
  window, duration, named support/security owners и approval policy, audit
  production collision preflight/rollout и реальный controlled unlock drill]`
- [x] Негативные RBAC/cross-tenant тесты всех API, jobs, exports и media.
  `[реализовано/проверено 2026-07-18 на текущем surface: fail-closed inventory всех 63
  v1 route files + mutation/RBAC/workerDb/media fences; динамическая PostgreSQL
  матрица вызывает 33 read/write/delete операции во всех 29 текущих
  ID-bearing route-файлах от tenant A к существующим объектам tenant B,
  получает только 403/404 и сверяет отсутствие мутаций/fixtures. Worker
  PostgreSQL matrix дополнительно подменяет import job -> foreign batch,
  notification -> foreign device и proof -> foreign user/store: все три
  quarantine/fail-closed без изменения batch, sender/storage call или review;
  scheduled overdue/stock-gap/digest игнорируют foreign rows. Полная
  динамическая RBAC-матрица вызывает все 40 office mutation handlers с
  запрещённой их policy ролью и получает точный 403 до payload parsing.
  Независимый pentest deployed environment остаётся внешним GA evidence]`
- [ ] Upload guard: size, MIME, magic bytes, path safety, quarantine и HEIC/video.
  `[реализовано/проверено тестами 2026-07-18: size+MIME+magic bytes для
  JPEG/PNG/WebP/MP4/MOV/WebM, tenant-owned S3 key; HEIC отклоняется 415 и
  mobile quarantines файл. BLOCKED — HEIC native/server codec choice, rebuild
  и real-device fixtures; конвертация не реализована]`
- [ ] Ротация JWT/S3/vision/deploy secrets; секреты не попадают в client bundle,
  логи, backup и CI artifacts.
  `[runbook реализован 2026-07-18: inventory, least-privilege storage,
  staged rotation и smoke/revoke для JWT/DB/S3/vision/deploy/backup/metrics;
  demo seeder 2026-07-19 больше не печатает пароль, PIN, email/display names
  или raw error в stdout/stderr: только allowlisted structured readiness/error
  metadata, credential-leak regression 2/2 PASS. Sentry boundary для
  web/workers/mobile больше не сериализует raw error message, stack или
  произвольный context: наружу уходят только тип ошибки, факт stack и
  allowlisted bounded operational metadata; PII/secret regression PASS;
  BLOCKED — production secret-manager access/owners и фактическая ротация]`
- [ ] Security headers, CORS/CSRF policy, dependency/container scanning.
  `[реализовано/локально проверено 2026-07-18: CSP/anti-frame/nosniff,
  origin guard, production audit=0; CI actions pinned SHA, TruffleHog tracked-source
  scan=0, Grype web/worker/custom Caddy/custom PostgreSQL High/Critical=0.
  Archived MinIO удалён из production. Интегрированная code baseline ветки
  `codex/production-readiness` на exact SHA
  `a257fa3f1e91150d3c9d60055855bafdc5dcbb2b` прошла remote checks run
  `29669623000`;
  draft PR #19 CLEAN, remote `ci` SUCCESS, TruffleHog и High/Critical scans
  web/worker/Caddy/PostgreSQL SUCCESS, deploy SKIPPED; три пользовательских
  удаления video исключены. BLOCKED — rollout/deployed-environment evidence.
  Read-only production
  login headers 2026-07-18 не содержат CSP/HSTS/frame/nosniff и всё ещё имеют
  `x-powered-by: Next.js`; это старый runtime, а не опровержение локального
  config test, и отдельная причина сохранять NO-GO до rollout]`
- [ ] Шифрование mobile-данных/медиа at rest и очистка при logout/revocation.
  `[частично реализовано/проверено mobile 175/175 + typecheck и Expo native
  config introspection 2026-07-19: SQLite переведена на SQLCipher 4 через
  expo-sqlite native plugin для Android/iOS; 256-bit ключ создаётся через
  CSPRNG и хранится device-only в SecureStore. При существующей encrypted DB
  без ключа приложение fail-closed и не создаёт новый ключ/не стирает данные.
  Однонаправленная миграция legacy plaintext DB сверяет schema + row inventory,
  marker и cipher_integrity_check до удаления plaintext; безопасный RU/AZ экран
  запрещает пользователю очищать данные при возможной несинхронизированной
  работе. Все durable offline photo/video, commercial/visit media и
  upload/download documents шифруются AES-256-GCM отдельным device-only
  SecureStore ключом. Versioned marker, atomic encrypted replacement с
  decrypt/verify, startup migration+integrity scan и plaintext-source deletion
  не позволяют принять частично записанный ciphertext; marker без ключа или
  повреждённый файл останавливают startup. Расшифрованный файл создаётся только
  во временном cache на время preview/open/upload и удаляется в `finally` и при
  следующем startup; Android backup отключён. Logout предупреждает о pending
  работе и очищает все media+operational SQLite до
  очистки session; remote 401/refresh revocation переводит sync в terminal
  authLost без retry, single-flight очищает media/SQLite/SecureStore и выходит
  на login, при частичном storage failure всё равно пытается очистить остальные
  backends. BLOCKED — signed native build/DB+plaintext-media migration и
  physical Android/iOS upload/preview/revocation smoke, low-end memory profile
  для whole-file AES-GCM; iOS bundle identifier/signing и key-loss
  recovery/approved wipe должны быть утверждены владельцами. Expo Go не
  является evidence SQLCipher или native AES-GCM]`

- [ ] Retention/deletion фото, GPS и audit data; consent/legal basis.
  `[частично реализовано/проверено PostgreSQL integration 2026-07-18: policy
  template, controlled tenant delete и новый guarded retention CLI: explicit
  UTC as-of + media/GPS/audit days без developer defaults, dry-run row/media
  inventory originals/thumbnails/video frames, SHA-256 manifest drift guard,
  fail-closed GoldenReference protection, exact confirmation, два разных
  approvals, backup/media receipts, legal-hold clearance, tenant advisory lock
  и serializable transaction. Просроченные DB media/AgentLocation/audit
  удаляются; Visit coordinates и GPS в EXIF/geofence/visit-alert JSON
  редактируются рекурсивно; новый минимальный audit event фиксирует
  policy/counts/digest и external evidence IDs. Изолированная схема: 30/30
  migrations, DB suite
  83/83 PASS; target expired data удалены, recent и neighbor сохранены,
  fixtures residue=0. Добавлен controlled DSAR inventory/export: exact
  org+slug+subject, manifest drift guard, dual approval/legal-basis receipt,
  exclusive 0600 artifact, AES-256-GCM и audit event; preview/result не
  раскрывают subject/request/PII, credential hashes/JTI/push tokens исключены,
  neighbor tenant regression PASS. BLOCKED — сроки/legal basis, scheduler и фактическое
  удаление external S3/backups требуют client privacy/legal/business и
  infrastructure owners; approved delivery/decrypt/delete DSAR drill требует
  privacy/security owners]`
- [ ] Face blur до персистентности либо согласованный режим без покупателей.
  `[не реализовано: runbook требует организационно исключать покупателей до
  появления проверенного pre-persistence blur либо письменного legal режима;
  AI flag сам по себе этот privacy-риск не закрывает. BLOCKED — privacy/legal
  решение о режиме либо утверждённый CV provider/dataset для pre-store blur]`

Definition of Done: нет открытых critical/high; доказано, что tenant A не
читает и не изменяет данные или медиа tenant B.

### Phase 17 — P1: observability и эксплуатация

- [ ] Error/crash reporting для web, workers и native mobile.
  `[реализовано в коде/проверено 2026-07-19: Sentry-compatible handlers gated
  by DSN. External telemetry boundary fail-closed: raw exception message,
  stack, arbitrary/nested context, email/PIN/token и unsafe metadata не
  сериализуются; сохраняются только safe error type, has-stack marker и
  bounded allowlisted source/component/isFatal/correlation operational fields.
  HTTP reject ingest теперь возвращает delivery=false. Негативные core/mobile
  tests PASS; clean 33-migration full suite 610/610, typecheck, lint и
  production build PASS. BLOCKED — production DSN/projects/owner и проверенный
  real test event с retention/access policy]`

- [ ] Структурные логи с correlationId/organizationId/deviceId/taskId/opId без
  токенов, PIN и персональных данных.
  `[частично реализовано/проверено тестами 2026-07-18: API middleware
  принимает только безопасный caller trace либо генерирует UUID, возвращает
  x-correlation-id и прокидывает его route handler; Caddy пишет JSON access-log,
  три worker runner и shutdown lifecycle пишут JSON через allowlist полей,
  тесты доказывают отбрасывание token/email. Authenticated API boundary теперь
  централизованно пишет allowlisted method/path/correlationId/organizationId/
  userId/deviceId/taskId без query/token/session/header leakage. Mobile push
  после schema validation пишет отдельный allowlisted domain event с
  correlationId/org/device/opId/kind/status; payload/result detail, GPS,
  token/email не сериализуются, unsafe IDs отбрасываются. Web 128/128 PASS.
  Demo seed/CI output переведён на allowlisted structured event без password,
  PIN, email/display name и private error message; regression 2/2 PASS.
  BLOCKED — production log collector/retention/owner]`
- [ ] Метрики: availability/latency/errors, sync/outbox, import freshness,
  worker lag, media errors, DB и storage capacity.
  `[частично реализовано/проверено 2026-07-19: закрытый /api/metrics
  для DB/queues/S3 и localhost-only Caddy Prometheus histograms для request
  latency/TTFB/codes/sizes; P95/P99 PromQL зафиксирован в runbook. Actual S3
  objects/bytes inventory использует полную ListObjectsV2 pagination,
  single-flight cache 15 минут, отдельные ready/age metrics и fail-closed
  cursor test. Добавлены rolling 15-minute aggregate failures для mobile
  outbox/import/proof-analysis/notifications без tenant/PII и шесть partial
  indexes; clean migration 33/33 и forced EXPLAIN подтвердил Index Only Scan
  для failure/oldest-work scrape queries. Metrics route authorization/aggregate
  contract 2/2 и full suite 610/610 PASS. Runtime smoke с текущим local
  apps/web/.env получил S3 403
  InvalidAccessKeyId из-за рассинхрона credentials с Compose, поэтому exact
  live values не заявляются. BLOCKED — production scraper/alerts/storage
  credentials и infrastructure owner]`

- [ ] Алерты с владельцем/runbook: web/DB/storage down, missed backup, stuck
  queue, stale import, sync/vision spike, disk/certificate expiry.
  `[частично реализовано/проверено 2026-07-19: backup/verify systemd OnFailure
  -> external webhook; добавлен Prometheus baseline из 17 rules для missing/down
  web target, storage readiness/inventory, import stall/recent failure,
  mobile/proof/notification recent failures и worker lag, sync-conflict growth,
  5xx/P95 SLO, missed backup, disk и TLS expiry. Pinned Prometheus 3.12.0
  promtool проверил все 17 rules;
  unit fixtures реально перевели web down, storage down, import stall/failure,
  proof/notification lag и sync-conflict growth в
  firing с точными severity/owner_role/runbook annotations. Runbook требует
  external scrape jobs, named routing и controlled staging delivery tests.
  BLOCKED — production Prometheus/Alertmanager/webhook, notification channel,
  named owner contacts и доставленные alert evidence]`

- [x] Понятные ошибки пользователю с support correlationId.
  `[реализовано/проверено unit+E2E 2026-07-18: каждый API response содержит
  x-correlation-id; единый client error contract безопасно показывает RU/AZ
  support ID для всех текущих client fetch load/mutation/poll errors и
  нормализует network failure в retryable 503 без вывода внутреннего body.
  Статический inventory-test запрещает незащищённый client fetch; 3-browser
  E2E доказывает показ support ID и отсутствие private response body]`
- [ ] Incident response, escalation и postmortem-процесс.
  `[процесс и шаблон реализованы 2026-07-18: severity/escalation/SLA baseline,
  incident log и postmortem в deploy/PILOT_GA_RUNBOOK.md и deploy/templates;
  BLOCKED — named production on-call и согласованное incident drill window]`
Definition of Done: тестовые отказы вызывают ожидаемый алерт, типовой инцидент
локализуется без доступа разработчика к данным клиента.

### Phase 18 — P1: реальный ERP/1C и сверка данных

- [ ] Клиентский контракт SKU/barcode/category/brand/dimensions,
  price/stock/sales/assortment, currency/VAT/timezone/units.
  `[шаблон контракта реализован 2026-07-18: deploy/ERP_IMPORT_RUNBOOK.md;
  BLOCKED — mapping sheet конкретного клиента, VAT/timezone и data owners]`

- [ ] Staging -> validation -> import -> reconciliation: idempotent replay,
  partial errors, quarantine и операторское исправление.
  `[частично реализовано/проверено worker+DB tests 2026-07-18: API принимает
  строгий optional ERP manifest, persisted row counts/SHA-256/totals
  reconciliation, partial errors, durable queue polling и
  operator error list; import queue имеет capped exponential retry,
  availableAt, stale PROCESSING recovery, terminal max-attempt failure и
  atomic concurrent claim. Manifest mismatch сохраняется и завершает batch как
  COMPLETED_WITH_ERRORS. BLOCKED — manifest/client ERP access для реальной сверки]`

- [ ] Delta/full sync, freshness monitoring и алерт на расхождение.
  `[частично: staging v1 идемпотентно upsert-ит delta/full payload и metrics
  отдаёт freshness. BLOCKED — destructive absence semantics/confirmation и
  production alert требуют client data/business/infrastructure owners]`

- [ ] Контрольные суммы и сверка количества/сумм с ERP.
  `[локальная механика реализована/проверена 2026-07-18: optional multipart
  expectedRows/expectedChecksum/expectedTotals проходят strict entity-specific
  validation, сохраняются для durable queue и сверяются с deterministic
  row-set SHA-256 и точными BigInt decimal sums price/costPrice/quantity/
  revenue/profit; результат и field-level mismatch сохраняются в ImportBatch.
  BLOCKED — реальные ERP manifest/access и 14 последовательных обменов]`

- [x] Guard от массового удаления/обнуления без подтверждения.
  `[guard реализован/проверен unit: zero и drop >10% блокируются без
  подтверждения; destructive full-sync сейчас отсутствует и ничего не удаляет]`

- [x] Runbook повторного импорта и восстановления ошибочной загрузки.
  `[runbook реализован. BLOCKED — клиентский ERP fixture/operator и staging
  access для evidence повторного импорта]`


Definition of Done: 14 последовательных обменов без необъяснённых расхождений;
повтор входного набора не создаёт дублей и не меняет итоговые суммы.

### Phase 19 — P1: производительность и масштабирование

- [x] Зафиксировать capacity target: tenants, stores, SKU, users, tasks/photos
  per day, import rows и retention.
  `[target зафиксирован в deploy/CAPACITY_SLO.md; это проектный baseline,
  production-like load/soak проверяется отдельными пунктами ниже]`

- [ ] Load tests: import, mass publish/task fan-out, mobile pull/push/upload,
  analytics/export и worker queues.
  `[частично реализовано/проверено local k6 2026-07-18: pull tiers 1/10/50
  PASS; после cursor/index/single-flight оптимизации два 200-VU pool=50 run
  PASS (3250/3250 и 3251/3251, 0% errors, overall P95 0.69/0.59 s);
  replay 20 VU/100 repeats PASS: 304/304, P95 177.92 ms, row delta=1.
  200 VU = разные devices одного demo-user/один instance, поэтому distinct-user
  production-like test pending. Дополнительный local distinct-user run на
  200 users/devices/tasks PASS: 3002 pulls/0 errors за 20 s, overall P95
  1.142 s, initial P95 1.191 s, delta P95 0.691 s; readiness 82/82,
  P95 0.194 s, post-run RSS ≈205 MiB. Это one-instance/non-soak evidence;
  local two-instance retest тоже PASS: 3348 pulls/0 errors, overall P95
  1.004 s, initial 1.063 s, delta 0.519 s, readiness 86/86 P95 0.148 s,
  post-run RSS 206/188 MiB, DB connections snapshot 19. Production
  load-balancer/history volume и 8h soak pending. Sales snapshot import+replay 100k/500k PASS
  local isolated executor (12.292/56.425 s first) и full CSV queue
  (12.035/60.440 s first; MATCH; row counts stable; 500k max RSS 1.18 GiB), но
  product+barcode 100k executor/CSV queue PASS (105.946/147.065 s first,
  MATCH, products/barcodes=100k). Assortment 100k executor/CSV/XLSX PASS
  (31.777/37.986/31.459 s first; MATCH; 50k matrix + 50k store); streaming
  XLSX заменил 499.620 s baseline. Complex refs/client workbooks,
  mass publish FORMAT->500 stores PASS local (175 ms; 500 tasks/histories;
  replay без дублей). Media 8x10 MiB PASS local (P95 704.77 ms, DB/S3=8/8);
  bounded overload при capacity=2 дал 2x201 + 6x503/Retry-After без artifacts.
  Реальный local MinIO stop/start upload drill PASS: outage вернул retryable
  503+Retry-After+correlationId и оставил DB/S3=0/0; после recovery тот же
  clientPhotoId получил 201, затем fixture полностью очищен.
  Standalone production build принял предельный synthetic MP4 35 MiB за
  715.65 ms: HTTP 201, DB/S3 bytes=36,700,160/36,700,160, post-run RSS
  311,380 KiB, cleanup=0. Это transport/storage limit proof, не camera codec
  или worker video-analysis proof.
  Concurrent multi-tenant publish 4x100 stores PASS local (131 ms; per tenant
  100 tasks/histories, one assignment, zero foreign tasks; replay rejected).
  Reference-network/real camera video+analysis/production-S3, broader analytics,
  multi-replica publish
  и soak pending. Analytics XML serialization 100k PASS (58.31 MB,
  728 ms, max RSS 275 MiB), silent export take=2000 устранён. Real DB fixture
  100k placements + two concurrent full exports PASS after keyset pagination:
  single 10.959 s, concurrent pair 10.969 s, 55.29 MB each, RSS 438->554 MB
  instead of the rejected full-array 454 MB->3.258 GB baseline. Sales/stock
  loaders больше не имеют silent 5k–15k truncation: все пять путей dashboard/
  ABC/like-for-like/stock coverage используют deterministic keyset pages по
  2k; regression 2001 rows и web 126/126 PASS 2026-07-18. Production-like
  sales/stock volume, proxy timeout и multi-replica exports BLOCKED — нужны
  production-like dataset/network/storage/replicas и 8h execution window]`

- [ ] SQL plans/indexes, pagination/batching, pools, memory, backpressure,
  timeouts и graceful shutdown.
  `[частично реализовано/проверено worker tests 2026-07-18: poll intervals
  fail-safe, SIGTERM/SIGINT прерывают idle wait, текущий tick дренируется,
  затем все три worker runner отключают Prisma; для pull добавлены четыре
  cursor-sort индекса, устранены повторные cursor/task reads и bounded
  tenant/user/cursor single-flight; product import получил bounded concurrency=16,
  Promise single-flight для общих brand/supplier/manufacturer/category refs
  и детерминированный barcode first-row-wins. Регрессия на 64 параллельных
  строках и три последовательных полных worker-suite run прошли 2026-07-18;
  assortment import получил
  key-ordered bounded concurrency=16 и streaming XLSX reader. Distinct-user
  SQL/pool и production-like complex import refs pending. Import и notification
  queues получили bounded exponential retry, due-time индексы, stale lease
  recovery и terminal attempt limit; proof-analysis stale/retry path подтверждён
  интеграционным тестом. Guarded local import backlog 500 jobs/4 concurrent
  worker loops PASS (2.970 s, 168 jobs/s; 500 completed, 0 failed,
  attempts=1, products=500, input artifacts=0). Это in-process loopback,
  не multi-container/production capacity proof. Общий runner lifecycle теперь
  переживает tick failure через capped exponential backoff+jitter; реальный
  local PostgreSQL stop/start drill прошёл два цикла, процесс не завершился,
  после recovery backoff сбросился до attempt=1. Local MinIO upload outage
  также PASS без artifacts; production DB/S3 outage и
  multi-replica recovery BLOCKED — production infrastructure/access. Media permit берётся
  до multipart parsing, default capacity=8, DB failure compensating-delete
  использует уникальный per-attempt object key]`
- [ ] Рост PostgreSQL/object storage/mobile SQLite; retention/archive/alerts.
  `[частично реализовано/проверено 2026-07-18: Prometheus экспортирует
  PostgreSQL database bytes и paginated/cached S3 objects/bytes/age/ready;
  mobile profile показывает SQLite allocated bytes и offline media files/bytes
  с near-limit warning; pure capacity tests PASS. BLOCKED — production alert
  thresholds/owners требуют infrastructure owner, retention/archive/delete
  policy требует client privacy/legal/business решения, а сменный SQLite
  baseline требует physical devices]`
- [ ] Зафиксировать SLO и baseline/soak/failure-test результаты.
  `[initial SLO, pull 1/10/50/200 same-user, replay, import и local publish-500
  baselines зафиксированы; distinct-user/production-like data,
  reference-network media/video/S3 failure, analytics/failure и 8h soak
  отсутствуют. BLOCKED — production-like dataset/infrastructure, reference
  network/devices и согласованное 8h execution window]`

Definition of Done: целевой объём выдерживается с запасом без потери данных;
P95/P99 и error rate соответствуют SLO на soak test.

### Phase 20 — pilot -> GA

- [ ] Пилот: 1 клиент, 3–5 магазинов, 10–20 пользователей, реальные SKU и
  физические устройства, 2–4 недели.
  `[BLOCKED — client agreement/data, 3–5 stores, signed mobile artifacts,
  physical devices, trained users и 2–4 week pilot window]`
- [ ] Инструкции и обучение администратора, менеджера, супервайзера и магазина.
  `[материалы реализованы: role-based training и acceptance practice в
  deploy/PILOT_GA_RUNBOOK.md. BLOCKED — named client users и training window]`
- [ ] Web QA: Chromium/WebKit/Firefox, desktop/tablet, accessibility keyboard/
  focus/contrast и полная проверка RU/AZ локализации без demo-заглушек.
  `[частично реализовано/проверено Playwright 2026-07-18: exact-SHA remote CI
  production standalone, 15/15 Chromium+Firefox+WebKit tests; responsive 390/768/1440,
  RU/AZ lang/accessible names/Tab/focus, безопасная support-error выдача и
  axe WCAG 2 A/AA + 2.1 A/AA audit login/catalog/tasks/analytics без rule
  exclusions. Audit выявил и исправил constrained zoom, 5 unnamed selects,
  nested interactive и 12 keyboard-inaccessible scroll regions. Ручной full
  copy audit и прогон без demo fixture BLOCKED — client data/copy owner]`
- [ ] Onboarding/offboarding tenant, экспорт/удаление данных, support SLA,
  каналы эскалации и ответственные за ERP, mobile release и инфраструктуру.
  `[процессы реализованы в pilot/security runbooks: onboarding/offboarding,
  export/delete controls, severity/SLA baseline и owner matrix; tenant DB
  delete CLI локально проверен с dry-run/dual approval/external receipts и
  cross-tenant preservation. BLOCKED — production owners, договорный SLA,
  реальный export/media/backups delete и подписанные approvals]`
- [ ] Журнал инцидентов, обратной связи и принятых решений.
  `[шаблоны реализованы: pilot event CSV и incident postmortem; реальный
  журнал BLOCKED — pilot/client/users ещё не стартовали]`
- [ ] Import -> planogram -> publish -> execution -> proof -> review/retake ->
  analytics выполняется без участия разработчика.
  `[частично реализовано/проверено PostgreSQL integration 2026-07-18:
  изолированный tenant проходит product ERP import с count/checksum ->
  equipment/template -> planogram/placement -> publish/store task -> execution
  transitions -> persisted photo proof -> human approve -> COMPLETED -> sales
  ERP import с count/checksum/totals -> analytics aggregate; проверены assignment,
  четыре history records и полная очистка fixture (residue=0). Proof создаётся
  на DB-level: фактический HTTP multipart/S3/native user walkthrough и прогон
  без разработчика BLOCKED — deployed environment, client operator и physical
  mobile device]`
- [x] AI остаётся feature flag/stub до валидации на 20–50+ реальных размеченных
  proof и измерения precision/recall/cost/latency с human review.
  `[зафиксировано в GA gates: только disabled/stub+human review до evidence;
  реальная выборка и метрики отсутствуют, поэтому автоматическое решение не
  включается]`
- [ ] GA review закрывает backup/restore, security, SLO, support,
  contracts/privacy, capacity и все P0/P1 доказательствами.
  `[исполняемый GO/NO-GO checklist реализован в deploy/PILOT_GA_RUNBOOK.md;
  GA review BLOCKED и остаётся NO-GO до перечисленных external/device/legal/
  business и production-like technical evidence]`

Definition of Done: в пилоте нет потери данных и открытых P0; основной сценарий
стабилен без помощи разработки; владелец принимает GA-гейты и P2-ограничения.

## Порядок начала production-разработки

1. Phase 14: health/readiness, backup/restore, deploy/rollback и отделение demo.
2. Phase 15–16: field-ready mobile и security/privacy.
3. Phase 17–18: observability и реальная ERP-интеграция.
4. Phase 19: capacity/load/soak на реалистичных данных.
5. Phase 20: пилот, исправления и только затем GA.

Не блокируют первый не-AI production: OCR ценников, автоматическое CV-решение,
3D-расширения, AR, голосовые подсказки и собственная модель. Они остаются
feature-flagged/P2 и не подменяют надёжность core workflow.
