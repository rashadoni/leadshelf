# MTM Gap Analysis — что есть и что нужно для FMCG retail execution

> **Связан с:** [`mars-overseas-roadmap.md`](./mars-overseas-roadmap.md)
> **Дата:** 2026-05-21
> **Цель:** показать команде точно, какие модели, файлы, экраны уже существуют и что нужно добавить

---

## 1. Что уже есть в коде LeadDrive v2

### Prisma модели (в `prisma/schema.prisma`)

| Модель | Покрывает | Размер |
|---|---|---|
| `MtmAgent` | Торговый агент, иерархия manager/subordinate, online status | ~25 полей |
| `MtmCustomer` | Торговая точка с lat/lng + per-customer geofence | ~15 полей |
| `MtmRoute` | Дневной маршрут агента | ~10 полей |
| `MtmRoutePoint` | Точка в маршруте (визит-плана) | ~7 полей |
| `MtmVisit` | Фактический визит (check-in/out, GPS) | ~15 полей |
| `MtmTask` | Задача с привязкой к визиту/клиенту | ~12 полей |
| `MtmPhoto` | Фото с категорией (shelf/display/promo/receipt) | ~15 полей |
| `MtmAlert` | Системные алерты (геозона, опоздание и т.д.) | ~10 полей |
| `MtmAgentLocation` | GPS-треки агентов | ~10 полей |
| `MtmOrder` | Заказы (items как JSON — нужно расширять) | ~10 полей |
| `MtmSetting` | Per-org настройки | key-value |
| `MtmNotification` | In-app + push уведомления | ~8 полей |
| `MtmAuditLog` | Лог действий | ~8 полей |

### API endpoints (`src/app/api/v1/mtm/*`)
- `activity` — лог активности
- `agents`, `agents/[id]` — CRUD по агентам
- `alerts`, `alerts/[id]` — алерты
- `analytics` — аналитика
- `customers`, `customers/[id]` — CRUD клиентов
- `dashboard` — главный дашборд
- `leaderboard` — рейтинги
- `locations` — GPS-треки
- `mobile/{auth, ping, location, profile, notifications}` — отдельный mobile API
- `notifications` — управление уведомлениями
- `orders`, `orders/[id]` — заказы
- `photos`, `photos/[id]` — фото
- `reports` — отчёты
- `routes`, `routes/[id]` — маршруты
- `settings` — настройки
- `tasks`, `tasks/[id]` — задачи
- `visits`, `visits/[id]` — визиты

### Web admin pages (`src/app/(dashboard)/mtm/*`)
Все 16 разделов есть: activity, agents, alerts, analytics, customers, dashboard, leaderboard, map, orders, photos, reports, routes, settings, tasks, visits, и главный page.tsx

### React components (`src/components/mtm/*`)
- `agent-form.tsx`, `customer-form.tsx`, `live-map.tsx`, `location-picker-map.tsx`, `order-form.tsx`, `route-form.tsx`, `route-map.tsx`, `task-form.tsx`, `visit-form.tsx`

### Mobile app (`/Users/rashadrahimov/Documents/mtm/MTMobileApp`)
- **Версия:** v1.1.2 (APK 138MB на Desktop)
- **Стек:** React Native 0.84.1 (bare), React 19, TypeScript 5.8, Zustand, NativeStack
- **Native deps:** VisionCamera 4.7, AsyncStorage, geolocation, background-actions
- **7 экранов:** LoginScreen, ServerScreen, RouteScreen, VisitScreen, TasksScreen, OrdersScreen, ProfileScreen
- **Фишки:** geofence-валидация с ролевыми override, GPS-heartbeat каждые 30 сек как foreground service, multi-tenant через server discovery

---

## 2. Сравнение с 8 модулями effie

### Слайд effie → наша реализация

#### Модуль 1: Field Team Management
> effie: «Visit plan fulfillment 98%, visit effectiveness 75%, time on route 8h, time in stores 6h»

**Наше состояние:** ✅ **ГОТОВО**
- Models: `MtmAgent`, `MtmRoute`, `MtmRoutePoint`, `MtmVisit`
- API: `/api/v1/mtm/{routes,visits,agents,leaderboard}`
- UI web: `(dashboard)/mtm/{routes,visits,agents,leaderboard,analytics}`
- UI mobile: `RouteScreen.tsx`, `VisitScreen.tsx`

**Gap:** KPI-дашборд в `(dashboard)/mtm/analytics/page.tsx` нужно расширить именно теми метриками, которые называет effie. Усилие: 1 неделя (Задача 2.3 в roadmap).

