# ERP / 1C import and reconciliation runbook

Этот runbook описывает стабильную границу staging v1. Конкретный адаптер 1С
начинается только после подписания клиентского mapping sheet.

## Обязательный клиентский контракт

До первого обмена владелец ERP и LeadShelf письменно фиксируют:

- идентификаторы SKU и правила ведущих нулей barcode;
- category/brand/supplier/manufacturer ownership;
- размеры и единицы (`PCS`, `BOX`, `KG`, `L`, `PACK`);
- currency, VAT inclusive/exclusive, decimal precision;
- store/warehouse identifiers и timezone business date;
- price/stock/sales/assortment semantics;
- full или delta mode для каждой сущности;
- expected row count и SHA-256 canonical row set для каждой поставки;
- expected totals для применимых snapshot-полей: `price`, `costPrice`,
  `quantity`, `revenue`, `profit`;
- SLA freshness, окно повторной доставки и ответственных с обеих сторон.

Неизвестное поле не должно молча менять значение. Удаление отсутствующих в
full-файле записей запрещено, пока клиент явно не согласовал такую семантику.

## Стандартный обмен

1. Сохранить входной файл неизменным во внешнем ERP archive с batch ID.
2. Загрузить CSV/XLSX в staging import API.
3. Дождаться terminal status; большие файлы обрабатывает durable worker queue.
4. Исправить строки из ImportError и повторить новый batch.
5. Сверить `reconciliation.sourceRows`, imported/error rows и
   `sourceChecksum` с ERP manifest.
6. MISMATCH запрещает downstream publish/decision до объяснения расхождения.
7. Повтор того же входа обязан дать тот же checksum и итоговые snapshot sums.

### Manifest в import API

`POST /api/v1/catalog/imports` принимает вместе с multipart-файлом три
необязательных текстовых поля:

- `expectedRows` — целое число от 0 до 10 000 000;
- `expectedChecksum` — 64 hex-символа SHA-256 canonical row set;
- `expectedTotals` — JSON не более 2 KB с decimal-строками.

Допустимые totals зависят от `entityType`: `prices` — `price,costPrice`,
`stock` — `quantity`, `sales` — `quantity,revenue,profit`; для `products` и
`assortment` totals запрещены. Пример:

```json
{"quantity":"1250.5","revenue":"83420.10","profit":"-120.25"}
```

API отклоняет malformed/inapplicable manifest с HTTP 400. Для больших файлов
manifest сохраняется в durable queue и применяется тем же executor-ом.
Суммы считаются без binary floating point по строкам, успешно прошедшим
канонический parser; это source-file totals, а не агрегат всей исторической БД.
Любое расхождение создаёт `reconciliation.status=MISMATCH`, field-level reason
и terminal batch status `COMPLETED_WITH_ERRORS`, даже если `errorRows=0`.

## Full sync deletion guard

Перед любым будущим full-sync deactivate/delete вызвать
`guardDestructiveFullSync`. Без отдельного подтверждения блокируются:

- входной active count = 0 при ненулевом текущем наборе;
- уменьшение active набора более 10%.

Простой boolean удалён из контракта. Для опасного уменьшения guard принимает
только HMAC-SHA-256 token с secret не короче 32 bytes, подписанный доверенным
server-side issuer. Payload exact-schema привязан к action
`deactivate_absent_products`, change ID, два разных approval ID, reason code,
tenant, entity, source SHA-256, current active SKU-set SHA-256,
current/incoming active counts, canonical
issuedAt/expiresAt и TTL максимум один час. Signature сравнивается constant-time;
malformed/tampered, иной tenant/checksum/count, expired/future token, слабый
secret и некорректные input counts fail-closed. Token/secret нельзя помещать в
API response, import error или log.

Контролируемый durable workflow реализован и по умолчанию выключен. Multipart
products import с `syncMode=full` требует `expectedRows` и `expectedChecksum`,
всегда сохраняется в queue и не claim-ится без attached approval. Request,
control, signing key и token должны быть абсолютными owner-only regular files
с mode `0600` (или строже), без symlink; output directory принадлежит тому же
UID и не допускает group/world write. Все CLI создают output эксклюзивно с mode
`0600`, выполняют `fsync`, никогда не перезаписывают файл и выводят только
безопасный event. Один control-файл:

```json
{
  "organizationId": "APPROVED_ORGANIZATION_ID",
  "jobId": "QUEUED_JOB_ID",
  "changeId": "CHG-12345",
  "requesterApprovalId": "erp-owner-approval-1",
  "reviewerApprovalId": "data-owner-approval-2",
  "reasonCode": "authoritative-catalog-reconciliation",
  "ttlSeconds": 1800
}
```

Последовательность prepare → issue → attach:

