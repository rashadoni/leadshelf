# MTM Image Recognition / Shelf AI — Спецификация

> **Связано с:** [`mars-overseas-roadmap.md`](./mars-overseas-roadmap.md) Задачи 3.1, 3.2, 3.3
> **Версия:** 1.1 draft, 2026-05-21 (plan-update after Perplexity research)
> **Цель:** дать парность с главной фичей effie — AI-анализ фотографий полки на предмет SKU, share of shelf, OOS, planogram compliance, share of display, OSA trend, eye-level detection.

---

## 1. Контекст

effie позиционирует AI image recognition как ключевую ценность. На слайде 7 их презентации показана таблица с потерями продаж в штуках и процентах — это результат именно автоматического анализа полки.

У них **10+ лет накопленного датасета FMCG**. Мы не догоним это за 4 месяца. Стратегия:
- **Phase 3 (now):** **3-tier hybrid pipeline** — Roboflow как primary detector на 100% фото (быстро, дёшево, 85-92% точность), Claude Vision как exceptions-handler для low-confidence (5-10% фото), Google Vision API для OCR ценников. Подробности в §2.
- **Phase 5 (через 6+ мес эксплуатации):** обучить собственный YOLO на накопленном датасете фотографий Mars Overseas → заменяет Roboflow на Tier 1.

### Plan-update 2026-05-21 (v1.0 → v1.1)
Предыдущая версия предлагала Claude Vision как primary для всех 15400 фото/мес — это $300/мес и латентность 5-15с на фото. Research показал что Claude Vision одинаково точен с Roboflow на counting facings, но **в 5x дороже и в 30x медленнее**. Reasoning capabilities Claude (его сильная сторона) пропадают на простой задаче подсчёта — её лучше делает специализированный детектор. Поэтому Claude переходит в exception-tier, где его сильная сторона (multi-modal reasoning + narrative explanation спорных кейсов) действительно полезна.

**User decisions 2026-05-21** (после architect review):
1. **M3-4 OCR ценников → deferred to Phase 4** (в `mars-overseas-tasks.json` переименованы в `M4-PRICE-a` и `M4-PRICE-b`). §13 spec остаётся документацией будущей фичи. Pitch positioning: «Phase 4 premium — pricing intelligence vs competitor».
2. **Roboflow custom training $3-5K one-time approved** → новая блокирующая задача `M3-PRE-1` (приоритет 48) перед M3-1b. Pre-trained Roboflow Universe models покрывают глобальные бренды (Pepsi/Coca-Cola crown logos), но regional SKU (азербайджанская упаковка, кириллица на этикетках) — out-of-distribution. Точная просадка точности неизвестна до baseline (community evidence anecdotal), но архитектор и наш analyst-call единодушно flagged this as a кickоff blocker.
   - **Pre-requisite (non-code gate):** NDA + Mars IP-rights clearance to share photos with Roboflow workforce — hard gate before $3-5K spend. Captured in `M3-PRE-1` rationale in `mars-overseas-tasks.json`; mirrored here so doc-only readers don't miss it.

---

## 2. Архитектура (3-tier hybrid)

