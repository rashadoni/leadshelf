# Initial capacity target and SLO

Статус: capacity targets — проектный baseline. Узкие local fixtures
зафиксированы ниже; до GA весь target должен быть подтверждён на production-like
dataset и soak не менее 8 часов.

## Target v1

- 10 active tenants;
- 500 stores total;
- до 100 000 SKU на tenant, 250 000 total;
- 2 000 active field users;
- 20 000 execution tasks/day;
- 10 000 proof media/day;
- 500 000 rows per import job;
- 90 days hot operational DB history;
- 180 days proof retention, если клиентский privacy contract не требует меньше.

10 000 media/day не помещаются в 80 GB VPS MinIO при длительном retention.
Production этого масштаба требует external object storage/lifecycle либо
существенно меньшего договорного retention. Это capacity blocker, не TODO UI.

## Initial SLO

- availability: 99.5% monthly, excluding agreed maintenance;
- authenticated JSON API: P95 < 500 ms, P99 < 2 s;
- mobile pull/push without media: P95 < 3 s;
- 10 MB media upload on reference network: P95 < 10 s;
- readiness failure detection: < 2 minutes;
- import 100 000 rows: < 15 minutes;
- server error rate: < 0.5% over 15 minutes;
- RPO 24 h, initial RTO 4 h.

## Required test matrix

1. Baseline readiness + mobile pull at 1/10/50/200 concurrent users.
2. Mobile push replay after lost response; verify no duplicate business rows.
3. Upload separately at controlled bandwidth; verify S3 and DB backpressure.
4. 100k/500k import, queue retry, partial-error and idempotent replay.
5. Mass publish/task fan-out for 500 stores.
6. Analytics/export on full SKU/snapshot history.
7. Worker backlog, DB/S3 failure and recovery.
8. Eight-hour soak with metrics/heap/connection/storage growth captured.

Локальные capacity-сигналы уже доступны: Prometheus отдаёт PostgreSQL bytes и
S3 object count/bytes/age; mobile-профиль показывает allocated SQLite bytes и
offline-media files/bytes. Предупреждение media включается при 80% hard limit
100 files/512 MiB. Это диагностика, не доказательство сменного soak: пороги
SQLite, retention/archive и production alert owners утверждаются отдельно.

Первый read/sync baseline:

```bash
BASE_URL=https://client.example.com \
SYNC_VUS=10 DURATION=10m \
MOBILE_ACCESS_TOKENS='<token-device-1>,<token-device-2>,...' \
k6 run deploy/load/k6-read-sync.js
```

Нужен отдельный access token для каждого device/VU: один общий token исказит
тест rate limiting. Сценарий делает readiness и безопасный mobile pull; mutating push покрывает отдельный replay;
он не заменяет mutating replay/upload/import/publish тесты из матрицы.

Конкурентный replay запускается только на отдельном smoke tenant/task. Скрипт
создаёт ровно один комментарий, затем до 200 раз отправляет тот же `clientOpId`
и требует неизменный сохранённый результат. Явный gate защищает production от
случайного запуска:

```bash
BASE_URL=https://client.example.com \
MOBILE_ACCESS_TOKEN='<dedicated-device-token>' \
REPLAY_TASK_ID='<dedicated-task-id>' \
RUN_MUTATING_REPLAY=yes-i-understand \
REPLAY_VUS=20 REPLAY_ITERATIONS=100 \
k6 run deploy/load/k6-mobile-replay.js
```

После прогона оператор обязан подтвердить в БД, что для выведенного в тексте
комментария создана одна строка `TaskComment`, а не N строк. HTTP-проверка
доказывает стабильность persisted operation result, но сама по себе не заменяет
эту business-row integrity проверку.

Results must include commit/image SHA, dataset manifest/checksum, environment,
P50/P95/P99, throughput, error rate, max DB connections, RSS/heap, queue lag,
DB/object growth and all data-integrity assertions.

## Local readiness/pull tiers — 2026-07-18

Статус: короткие local stress runs, не production capacity/soak evidence.
Окружение: standalone Next.js, PostgreSQL 16, dev MinIO, demo seed, k6 1.2.3;
каждый VU имел отдельный device token, readiness = 5 RPS, duration = 10 s.

