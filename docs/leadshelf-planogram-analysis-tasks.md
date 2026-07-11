# LeadShelf — перенос анализа планограмм из LeadDrive: полный анализ и задачи

> **Статус:** спецификация для реализации в проекте **LeadShelf** (2026-07-11).
> **Исполнитель реализации:** Codex (со своим ИИ-стеком — детекция/распознавание подставляются за интерфейсом провайдера, см. Эпик 4).
> **Основание:** полный аудит модуля в leaddrive-v2 (161 файл: 8 моделей Prisma, ~30 API-роутов, 4 страницы + 4 крупных компонента, 31 файл `src/lib/shelf-analysis`, ~77 тестов, 8 help-разделов, ~161 i18n-ключ ×3 локали).
> В конце — план **удаления** модуля из LeadDrive (раздел 5).

---

## 1. Что переносим (в двух словах)

Модуль «Планограммы + Аналитика полок»: супервайзер задаёт эталонную выкладку
(планограмма + «золотое» фото полки с **обводкой каждого товара** — bounding box),
полевой агент фотографирует реальную полку, ИИ находит товары на фото (тоже с
обводкой), сравнивает с эталоном и считает метрики: compliance, OOS,
share of shelf, perfect-store score и т.д. Плюс: ручная разметка фото человеком,
чек-листы соответствия, аналитика/лидерборд, дообучение собственной модели на
накопленной разметке, OCR ценников.

---

## 2. Полный анализ текущей реализации (источник истины для переноса)

### 2.1 Ключевые понятия

| Понятие | Суть | Таблица в LeadDrive |
|---|---|---|
| **Планограмма** | Эталонный ассортимент: список `{skuId, expectedFacings, position}` + категория магазина (A/B/C/D) + бренд + флаг `strictCompliance` | `MtmPlanogram` |
| **Golden reference** | Фото идеально выложенной полки + **слоты** (обведённые товары) | `MtmPlanogram.referenceImageUrl` + `MtmPlanogramSlot` |
| **Слот** | Одна позиция на золотом фото: bbox + label + необязательная привязка к SKU + facings (сколько одинаковых фронтов накрывает бокс) + embedding | `MtmPlanogramSlot` |
| **Скан / анализ** | Результат ИИ-анализа одного фото: найденные товары (bbox!), метрики | `MtmShelfAnalysis` (1:1 с фото) |
| **Аннотация** | Один нарисованный человеком бокс на полевом фото, привязанный к SKU (для ручной разметки и обучения модели) | `MtmShelfAnnotation` |
| **Чек планограммы** | Человеческий вердикт агента «соответствует / не соответствует», опционально со ссылкой на ИИ-скан | `MtmPlanogramCheck` |
| **Тренировочный прогон** | Экспорт разметки → обучение детектора → деплой версии модели per-org | `MtmModelTrainingRun` |
| **Цена с полки** | Прочитанный с ценника прайс (OCR), привязанный к SKU | `MtmPhotoPrice` |

### 2.2 Конвенция координат (КРИТИЧНО — единая по всей системе)

```
bbox = [x, y, w, h]
— нормализованные 0..1 (доли ширины/высоты изображения)
— origin: верхний левый угол
```
Одна и та же конвенция у: детекций ИИ (`DetectedSku.bbox`), слотов golden
(`MtmPlanogramSlot.bbox`), ручных аннотаций (`MtmShelfAnnotation.bbox`), ценников
(`MtmPhotoPrice.bbox`). Синтетический `[0,0,0,0]` — маркер «нет пространственных
данных» (roll-up golden-вердиктов); пространственные метрики обязаны его
отвергать (guard `assertRealBbox`, бросает на нулевой площади).

### 2.3 Модель данных (минимум для LeadShelf)

Прямой аналог (имена можно свои, состав полей — этот):

- **Planogram**: `id, orgId, name, description?, storeCategory?(A/B/C/D), brand?, referenceImageUrl?, expectedSkus Json [{skuId, expectedFacings, position}], strictCompliance bool, isActive`
- **PlanogramSlot**: `id, orgId, planogramId, slotIndex (unique в паре с planogramId), skuId? (слабая ссылка, БЕЗ FK — допускаются слоты без каталога), label, bbox Json, facings Int? (1..99), embedding Float[], refCropUrl?, createdById?`
- **Photo**: `id, orgId, agentId, visitId?, url, category?(shelf/display/promo/receipt), status(PENDING/APPROVED/REJECTED), lat/lng, exifData?, tamperingDetected, …`
- **ShelfAnalysis** (1:1 к фото, `photoId @unique`): `status (PENDING/PROCESSING/COMPLETED/FAILED/REJECTED/AWAITING_BACKSTOP), provider (строка: 'claude'|'roboflow'|'manual'|'golden-reference'|'stub'|свой), detectedSkus Json [{skuId?, label, confidence, facings, bbox, displayType?}], totalFacings, shareOfShelf Json?, oosCount, oosList Json?, planogramId?, complianceScore Float?, perfectStoreScore Int?, perfectStoreGrade?, costCents?, modelVersion?, clientScanId? (идемпотентность), attempts, nextRetryAt?, lockedAt?, startedAt/completedAt/errorMessage`
- **ShelfAnnotation**: `id, orgId, photoId, skuId (FK), bbox Json, source (MANUAL/AUTO/CONFIRMED), createdById?`
- **PlanogramCheck**: `id, orgId, agentId, customerId, visitId?, planogramId, status (COMPLIANT/NON_COMPLIANT), analysisId?`
- **Sku / SkuCategory**: каталог `{code (unique per org), name, brand?, basePrice, isActive}` + иерархия категорий
- **ModelTrainingRun** (опц., Эпик 9): `status (DRAFT/UPLOADING/UPLOADED/TRAINING/READY/DEPLOYED/FAILED), imageCount, boxCount, skuCount, format('coco'), modelRef?/modelVersion?, metrics Json?, errorMessage?, triggeredById?`
- **PhotoPrice** (опц., Эпик 10): `photoId, skuId?, bbox Json, rawOcrText, ocrConfidence, priceValue Decimal, currency, isPromo`