```
┌──────────────────────┐
│  Mobile App          │
│  PhotoCaptureModal   │
└──────────┬───────────┘
           │ multipart upload (with M1-2 watermark + EXIF)
           ▼
┌──────────────────────┐       ┌──────────────────────┐
│  API: /mtm/photos    │──────▶│  S3-compatible       │
│  POST                │       │  storage (MinIO/R2)  │
└──────────┬───────────┘       └──────────────────────┘
           │ enqueue job
           ▼
┌──────────────────────────────────────────────────────────┐
│  Tier 0 (M3-0):  Photo quality pre-check                 │
│  Roboflow binary classifier "is this a shelf?"           │
│  → если нет: status=REJECTED, anomaly audit (M3-5)       │
│  → если да: продолжаем                                    │
└──────────┬───────────────────────────────────────────────┘
           ▼
┌──────────────────────────────────────────────────────────┐
│  Tier 1 (M3-1b):  PRIMARY detector — RoboflowProvider    │
│  100% фото проходящих Tier 0                              │
│  ~200-500ms latency, ~$0.005/image, 85-92% accuracy       │
│  Output: detectedSkus[] + per-SKU confidence              │
└──────────┬───────────────────────────────────────────────┘
           │
           │  if min(confidence) < 0.7  OR  planogram_mismatch > 30%
           │  OR  customer.category == 'A' (top 20%)
           │  → routing to Tier 2:
           ▼
┌──────────────────────────────────────────────────────────┐
│  Tier 2 (M3-2):  EXCEPTIONS — ClaudeVisionProvider       │
│  ~5-10% фото (low-confidence или high-value)             │
│  ~5-15s latency, ~$0.03/image, multimodal reasoning       │
│  Input: photo + Roboflow's primary detect + known-SKU list│
│  Output: corrected counts + narrative ("Pepsi обычно 30%, │
│          сейчас 70% — необычно") + final confidence       │
└──────────┬───────────────────────────────────────────────┘
           │
           │  if Tier-2 confidence still < 0.5  OR  manual review requested
           ▼
┌──────────────────────────────────────────────────────────┐
│  Tier 3:  Human QA in Web admin /mtm/shelf-analytics/    │
│  Supervisor approves/rejects → feeds retraining pipeline │
└──────────┬───────────────────────────────────────────────┘
           ▼
┌──────────────────────────────────────────────────────────┐
│  MtmShelfAnalysis row in PostgreSQL                      │
│  + Push notification to mobile                            │
│  + Metrics row in computed aggregates                     │
└──────────────────────────────────────────────────────────┘
```

### Бюджет на 15400 фото/мес (100 фото × 7 reps × 22 дня)
| Tier | Доля | Provider | Стоимость |
|---|---|---|---|
| 0 (quality) | 100% | Roboflow binary classifier | ~$15/мес |
| 1 (detect) | ~85% (после reject в Tier 0) | RoboflowProvider | ~$65/мес |
| 2 (exceptions) | ~5-10% от Tier 1 | Claude Sonnet 4.5 Vision | ~$45/мес |
| OCR (M3-4 → see §13: deferred, renamed M4-PRICE-a/b) | ~10% (только photos с ценниками) | Google Vision API | ~$3/мес |
| **Итого** | | | **~$128/мес** |

Сравнение с предыдущей версией спеки (Claude как primary на 100%): **~$300+/мес**. Экономия **>$170/мес** + латентность 95% фото < 1с.

### ⚠️ One-time custom training cost (NOT в monthly budget)
Roboflow's pre-trained FMCG-models покрывают **глобальные** бренды (Pepsi/Coca-Cola crown logos), но **не знают** локальных бутылок и упаковки Mars Overseas (азербайджанские варианты, региональные размеры, кириллица на этикетках). До production-pilot нужно **минимум один раунд custom training**:
- Разметка: **~500 фото** из demo-tenant'а Mars Overseas, **~20 bboxes на фото** = 10 000 аннотаций
- Стоимость аннотации: Roboflow Annotate **$0.30/bbox** = **~$3 000 one-time** (либо ~$1 500 на Scale AI / Toloka если получится снизить unit-cost)
- Тренировка через Roboflow UI: ~$200-500 GPU time
- **Итого one-time:** **$3 200 - $5 000**

Этот бюджет — отдельно от $128/мес inference. Дополнительный раунд training через 3 месяца pilot (когда соберём ещё 50 000 фото от реальных reps) — opcjionally, ~$2 000.

---

## 3. Prisma schema

