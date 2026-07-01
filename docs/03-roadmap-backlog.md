# LeadShelf: roadmap и backlog

## Phase 0 - Product foundation

Цель: зафиксировать scope, стек, структуру репозитория и первый прототип модели данных.

Задачи:

- Создать GitHub repo `leadshelf`.
- Создать monorepo skeleton.
- Настроить TypeScript, lint, formatting.
- Создать Prisma schema v0.
- Создать auth/tenant baseline.
- Создать базовую навигацию web app.
- Создать seed demo tenant.

Definition of Done:

- Есть локальный dev server.
- Есть первая миграция.
- Есть demo user.
- Есть пустые разделы: Catalog, Equipment, Floor Plans, Planograms, Tasks, Analytics.

## Phase 1 - Catalog & ERP import

Цель: продуктовая база, без которой планограмма невозможна.

Задачи:

- Product CRUD.
- Category tree.
- Brand/supplier/manufacturer attributes.
- Product dimensions: width, height, depth, weight.
- Barcode support.
- Product images.
- Import CSV/XLSX.
- 1C/ERP import contract.
- Stock/price/sales snapshots.
- Assortment matrix.
- Data quality report: missing dimensions, missing barcode, missing image, missing category.

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

Definition of Done:

- Можно вручную собрать полку и увидеть, сколько товара помещается по ширине и глубине.

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

Definition of Done:

- Центральный офис публикует планограмму.
- Мобильный пользователь видит задание.
- Пользователь отправляет фото.
- Офис видит задачу как выполненную/на проверке.

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