Важные инварианты из прода:
- `ShelfAnalysis.photoId` — unique; **все** терминальные записи защищены manual-wins guard'ом: `updateMany({where: {photoId, provider: {not: "manual"}}})` — ручная разметка человека никогда не перезаписывается автоанализом.
- Partial-unique `(orgId, clientScanId) WHERE clientScanId IS NOT NULL` — повторный POST того же скана с телефона сходится в ту же строку.
- `expectedSkus` перед любым расчётом прогоняется через дедуп по skuId с суммированием facings (один SKU в нескольких ячейках сетки не должен раздувать метрики).

### 2.4 Четыре пути анализа (все пишут в одну таблицу ShelfAnalysis)

1. **Очередь (upload → worker)**: фото категории `shelf` → джоб → Tier-0 проверка качества фото (эвристики sharp: размер <1KB, аспект вне 1/3..3, яркость <25/>230, variance<100 → blurry; reject → REJECTED + антифрод-аудит) → Tier-1 детектор → условно Tier-2 VLM-ревью → метрики → персист.
2. **Мобильный inline-скан + cron-backstop** (основной у Mars): телефон шлёт base64 → сервер сначала **персистит** фото + строку PROCESSING (persist-first), потом до 2 попыток синхронного ИИ; не вышло → строка паркуется в `AWAITING_BACKSTOP` c экспоненциальным `nextRetryAt` (30·2^(n−1) сек, cap 1ч), телефон получает `202 {status:"processing"}` и поллит; cron-дренер атомарно клеймит батч (`UPDATE … FOR UPDATE SKIP LOCKED RETURNING`, lockedAt-токен, stale-reclaim 15 мин) и добивает до 6 суммарных попыток → FAILED.
3. **Ручная разметка**: человек рисует боксы в аннотаторе → сервер агрегирует боксы в `detectedSkus` (`provider:"manual"`, confidence 1, facings = число боксов на SKU) → те же метрики.
4. **Golden-скан**: сравнение полевого фото со слотами золотого фото → per-slot вердикты `compliant | missing | wrong` → roll-up в `{detected, expected}` → те же метрики (bbox синтетический).

### 2.5 ИИ-контракты (то, что Codex заменит своим ИИ)

Интерфейс провайдера (сохранить как seam — тогда ИИ взаимозаменяем):

```ts
interface ShelfAnalysisProvider {
  name: string
  analyze(input: {
    imageUrl: string; imageBase64?: string; imageMediaType?: string
    orgSkus?: {id, code, name, brand?}[]          // каталог для матчинга label→skuId
    planogramSkuContext?: {name, brand?}[]        // 5–50 ожидаемых SKU как подсказка
    priorResult?: AnalysisResult                  // для Tier-2 «проверь и исправь»
    activeModel?: {…}                             // per-org версия своей модели
  }): Promise<{
    provider: string; modelVersion: string; costCents: number; rawResponse: unknown
    detectedSkus: { skuId?, label, confidence: 0..1, facings: number,
                    bbox: [x,y,w,h], displayType?: "main_shelf"|"cooler"|"endcap" }[]
  }>
}
```

Что делает текущий стек (референс для замены):
- **Tier-1** — Roboflow hosted detect (или self-hosted RF-DETR через `MTM_DETECTOR_URL`); центр-пиксели → нормализованный top-left; агрегация по label (facings=count, max conf, first bbox).
- **Tier-2** — Claude Vision `claude-sonnet-4-6` (max_tokens 4096): промпт «прочитай реальный бренд/название, НЕ подгоняй под ожидаемый SKU по форме/цвету, вода≠Pepsi; честный confidence; facings = число фронтов; bbox tight top-left normalized, игнорируй отражения, типичная высота товара 0.25–0.6, ширина 0.05–0.18; не выдумывай; только JSON `{"detectedSkus":[…]}`». Parse-fail → fallback на priorResult (не бросать).
- **Маршрутизация в Tier-2**: `min(confidence) < 0.7` И детекций ≥ порога плотности по категории магазина (A:5, B:4, C:3, D:2), ИЛИ магазин категории A.
- **Golden-скан, 2 движка**:
  - *Детерминированный*: кроп полевого фото по bbox слота → эмбеддинг → cosine с эмбеддингом слота; `≥ 0.85 → compliant`, иначе `wrong` (missing неразличим). Эмбеддеры: локальный `local-grid-v1` (12×12 RGB → 432-dim, sharp, офлайн, бесплатно, детерминированный) или Voyage `voyage-multimodal-3` (1024-dim). Разная размерность → cosine 0 → эскалация, не ложный вердикт.
  - *VLM grounded*: `claude-sonnet-4-6`, **temperature 0**, max_tokens 2048; вход = ДВА изображения (golden + поле) + список слотов с центрами; выход ровно по записи на слот `{"slots":[{slotIndex, outcome: compliant|missing|wrong, present: 0..N}]}`; невалидный слот → missing (консервативно); полный parse-fail → 502 и НЕ персистить (не травить дашборд ложным 0%).
  - *Гибрид (как в проде)*: сперва эмбеддинги; если все compliant — готово (provisional=false); есть сомнительные — одна эскалация всего изображения в VLM, уверенные вердикты сохраняются.
- **Матчинг label→skuId** (`matchSkuId`): проход 1 — точный substring по code/name; проход 2 — пересечение слов с исключением стоп-слов и размерных токенов (`0.33l`, `330ml`, `can`…) — чтобы конкурентная банка не линковалась на свой SKU через «0.33l»; проход 3 — по бренду как last resort.
- **OCR ценников**: Claude `claude-sonnet-4-6`, temp 0 → `{"prices":[{label, price, currency, bbox, confidence, isPromo}]}`; привязка к товару — ближайший центр bbox в радиусе 0.2; regex цены `(\d+(?:[.,]\d{1,2})?)\s*AZN`; два числа на ценнике → меньшее = промо.

### 2.6 Метрики — формулы (переносить 1:1, это чистые функции без БД)