```prisma
model MtmShelfAnalysis {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  photoId        String   @unique
  photo          MtmPhoto @relation(fields: [photoId], references: [id], onDelete: Cascade)

  status         MtmShelfAnalysisStatus @default(PENDING)
  provider       String   // 'roboflow', 'claude', 'google-vision', 'custom-yolo'

  // Raw detection result
  detectedSkus   Json     // [{skuId, label, confidence, bbox: [x,y,w,h], facings}]

  // Computed metrics
  totalFacings   Int      @default(0)
  shareOfShelf   Json?    // {"Pepsi": 33, "Coca-Cola": 22, ...}
  oosCount       Int      @default(0)
  oosList        Json?    // [{skuId, expectedFacings}]
  planogramId    String?
  planogram      MtmPlanogram? @relation(fields: [planogramId], references: [id], onDelete: SetNull)
  complianceScore Float?  // 0-100 (vs planogram, null if no planogram)

  // Process metadata
  startedAt      DateTime?
  completedAt    DateTime?
  errorMessage   String?
  costCents      Int?     // API cost tracking
  modelVersion   String?  // for reproducibility

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([organizationId])
  @@index([photoId])
  @@index([status])
  @@map("mtm_shelf_analyses")
}

enum MtmShelfAnalysisStatus {
  PENDING       // queued, not yet picked up
  PROCESSING    // worker has it
  COMPLETED     // Tier 1 (or Tier 2) finished successfully
  FAILED        // worker hit an error (API down, parse fail, etc.)
  REJECTED      // M3-0 photo quality pre-check rejected the image (not a shelf)
}

// Эталонная планограмма для категории полки
model MtmPlanogram {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  name           String
  description    String?
  customerCategory MtmCustomerCategory?  // только A, или для всех
  referenceImageUrl String?
  expectedSkus   Json     // [{skuId, expectedFacings, position}]

  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  analyses       MtmShelfAnalysis[]

  @@index([organizationId])
  @@map("mtm_planograms")
}
```

### Изменения в MtmPhoto
```prisma
model MtmPhoto {
  // ... существующие поля ...
  shouldAnalyze  Boolean  @default(false)  // mark for AI
  analysis       MtmShelfAnalysis?
}
```

---

## 4. Backend: Provider Adapter pattern

`src/lib/shelf-analysis/`:
```
shelf-analysis/
├── index.ts              # main entry point + getProvider()
├── types.ts              # ShelfAnalysisProvider interface, AnalysisResult, DetectedSku
├── providers/
│   ├── roboflow.ts       # RoboflowProvider
│   ├── claude.ts         # ClaudeVisionProvider — использует @anthropic-ai/sdk (уже стоит)
│   ├── google-vision.ts  # GoogleVisionProvider
│   └── mock.ts           # для тестов
├── metrics.ts            # computeShareOfShelf, computeOos, computeCompliance
└── queue.ts              # BullMQ worker
```

### Interface
```typescript
export interface ShelfAnalysisProvider {
  name: string;
  analyze(input: AnalysisInput): Promise<AnalysisResult>;
}

export interface AnalysisInput {
  imageUrl: string;
  organizationId: string;
  expectedSkus?: ExpectedSku[];  // если есть планограмма
  customSkuList?: string[];  // ограничить распознавание известными SKU
}

export interface AnalysisResult {
  provider: string;
  modelVersion: string;
  detectedSkus: DetectedSku[];
  rawResponse: any;
  costCents: number;
}

export interface DetectedSku {
  skuId?: string;       // если матчится с нашим каталогом
  label: string;
  confidence: number;
  facings: number;
  bbox: [number, number, number, number];
}
```

### ClaudeVisionProvider (preferred — реюз уже подключённого SDK)
```typescript
// Концептуально
async analyze(input) {
  const knownSkus = await getKnownSkus(input.organizationId);
  const skuListPrompt = knownSkus.map(s => `${s.code}: ${s.name} (${s.brand})`).join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'url', url: input.imageUrl } },
        {
          type: 'text',
          text: `Analyze this retail shelf photo. Known SKUs in this organization:\n${skuListPrompt}\n\nFor each visible SKU, return JSON: {detectedSkus: [{skuId, label, confidence, facings, bbox}]}. Confidence 0-1. Facings = number of product fronts visible. bbox = [x,y,w,h] in 0-1 normalized coords.`
        }
      ]
    }]
  });
  // parse JSON from response
}
```

### Стоимость per request
- **Roboflow:** ~$0.005 per image — PRIMARY (Tier 1, 100% photos that pass Tier 0)
- **Claude Sonnet 4.5 vision:** ~$0.01-0.03 per image — EXCEPTIONS (Tier 2, ~5-10% of Tier 1)
- **Google Vision OCR:** ~$0.0015 per image — PRICE TAGS (M3-4 → see §13: deferred, renamed M4-PRICE-a/b)

При 100 фото/день × 7 reps × 22 рабочих дня = **15400 фото/мес** (см. бюджет в §2).

