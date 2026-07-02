# Решение: перенос полного MTM-модуля (2026-07-02)

Это решение **обновляет** scope из `01-product-scope.md` и частично отменяет
запреты из `04-implementation-instructions.md`.

## Решение владельца продукта

LeadShelf получает **весь функциональный объем MTM-модуля** из `leaddrive-v2`,
включая field-force разделы, которые ранее были исключены:

- Маршруты (Routes) и точки маршрутов.
- Визиты (Visits) с anomaly detection.
- Живая карта (Live Map) — GPS-трекинг исполнителей.
- Заказы (Orders), кредитные лимиты, промо-акции, invoice generation.
- Xəbərdarlıqlar (Alerts).
- Агенты, команды, регионы, лидерборд.
- Ремонтные заявки и инспекции оборудования (asset management).

Плюс всё shelf-ядро, которое и так было в плане: планограммы, проверки
планограмм, рэф-аналитика, фото, задачи, SKU-каталог, категории, оборудование.

LeadShelf позиционируется как **field-force + shelf execution** продукт.
CRM-часть LeadDrive (leads/deals/marketing/loyalty/contracts/finance) по-прежнему
НЕ переносится.

## Правила переноса (жёсткие)

1. **Портируем поведение и проверенные алгоритмы, не старую архитектуру.**
2. База, домены, названия и зависимости — LeadShelf-native. Никаких `Mtm*`
   префиксов, никаких импортов из CRM-кода.
3. Планограмма строится на **физической модели** (мм, полки, фейсинги X/Y/Z)
   из `07-data-model-draft.md`. Фото-bbox модель MTM (`MtmPlanogramSlot.bbox`)
   переносится только как **golden-reference слой для AI-проверки**, не как
   основная модель планограммы.
4. «Оборудование» разделяется на два модуля с разными назначениями:
   - **Equipment library** — конструктор (полки, ячейки, габариты) для планограмм;
   - **Asset management** — учёт единиц оборудования у точек (инспекции,
     ремонты, история статусов) — это то, чем было `MtmEquipment`.
5. `MtmCustomer` переносится как `Store` (торговая точка), не как CRM-contact.

## Источник кода

`/Users/rashadrahimov/Projects/leaddrive-v2`:

- `src/app/(dashboard)/mtm/` — 22 раздела UI.
- `src/app/api/v1/mtm/` — ~80 файлов, ~10 400 строк API (+ mobile API: auth,
  sync, planogram-checks, shelf-analytics).
- `src/components/mtm/` — 19 компонентов (~4 700 строк), включая
  `shelf-builder.tsx`, `golden-reference-editor.tsx`, `shelf-annotator.tsx`.
- `src/lib/mtm/` — ~3 600 строк домен-логики: photo-watermark, photo-quality,
  price-ocr, promotion-engine, shelf-backstop, visit-anomaly, credit-limit,
  invoice-generator, territory-scope и др.
- `prisma/schema.prisma` — 38 моделей `Mtm*`.