| VU | Prisma pool | Checks/errors | Pull P95 / P99 | Ready P95 / P99 | Gate |
| ---: | ---: | --- | --- | --- | --- |
| 1 | default | 71/71, 0% | 109.70 / 133.87 ms | 16.83 / 56.60 ms | PASS |
| 10 | default | 250/250, 0% | 160.83 / 207.96 ms | 17.49 / 58.68 ms | PASS |
| 50 | default | 717/717, 0% | 1.08 / 1.15 s | 343.66 / 521.68 ms | PASS |
| 200 | 50 | 3250/3250 и 3251/3251, 0% | 0.69 / 0.89 s и 0.59 / 0.76 s | 167.41 / 229.59 ms и 250.51 / 271.19 ms | PASS local fixture |

На 200 VU первый untuned full-sync run дал pull P95 6.38 s и readiness
P95 6.33 s. Pool=50 в отдельном run улучшил pull до 2.75 s, но readiness
остался 2.13 s. Stateful-cursor run вернул readiness в SLO, однако 200
одновременных initial sync сохранили pull P95 4.25 s. Нестабильность результата
подтвердила saturation исходного query path.

После этого добавлены четыре cursor-sort индекса, исключено повторное чтение
полного набора cursors и назначенных задач, а одинаковые конкурентные pull
ограниченно объединяются по `organization/user/cursors` только на время
активного запроса. Два последовательных pool=50 retest прошли: initial P95
891.34/720.31 ms, delta P95 349.20/437.73 ms, overall pull P95
691.73/591.63 ms, readiness P95 167.41/250.51 ms, HTTP errors 0%.

Ограничение результата существенно: fixture использует 200 разных device
tokens одного demo-user на одном app instance. Single-flight корректно защищает
именно этот thundering-herd случай; он не доказывает capacity для 200 разных
пользователей/наборов cursors или нескольких replicas. Поэтому local tier
зелёный, но production capacity/GA gate остаётся открытым.

Load tokens последнего retest подписаны локально и не создавали auth/device
rows; предыдущие auth sessions/devices удалены. Business mutations не
выполнялись. Нужны distinct-user query/pool profiling, production-like dataset
и длительный soak. Initial и delta pull имеют отдельные обязательные thresholds.

Distinct-user retest использовал 200 временных users, 200 devices и по одной
task на пользователя в demo tenant; каждому был подписан отдельный 15-minute
access token. Безопасный локальный Node runner (сторонний k6 container не получил
host network/workspace/token mount) за 20 s выполнил 3,002 pull requests:
errors=0, overall P50/P95/P99=313.80/1,142.18/1,171.92 ms; initial
P95/P99=1,191.18/1,217.97 ms; delta P95/P99=690.57/713.26 ms. Readiness:
82/82, P95/P99=193.85/368.68 ms. Post-run web RSS ≈205 MiB; DB connections
snapshot=10, это не peak. Все fixture users/devices/tasks, limiter buckets и
token file удалены.

Этот результат закрывает локальный distinct-user query/cursor риск на одном
standalone instance. Несколько replicas, production-like volume и 8h soak
оставались открыты. Повтор с теми же 200 distinct users, чередующий каждый
запрос между двумя независимыми standalone processes, также PASS: 3,348 pull,
0 errors; overall P50/P95/P99=138.85/1,004.28/1,060.32 ms; initial P95/P99=
1,062.89/1,064.93 ms; delta P95/P99=518.85/578.28 ms; readiness 86/86,
P95/P99=147.89/776.25 ms. Post-run RSS=210,456/192,040 KiB, DB connections
snapshot=19. Fixture снова полностью удалён.

Это local multi-instance evidence без reverse-proxy balancing/network и без
production-like history volume. 8h soak и peak DB/pool instrumentation pending.

## Local replay baseline — 2026-07-18

Статус: локальное доказательство одного сценария, не production capacity result.

- code: dirty working tree на базе `34b0dfc04ead4d61e553e5ef8230abb4d385c1ba`;
  до commit этот результат не является воспроизводимым release evidence;
- app image: `sha256:97f43db7bd8952b0629afe343b0c0b94b6f659f272557abc28ac14169c904840`;
- load tool: `grafana/k6:1.2.3`, digest
  `sha256:4f82892217f3110cb233e2b2622bcc97fabc70f14bd241fbfbfe7305105c68aa`;
- environment: local standalone Next.js + local PostgreSQL 16 + demo seed,
  без внешней сети и production-like data volume;
- workload: 20 VU, 100 concurrent replays, 102 HTTP requests;
- result: 304/304 checks, HTTP errors 0%, throughput 270.29 req/s;
- latency: average 62.15 ms, median 48.38 ms, P95 177.92 ms,
  P99 250.62 ms, max 263.45 ms;