| Метрика | Формула |
|---|---|
| **Share of shelf** | по label суммируются facings; целые проценты методом **наибольшего остатка** (сумма ровно 100) |
| **Brand share** | facings по брендам каталога; не сматченное → бакет `Competitor / Other`; `ourSharePct + competitorSharePct = 100` |
| **OOS** | SKU планограммы, у которых `actualFacings < expectedFacings` (детекции одного SKU суммируются!) |
| **Compliance (lenient, дефолт)** | `round( Σ min(actual/expected, 1) / N × 100 )` — оверсток не штрафуется |
| **Compliance (strict)** | вклад SKU = `max(0, 1 − |actual−expected|/expected)` — отклонение в обе стороны штрафуется |
| **Perfect Store** | 4 пиллара: availability(вес 0.35, % SKU с ≥1 facing) + compliance(0.30) + share(0.20, ourSharePct) + facings(0.15, `Σmin(actual,expected)/Σexpected`); невычислимые пиллары выпадают, веса ренормализуются; грейды: ≥90 gold, ≥75 silver, ≥60 bronze, <60 fail |
| **Shelf actions** | per-SKU дефицит: `restock` (0 на полке) / `add_facings`, сортировка по дефициту — «что доложить прямо сейчас» |
| **Price compliance** | отклонение от basePrice, tolerance 0.5%; статусы ok/underpriced/overpriced/promo/promo_mismatch (промо сверяется с ожидаемой промо-ценой, если есть активная промо-акция) |
| **OSA trend** | по дням: % фото без OOS |
| **Chronic OOS** | SKU в oosList ≥ 50% сканов |
| **Eye-level** | centerY бокса: <0.33 top, <0.67 eye-level, ≥0.67 bottom |
| **Share of display** | по зонам (main_shelf/cooler/endcap): сумма площадей bbox, % от общей |

### 2.7 API-поверхность (минимальный набор для LeadShelf)

