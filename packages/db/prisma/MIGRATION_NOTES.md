# Обязательный raw SQL для первой миграции

> ⚠️ **Грабли `prisma migrate diff`**: он не знает про raw-SQL констрейнты и
> ВСЕГДА генерирует `DROP INDEX *_natural_key` — вычищайте эти строки из
> каждой новой миграции (Postgres, к счастью, отклонит DROP INDEX на
> constraint-backed индексе, и миграция просто откатится).

Prisma не выражает эти констрейнты — их нужно дописать руками в SQL первой
миграции ДО загрузки любых данных. Список собран из Codex-ревью схемы
(2026-07-02, вердикт NO-GO до выполнения этих пунктов).

> **Статус (2026-07-02, испр.):** миграция `0_init` применена, но п.1 в неё
> НЕ вошел (в отличие от заявленного ранее — интеграционный тест это поймал);
> unique-ключи снапшотов добавлены отдельной миграцией
> `20260702*_snapshot_natural_keys`. П.2 (CHECK на assignment) — в `0_init`.
> П.3 (publish-инварианты) реализован миграцией
> `20260703093945_publish_invariant_triggers` и DB regression tests. П.4
> (граф-целостность) в v0 держится parent-path репозиториями и core validation:
> placement shelf/zone проходят через DRAFT-only repo/API с revision guard;
> если потребуется прямой SQL/write bypass, добавить DB triggers отдельной
> миграцией. П.5 (tenant-изоляция) — **реализован**:
> `src/tenant-client.ts` (createTenantClient/createSystemClient) + 10
> интеграционных тестов изоляции в `src/__tests__/`. П.6 — отложено осознанно.

## 1. Уникальность снапшотов с nullable-колонками (Postgres 15+)

```sql
ALTER TABLE price_snapshots
  ADD CONSTRAINT price_snapshots_natural_key
  UNIQUE NULLS NOT DISTINCT (product_id, store_id, date);

ALTER TABLE stock_snapshots
  ADD CONSTRAINT stock_snapshots_natural_key
  UNIQUE NULLS NOT DISTINCT (product_id, store_id, warehouse_id, date);

ALTER TABLE sales_snapshots
  ADD CONSTRAINT sales_snapshots_natural_key
  UNIQUE NULLS NOT DISTINCT (product_id, store_id, date);
```

## 2. PlanogramAssignment: ровно одна цель

```sql
ALTER TABLE planogram_assignments
  ADD CONSTRAINT planogram_assignment_exactly_one_target
  CHECK (num_nonnulls(store_id, format_id) = 1);
```

## 3. Publish-инварианты (triggers)

- `planogram_assignments`: INSERT разрешен только если версия в состоянии
  `PUBLISHED`.
- `tasks`: если `planogram_version_id` задан — версия должна быть `PUBLISHED`;
  если задан `assignment_id` — `store_id`/`planogram_version_id` задачи должны
  совпадать с целью assignment.
- `planogram_versions`: запрет UPDATE полей контента, когда
  `state = 'PUBLISHED'` (immutable snapshot).
- `equipment_versions`: запрет UPDATE геометрии, когда `is_frozen = true`;
  выставлять `is_frozen = true` при первой публикации ссылающейся планограммы.

## 4. Целостность графа планограммы (triggers)

- `planogram_placements.shelf_id` → полка должна принадлежать
  `equipment_version` того же `planogram_equipment`.
- `planogram_placements.zone_id` → зона должна принадлежать тому же
  `planogram_version_id`.
- `planogram_zones.planogram_equipment_id` → equipment того же
  `planogram_version_id`.

## 5. Tenant-целостность (решение)

Codex рекомендует композитные tenant-FK (`@@unique([organizationId, id])` на
родителях + составные FK). Решение v0: НЕ вводить композитные FK, а
enforce'ить изоляцию тенанта scoped Prisma-клиентом в `packages/db`
(client extension, автоматически добавляющий `organizationId` во все where) +
интеграционные тесты изоляции. Пересмотреть при первом инциденте или при
переходе на RLS.

## 6. Отложено осознанно

- Overlap-констрейнты на validity-окна `assortment_matrix`/`store_assortment`
  (EXCLUDE USING gist) — v0 держит одну актуальную строку на пару, история
  через AuditLog.

## 7. Full-sync approval state

Миграция `20260719055000_import_full_sync_approval` добавляет в durable import
queue `syncMode`, путь к owner-only approval token и timestamp attach. Raw SQL
CHECK допускает только `delta|full`, требует атомарную пару path/timestamp и
запрещает approval на delta jobs. Partial index обслуживает операторский список
full-sync jobs, ожидающих approval. Bearer token и signing key в БД не хранятся.
Следующая миграция `20260719060000_product_tenant_write_lock` ставит transaction-
level advisory lock по organization ID на каждый `products` INSERT/UPDATE/DELETE.
Full-sync consumer берёт тот же lock до пересчёта active set, поэтому concurrent
delta/API writer того же tenant не может изменить каталог между approval check
и deactivation; другой tenant использует иной lock key.
