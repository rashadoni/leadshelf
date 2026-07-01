# MTM SKU Catalog & Order Capture — Спецификация

> **Связано с:** [`mars-overseas-roadmap.md`](./mars-overseas-roadmap.md) Задача 1.3 + 2.2
> **Версия:** 1.0 draft, 2026-05-21
> **Цель:** дать торговому агенту в мобильном приложении полноценный каталог SKU с ценами/промо/остатками для сбора заказов на точке.

---

## 1. Контекст

Сейчас `MtmOrder.items` хранит JSON произвольной структуры — это не позволяет:
- Связать позицию с фактическим SKU
- Считать промо-логику и скидки
- Контролировать остатки на складах
- Делать аналитику «топ продаваемых SKU», «упущенные продажи»

Mars Overseas — Pepsi-боттлер. Их каталог: ~200–500 SKU (напитки разных объёмов + Lay's snacks). Несколько складов в Баку, Гяндже, других регионах.

---

## 2. Prisma schema — новые модели

```prisma
// Категория товаров (Напитки / Снеки / Соки / Кофе и т.д.)
model MtmSkuCategory {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  parentId       String?
  parent         MtmSkuCategory? @relation("CategoryHierarchy", fields: [parentId], references: [id], onDelete: SetNull)
  children       MtmSkuCategory[] @relation("CategoryHierarchy")
  name           String
  nameAz         String?
  nameEn         String?
  code           String?
  iconUrl        String?
  sortOrder      Int          @default(0)
  isActive       Boolean      @default(true)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  skus           MtmSku[]

  @@unique([organizationId, code])
  @@index([organizationId])
  @@map("mtm_sku_categories")
}

// Сам товар
model MtmSku {
  id             String         @id @default(cuid())
  organizationId String
  organization   Organization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  categoryId     String?
  category       MtmSkuCategory? @relation(fields: [categoryId], references: [id], onDelete: SetNull)

  code           String         // артикул, например "PEPSI-0.5-PET"
  externalId     String?        // ID в 1С / SAP
  barcode        String?        // EAN-13

  name           String
  nameAz         String?
  nameEn         String?
  description    String?

  brand          String?        // Pepsi, Mirinda, Lay's
  unit           String         @default("шт")  // шт, ящик, кг
  packSize       Int            @default(1)     // сколько штук в пачке

  basePrice      Decimal        @db.Decimal(10, 2)
  currency       String         @default("AZN")

  imageUrl       String?
  thumbnailUrl   String?

  isActive       Boolean        @default(true)
  weight         Float?         // граммы — для логистики
  volumeMl       Int?           // мл — для напитков

  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  prices         MtmSkuPrice[]
  stockLevels    MtmSkuStock[]
  orderItems     MtmOrderItem[]
  promotions     MtmPromotionSku[]

  @@unique([organizationId, code])
  @@index([organizationId])
  @@index([categoryId])
  @@index([brand])
  @@map("mtm_skus")
}

// Цена SKU для категории клиента или сегмента
model MtmSkuPrice {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  skuId          String
  sku            MtmSku       @relation(fields: [skuId], references: [id], onDelete: Cascade)

  customerCategory MtmCustomerCategory? // A / B / C
  minQuantity    Int          @default(1)
  price          Decimal      @db.Decimal(10, 2)
  currency       String       @default("AZN")
  validFrom      DateTime?
  validTo        DateTime?

  createdAt      DateTime     @default(now())

  @@index([organizationId])
  @@index([skuId])
  @@map("mtm_sku_prices")
}

// Склад
model MtmWarehouse {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  name           String
  code           String
  address        String?
  isActive       Boolean      @default(true)
  stockLevels    MtmSkuStock[]
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@unique([organizationId, code])
  @@map("mtm_warehouses")
}

// Остатки SKU на складе
model MtmSkuStock {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  skuId          String
  sku            MtmSku       @relation(fields: [skuId], references: [id], onDelete: Cascade)
  warehouseId    String
  warehouse      MtmWarehouse @relation(fields: [warehouseId], references: [id], onDelete: Cascade)
  quantity       Int          @default(0)
  reservedQty    Int          @default(0)
  lastSyncedAt   DateTime?

  @@unique([skuId, warehouseId])
  @@index([organizationId])
  @@map("mtm_sku_stocks")
}

// Промоакция
model MtmPromotion {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  name           String
  description    String?
  type           MtmPromotionType   // PERCENT_DISCOUNT, BULK_DISCOUNT, BOGO, GIFT
  config         Json         // {"minQty": 200, "discountPercent": 10}
  validFrom      DateTime
  validTo        DateTime
  customerCategory MtmCustomerCategory?
  isActive       Boolean      @default(true)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  skus           MtmPromotionSku[]

  @@index([organizationId])
  @@index([validFrom, validTo])
  @@map("mtm_promotions")
}

model MtmPromotionSku {
  promotionId String
  promotion   MtmPromotion @relation(fields: [promotionId], references: [id], onDelete: Cascade)
  skuId       String
  sku         MtmSku       @relation(fields: [skuId], references: [id], onDelete: Cascade)

  @@id([promotionId, skuId])
  @@map("mtm_promotion_skus")
}

enum MtmPromotionType {
  PERCENT_DISCOUNT
  BULK_DISCOUNT
  BOGO
  GIFT
}

// Кредитный лимит клиента
model MtmCreditLimit {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  customerId     String       @unique
  customer       MtmCustomer  @relation(fields: [customerId], references: [id], onDelete: Cascade)
  limitAmount    Decimal      @db.Decimal(12, 2)
  currentDebt    Decimal      @default(0) @db.Decimal(12, 2)
  currency       String       @default("AZN")
  daysOverdue    Int          @default(0)
  isBlocked      Boolean      @default(false)
  lastSyncedAt   DateTime?
  updatedAt      DateTime     @updatedAt

  @@index([organizationId])
  @@map("mtm_credit_limits")
}
```

### Изменения в существующих моделях

```prisma
// MtmOrder — добавить поля:
model MtmOrder {
  // ... существующие поля ...

  warehouseId    String?      // выбранный склад
  warehouse      MtmWarehouse? @relation(fields: [warehouseId], references: [id], onDelete: SetNull)

  subtotal       Decimal      @default(0) @db.Decimal(12, 2)
  discountAmount Decimal      @default(0) @db.Decimal(12, 2)
  taxAmount      Decimal      @default(0) @db.Decimal(12, 2)
  // totalAmount already exists

  currency       String       @default("AZN")
  appliedPromotions Json       @default("[]")  // [{promotionId, discountAmount}]
  pdfUrl         String?      // ссылка на сгенерированную накладную

  items          MtmOrderItem[]  // взамен items Json — нормальная связь
}

// Новая модель — позиция заказа
model MtmOrderItem {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  orderId        String
  order          MtmOrder     @relation(fields: [orderId], references: [id], onDelete: Cascade)
  skuId          String
  sku            MtmSku       @relation(fields: [skuId], references: [id], onDelete: Restrict)
  quantity       Int
  unitPrice      Decimal      @db.Decimal(10, 2)
  discount       Decimal      @default(0) @db.Decimal(10, 2)
  total          Decimal      @db.Decimal(12, 2)
  appliedPromotionId String?

  @@index([orderId])
  @@map("mtm_order_items")
}
```

### Миграция данных
`MtmOrder.items` (JSON) → миграция в `MtmOrderItem`:
- Скрипт `scripts/migrate-mtm-order-items.ts` парсит существующий JSON и создаёт строки в новой таблице
- После проверки — удаляем поле `items` в следующей миграции

---

## 3. API endpoints

### Backend (`src/app/api/v1/mtm/skus/`)

```
GET    /api/v1/mtm/skus                # list with filters: category, brand, search, isActive
GET    /api/v1/mtm/skus/:id            # detail
POST   /api/v1/mtm/skus                # create (admin only)
PATCH  /api/v1/mtm/skus/:id            # update (admin only)
DELETE /api/v1/mtm/skus/:id            # soft delete

GET    /api/v1/mtm/skus/categories     # category tree
POST   /api/v1/mtm/skus/import         # CSV upload (multipart)

GET    /api/v1/mtm/skus/:id/price?customerId=...&quantity=...
       # returns applicable price + applicable promotions
```

### Mobile API расширения

Mobile sync endpoints должны включать SKU catalog в bulk:
```
GET    /api/v1/mtm/mobile/sync/skus?since=<timestamp>
       # delta sync — SKUs, prices, stocks, promotions с прошлой синхронизации
```

### Order endpoints — изменения

```
POST   /api/v1/mtm/orders               # create with items[] array (валидация: existing SKUs, credit limit, stock)
                                         # автоматически рассчитывает subtotal, применяет промо, возвращает totalAmount
GET    /api/v1/mtm/orders/:id/pdf       # генерирует PDF накладную (через jspdf на сервере или через puppeteer)
```

---

## 4. Web admin UI

### Новые страницы

| Путь | Что |
|---|---|
| `/mtm/skus` | Список товаров с фильтрами, поиском, импортом CSV |
| `/mtm/skus/[id]` | Карточка товара: фото, цены, остатки, промоакции |
| `/mtm/skus/new` | Создание |
| `/mtm/categories` | Дерево категорий с drag-drop |
| `/mtm/warehouses` | Склады + остатки |
| `/mtm/promotions` | Промоакции: список, создание, привязка к SKU |

### Компоненты
- `src/components/mtm/sku-form.tsx`
- `src/components/mtm/sku-list.tsx`
- `src/components/mtm/sku-import-modal.tsx` — drag-drop CSV
- `src/components/mtm/promotion-form.tsx`
- `src/components/mtm/category-tree.tsx`

---

## 5. Mobile UI (React Native)

### Новые экраны (`MTMobileApp/src/screens/`)

| Файл | Что |
|---|---|
| `orders/SkuCatalogScreen.tsx` | Каталог: категории сверху, поиск, плитки SKU с фото/ценой |
| `orders/SkuDetailScreen.tsx` | Карточка: большое фото, описание, цена для этого клиента, кнопка «Добавить в корзину» |
| `orders/CartScreen.tsx` | Корзина: список позиций, изменение qty, скидки/промо, итог |
| `orders/OrderFormScreen.tsx` | Заполнение и отправка: склад, способ оплаты, комментарий → POST |
| `orders/OrderSuccessScreen.tsx` | Подтверждение + кнопка «Поделиться PDF» |

### State management
- Zustand store `useCartStore`: список позиций в корзине, текущий клиент, applied promotions, totalAmount
- При check-in в визит → корзина привязывается к клиенту
- При check-out без оформления → предупреждение «Корзина не пустая»

### Offline behaviour (см. [`mtm-offline-sync-spec.md`](./mtm-offline-sync-spec.md))
- SKU catalog кэшируется локально на устройстве (~200 SKU × ~5KB на каждый с фото-превью = ~1 MB)
- Photo URLs пред-загружаются при синке (опционально)
- Цены и остатки обновляются при каждом sync
- Создание заказа в офлайне → outbox → отправка при появлении сети

---

## 6. Order capture extended logic (Phase 2)

### Promotion engine
В backend `src/lib/mtm/promotion-engine.ts`:
1. Получить applicable promotions для (customer, sku, quantity)
2. Применить в порядке: BULK_DISCOUNT → PERCENT_DISCOUNT → BOGO → GIFT
3. Вернуть discount per line + total order discount

### Credit limit check
В `POST /api/v1/mtm/orders`:
- Проверить `MtmCreditLimit.currentDebt + order.totalAmount <= limitAmount`
- Если превышен → return 422 с `{error: "CREDIT_LIMIT_EXCEEDED", currentDebt, limit, orderAmount}`
- В mobile показать диалог: «Дебиторка клиента 2400 AZN / лимит 3000 AZN. Текущий заказ 800 AZN. Превышение на 200 AZN. Связаться с супервайзером?»

### PDF invoice
- Backend job через `jspdf` или `puppeteer`
- Template `src/lib/mtm/templates/invoice.html` с placeholders
- Сохранение в S3-compatible storage → URL в `MtmOrder.pdfUrl`
- Mobile: кнопка «Поделиться» → Share API (нативный share)

---

## 7. ERP-mapping

Для будущей интеграции с 1С (Phase 2.4):

```prisma
model MtmExternalIdMap {
  id             String   @id @default(cuid())
  organizationId String
  entityType     String   // "sku", "customer", "warehouse"
  internalId     String
  externalId     String
  externalSystem String   @default("1c")
  syncedAt       DateTime @default(now())

  @@unique([organizationId, entityType, externalSystem, externalId])
  @@index([organizationId])
  @@map("mtm_external_id_map")
}
```

При импорте SKU из 1С → создаётся `MtmSku` + запись в `MtmExternalIdMap`.
При создании заказа → в outbox для 1С с external SKU IDs.

---

## 8. Acceptance criteria (приёмка)

### v1 (Phase 1, Задача 1.3)
- [ ] Админ может импортировать CSV с 200+ SKU за 30 сек
- [ ] Агент в mobile видит каталог за <2 сек после открытия экрана
- [ ] Поиск по названию работает мгновенно (локальный фильтр кэша)
- [ ] Создание заказа из позиций каталога успешно отправляется на сервер
- [ ] Сумма заказа автоматически считается qty × price

### v2 (Phase 2, Задача 2.2)
- [ ] Промоакции применяются автоматически при добавлении SKU в корзину
- [ ] При превышении credit limit заказ не создаётся, агент видит понятное сообщение
- [ ] PDF-накладная генерируется за <5 сек после создания заказа
- [ ] При офлайн режиме заказы накапливаются в очереди и отправляются при появлении сети
- [ ] Импорт SKU из 1С через cron job работает каждый час, никаких дубликатов

---

## 9. Out of scope

В этой спеке **НЕ покрываем:**
- Multi-currency (только AZN на старте)
- Налоговое поведение (НДС) — добавим если Mars запросит
- Заказы на нескольких складах в одном order (только один warehouse per order)
- Возвраты товара — отдельная спека

---

## История изменений

| Дата | Изменение |
|---|---|
| 2026-05-21 | Создание v1 |