- integrity: persisted result стабилен; `TaskComment` delta = 1, затем все
  созданные comment/session/device/outbox test artifacts удалены (остаток 0);
- не измерялись RSS/heap, DB connections, storage growth или queue lag.

Этот прогон закрывает только test-matrix item 2 на локальном demo fixture.
Multi-user/production-like pull, upload/import/publish/analytics/failure recovery
и 8h soak остаются обязательными до GA.

## Local sales snapshot import tiers — 2026-07-18

Статус: PASS для in-memory sales snapshot executor на isolated local fixture;
не является доказательством products/assortment, upload queue или client ERP.

Окружение: одноразовый PostgreSQL 16, чистые 24 миграции, demo seed,
`CHUNK_SIZE=500`, Node heap limit 4 GiB. Каждый tier выполнял первый import и
полный идемпотентный replay тех же уникальных natural keys.

| Rows | First import | Replay | Integrity | Max RSS | Gate |
| ---: | --- | --- | --- | ---: | --- |
| 100,000 | 12.292 s; 8,136 rows/s | 8.699 s; 11,496 rows/s | MATCH; 0 -> 100k -> 100k | 406 MiB | PASS local fixture |
| 500,000 | 56.425 s; 8,861 rows/s | 42.630 s; 11,729 rows/s | MATCH; 0 -> 500k -> 500k | 657 MiB | PASS local fixture |

Полный CSV queue/file/parser path также выполнен с автоматическим unlink:

| Rows / CSV | First queue job | Replay queue job | Integrity | Max RSS | Gate |
| ---: | --- | --- | --- | ---: | --- |
| 100,000 / 3.94 MB | 12.035 s; 8,309 rows/s | 8.396 s; 11,911 rows/s | MATCH; 0 -> 100k -> 100k | 558 MiB | PASS local fixture |
| 500,000 / 19.72 MB | 60.440 s; 8,273 rows/s | 44.510 s; 11,234 rows/s | MATCH; 0 -> 500k -> 500k | 1,213 MiB | PASS local fixture |

Benchmark защищён точной confirmation phrase, отказывается от non-loopback
`DATABASE_URL`, проверяет пустой date range, row counts и reconciliation. После
каждого прогона одноразовый DB container удалён.

Открытые ограничения: rows, CSV text и canonical checksum материализуются в
памяти — 500k queue peak уже около 1.18 GiB; XLSX не измерен. Products и
assortment всё ещё выполняют row-level upsert; не проверены partial-error retry,
mid-import kill, DB failure/backpressure и production-like reference cardinality.
Механика очереди отдельно проверена на малом реальном DB fixture: временно
отсутствующий input-файл переводит job в due-time retry и затем завершается без
дублей; stale PROCESSING requeue/terminal max-attempt и конкурентный claim двух
workers также PASS. Это не backlog/capacity или DB-outage доказательство.

После добавления общего capped exponential backoff с jitter import runner был
запущен отдельным процессом, а локальный PostgreSQL 16 дважды остановлен и
запущен. Процесс не завершился, ошибки tick дали последовательные attempt
1..8, после healthy polling возобновился, а второй outage снова начался с
attempt=1. После финального recovery 28 секунд успешных пустых poll не дали
ошибок; SIGINT выполнил draining shutdown, PostgreSQL остался healthy. Это
реальный local DB-process outage drill, но не production/multi-container/S3
failure evidence.

## Local import worker backlog tier — 2026-07-18

Guarded benchmark создает отдельную временную organization и file queue,
отказывается от non-loopback PostgreSQL и удаляет fixture после проверки.
500 одно-строчных product import jobs обработаны четырьмя конкурентными
worker loops за 2.970 s (168 jobs/s): completed=500, failed=0, products=500,
jobs с attempts!=1 — 0, оставшиеся input files — 0. Enqueue занял 2.004 s.

Это доказывает локальный claim/backlog path, но не поведение отдельных
контейнеров, тяжелых файлов, длительный queue lag, pool saturation, рестарт
процесса или отказ S3. Отдельный runner/PostgreSQL stop-start drill описан
выше; production и multi-container DB recovery всё ещё не доказаны.

## Local product catalog import tier — 2026-07-18