```bash
pnpm --filter @leadshelf/worker import:prepare-full-sync-approval -- \
  --control-file /run/leadshelf/erp/full-sync-control.json \
  --output-file /run/leadshelf/erp/full-sync-request.json

pnpm --filter @leadshelf/worker import:issue-full-sync-approval -- \
  --request-file /run/leadshelf/erp/full-sync-request.json \
  --secret-file /run/secrets/erp-full-sync-approval-key \
  --output-file /run/leadshelf/erp/full-sync-approval.token

pnpm --filter @leadshelf/worker import:attach-full-sync-approval -- \
  --control-file /run/leadshelf/erp/full-sync-control.json \
  --secret-file /run/secrets/erp-full-sync-approval-key \
  --token-file /run/leadshelf/erp/full-sync-approval.token
```

Prepare пересчитывает row count/source checksum/current active-set checksum и
current+incoming active counts из реального queued source; attach повторяет
расчёт и сохраняет только путь к
token. Web принимает full-sync только при отдельном временном opt-in
`LEADSHELF_FULL_SYNC_REQUESTS_ENABLED=true`; без него API возвращает 503 и не
создаёт queue artifact. Worker запускает full-sync лишь при точных runtime
значениях
`LEADSHELF_FULL_SYNC_ENABLED=true` и абсолютном
`LEADSHELF_FULL_SYNC_APPROVAL_KEY_FILE`. Он ещё раз проверяет protected source,
manifest, counts, signature и expiry внутри serializable transaction под
tenant advisory lock. Только `COMPLETED` + MATCH + zero row errors допускают
soft-deactivation (`isActive=false`) отсутствующих SKU и allowlisted AuditLog;
DB trigger заставляет любой concurrent product writer того же tenant взять тот
же transaction lock, но не блокирует соседний tenant. Source/token удаляются
после commit. Context,
crypto или source drift завершается terminal FAILED с rollback всей транзакции;
transient DB failure остаётся retryable.

Token-файл является краткоживущим bearer credential: его нельзя выводить в
stdout, помещать в argv, CI artifact, тикет или лог; после контролируемой
передачи consumer-у он удаляется по утверждённой evidence policy. Signing key
должен поступать из production secret manager в owner-only файл и ротироваться
по security runbook.

Локальная mechanics и PostgreSQL integration проверены, но production gate не
закрыт: flag остаётся `false`, secret-manager mount/UID policy, client mapping,
реальный staging replay/recovery и 14 последовательных reconciliation runs
отсутствуют. До этих evidence включать full-sync runtime запрещено.

### Контролируемая отмена ожидающего full-sync

Отмена допускается только пока job имеет status `PENDING`. Она требует двух
разных approval ID и отдельного owner-only (`0600`) control-файла без symlink:

```json
{
  "organizationId": "APPROVED_ORGANIZATION_ID",
  "jobId": "QUEUED_JOB_ID",
  "changeId": "CHG-12345",
  "requesterApprovalId": "erp-owner-approval-1",
  "reviewerApprovalId": "data-owner-approval-2",
  "reasonCode": "operator-cancelled-stale-source",
  "confirmation": "CANCEL FULL SYNC QUEUED_JOB_ID APPROVED_ORGANIZATION_ID"
}
```

```bash
pnpm --filter @leadshelf/worker import:cancel-full-sync -- \
  --control-file /run/leadshelf/erp/full-sync-cancel.json
```

DB-транзакция сначала terminal fail-close переводит job и batch в `FAILED` и
пишет allowlisted `catalog.full_sync_cancelled`. Затем CLI удаляет только
owner-only regular source/token из защищённых директорий и фиксирует
`catalog.full_sync_cleanup_completed`. При filesystem error job остаётся с
`full_sync_cancelled_cleanup_required`, metric/critical alert не гаснет, а та
же команда безопасно повторяет только cleanup. Ручное удаление файлов или
ImportBatch запрещено. Для `PROCESSING`/завершённого job команда fail-closed.

## Повтор и восстановление

- Ошибка parse/validation: исправить источник, новый batch; старый не менять.
- Ошибка worker до записи: job retry с тем же batch/storagePath.
- Partial errors: успешные natural keys идемпотентны, исправленные строки можно
  повторить отдельным delta batch.
- Неверные бизнес-значения: загрузить корректирующий snapshot с тем же natural
  key; исторический batch/error audit сохранить.
- Нельзя редактировать production БД вручную или удалять ImportBatch.
- Ожидающий full-sync отменять только процедурой выше; при cleanup alert
  устранить права/mount и повторить ту же команду с тем же control-файлом.

## Приёмка клиента

В журнале обменов фиксируются 14 последовательных поставок: batch ID, entity,
source/expected counts, checksums, sums, duration, freshness, errors и решение.
Только 14 объяснённых MATCH-прогонов закрывают production gate Phase 18.