**Планограммы**: `GET/POST /planograms` (список: фильтры all/category/limit/offset; создание: name, expectedSkus min 1, валидация принадлежности SKU организации), `GET/PUT /planograms/{id}` (org-scoped updateMany, 404 при чужом), деактивация вместо DELETE.
**Golden**: `GET/PUT/DELETE /planograms/{id}/golden-reference` (PUT: слоты max 200, транзакция deleteMany+createMany, после — пересчёт эмбеддингов, ответ `{slotCount, embeddedCount}`; DELETE: слоты + referenceImageUrl=null), `POST …/golden-reference/upload` (multipart, png/jpg/webp ≤10MB, SVG запрещён, rate-limit 30/мин), `POST …/golden-reference/auto-detect` (rate-limit 15/мин, НИЧЕГО не пишет в БД — только черновики слотов).
**Фото**: `POST /photos` (multipart ≤10MB, magic-number проверка, HEIC→JPEG, антифрод EXIF/GPS/burst, rate-limit 30/мин, enqueue анализа для category=shelf), `GET /photos`, `PATCH/DELETE /photos/{id}` (ревью/удаление), `GET/PUT /photos/{id}/annotations` (ручная разметка: серверный резолв label'ов, транзакция замены + upsert analysis provider="manual"), `POST /photos/{id}/golden-analyze`.
**Аналитика**: `GET /shelf-analytics` (список, кэш 60с, лёгкая проекция), `GET /shelf-analytics/{id}` (полная детализация), `GET /shelf-analytics/summary` (avgCompliance, byAgent, top chronic OOS; row cap 5000), `GET /shelf-analytics/leaderboard` (perfect-store по магазинам, дедуп «последний скан выигрывает»).
**Чеки**: `GET /planogram-checks` (веб), `POST /mobile/planogram-checks` (батч вердиктов, org-scope проверки всех id).
**Мобильные**: `POST /mobile/shelf-analytics/analyze` (inline-скан, см. 2.4.2), `GET /mobile/shelf-analytics/{id}` (поллинг: 202 running / 200 терминал — байт-идентичный формат с analyze), `GET /mobile/customers/{id}/planograms` (по категории магазина с graceful fallback на все активные), `POST /mobile/planograms/{id}/golden-reference/upload` (base64, только роли ADMIN/MANAGER/SUPERVISOR).
**Обучение** (опц.): `GET/POST /model-training/runs`, `PATCH /model-training/runs/{id}` (переходы стейт-машины UPLOADED→TRAINING→READY→DEPLOYED, CAS), `GET /model-training/active`, `GET /model-training/coco-export`.
**Cron**: `POST /cron/shelf-backstop` (секрет в заголовке, батч ≤6, внешний планировщик).

Сквозные правила: любой список/чтение — **org-scoped** (`findFirst({id, organizationId})`, чужой id → 404, не 403); мутации — `updateMany` с organizationId в where (TOCTOU-guard); мутации golden — только роли admin/manager; лимиты списков 50/200.

### 2.8 UI-поверхность

1. **Список планограмм** — стат-карты, табы active/all/inactive, поиск, карточки (категория, бренд, число SKU).
2. **Создание/редактор планограммы** — форма + **ShelfBuilder**: визуальная сетка полок (до 8 полок × 8 колонок), клик по ячейке → выбор SKU + facings (1–20), кодировка `position=(shelf+1)*100+(col+1)`; экспорт/импорт `expectedSkus`.
3. **Golden Reference Editor** (на странице планограммы) — см. Эпик 3.
4. **Список сканов** (`shelf-analytics`) — стат-карты, табы статусов, строки с миниатюрой/провайдером/метриками + Perfect-Store leaderboard.
5. **Деталь скана** — фото, метаданные (провайдер, версия модели, длительность, стоимость), detectedSkus с confidence, share-of-shelf бары, OOS-лист, тумблер «Manual markup» → **ShelfAnnotator**.
6. **Чеки планограмм** — стат-карты, compliance by agent, top chronic OOS, список вердиктов со ссылкой на ИИ-скан.
7. **Фотогалерея** — ревью PENDING/APPROVED/REJECTED, режимы gallery/compare/batch.
8. **Model Training** (опц.) — таблица прогонов, кнопки lifecycle, скачивание COCO.
9. **Мобильные экраны** (у Mars — мобильное приложение поверх API): список планограмм магазина → съёмка → ожидание/поллинг → результат с bbox-оверлеем и actions → вердикт. В LeadShelf — см. задачу 6.10.

### 2.9 Хранение и окружение

- Файлы на диске: `uploads/photos/…` и `uploads/golden/<orgId>/golden-<8hex>.<ext>` (org-scoped путь — отдача файла только владельцу; для LeadShelf разумнее сразу S3-совместимое хранилище).
- Чтение картинки для ИИ — с диска в base64 (приватные URL внешнему API недоступны).
- Env текущего стека: `ANTHROPIC_API_KEY`, `ROBOFLOW_API_KEY/PROJECT_ID/VERSION`, `MTM_DETECTOR_URL/TOKEN`, `GOLDEN_EMBEDDER`+`VOYAGE_API_KEY`, `MTM_PRICE_OCR_ENABLED`, `MTM_SHELF_BACKSTOP_ENABLED`+`MTM_SHELF_BACKSTOP_BATCH`, `CRON_SECRET`, `GOOGLE_VISION_API_KEY` (дормант). Для LeadShelf — свои аналоги под ИИ Codex + те же флаги (backstop, price-ocr, detector).

---

## 3. Задачи для LeadShelf (эпики → задачи)

Порядок = рекомендованный порядок реализации. MVP = Э0–Э6; v1 = Э7–Э8; v2 = Э9–Э11.

### Эпик 0 — Фундамент
- [ ] 0.1 Скелет проекта (web + API), аутентификация, роли (admin / manager / agent), мультитенантность если нужна (org-scoping во ВСЕХ запросах — см. 2.7).
- [ ] 0.2 Хранилище изображений (S3/MinIO или диск): загрузка multipart и base64, лимит 10MB, allowlist png/jpg/webp (+heic→jpeg для полевых фото), magic-number валидация, генерация thumbnail для списков, приватная отдача с проверкой владельца.
- [ ] 0.3 Rate-limiting (фото 30/мин, golden-upload 30/мин, auto-detect 15/мин), cron-эндпоинт с секретом.
- [ ] 0.4 Единый тип `bbox = [x,y,w,h] норм. 0..1 top-left` + утилиты `clamp01`, валидация (4 finite числа, w>0, h>0, x+w≤1, y+h≤1) + guard от `[0,0,0,0]` в пространственных метриках.
- [ ] 0.5 **Базовые сущности поля** (без них модуль не работает): **магазин/клиент** (name, категория A/B/C/D — по ней резолвится планограмма, координаты + geofenceRadius — для антифрода и статуса фото; по магазину группируется leaderboard), **агент** (кто снимает), опционально **визит** (связка фото↔магазин↔агент; без визита скан попадает в «unattributed»).
- [ ] 0.6 Аудит-лог ключевых действий: загрузка фото, сохранение/удаление golden, сохранение ручной разметки, вердикты, tampering-события (в LeadDrive это отдельная таблица audit-логов — форензика и разбор споров).
- [ ] 0.7 Демо-сид для разработки/QA: 3–5 SKU, планограмма без категории (применяется ко всем), тестовый магазин без координат (гео-чек пропускается), агент — аналог `scripts/seeds/mars-planogram-test.mjs`.

### Эпик 1 — Каталог SKU
- [ ] 1.1 CRUD SKU: `code` (unique per org), `name`, `brand?`, `basePrice`, `isActive`; поиск `?search=&limit=20` (нужен редакторам обводки); импорт CSV — опционально.
- [ ] 1.2 Категории (иерархия) — опционально для MVP.
- [ ] 1.3 Хелпер `skuDraftFromLabel(label)` → `{name, code (UPPER, не-алфанум→'-', ≤64), brand (первый токен)}` — для быстрого создания SKU из ИИ-лейбла.
- [ ] 1.4 Фаззи-матчер `matchSkuId(label, skus)` по алгоритму из 2.5 (обязательно с исключением размерных токенов — иначе конкуренты линкуются на свои SKU через «0.33l»).

### Эпик 2 — Планограммы
- [ ] 2.1 Модель + CRUD (см. 2.3, 2.7): expectedSkus min 1, валидация принадлежности SKU, деактивация вместо удаления, `strictCompliance` флаг.
- [ ] 2.2 **ShelfBuilder** — сетка полок: до 8×8, add/remove/move полки, ячейка = SKU + facings 1–20, `position=(shelf+1)*100+(col+1)`, двусторонняя конвертация grid ↔ expectedSkus.
- [ ] 2.3 Резолвер активной планограммы для скана: по категории магазина, точное совпадение > глобальная (`customerCategory=null`), свежая > старой; на выходе дедуплицированные expectedSkus + strict-флаг.
- [ ] 2.4 Страница списка + страница редактирования (2.8.1–2.8.2).

### Эпик 3 — Редактор обводки товаров (bounding boxes) ⭐ главный UI-компонент

Два родственных компонента с одинаковой канвас-механикой, но разными моделями данных:
**(A) GoldenReferenceEditor** — слоты эталона (бокс = ПОЗИЦИЯ, skuId опционален);
**(B) ShelfAnnotator** — разметка полевого фото (бокс = ЭКЗЕМПЛЯР товара, skuId обязателен).
Рекомендуется сразу выделить общий canvas-примитив (в LeadDrive это осознанный тех-долг — механика скопирована).

#### 3.1 Канвас-механика (общая для A и B)
- [ ] 3.1.1 Слой поверх `<img>`: полноширинное фото, поверх — прозрачный div-«surface», ловящий мышь; боксы — absolute-элементы, позиционируемые в **процентах** (`left = x*100%` и т.д.), т.е. автоматически масштабируются с картинкой. Без zoom/pan (проверено на пользователях: зум «скользит», убрали).
- [ ] 3.1.2 Координаты из события: `(clientX − rect.left) / rect.width` c clamp 0..1 (`getBoundingClientRect` поверхности).
- [ ] 3.1.3 **Рисование**: mousedown → драфт `{x0,y0,x1,y1}` (пунктирный прямоугольник), mousemove тянет угол, mouseup/mouseleave коммитит. Если протяжка меньше `MIN_DRAG = 0.012` по обеим осям — это **клик**: ставится дефолтный бокс (golden: 0.08×0.16; annotator: 0.07×0.11), центрированный на точке клика и заклампленный внутрь изображения.
- [ ] 3.1.4 **Перемещение**: mousedown по телу бокса → запоминаем `orig` bbox и стартовую точку; дельта применяется к orig (идемпотентно), клампится так, чтобы бокс не вышел за края (`x ∈ [0, 1−w]`). Слушатели mousemove/mouseup — на **window** (перетаскивание переживает выход курсора за пределы фото).
- [ ] 3.1.5 **Ресайз**: 4 угловых хэндла (nw/ne/sw/se, квадратики ~10px, курсоры nwse/nesw-resize); выбранный угол следует за мышью, противоположный — якорь; минимальный размер `MIN_BOX = 0.01`; нормализация при «перевороте» (min/max углов).
- [ ] 3.1.6 Пока рисуется драфт, существующие боксы `pointer-events:none` (иначе драфт цепляется за них); в покое — интерактивны (cursor-move).
- [ ] 3.1.7 Удаление: крестик на ярлыке бокса + в списке; «Clear all».
- [ ] 3.1.8 **Ярлык бокса** (над верхней гранью, цвет = цвет бокса): порядковый номер, label (truncate), `×N` если facings>1, крестик; у низкоуверенных — процент confidence.
- [ ] 3.1.9 **Цвета**: детерминированная палитра из 8 цветов (#2563eb, #16a34a, #d97706, #db2777, #7c3aed, #0891b2, #dc2626, #059669); golden — по индексу слота, annotator — по хэшу skuId. Заливка полупрозрачная (~13–22% альфы), активный бокс — темнее + ring.
- [ ] 3.1.10 Состояние `dirty` → кнопка Save активна только при изменениях; активный бокс подсвечен и его редактор открыт под фото.
- [ ] 3.1.11 **Touch-поддержка** (в LeadDrive её нет — редактор mouse-only, осознанный долг): pointer-events вместо mouse-событий, чтобы рисование/перенос/ресайз работали на планшете; хэндлы ≥24px тач-таргет.

#### 3.2 GoldenReferenceEditor (слоты эталона)
- [ ] 3.2.1 Данные слота в UI: `{label, skuId?, bbox, facings (≥1, дефолт 1, clamp 1..99), confidence? (только на свежем автодетект-драфте), brand?}`.
- [ ] 3.2.2 Компоновка (сверху вниз): заголовок + счётчик слотов + Save · **статус-баннер** (зелёный «детерминированный скан активен, N слотов embedded» / янтарный «фото есть — разметьте и сохраните» / серый «загрузите фото эталона») · баннер дрейфа · тулбар (Upload/Replace photo · Auto-detect slots · Sync SKU list · Remove golden) · канвас · подсказка · **редактор активного слота** (label-input, facings-input, поиск SKU с дебаунсом 250мс, Unlink, «Create catalog SKU from this label») · **строка чипов слотов** (цветная точка, №, label, ×facings, корзинка; клик — активирует слот).
- [ ] 3.2.3 Валидация Save: каждый слот обязан иметь label (текст или привязанный SKU) — иначе фокус на первый пустой + тост. PUT заменяет слоты целиком; ответ содержит `embeddedCount` — сколько слотов получили эмбеддинги (→ статус-баннер).
- [ ] 3.2.4 **Auto-detect slots**: кнопка запускает ИИ-детекцию по золотому фото → черновики слотов (с confidence); подтверждение перед заменой существующих; boxes с невалидным bbox отбрасываются; `skuId` заполняется фаззи-матчем, но остаётся редактируемым. **Низкоуверенные (< 0.7)** — янтарный пунктир + баннер «N слотов ниже 70% уверенности — проверьте»; правка label'а или линковка SKU человеком сбрасывает флаг (человек подтвердил личность товара).
- [ ] 3.2.5 **Привязка SKU**: поиск по каталогу; линковка подставляет label (если пуст) и brand; Unlink возвращает слот в label-only. Быстрое создание SKU из лейбла: предзаполненная форма (`skuDraftFromLabel`), 409 по коду → предложить сменить код.
- [ ] 3.2.6 **Консистентность golden ↔ ассортимент**: `checkGoldenConsistency(slots, expectedSkuIds)` → баннер дрейфа (каких SKU из списка нет в golden / какие лишние / сколько слотов не слинковано) + кнопка **«Sync SKU list from golden»**: слоты с валидным линком идут как есть; label-only и «протухшие» линки (label противоречит бренду слинкованного SKU — доверять label) → SKU создаётся/находится из label; подтверждение с перечислением и предупреждением об off-brand товарах (не совпадающих с брендом планограммы) — но не блокировать, решает человек. Расстановка позиций: кластеризация слотов в полки по вертикали центров (band-фактор 0.6 высоты), сетка 8×8, `position=(shelf+1)*100+(col+1)`.
- [ ] 3.2.7 После Save — авто-предложение синхронизировать список SKU, если слинкованные товары golden разошлись со списком (только слинкованные, без автосоздания — авто-создание только по явной кнопке).
- [ ] 3.2.8 Замена фото: инвалидация эмбеддингов всех слотов (embedding=[]) до нового Save; слоты сохраняются. Удаление golden: слоты + фото, сканы откатываются на «provisional» ИИ-путь.
- [ ] 3.2.9 Лимит 200 слотов; роли: только admin/manager.

#### 3.3 ShelfAnnotator (ручная разметка полевого фото)
- [ ] 3.3.1 Перед рисованием обязателен выбранный SKU (поиск с дебаунсом); бокс = `{skuId, label, bbox}`; цвет — из хэша skuId; панель счётчиков `×N` по SKU.
- [ ] 3.3.2 Кнопка **«Load N auto-detections to review»** — детекции ИИ импортируются как AUTO-боксы (только с skuId и валидной геометрией) для правки человеком.
- [ ] 3.3.3 Save: `PUT /photos/{id}/annotations` `{annotations: [{skuId, bbox}], source: seeded ? "CONFIRMED" : "MANUAL"}`; сервер сам резолвит label'ы из каталога (клиентским не верить), пересчитывает метрики и апсертит анализ `provider="manual"` (status COMPLETED) — который выигрывает у любого автоанализа.
- [ ] 3.3.4 Источники: MANUAL (с нуля) / AUTO (импорт, ждёт ревью) / CONFIRMED (человек подтвердил) — CONFIRMED+MANUAL = чистый датасет для обучения (Эпик 9).

#### 3.4 Отображение результатов скана (обводка найденного, read-only)
- [ ] 3.4.1 На детали скана: фото + оверлей detectedSkus-боксов (те же проценты/цвета/ярлыки: label, confidence, ×facings) — как на скриншоте прод-демо.
- [ ] 3.4.2 Для golden-скана — визуализация вердиктов по слотам: compliant (зелёный) / missing (красный, пустой слот) / wrong (оранжевый — другой товар на месте).
- [ ] 3.4.3 Тот же оверлей на **мобильном/полевом экране результата** (агент видит, что именно ИИ нашёл и где) + список найденного с counts, share-of-shelf карточка, OOS-лист, compliance — прямо после скана.

### Эпик 4 — ИИ-анализ (свой ИИ Codex за интерфейсом провайдера)
- [ ] 4.1 Реализовать `ShelfAnalysisProvider` (контракт из 2.5) поверх выбранного ИИ. Требования к детекции: label + честный confidence + facings (число фронтов) + tight bbox; не выдумывать товары; отражения/цены не считать товарами. Выход строго JSON.
- [ ] 4.2 Пайплайн скана: (опц.) проверка качества фото → детекция → `matchSkuId` → резолв планограммы → метрики → персист с manual-wins guard'ом. Опционально двухуровневая схема (быстрый детектор + VLM-ревью низкоуверенных, маршрутизация из 2.5).
- [ ] 4.3 **Golden-скан**: минимум — VLM-сравнение двух изображений (промпт-контракт из 2.5: per-slot outcome + present, temperature 0, parse-fail → 502 без персиста); желательно — детерминированный эмбеддинг-путь (кроп слота → эмбеддинг → cosine ≥ 0.85) с эскалацией сомнительных в VLM. Эмбеддинги пересчитываются при сохранении слотов и обнуляются при замене фото.
- [ ] 4.4 Auto-detect для golden-фото: та же детекция, выход — черновики слотов (без записи в БД), confidence сохраняется для UI-флага.
- [ ] 4.5 Учёт стоимости (`costCents`) и версии модели (`modelVersion`) на каждом скане — для аудита и сравнения моделей.
- [ ] 4.6 Roll-up golden-вердиктов в метрики: identity слота = `skuId ?? "slot:{index}"`; multi-facing слоты одного SKU агрегируются (не двойной счёт); `wrong`-слоты идут в бакет конкурента в share-of-shelf, но не в compliance; bbox синтетический `[0,0,0,0]` → только facings-метрики (guard!).
- [ ] 4.7 **Гранулярность автодетекта для golden** (грабли из прод-опыта): один бокс = один **блок** (label × полка — непрерывный ряд одинаковых фронтов), c `facings = N` и `confidence = min` по блоку. НЕ глобальная агрегация по label (SKU на двух полках схлопнется в один бокс — ломается расстановка по полкам) и НЕ по-фейсинговая (3 фронта Pepsi → 3 соседних слота вместо одного с facings=3). Если детектор отдаёт по-фейсинговые боксы — группировать: тот же label + та же полоса по y + смежность по x. Для полевого скана глобальная агрегация по label остаётся корректной (метрики всё равно суммируют по skuId).

### Эпик 5 — Метрики (чистые функции, порт 1:1 из 2.6)
- [ ] 5.1 shareOfShelf (наибольший остаток!), brandShare, OOS, compliance lenient/strict, perfectStore + грейды, shelfActions.
- [ ] 5.2 osaTrend, chronicOos (порог 0.5), eyeLevel (0.33/0.67), shareOfDisplay (по площадям bbox, с guard'ом синтетики).
- [ ] 5.3 Обязательные инварианты: дубликаты SKU в детекциях суммируются по facings ВЕЗДЕ (исторический прод-баг: два бокса одного товара перетирали друг друга → ложные 100%); expected дедуплицируется до расчёта; пустая планограмма → compliance = null (не 0).
- [ ] 5.4 Юнит-тесты на все формулы (в LeadDrive это ~20 тестовых файлов — брать кейсы оттуда: largest-remainder 33/33/34, strict-mode, renormalization весов perfect-store и т.д.).

### Эпик 6 — Полевой скан (API для мобильного/веб-клиента)
- [ ] 6.1 `POST /scan` (base64 + planogramId? + clientScanId + gps?): **persist-first** (файл + Photo + Analysis PROCESSING), потом ИИ ≤2 попыток; успех → 200 c полным результатом; неуспех по транзиентной ошибке → парковка AWAITING_BACKSTOP + `202 {status:"processing"}`.
- [ ] 6.2 Идемпотентность по `clientScanId` (partial-unique; повторный POST → тот же результат/202, тем же форматом что и поллинг).
- [ ] 6.3 Поллинг `GET /scan/{id}`: 202 пока PROCESSING/AWAITING_BACKSTOP, 200 на терминале.
- [ ] 6.4 Cron-backstop: атомарный клейм (`FOR UPDATE SKIP LOCKED` + lockedAt-токен), батч ≤6, 1 попытка/тик, backoff 30·2^(n−1)с cap 1ч, максимум 6 попыток → FAILED, stale-reclaim 15 мин, CAS на терминальной записи. Инвариант: batch × timeout < stale-окна.
- [ ] 6.5 Классификация ошибок transient/permanent (список из 2.5/LeadDrive: 408/429/5xx/таймауты/сетевые коды → ретрай; прочие 4xx/ENOENT → FAILED сразу).
- [ ] 6.6 Ответ телефону: detectedSkus, missingSkus (с именами), complianceScore, brandShareOfShelf, perfectStore, **actions** («доложи 2 фейсинга Pepsi 1L» — главная полевая ценность), опц. priceCompliance.
- [ ] 6.7 Чеки: `POST /planogram-checks` (батч вердиктов COMPLIANT/NON_COMPLIANT с опц. analysisId), `GET /customers/{id}/planograms` (по категории, fallback на все активные).
- [ ] 6.8 Опционально антифрод (Эпик 11) и geofence-статус фото (цепочка: per-магазин override → орг-настройка → 100 м по умолчанию).
- [ ] 6.9 CORS на мобильных эндпоинтах (+OPTIONS preflight), если клиент — PWA/WebView с другого origin'а.
- [ ] 6.10 **Полевой клиент UI** (мобильный экран/PWA): выбор магазина → список его планограмм → камера/выбор фото → отправка скана → экран ожидания (поллинг по 202) → экран результата с обводкой (3.4.3) и списком actions → отправка вердикта COMPLIANT/NON_COMPLIANT. Опционально push/уведомление «анализ готов: N товаров, M отсутствует», если анализ ушёл в backstop.

### Эпик 7 — Аналитика и страницы
- [ ] 7.1 Список сканов + деталь скана (2.8.4–2.8.5, включая оверлей боксов из 3.4).
- [ ] 7.2 Summary: средний compliance, compliance by agent, топ хронически отсутствующих SKU (cap выборки ~5000 строк, кэш 60с).
- [ ] 7.3 Perfect-Store leaderboard по магазинам (дедуп «последний скан на магазин», grade-бейджи, счётчик неатрибуцированных).
- [ ] 7.4 Страница чеков планограмм со ссылками на ИИ-сканы.
- [ ] 7.5 Фотогалерея с ревью (approve/reject, batch) — если нужен ревью-контур.

### Эпик 8 — Чеки/вердикты + фото-ревью (закрытие контура «человек проверяет ИИ»)
- [ ] 8.1 Human-review путь обязателен (точность ИИ 80–95%, не 100): ручная разметка (3.3) + человеческий вердикт (6.7) — это и есть fallback.
- [ ] 8.2 Статусная модель фото PENDING/APPROVED/REJECTED + причины reject.

### Эпик 9 — Обучение собственной модели (v2, опционально)
- [ ] 9.1 Экспорт разметки (MANUAL+CONFIRMED) в **COCO**: нормализованный bbox → пиксельный (нужны реальные размеры изображений), категория = SKU, уникализация имён категорий, валидация до экспорта.
- [ ] 9.2 Стейт-машина прогона DRAFT→UPLOADING→UPLOADED→TRAINING→READY→DEPLOYED (+FAILED), CAS-переходы, reaper зависших (30 мин).
- [ ] 9.3 Активная модель per-org (`activeModel` в настройках) — DEPLOYED версия начинает применяться без редеплоя; поле держать провайдер-нейтральным (`modelRef`), не привязываться к вендору.
- [ ] 9.4 Петля данных: AUTO-детекции → человек подтверждает (CONFIRMED) → следующий датасет. Рекомендация из прод-опыта: для старта — детектор одного класса «product» (локализация) + VLM для называния; per-SKU классы — когда накопится 100–300 изображений на SKU.
- [ ] 9.5 Если self-hosted детектор: контракт `POST /detect {image_base64|image_url, model?} → {detections:[{label,bbox,confidence}], model_version}`, таймаут 20с, деградация с алертом (не молча).

### Эпик 10 — OCR ценников (v2, опционально; фиче-флаг, дефолт OFF)
- [ ] 10.1 Чтение ценников по промпт-контракту из 2.5 (или свой OCR), привязка к товару по ближайшему bbox-центру (радиус 0.2), промо-детекция (перечёркнутая/два числа → меньшее = промо).
- [ ] 10.2 Персист wipe-then-write per photo (идемпотентно), price-compliance по формуле 2.6 (tolerance 0.5%), сверка промо-цены с активными акциями, если есть промо-модуль.

### Эпик 11 — Антифрод фото (v2, опционально)
- [ ] 11.1 Проверка качества (не-полка/размытость/темнота) → REJECT с причиной + возможность override.
- [ ] 11.2 EXIF-форензика (GPS против координат магазина ≤100м, watermark-теги, clock drift), burst-детекция (>5 фото/30с), tampering → форс на ручное ревью (false-positive-safe: отсутствие EXIF — не фрод).

---

## 4. Что НЕ переносить (осознанно)

- LeadDrive-специфика: RLS-обёртки, tenant-capability биллинг (`planogram-shelf-execution`), AI-советник и его сигналы, help-центр/видео, i18n-механика LeadDrive.
- Второй скорер `src/lib/consumer-goods/planogram-scorer.ts` — это отдельный TPM-модуль (RetailExecutionAudit), к этому модулю отношения не имеет.
- Roboflow-специфичные интеграции — только как референс (LeadShelf получает провайдер-нейтральные контракты).

---

## 5. Задачи по удалению модуля из LeadDrive (после запуска LeadShelf)

⚠️ Модуль live на проде (mars-тенант). Порядок: сначала LeadShelf работает, потом вырезание. Шаг 5.7 (дроп таблиц с данными) — **разрушительный, только по явному решению владельца** и после бэкапа/выгрузки данных Mars.

- [ ] 5.1 **Выключить capability** `planogram-shelf-execution` у тенантов (soft-disable уже поддержан) + флаги `MTM_SHELF_BACKSTOP_ENABLED=0`, `MTM_PRICE_OCR_ENABLED=0`; снять cron-тики `mtm-shelf-backstop` и `mtm-training-reaper` из планировщика.
- [ ] 5.2 **UI**: удалить страницы `/mtm/{planograms,planogram-checks,shelf-analytics,photos,model-training}` + компоненты `golden-reference-editor`, `shelf-annotator`, `shelf-builder`, `perfect-store-leaderboard`; убрать 4 пункта из `nav-items.ts` (`mtmPhotos`, `mtmShelfAnalytics`, `mtmPlanograms`, `mtmPlanogramChecks`). `/mtm/leaderboard` (геймификация) и `/mtm/alerts` — НЕ трогать.
- [ ] 5.3 **API**: удалить `api/v1/mtm/{planograms,planogram-checks,shelf-analytics,model-training,photos}` + mobile-аналоги (`mobile/shelf-analytics/*`, `mobile/planogram-checks`, `mobile/customers/[id]/planograms`, `mobile/planograms/[id]/golden-reference/upload`) + `api/cron/{mtm-shelf-backstop,mtm-training-reaper}`.
- [ ] 5.4 **Библиотеки**: `src/lib/shelf-analysis/**` целиком; `src/lib/mtm/{shelf-backstop,shelf-backstop-processor,shelf-scan-response,shelf-leaderboard,golden-photo,photo-category,photo-quality,photo-watermark,inline-scan-*,price-ocr,sku-draft-from-label,model-training-access}`; очередь `shelf-analysis` из `queue/queues.ts` + `queue/worker.ts` + `queue/jobs/shelf-analysis.ts`. (Фото-подсистему `photos`/watermark оставить, если фото используются вне анализа полок — решить при вырезании.)
- [ ] 5.5 **AI-советник** (правка, не удаление): из `signals.ts` убрать `buildPhotoSignals/buildPlanogramCheckSignals/buildShelfExecutionSignals` + `flagShelfIssueAction`; из `execution.ts`/`autonomy.ts`/`action-preview.ts` — action-типы `flag_shelf_issue`/`shelf_issue`/`planogram_issue`; из `service.ts` — маршрутизацию shelf/planogram и entityType-маппинги; из `capabilities.ts` — запись `mtm`; из виджетов `advisor-record-widget`/`advisor-center-widgets` — ветки `mtm_shelf_analysis`/`mtm_planogram_check`/`mtm_photo`.
- [ ] 5.6 **Конфиг/справочники**: `tenant-capabilities.ts` (+access, +demos) — capability и хелпер; `entity-fields.ts` — сущности `mtm_planogram_check`, `mtm_shelf_analysis`; i18n — namespaces `mtmPlanogramsPage`(53), `mtmShelfAnalyticsPage`(39), `mtmPhotosPage`(30), `mtmPlanogramChecksPage`(29), `mtmShelf`(10), nav/navDesc по 4 ключа, `fieldPermissions` 10 ключей — ×3 локали, затем `node scripts/check-translations.js`; help-контент 8 слагов + `registry.ts` + `video-assets.ts`; сид `scripts/seeds/mars-planogram-test.mjs`.
- [ ] 5.7 **БД (разрушительно, отдельное решение владельца)**: выгрузка/бэкап данных Mars → миграция drop: `mtm_planogram_slots`, `mtm_planogram_checks`, `mtm_shelf_annotations`, `mtm_model_training_runs`, `mtm_shelf_analyses`, `mtm_photo_prices`, `mtm_planograms` (+ enum'ы, + relation `annotations` из `MtmSku`, + relation `analysis`/`prices`/`annotations` из `MtmPhoto`); `mtm_photos` — оставить (общая для MTM); `mtm_skus`/`mtm_sku_categories` — **НЕ трогать** (каталог общий с заказами/промо/стоками). Обновить RLS-скрипты: `scripts/rls/*-batch-6.sql` (mtm_planogram_slots) удалить, из batch-3 убрать дропнутые таблицы; прогнать `python3 scripts/rls/find-context-gaps.py` (0 gaps).
- [ ] 5.8 **Тесты**: удалить ~77 файлов модуля (список зафиксирован в аудите; `api-mtm-photos` и `lib-mtm-photo-watermark-*` — только если удаляется и фото-подсистема). Плюс **правки в общих тестах и моках** (не удалять): `src/__tests__/mocks/mtm-prisma.ts` (вычистить shelf-модели), `tenant-capabilities.test.ts`, `tenant-capability-access.test.ts`, `api-admin-tenant-capabilities.test.ts`, `entity-fields.test.ts`, `lib-module-catalog.test.ts`, `help-video-assets.test.ts`, `lib-ai-advisor-*`, `lib-middleware.test.ts`. `npm test` сверить с базлайном, `npx tsc --noEmit`, `npm run build`.
- [ ] 5.9 **Скрипты и сиды advisor'а**: `scripts/seeds/advisor-demo.mjs` (сеет shelf-сигналы), `scripts/check-advisor-qa-readiness.mjs`, `scripts/advisor-enterprise-smoke.mjs`, `scripts/audit-tenant-capabilities.mjs` — убрать planogram/shelf-ветки; финальная проверка `grep -ri 'planogram|shelf' src/ scripts/` на осиротевшие ссылки.
- [ ] 5.10 **Uploads-proxy**: в `src/app/api/v1/uploads/[...path]/route.ts` убрать ветку раздачи `mtm-golden/<orgId>/…` (org-scoped guard F-41); lookup по `mtm_photos` остаётся, пока живы фото.
- [ ] 5.11 **Env/доки**: убрать `ROBOFLOW_*`, `MTM_DETECTOR_*`, `GOLDEN_EMBEDDER`, `VOYAGE_API_KEY`, `MTM_SHELF_BACKSTOP_*`, `MTM_PRICE_OCR_ENABLED`, `GOOGLE_VISION_API_KEY` с прода; заархивировать `docs/mtm-shelf-*`, `docs/mtm-image-recognition-spec.md`, `docs/mtm-golden-reference-layout.md`, `docs/mtm-fmcg-gap-analysis.md`; вычистить упоминания из `CLAUDE.md`, roadmap, `mars-overseas-tasks.json`, help-video доков.
- [ ] 5.12 Прод-чистка: удалить каталоги `public/uploads/mtm-golden/` (после бэкапа), PM2/cron-конфиги backstop. Помнить про PWA-кэш: после деплоя пользователи могут видеть старое меню из service worker'а — это не баг деплоя (лечится жёстким обновлением).

---

## 6. Ключевые уроки прод-эксплуатации (чтобы LeadShelf не наступил на те же грабли)

1. **VLM плохо локализует** (боксы приблизительные, особенно на плотных/бликующих полках) — читает label'ы отлично. Идеал: детектор локализует, VLM/классификатор называет. Три итерации промптов упёрлись в потолок — дальше только обученный детектор.
2. **Недетерминизм = недоверие**: одна и та же полка давала 75%→50% между прогонами, пока не появились temperature 0 и детерминированный эмбеддинг-путь golden. Для «одно фото → всегда один скор» нужен неслучайный путь.
3. **Дубликаты детекций суммировать по facings** — иначе ложные 100%/ложные OOS (реальный прод-баг).
4. **Manual-wins везде**: человеческая разметка не должна перезаписываться автоанализом ни в какой гонке.
5. **Persist-first + идемпотентность + backstop** для мобильного скана: телефоны теряют сеть, ИИ таймаутит — результат не должен теряться.
6. **Не блокировать человека**: все ИИ-подсказки (off-brand, low-confidence, drift) — предупреждения с решением за человеком, не запреты.
7. **Parse-fail ИИ ≠ нулевой скор**: сломанный ответ модели не персистится (иначе дашборд отравлен ложными 0%).
8. NMS-детекторы сливают соседние одинаковые фейсинги (Pepsi×3 → 1 бокс) — для подсчёта фронтов нужен NMS-free детектор (RF-DETR-класс) либо VLM-подсчёт facings.