---

#### Модуль 2: Shelf Management / Image Recognition
> effie: «AI photo recognition of shelf, share of shelf, planogram compliance, OSA»

**Наше состояние:** ❌ **НЕТ**
- Модели `MtmPhoto` есть, но категория photo — просто string без анализа
- Нет интеграции с CV/ML

**Gap:** Phase 3 в roadmap, спека [`mtm-image-recognition-spec.md`](./mtm-image-recognition-spec.md). Усилие: 3–4 недели через Roboflow API.

---

#### Модуль 3: Sales & Accounts Receivable Management
> effie: «orders, invoices, AR tracking, credit limits»

**Наше состояние:** 🟡 **ЧАСТИЧНО**
- `MtmOrder` есть, но `items` — JSON без жёсткой схемы и без каталога SKU
- Дебиторки нет вообще
- Кредитные лимиты — нет

**Gap:**
- SKU catalog → спека [`mtm-sku-catalog-spec.md`](./mtm-sku-catalog-spec.md), Задача 1.3 + 2.2 (3 недели)
- AR tracking → новая модель `MtmAccountsReceivable`, Задача 2.2 (часть из 2 недель)

---

#### Модуль 4: Other processes (Store check, audit, inventory)
> effie: «store visits, audits, inventory checks»

**Наше состояние:** ✅ **БОЛЬШЕ ЧЕМ У EFFIE**
- `MtmVisit` + `MtmTask` + `MtmPhoto` + `MtmAlert` — полная связка для аудита
- effie показала «91.7% non-automated» — значит они продают сами эту автоматизацию

**Gap:** нет.

---

#### Модуль 5: Safe Launch / Pilot Methodology
> effie: Process methodology, не код

**Наше состояние:** 🟡 — **методология**, не код
- Нужно расписать стандартный playbook пилота: 3,5 мес → 2 мес rollout

**Gap:** создать `docs/mtm-pilot-playbook.md` — материалы для sales/internal. Усилие: 2 дня.

---

#### Модуль 6: National Rollout
**Наше состояние:** 🟡 **архитектурно готово, нужны нагрузочные тесты**
- Multi-tenant (`organizationId` везде) — ✅
- Permissions matrix в `src/lib/permissions.ts` — ✅
- Background queue (BullMQ) — ✅
- НО: не тестировано под 351 пользователя одновременно

**Gap:** Phase 4 в roadmap, нагрузочные тесты + индексы БД. Усилие: 2–3 недели.

---

#### Модуль 7: Stock Management через Image Recognition (см. таблицу SKU на slide 7)
> effie: «Capital Black 30% Minimum Sales Loss, Wolf 0.45 6.7%...»

**Наше состояние:** ❌ **НЕТ**
- Это аналитика *на основе* image recognition — то есть требует Модуль 2

**Gap:** строится поверх Phase 3. После того как есть распознавание SKU на полке → новые отчёты по «упущенным продажам». Усилие: 1 неделя поверх Phase 3.

---

#### Модуль 8: Equipment Inventory
> effie: «Equipment relocation, replacement, write-off, search, condition control, photos, repair requests»

**Наше состояние:** ❌ **НЕТ**
- Нет моделей оборудования
- Это особенно важно для Pepsi-боттлера (тысячи холодильников в полях)

**Gap:** новый модуль. Спека [`mtm-equipment-inventory-spec.md`](./mtm-equipment-inventory-spec.md), Задача 1.4 (1 неделя для v1, ещё 1–2 для full).

---

## 3. Технические risks/gaps вне 8 модулей effie

### A. Offline-first sync ⚠️ КРИТИЧНО

**Текущее состояние:** Mobile приложение полностью online — все запросы синхронные fetch без очереди, без кэша, без retry.

**Почему это критично:** В азербайджанских регионах (за пределами Баку) 4G нестабильный. Без offline-first продукт нельзя ставить в полях, агенты потеряют доверие в первый же день.

**Gap:** Спека [`mtm-offline-sync-spec.md`](./mtm-offline-sync-spec.md), Задача 2.1 в roadmap. Усилие: 3 недели (это самая большая инженерная задача).

### B. Локализация AZ/EN/RU на mobile

**Текущее состояние:** Все строки на mobile захардкожены на русском (включая background-service notification на native стороне).

**Gap:** Задача 1.1, react-i18next + native strings.xml. Усилие: 4–5 дней.

### C. Photo watermarking + EXIF