**Рекомендация для пилота (plan-update 2026-05-21):** Roboflow primary + Claude exceptions, не Claude only. Roboflow с pre-trained FMCG model + custom training pipeline даёт сравнимую с Claude точность на counting facings (85-92% vs 70-85%) в 5x дешевле и 30x быстрее. Claude используется там где его reasoning capabilities действительно нужны — на спорных кейсах, низкоуверенных детекциях и top-20% клиентов.

---

## 5. Queue worker

`src/lib/shelf-analysis/queue.ts`:
```typescript
import { Worker } from 'bullmq';

const worker = new Worker('shelf-analysis', async (job) => {
  const { photoId } = job.data;

  // 1. Load photo + check
  const photo = await prisma.mtmPhoto.findUnique({ where: { id: photoId } });
  if (!photo || !photo.shouldAnalyze) return;

  // 2. Update status
  await prisma.mtmShelfAnalysis.upsert({
    where: { photoId },
    create: { photoId, organizationId: photo.organizationId, status: 'PROCESSING', startedAt: new Date() },
    update: { status: 'PROCESSING', startedAt: new Date() }
  });

  // 3. Tier 0 — photo quality pre-check (M3-0)
  const quality = await getProvider('quality-classifier').analyze({ imageUrl: photo.url });
  if (quality.detectedSkus[0]?.label !== 'shelf' || quality.detectedSkus[0]?.confidence < 0.6) {
    await prisma.mtmShelfAnalysis.update({
      where: { photoId },
      data: { status: 'REJECTED', errorMessage: 'photo_quality_fail', completedAt: new Date() },
    });
    // Anomaly audit (M3-5) — let supervisors see it
    return;
  }

  // 4. Tier 1 — primary detector (M3-1b: RoboflowProvider)
  const tier1 = getProvider('roboflow');
  const customer = await prisma.mtmCustomer.findFirst({ /* via photo.visit */ });
  let result;
  try {
    result = await tier1.analyze({ imageUrl: photo.url, organizationId: photo.organizationId });

    // 4a. Tier 2 — exceptions routing (M3-2).
    //
    // Category-aware density guard: a flat `detectedCount > 5` threshold
    // would silently skip Tier-2 for category C/D corner stores where
    // shelves legitimately have 3-4 SKUs — exactly the small stores
    // where weird/non-standard shelves are MOST likely and Claude's
    // reasoning is MOST valuable. Use a per-category floor:
    //   A: >= 5  (typical sales-rich shelf, plenty of SKUs)
    //   B: >= 4
    //   C: >= 3
    //   D: >= 2  (corner store, sparse is normal)
    const minConf = result.detectedSkus.length > 0
      ? Math.min(...result.detectedSkus.map(s => s.confidence))
      : 0
    const detectedCount = result.detectedSkus.length
    const categoryFloor: Record<string, number> = { A: 5, B: 4, C: 3, D: 2 }
    const floor = categoryFloor[customer?.category ?? 'B'] ?? 4
    const hasEnoughSkus = detectedCount >= floor
    const planogramMismatch = await getPlanogramMismatch(result.detectedSkus, customer)
    const isTopCustomer = customer?.category === 'A'
    const wantsTier2 =
      (minConf < 0.7 && hasEnoughSkus) ||
      (planogramMismatch > 0.30 && hasEnoughSkus) ||
      isTopCustomer
    if (wantsTier2) {
      const tier2 = getProvider('claude');
      const corrected = await tier2.analyze({
        imageUrl: photo.url,
        organizationId: photo.organizationId,
        priorResult: result, // Claude получает первичный детект от Roboflow как контекст
      });
      result = corrected; // overwrite with Claude's reviewed output
    }

    // 5. Compute metrics
    const metrics = computeMetrics(result.detectedSkus, photo.organizationId);

    // 6. Save
    await prisma.mtmShelfAnalysis.update({
      where: { photoId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        provider: providerName,
        modelVersion: result.modelVersion,
        detectedSkus: result.detectedSkus,
        totalFacings: metrics.totalFacings,
        shareOfShelf: metrics.shareOfShelf,
        oosCount: metrics.oosCount,
        oosList: metrics.oosList,
        complianceScore: metrics.complianceScore,
        costCents: result.costCents
      }
    });

    // 7. Notify mobile
    await sendPushNotification(photo.agentId, {
      title: 'Анализ полки готов',
      body: `${metrics.totalFacings} товаров, ${metrics.oosCount} отсутствуют`,
      data: { photoId, type: 'shelf_analysis_complete' }
    });
  } catch (e) {
    await prisma.mtmShelfAnalysis.update({
      where: { photoId },
      data: { status: 'FAILED', errorMessage: String(e), completedAt: new Date() }
    });
  }
}, { connection: redis, concurrency: 5 });
```