Realistic fixture содержит 100,000 новых SKU с уникальным barcode и полными
габаритами. До оптимизации последовательный 1k baseline был 7.059 s
(142 rows/s). Bounded concurrency=16 ускорил 1k до 1.173 s и сохранил
детерминированный first-row-wins для дубликатов barcode; regression suite
обнаружил первоначальную unique race общих справочников. Promise single-flight
для brand/supplier/manufacturer/category исправлен и подтверждён fixture из 64
параллельных строк; полный worker suite 40/40 прошёл три раза подряд.

| Path / input | First import | Replay | Integrity | Max RSS | Gate |
| --- | --- | --- | --- | ---: | --- |
| executor / 100k rows | 105.946 s; 944 rows/s | 66.217 s; 1,510 rows/s | MATCH; products 0 -> 100k -> 100k; barcodes=100k | 498 MiB | PASS local fixture |
| CSV queue / 7.81 MB | 147.065 s; 680 rows/s | 99.775 s; 1,002 rows/s | MATCH; products 0 -> 100k -> 100k; barcodes=100k | 613 MiB | PASS local fixture |

Это закрывает local 100k product catalog target с запасом к SLO 15 минут.
Не проверены 500k products (target относится к import rows, но catalog target
равен 100k SKU/tenant), XLSX, сложная cardinality брендов/категорий/внешних ID,
partial errors, mid-import kill и production-like recovery.

## Local mass publish tier — 2026-07-18

Статус: PASS для isolated 500-store FORMAT fixture; не production/soak evidence.

Окружение: одноразовый PostgreSQL 16, чистые 24 миграции, один tenant/format,
500 новых stores, одна валидная planogram placement. Publish path оптимизирован
с последовательных per-store writes до трёх bulk `createMany` операций внутри
той же транзакции.

| Stores | Publish operation | Integrity | Process RSS | Gate |
| ---: | ---: | --- | --- | --- |
| 500 | 175 ms | 500 tasks; 500 NEW histories; 1 shared assignment | +7.6 MiB; 155 MiB max for command | PASS local fixture |
| 4 tenants × 100 | 131 ms concurrent | per tenant: 100 tasks/histories, 1 assignment, 0 foreign tasks; replay rejected | 132→138 MB | PASS local fixture |

Повтор с исходной revision получил `invalid_state`; после него осталось ровно
500 tasks, 500 histories и одна assignment. Fixture требует точную confirmation
phrase, отказывается от non-loopback `DATABASE_URL`, а одноразовый DB container
после прогона удалён.

Concurrent fixture одновременно публикует четыре независимые planograms и
проверяет tenant isolation по каждой записи. Оба fixture остаются
single-process/loopback. Не измерены отдельные replicas/processes, pool
saturation, notification/outbox delivery после fan-out, production-like
network/storage latency и длительный soak.

## Local assortment and XLSX import tier — 2026-07-18

Fixture содержит 100,000 заранее заведённых SKU, 100 stores и смешанный набор
из 50,000 format-matrix и 50,000 store-exception строк. Bounded concurrency=16
сохраняет последовательность строк для одинакового natural key: последняя
строка детерминированно выигрывает. Последовательный 1k baseline до оптимизации
был 1.819/1.667 s; после — 0.359/0.267 s.

| Path / input | First import | Replay | Integrity | Max RSS | Gate |
| --- | --- | --- | --- | ---: | --- |
| executor / 100k rows | 31.777 s; 3,147 rows/s | 29.323 s; 3,410 rows/s | MATCH; 50k matrix + 50k store, stable | 612 MiB | PASS local fixture |
| CSV queue / 4.26 MB | 37.986 s; 2,633 rows/s | 29.628 s; 3,375 rows/s | MATCH; 50k + 50k, stable | 686 MiB | PASS local fixture |
| XLSX queue / 2.33 MB | 31.459 s; 3,179 rows/s | 27.861 s; 3,589 rows/s | MATCH; 50k + 50k, stable | 1.08 GiB command peak | PASS local fixture |

Исходный non-streaming ExcelJS reader функционально прошёл, но занял
499.620/801.480 s (200/125 rows/s) и достиг 910 MiB. Streaming reader ускорил
тот же workbook примерно в 15.9x/28.8x и сохранил `Cell.text` semantics в
regression tests. XLSX max RSS выше CSV, но замер всей команды включает создание
workbook самим fixture до job; отдельно parser-only peak не снят.

Не проверены реальные клиентские XLSX со styles/formulas/multiple sheets,
500k XLSX, partial-error файлы, crash/retry и сложная cardinality reference maps.

## Local media upload and backpressure tier — 2026-07-18