**Текущее состояние:** Фото уходят на сервер «голыми» — без timestamp/GPS/agent name на изображении. Это базовая «proof of visit» функция.

**Gap:** Спека [`mtm-photo-watermark-spec.md`](./mtm-photo-watermark-spec.md), Задача 1.2. Усилие: 3 дня.

### D. ERP/1С интеграция

**Текущее состояние:** Нет коннектора с 1С. У Mars наверняка 1С УТ или похожее.

**Gap:** Задача 2.4 в roadmap. Усилие: 2 недели + 1 неделя интеграционного тестирования.

### E. iOS-сборка

**Текущее состояние:** В `MTMobileApp/ios/` структура есть, но текущая v1.1.2 — только Android.

**Gap:** Не делаем на старте (95% FMCG-агентов на Android), откладываем на Phase 5+. Если Mars запросит — 1–2 недели на сборку и Apple Dev account.

### F. Тесты mobile

**Текущее состояние:** `__tests__/` папка пустая, есть только jest конфиг.

**Gap:** Постепенно добавлять покрытие в течение всех фаз. Не блокер для пилота.

### G. Crash reporting

**Текущее состояние:** Нет Sentry/Crashlytics в mobile.

**Gap:** Добавить Sentry в начале Phase 1 (Sentry уже стоит на backend). Усилие: 1 день.

---

## 4. Итоговая матрица gap × фаза × усилие

| # | Gap | Phase | Усилие | Спека |
|---|---|---|---|---|
| 1 | i18n AZ/EN/RU mobile | 1 | 5 дней | этот документ |
| 2 | Photo watermark + EXIF | 1 | 3 дня | [`mtm-photo-watermark-spec.md`](./mtm-photo-watermark-spec.md) |
| 3 | SKU catalog v1 | 1 | 1,5 нед | [`mtm-sku-catalog-spec.md`](./mtm-sku-catalog-spec.md) |
| 4 | Equipment Register v1 | 1 | 1 нед | [`mtm-equipment-inventory-spec.md`](./mtm-equipment-inventory-spec.md) |
| 5 | Sentry mobile | 1 | 1 день | — |
| 6 | Offline-first sync | 2 | 3 нед | [`mtm-offline-sync-spec.md`](./mtm-offline-sync-spec.md) |
| 7 | Order capture extended (discounts/credit/PDF) | 2 | 2 нед | [`mtm-sku-catalog-spec.md`](./mtm-sku-catalog-spec.md) §6 |
| 8 | KPI-дашборды Mars-specific | 2 | 1 нед | этот документ §2 |
| 9 | 1C ERP integration | 2 | 3 нед | роадмап §2.4 |
| 10 | Shelf AI via Roboflow | 3 | 2 нед | [`mtm-image-recognition-spec.md`](./mtm-image-recognition-spec.md) |
| 11 | Claude Vision fallback | 3 | 1 нед | [`mtm-image-recognition-spec.md`](./mtm-image-recognition-spec.md) §5 |
| 12 | Planogram compliance | 3 | 1 нед | [`mtm-image-recognition-spec.md`](./mtm-image-recognition-spec.md) §6 |
| 13 | Lost sales analytics (модуль 7 effie) | 3+ | 1 нед | поверх 10 |
| 14 | Performance до 351 user | 4 | 3 нед | роадмап §4.1 |
| 15 | iOS support | 5 | 2 нед | отложено |
| 16 | Custom YOLO model | 5 | 4–6 мес | отложено |

**Итого до парности с effie:** пункты 1–13 = ~16 нед при 2 девах параллельно ≈ **8 недель календарно при правильной параллелизации**.

---

## 5. Где у нас преимущества (что effie не догонит быстро)

1. **AI Constructor / Da Vinci** — наш существующий AI-модуль в `src/lib/ai/` уже умеет работать с разными LLM. effie это не предлагает. Можно делать **«AI-помощник торгового»**: суммаризировать визит, генерировать follow-up задачи, советовать ассортимент на основе истории клиента.
2. **Полная CRM в одной системе** — у Mars не только полевые продажи: маркетинг, тикеты, контракты, инвойсы — всё в одной системе у нас. effie — только полевое.
3. **Локальная команда** — мы в AZ/Caucasus, effie — в Польше через Украину. Скорость реакции и стоимость поддержки.
4. **Open architecture** — Next.js + Prisma, легко интегрироваться с чем угодно. effie — закрытая платформа.

---

## История изменений

| Дата | Изменение | Автор |
|---|---|---|
| 2026-05-21 | Создан на основе аудита кода + анализа effie pitch | Claude |