### Trigger
В `POST /api/v1/mtm/photos`:
```typescript
// после сохранения photo
if (photo.category === 'shelf') {
  await prisma.mtmPhoto.update({ where: { id: photo.id }, data: { shouldAnalyze: true }});
  await shelfAnalysisQueue.add('analyze', { photoId: photo.id }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 }});
}
```

---

## 6. Planogram compliance

### Web admin
`/mtm/planograms/` — список + создание

Создание планограммы:
1. Загрузить эталонное фото
2. UI разметки: bbox + связь с SKU (drag-drop из каталога)
3. Сохранить с `expectedSkus`

### Auto-detect planogram для каждого фото
- При анализе — определить customerCategory из связанного `MtmVisit.customer.category`
- Найти `MtmPlanogram` для этой категории
- Сравнить detected vs expected → `complianceScore`

### Метрика compliance
```typescript
function computeCompliance(detected: DetectedSku[], expected: ExpectedSku[]): number {
  if (!expected.length) return null;

  const detectedMap = new Map(detected.map(d => [d.skuId, d.facings]));
  let score = 0;

  for (const exp of expected) {
    const actualFacings = detectedMap.get(exp.skuId) || 0;
    if (actualFacings >= exp.expectedFacings) {
      score += 1;  // полное соответствие
    } else {
      score += actualFacings / exp.expectedFacings;
    }
  }

  return (score / expected.length) * 100;
}
```

---

## 7. Mobile UI

### После загрузки фото
- На экране визита — список загруженных фото со статусом badge: «⏳ Анализируется», «✅ Готово», «⚠️ Ошибка»
- Кнопка «Open analysis» → новый экран `ShelfAnalysisResultScreen`
- На экране:
  - Оригинальное фото с bbox overlay по каждому detected SKU
  - Список detected SKU с counts
  - Share of shelf карточка
  - OOS list — «Не хватает: Pepsi 1.5L, 7UP 0.5L»
  - Compliance score если планограмма привязана

### Push notification
- При completion — push «Анализ полки готов: 12 SKU обнаружено, 3 отсутствуют»

---

## 8. Admin dashboard

`/mtm/shelf-analytics/`:
- Filter: agent, customer, date range, category
- Графики:
  - Trend OSA: % фото без OOS по дням
  - Share of shelf динамика наших vs конкурентов
  - Compliance score по агентам и по магазинам
  - Heatmap: какие SKU чаще всего OOS
- Drill-down: клик по фото → детальный экран

`/mtm/shelf-analytics/[id]` — детальный анализ конкретного фото

---

## 9. Custom YOLO (Phase 5, отложено)

Когда у нас будет 6+ месяцев датасета (15400 × 6 = ~92000 фото) Mars Overseas:
1. **Разметка:** аутсорсинг через Roboflow Annotate или Scale AI (~$0.10-0.30 per bbox)
2. **Тренировка:** YOLOv11 на размеченных данных, ~$200-500 на GPU обучение
3. **Деплой:** ONNX export → Triton Inference Server или TensorFlow Serving в нашей инфре
4. **Стоимость:** ~$50-100/мес на serverless GPU vs $200-300/мес на Claude API при той же нагрузке

**Когда переходить:** когда:
- На датасете 50k+ размеченных фото
- Точность custom model > Claude API на validation set
- Объём фото такой, что ROI = разница в стоимости > 6 месяцев бюджета на разработку

---

## 10. Acceptance criteria

### M3-0 — photo quality pre-check
- [ ] Roboflow binary classifier `is_shelf` развёрнут и принимает фото
- [ ] Latency p95 ≤ 300ms
- [ ] Recall ≥90% на класс `shelf` (не пропускаем нормальные)
- [ ] Precision ≥80% на класс `not_shelf` (не отклоняем нормальные)