Статус: PASS limited на loopback PostgreSQL/MinIO; не reference-network или
production S3 evidence. Payload — валидный PNG, дополненный до ровно 10 MiB;
каждый VU использовал отдельный device access token и уникальный clientPhotoId.

Первый run обнаружил реальный transport mismatch: Next.js обрезал multipart на
10 MiB до route, хотя route разрешал photo=15 MiB/video=35 MiB. Transport limit
поднят до 40 MiB с запасом на multipart; route-level MIME/signature/size checks
остались 15/35 MiB.

| App capacity / workload | Result | Successful P95 | Integrity | Gate |
| --- | --- | ---: | --- | --- |
| 8 / 8 VU x 10 MiB | 8 accepted; 0 errors; 24/24 checks | 704.77 ms | DB 8 rows/keys/80 MiB = S3 8 objects/80 MiB | PASS local fixture |
| 8 / 16 VU x 10 MiB | 16 accepted; no overlap rejection | 1.11 s | functional PASS; backpressure assertion not exercised | INCONCLUSIVE backpressure |
| 2 / 8 VU x 10 MiB | 2 accepted; 6 explicit 503 + Retry-After; 24/24 checks | 396.97 ms | DB/S3 exactly 2 objects/20 MiB; rejected requests left 0 artifacts | PASS mechanism |

Permit берётся до `formData()`, поэтому одновременно буферизуется не больше
настроенного числа multipart bodies на replica. Default = 8, допустимый env
range 1..32. Object key уникален для попытки; если DB transaction падает,
удаляется только объект этой попытки. Это исключает orphan object и опасное
удаление объекта победителя при concurrent duplicate clientPhotoId. Helper и
semaphore покрыты regression tests.

Controlled local S3 outage drill остановил MinIO перед upload. Endpoint вернул
`503 storage_unavailable`, `Retry-After: 5` и support correlation ID; для
уникального clientPhotoId осталось DB rows=0 и objects=0. После healthy restart
повтор того же запроса вернул 201, DB/object появились согласованно и затем были
удалены вместе со всеми fixture user/device/task/token artifacts. PostgreSQL и
MinIO после cleanup healthy. Оба object-write endpoint теперь используют один
проверенный unavailable signal; это local provider-process test, а не
production S3/network evidence.

Предельный route/transport tier выполнен через свежий standalone production
build: один synthetic signature-valid MP4 ровно 35 MiB с duration=30 s получил
201 за 715.65 ms. `PhotoSubmission.fileSizeBytes` и MinIO object size совпали —
36,700,160 bytes, mediaType=VIDEO, durationMs=30,000; post-run server RSS был
311,380 KiB. Photo/reviews/object/user/device/task/token затем удалены, остаток
0. Payload проверяет multipart, лимит, DB/S3 consistency и cleanup, но не
является декодируемым camera video и не доказывает ffmpeg/vision worker path.

После runs удалены 26 S3 objects, 26 photo rows, 52 review rows, 48 sessions,
32 test devices и test limiter buckets; остаток photo/device artifacts = 0.

Ограничения: loopback не моделирует reference bandwidth/packet loss; max RSS во
время run не снимался (post-run standalone RSS около 327 MiB); не проверены
real camera/codec video analysis, slow production S3, cleanup failure
alert/reconciliation,
несколько replicas и длительная upload/retention нагрузка.

## Local analytics export serialization tier — 2026-07-18

Экспорт больше не наследует UI `take: 2000`: full-export mode tenant-scoped и
не содержит `take`. XML переведён с полной `.map().join()` материализации на
pull-based stream по одной строке.

Guarded in-memory fixture сериализовал 100,000 aggregated product rows в
100,002 chunks / 58,312,805 bytes за 728 ms (137,368 rows/s); max command RSS
275 MiB, escaping и число строк покрыты regression tests.

DB fixture затем создал 100,000 реальных Product/PlanogramPlacement rows.
Первоначальный full-array Prisma path дал single query 8.874 s + XML 0.581 s,
но два concurrent exports подняли RSS с 454 MB до 3.258 GB. После перехода на
pull-based DB pages, keyset cursor и индекс
`(planogramVersionId, productId, sortOrder, id)` тот же single export 55.29 MB
занял 10.959 s, два concurrent полных экспорта — 10.969 s; RSS вырос только с
438 MB до 554 MB. Integrity: 100,002 chunks на export, bytes идентичны.

Это PASS limited для planogram-products DB->XML path на loopback. Полная
analytics page по sales/stock history, client download/proxy timeouts,
несколько web replicas и snapshot growth ещё не измерены.
