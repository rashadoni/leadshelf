# LeadShelf: архитектура

## Рекомендованный стек

### Web

- Next.js App Router.
- TypeScript.
- Tailwind + shadcn/ui или собственный design system поверх Radix.
- React Query или server actions/route handlers по ситуации.
- Canvas/SVG layer для 2D planogram editor.

### Mobile

- React Native.
- Expo prebuild/dev-client или bare React Native, если нужны VisionCamera/WatermelonDB без компромиссов.
- WatermelonDB или SQLite-first локальное хранилище.
- Offline outbox.
- Camera + barcode scanner.

### Backend

- Postgres.
- Prisma.
- S3-compatible storage: Cloudflare R2, MinIO, AWS S3 или Hetzner object storage.
- Queue: сначала Postgres-backed jobs/pg-boss, потом Redis/BullMQ если нужна нагрузка.
- ML/AI отдельно через HTTP microservice, не внутри основного Next.js процесса.

### Почему не Firebase как основной backend

Firebase удобен для быстрого мобильного MVP, но для LeadShelf хуже:

- сложные BI-запросы;
- отчеты по периодам;
- joins по магазинам, форматам, SKU, продажам;
- tenant isolation;
- SQL-агрегации;
- выгрузки в Excel;
- интеграция с 1C/ERP.

Для этого Postgres лучше и дешевле в долгую.

## Монорепозиторий

Рекомендуемая структура:

```text
leadshelf/
  apps/
    web/                 # Next.js admin/web app
    mobile/              # React Native app
  services/
    worker/              # jobs: import, publish, analytics, sync
    vision/              # optional FastAPI detector/embedding service
  packages/
    db/                  # Prisma schema, migrations, typed db helpers
    core/                # domain logic: planogram math, rules, metrics
    api-contracts/       # zod schemas/types shared web/mobile/backend
    ui/                  # shared design tokens/components for web
  docs/
  scripts/
```

Если хочется быстрее, можно начать с одного Next.js app + Prisma, но с самого начала держать domain logic в `packages/core`, чтобы потом без боли отделить worker/mobile contracts.

## Главные bounded contexts

### 1. Identity & Tenant

- Organization.
- User.
- Role.
- Permission.
- Session.
- AuditLog.

Это техническое основание, не продуктовый модуль.

### 2. Retail Network

- Store/Pharmacy.
- Store format.
- Region.
- Floor plan.
- Format assignment.

Форматы важны: одна планограмма может быть активна на 100 аптеках.

### 3. Catalog & ERP

- Product.
- Barcode.
- Category tree.
- Brand.
- Supplier.
- Manufacturer.
- Attributes.
- Dimensions.
- Price snapshot.
- Stock snapshot.
- Sales snapshot.
- Assortment matrix.

ERP/1C данные должны храниться snapshot-ами, чтобы отчеты за прошлый период не ломались от текущих остатков.

### 4. Equipment

- Equipment type/template.
- Equipment instance.
- Shelf.
- Cell/container.
- Physical dimensions.
- Placement constraints.
- Visual preview.

Оборудование должно жить отдельно от планограммы, потому что оно переиспользуется в планах залов.

### 5. Planogram

- Planogram.
- Planogram version.
- Planogram equipment.
- Zone.
- Placement.
- Rule set.
- Publish target.
- Task.

Ключевая идея: планограмма должна быть versioned. Нельзя просто менять активную схему без истории.

### 6. Mobile Execution

- Published task.
- Device.
- Sync cursor.
- Outbox operation.
- Photo submission.
- Comment.
- Barcode lookup.

Мобильное приложение должно быть простым. Оно не должно быть мини-web-admin.

### 7. Analytics

- Precomputed metric snapshots.
- Like-for-like reports.
- ABC reports.
- Share-of-shelf.
- Task SLA/KPI.
- Assortment mismatch.

Часть отчетов можно считать on-demand, но тяжелые отчеты лучше агрегировать ночью после импорта 1C.

### 8. AI / Vision

- Golden reference.
- Reference slots.
- Shelf scan.
- Detection.
- Model run.
- Human review.

AI должен быть отдельным optional layer. MVP обязан работать без AI.

## Важные архитектурные правила

1. Planogram math держать в чистом `core` пакете без React и Prisma.
2. Все размеры хранить в миллиметрах или сантиметрах, но выбрать один canonical unit.
3. Все editor coordinates хранить отдельно от UI pixel coordinates.
4. Каждая планограмма должна иметь версии.
5. Публикация должна создавать task/snapshot, а не ссылаться на mutable draft.
6. Offline mobile операции должны быть idempotent.
7. ERP import должен быть повторяемым и безопасным.
8. AI не должен менять планограмму напрямую без human approval.

## 2D против 3D

Сначала строить точный 2D editor. 3D делать viewer-ом поверх тех же данных.

Не советую начинать с 3D как главного редактора:

- сложнее UX;
- сложнее тестировать;
- больше багов с размерами;
- тяжелее на слабых ноутбуках;
- не нужен для большинства ежедневных операций.

3D полезен для презентации и проверки, но ядро управления - 2D + таблицы.
