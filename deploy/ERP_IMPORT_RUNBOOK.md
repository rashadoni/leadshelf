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

Подтверждение привязывается к tenant, entity, checksum и expiresAt; простой
boolean из публичного API недостаточен. Текущий staging v1 использует upsert и
не удаляет отсутствующие строки, поэтому массовое удаление сейчас невозможно.

## Повтор и восстановление

- Ошибка parse/validation: исправить источник, новый batch; старый не менять.
- Ошибка worker до записи: job retry с тем же batch/storagePath.
- Partial errors: успешные natural keys идемпотентны, исправленные строки можно
  повторить отдельным delta batch.
- Неверные бизнес-значения: загрузить корректирующий snapshot с тем же natural
  key; исторический batch/error audit сохранить.
- Нельзя редактировать production БД вручную или удалять ImportBatch.

## Приёмка клиента

В журнале обменов фиксируются 14 последовательных поставок: batch ID, entity,
source/expected counts, checksums, sums, duration, freshness, errors и решение.
Только 14 объяснённых MATCH-прогонов закрывают production gate Phase 18.