### M3-1a..d — primary detection (Roboflow)
- [ ] Фото shelf автоматически попадает в очередь анализа после Tier 0
- [ ] Анализ Tier 1 завершается за ≤2 сек в 95% случаев
- [ ] Detected SKU матчатся с нашим каталогом по brand/name fuzzy match ≥80%
- [ ] Share of shelf считается корректно (manual sample 20 фото, error < 15%)
- [ ] OOS list содержит все ожидаемые SKU, которых нет на фото
- [ ] UI на mobile показывает результат с bbox overlay

### M3-2 — Claude exceptions
- [ ] Confidence-routing logic работает: `(min(conf)<0.7 AND detectedCount>5) OR (planogram_mismatch>30% AND detectedCount>5) OR customer.category='A'` → Tier 2 (легитимные пустые полки не блочат бюджет)
- [ ] ≤10% всех фото попадают на Tier 2 после первой недели pilot (если выше — overcost alert + ревизия threshold'ов)
- [ ] Claude получает `priorResult` от Roboflow в prompt и improves output
- [ ] Сравнение **measured first week** на ≥40 routed фото: low-confidence rate Tier 1 = X% → после Claude review = Y%. Зафиксировать X и Y в `docs/mars-overseas-discovery-notes.md`. Acceptance: Y < X (Claude действительно помогает, не просто дорогой co-pilot)

### M3-3a/b — planogram + расширенные метрики
- [ ] Админ может создать планограмму с 10+ SKU и привязать к customerCategory
- [ ] Compliance score автоматически рассчитывается для всех новых фото shelf
- [ ] **Share of display** считается по типу выкладки (main shelf / cooler / endcap)
- [ ] **OSA trend** — day-over-day OOS-rate график по магазину и по агенту
- [ ] **Eye-level** — для каждого detected SKU вычисляется shelf row (top/eye/bottom)
- [ ] На дашборде видна динамика всех 4 метрик

### M3-4 — OCR ценников (→ deferred to Phase 4 as M4-PRICE-a/b, see §13 note)
- [ ] Google Vision интегрирован, секреты в env
- [ ] При detection price-tag bbox → отрезается → OCR → парсится цена в AZN
- [ ] ≥85% точность OCR на manyочих ценниках Bravo/Bolmart/Araz
- [ ] Цена связывается с ближайшим detected SKU в ≥80% случаев

### M3-5 — visit anomaly
- [ ] 4 audit-actions добавлены: `PHOTO_NOT_A_SHELF`, `PHOTO_GPS_VS_CUSTOMER_MISMATCH`, `PHOTO_BURST_SUSPICIOUS`, `PHOTO_TIER0_OVERRIDDEN`
- [ ] Web UI `/mtm/shelf-analytics/` имеет фильтр «anomalies»
- [ ] `PHOTO_TIER0_OVERRIDDEN` пишется автоматически при каждом нажатии supervisor'ом «Override → analyze anyway» (M3-0 manual override path), без возможности отключить — закрывает inside-fraud bypass
- [ ] False-positive rate <10% на тестовом наборе

---

## 11. Out of scope (Phase 3)

- Custom-обученная ML-модель (Phase 5)
- Распознавание промо-материалов POSM (отдельно — потенциально расширение M3-3b)
- Сравнение с конкурентами по бренду глубже share-of-shelf (можно добавить, если получим brand mapping от Mars)

> **Plan-update 2026-05-21:** OCR ценников **больше не out-of-scope** — задача описана в §13. Note: после второго architect-pass renamed to `M4-PRICE-a/b` in tasks.json (Phase 4); see §13 banner for context.

---

## 12. Photo quality pre-check (M3-0)

### Зачем
В полях агенты случайно жмут shutter — получаются фото потолка, дашборда, ладони над объективом, размытые из-за движения. ~5-15% всех фото такие. Если они попадают на Tier 1 (Roboflow), это:
- Лишний расход бюджета (15% × $0.005 × 15400 = ~$12/мес впустую)
- Загрязняет share-of-shelf метрики (агент якобы посетил магазин, но фото = ничего)
- Создаёт false-positive OOS («полка отсутствует» → 100% OOS)

### Что делаем
**Простой binary classifier через Roboflow:**
- Класс «shelf» — фото содержит идентифицируемую полку магазина
- Класс «not_shelf» — всё остальное (потолок, ладонь, дашборд, размыто, темно)

Обучение: 500 labeled фото из demo-tenant'а Mars Overseas (~1 день разметки через Roboflow Annotate). Latency: <100ms. Стоимость: ~$0.001/image.

### Что делаем при reject
- `MtmShelfAnalysis.status = 'REJECTED'`
- `errorMessage = 'photo_quality_fail: <reason>'` (e.g. `blurry`, `dark`, `no_shelf_detected`)
- Анти-фрод аудит (см. M3-5) — фиксируем что агент сфоткал не магазин
- Mobile видит badge «фото отклонено» с возможностью переснять
- НЕ списываем визит — фото это proof of presence, отдельная сущность от check-in

### Visibility — rejected photos не теряются молча
Без отдельной метрики легко пропустить ситуацию «у агента 80% фото потолок — он либо стажёр, либо саботирует». Поэтому:
- **Aggregate metric:** `rejected_photo_count_per_rep_per_day` в `MtmAgentDailyStats` (или вычислять on-the-fly из `MtmShelfAnalysis.status='REJECTED'` + `agent.id` + day)
- **Supervisor alert:** если у любого rep'а >20% фото за день в `REJECTED` → notification «Agent X has 12/50 rejected photos today, review training or photo workflow»
- **Web admin фильтр:** `/mtm/shelf-analytics/?status=rejected` + список с миниатюрами и причиной reject — supervisor может manually approve если знает что reject false-positive
- **Manual override:** клик «Override → analyze anyway» в Web UI заводит фото в Tier 1 минуя Tier 0 (для случаев когда classifier ошибся на нестандартной полке)

### Acceptance
- ≥90% recall на класс `shelf` (мы НЕ пропускаем хорошие фото)
- ≥80% precision на класс `not_shelf` (если отклонили — действительно не полка)
- Latency p95 ≤ 300ms

---

## 13. OCR ценников (M3-4 → renamed M4-PRICE-a/b in tasks.json)

> **Note (2026-05-21 user decision):** task IDs in this section are kept as historical "M3-4" terminology in spec body for context, but the actual task tracker uses `M4-PRICE-a` (Prisma schema) and `M4-PRICE-b` (Google Vision integration) at priority 75 in Phase 4. When you `grep M3-4 mars-overseas-tasks.json` you won't find anything — that's intentional. The deferred-to-Phase-4 decision is in §1 changelog.

### Зачем
Mars Overseas хочет: «покажи мне цену Pepsi 0.5L в каждом магазине + цены конкурентов». Это конкретное **pricing intelligence**, продаётся отдельно как Premium-фича.

### Почему Google Vision (а не Claude / Roboflow)
- **Google Vision OCR:** $0.0015/image, 90%+ точность на печатном тексте даже мелким шрифтом, специально для retail-этикеток. Best-of-breed.
- **Roboflow:** умеет detect объект «ценник», но не читать текст с него (это OCR задача, не object detection).
- **Claude:** хорошо читает крупный текст, но fail-rate на мелком шрифте 4-6pt (стандарт ценников) ~30-50%. Дорого и неточно.

### Архитектура
Отдельный pipeline, не часть main shelf analysis:
1. Roboflow на Tier 1 кроме SKU детектит ещё bbox для price tags
2. Если price tag bbox найден → отрезаем эту область → Google Vision OCR
3. Парсим распознанный текст: regex для `\d+[.,]\d{2}\s*AZN` (Mars Overseas — Азербайджан)
4. Связываем с ближайшим detected SKU по координатам bbox
5. Сохраняем в `MtmPhotoPrice` (новая таблица — см. ниже)

### Prisma schema (для M3-4 — task tracker IDs: `M4-PRICE-a` / `M4-PRICE-b`)
> Subtask IDs `M3-4a` / `M3-4b` below are spec-internal historical naming; the actual `mars-overseas-tasks.json` uses `M4-PRICE-a` (Prisma schema) and `M4-PRICE-b` (Google Vision integration) at priority 75 in Phase 4. Same scope, just renamed for tracker.

- **M3-4a** (→ `M4-PRICE-a`) — Prisma модель `MtmPhotoPrice` + миграция (1 день)
- **M3-4b** (→ `M4-PRICE-b`) — OCR pipeline + Google Vision integration (2 дня)

```prisma
model MtmPhotoPrice {
  id             String   @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  photoId        String
  photo          MtmPhoto @relation(fields: [photoId], references: [id], onDelete: Cascade)

  // Optional link to the detected SKU this price tag is closest to
  // (bbox spatial match in OCR pipeline; null if no SKU within radius)
  skuId          String?
  sku            MtmSku? @relation(fields: [skuId], references: [id], onDelete: SetNull)

  // Source
  bbox           Json     // [x, y, w, h] in normalized coords
  rawOcrText     String   // what Google Vision returned, for audit
  ocrConfidence  Float    // 0-1 from Google Vision

  // Parsed
  priceValue     Decimal  @db.Decimal(10, 2)  // 12.34 in store currency
  currency       String   @default("AZN")
  isPromo        Boolean  @default(false)  // detected if price is struck-through

  createdAt      DateTime @default(now())

  @@index([organizationId])
  @@index([photoId])
  @@index([skuId])
  @@map("mtm_photo_prices")
}
```

### Acceptance
- ≥85% точность на манычих ценниках Bravo/Bolmart/Araz (тестовые)
- Цена правильно матчится с SKU в 80% случаев
- Phase 3 — only soft-drink products, OCR shelf-edge labels (не каталоги)

---

## 14. Visit anomaly detection (M3-5)

### Зачем
Anti-fraud feature. Использует M3-0 classifier output + GPS из M1-2 watermark. Закрывает 3 сценария:
1. **«Я сфоткал из машины»** — кадр содержит дашборд / зеркало / руль вместо полки → M3-0 reject + alert
2. **«GPS на 11км от магазина»** — EXIF GPS уже проверяется в M1-2 (`tamperingDetected`). Здесь мы добавляем cross-check: GPS-точка фото должна быть в радиусе ≤100м от `MtmCustomer.latitude/longitude`
3. **«Слишком много фото за минуту»** — агент стоит у магазина и шлёт 50 фото за раз чтобы создать иллюзию долгого визита → rate limit + flag

### Реализация
Reuse:
- M1-2 helper `haversineMeters` — для GPS distance check
- M3-0 classifier — для «is this even a shelf?»
- Существующий `MtmAuditLog` channel

Новые actions в `src/lib/mtm-audit.ts`:
- `PHOTO_NOT_A_SHELF` — Tier 0 reject
- `PHOTO_GPS_VS_CUSTOMER_MISMATCH` — расстояние >100м от заявленного клиента
- `PHOTO_BURST_SUSPICIOUS` — >5 фото за 30 секунд от одного агента
- `PHOTO_TIER0_OVERRIDDEN` — supervisor нажал «Override → analyze anyway» на M3-0 reject. Пишет `supervisor.id`, `photo.id`, `original_reject_reason`, timestamp. Защита от внутреннего bypass: если supervisor каждый день оверрайдит десятки рекжектов — это паттерн, видный в audit grep.

### Что видит супервайзер
В `/mtm/shelf-analytics/` появляется фильтр «anomalies» — список всех photos с открытыми anomaly events. Один клик → review screen.

### Acceptance
- Все 3 audit-actions пишутся при выполнении условий
- Web UI отображает badges «not a shelf» / «GPS mismatch» / «burst suspicious» на превью фото
- False-positive rate <10% (проверка на 50 фото от тестового агента)

---

## История изменений

| Дата | Версия | Изменение |
|---|---|---|
| 2026-05-21 | v1.0 | Создан |
| 2026-05-21 | v1.1 | **Plan-update** после Perplexity research: 3-tier hybrid (Roboflow primary + Claude exceptions), новые задачи M3-0 (quality pre-check), M3-4 (OCR — later deferred to Phase 4 as `M4-PRICE-a/b`, see §1), M3-5 (anomaly detection), расширен M3-3b (share-of-display + OSA trend + eye-level). См. §1 changelog inline. |
