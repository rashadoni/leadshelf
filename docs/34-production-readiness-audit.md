# Production readiness audit — 2026-07-19

Статус решения: **NO-GO для client production и GA**.

LeadShelf уже является рабочим интегрированным MVP для локального demo/smoke,
но production-ready считается только система с доказанными инфраструктурой,
полевым mobile release, клиентскими данными, privacy/legal controls и pilot
evidence. Отсутствующее внешнее доказательство не заменяется новым кодом.

## Проверенная инженерная база

| Gate | Результат | Evidence |
| --- | --- | --- |
| Prisma schema/client | PASS | validate + generate; Prisma 6.19.3 |
| Миграции | PASS local; prior remote PASS | current 33/33 на чистой изолированной PostgreSQL 16; remotely validated feature SHA имел 30/30 |
| Unit/integration | PASS local; prior remote PASS | current clean 33-migration schema 626/626: core 106, mobile 175, DB 92, vision 43, worker 68, web 142; remotely validated feature SHA — 582/582 |
| Production build | PASS | Next.js 15.5.20 standalone build |
| Browser smoke | PASS | prior full 21/21; current tenant-qualified login regression 15/15 Chromium, Firefox, WebKit at 390/768/1440 + RU/AZ keyboard/focus + safe support errors + axe WCAG A/AA |
| Public runtime smoke | FAIL / NO-GO | 2026-07-18 22:56 UTC: `hermescrm.xyz/api/health`=200, `/api/ready`=404, `/api/metrics`=404; direct `/api/ready`=404. Login response lacks new CSP/HSTS/frame/nosniff and exposes `x-powered-by`; hardening commit is not deployed |
| Dependency audit | PASS local | production audit: 0 known vulnerabilities |
| Secrets | PASS local | current source 0; full Git history 0 verified/unknown |
| Remote CI | PASS last executable / BLOCKED implementation run | PR #19 draft; exact feature SHA `a257fa3f1e91150d3c9d60055855bafdc5dcbb2b`, run 29669623000: 582-test `ci` + cross-browser smoke SUCCESS, secret + four production-image High/Critical scans SUCCESS; deploy SKIPPED. Telemetry SHA `1ced5a53356a14ed391f22b3484424bf37b06186`, run 29672742232: `ci` и secret/image scan имели `steps: []`, потому что GitHub отклонил jobs из-за failed account payment/spending limit; deploy SKIPPED. Это внешний billing blocker, не результат тестов |
| Runtime images | PASS local | Grype High/Critical=0; current web `sha256:1500d453de78...`, worker `sha256:1082a67e8c32...`; custom Caddy/PostgreSQL also clean |
| Compose/proxy/scripts | PASS | Compose config, Caddy validate, workflow YAML, bash syntax, diff check |
| Restore drill | PASS local | encrypted restic restore, checksums, 23 migrations, media=1/26 bytes |
| Post-deploy smoke | PASS local | health/readiness/login/pull/logout; opt-in comment delta=1, cleanup=0 |
| Replay/idempotency | PASS local | 20 VU, 100 replays, 304/304 checks, P95 177.92 ms, row delta=1 |
| Pull 1/10/50 VU | PASS local | 0% errors; P95 109.70 ms / 160.83 ms / 1.08 s |
| Pull 200 VU | PASS limited | два same-user/device-distinct run: 3250/3250 и 3251/3251; overall P95 0.69/0.59 s; 0% errors |
| Pull 200 distinct users | PASS limited | 3002 requests/0 errors in 20 s; overall P95 1.142 s; initial 1.191 s; delta 0.691 s; readiness 82/82 P95 0.194 s; one instance |
| Pull 200 users / 2 instances | PASS limited | 3348 requests/0 errors; overall P95 1.004 s; initial 1.063 s; delta 0.519 s; readiness 86/86 P95 0.148 s; RSS 206/188 MiB |
| Sales import 100k/500k | PASS limited | executor + real CSV queue/replay: first 12.035/60.440 s; MATCH; stable rows; queue max RSS 558 MiB/1.18 GiB |
| Product import 100k | PASS limited | realistic barcode executor/CSV queue + replay: first 105.946/147.065 s; MATCH; products/barcodes=100k; queue max RSS 613 MiB |
| Assortment/XLSX 100k | PASS limited | mixed 50k format + 50k store executor/CSV/XLSX: first 31.777/37.986/31.459 s; replay stable; XLSX command max RSS 1.08 GiB |
| Publish fan-out 500 stores | PASS limited | isolated FORMAT fixture: 175 ms; 500 tasks/histories; one assignment; rejected replay left counts unchanged |
| Publish 4 tenants × 100 | PASS limited | concurrent 131 ms; per tenant 100 tasks/histories, 1 assignment, 0 foreign tasks; replay rejected |
| Media upload 10 MiB | PASS limited | capacity=8: 8/8 accepted, P95 704.77 ms, DB/S3 8 objects=80 MiB; capacity=2 overload: 2 accepted + 6 explicit 503, rejected artifacts=0 |
| Media video 35 MiB | PASS limited | standalone build: synthetic signature-valid MP4 201 in 715.65 ms; DB/S3=36,700,160 bytes; post-run RSS 311,380 KiB; cleanup=0 |
| Media S3 outage/recovery | PASS limited | local MinIO stop: 503 + Retry-After + correlation ID, DB/S3 artifacts=0/0; restart + same clientPhotoId: 201; cleanup=0 |
| Analytics DB/XML 100k | PASS limited | keyset DB->XML: single 10.959 s; 2 concurrent 10.969 s; 55.29 MB each; RSS 438->554 MB (rejected full-array baseline ended at 3.258 GB) |

Подробные load metrics и ограничения: `deploy/CAPACITY_SLO.md`.
Security/API inventory: `docs/33-security-api-inventory.md`.

## Реализовано в этой production-readiness итерации

- durable PostgreSQL-backed atomic rate limiting для login/sync/upload/import
  и внешнего OpenAI/Gemini proof budget; AI over-limit до media/AI call уходит
  в persisted human-review fallback;
- fail-closed inventory всех 63 v1 route files, включая отдельную
  `requireFieldBffSession` boundary для internal Field BFF, и representative dynamic
  cross-tenant import/media tests; 33-case PostgreSQL IDOR matrix охватывает
  read/write/delete во всех 29 текущих ID-bearing route-файлах и проверяет
  отсутствие target mutations; worker matrix fail-closed quarantines corrupt
  import/notification/proof tenant links before foreign mutation/send/storage
  и проверяет scheduled overdue/stock-gap/digest isolation; dynamic RBAC
  исполняет все 40 office mutations с запрещённой ролью и точным 403;
- pinned GitHub Actions, full-history secret scan и four-image vulnerability gate;
- production deploy больше не следует автоматически из push в main: job
  требует explicit repository enable и protected environment, pinned known
  hosts, non-root SSH и root-owned exact-SHA wrapper. Mode-0600 receipt
  fail-closed связывает SHA с approval, backup/restore и rollback evidence;
  wrapper выполняет новый backup+verify до migration, ждёт health web/vision/
  всех workers до success receipt и никогда не seed-ит demo.
  Негативные receipt/workflow invariant tests PASS; реальная environment
  protection и release execution остаются внешним gate;
- non-root web/worker images без npm/corepack; custom current Caddy/PostgreSQL
  wrappers без High/Critical findings;
- archived MinIO удалён из production; production требует maintained external
  S3/R2; backup/drill больше не запускают archived MinIO image;
- readiness/metrics, localhost Caddy Prometheus endpoint, JSON access logs и
  privacy-safe worker JSON logs; paginated/cached S3 object count/bytes
  inventory с ready/age signals (unit PASS; current local `.env` runtime
  credential mismatch вернул 403, поэтому live value не заявляется);
- единый client error contract с RU/AZ support correlation ID для текущего
  fetch inventory; network failure становится retryable 503, а 3-browser E2E
  доказывает, что private response body не показывается пользователю;
- post-deploy mobile smoke больше не передаёт PIN, access/refresh tokens или
  tenant identifiers через jq/curl argv: owner-only PIN, mode-0600 temp request/
  curl-config files, disabled implicit `.curlrc` и trap cleanup. Mock health/
  ready/login/pull/push/logout regression доказывает отсутствие private markers
  в child argv/stdout/stderr и fail-closed отклоняет group/world-readable или
  symlink PIN; deployed full smoke pending;
- ERP destructive guard больше не имеет boolean bypass: опасный zero/>10% drop
  допускается только HMAC-SHA-256 approval с exact action/tenant/entity/source
  checksum/current active-set checksum/counts/issuedAt/expiresAt binding,
  change/reason и двумя разными approval IDs, <=1h TTL и >=32-byte explicit
  secret. Controlled file-based
  issuer проверяет owner/mode/no-symlink, пишет token O_EXCL mode 0600 и не
  раскрывает protected values через CLI. Durable queue persist-ит только token
  path; default-disabled consumer повторно проверяет source/context и атомарно
  выполняет upsert + absent-SKU soft-deactivation + audit в serializable tenant-
  locked transaction только при MATCH/zero errors; DB trigger сериализует
  concurrent same-tenant product writes без блокировки neighbor. PostgreSQL
  end-to-end, rollback-on-drift и lock concurrency PASS; production secret-manager/
  UID mount, client mapping и staging/14-run evidence отсутствуют;
- axe audit без rule exclusions на RU/AZ login/catalog/tasks/analytics во всех
  трёх браузках; zoom остаётся доступен, selects именованы, nested controls
  устранены, horizontal analytics tables доступны с клавиатуры;
- controlled k6 replay и stateful pull tiers с hard mutation guard;
- mobile pull cursor/task read reduction, четыре cursor-sort индекса и bounded
  tenant/user/cursor single-flight с retry/bound regression tests;
- bounded product import concurrency с детерминированным duplicate-barcode
  first-row-wins и Promise single-flight общих справочников (64 concurrent-row
  regression; worker suite 40/40 три раза); guarded 100k product и 100k/500k
  sales executor/queue fixtures;
- key-ordered assortment concurrency и streaming XLSX reader; guarded mixed
  100k assortment executor/CSV/XLSX fixture с полным replay;
- bulk transactional publish fan-out и guarded 500-store integrity/replay fixture;
- 40 MiB Next transport limit согласован с 15/35 MiB route guards; pre-parse
  upload semaphore, unique attempt keys и compensating S3 cleanup;
- full tenant analytics export без silent 2k truncation и pull-based XML stream;
- пять sales/stock analytics loaders без silent 5k–15k truncation: полная
  deterministic keyset pagination по 2k и >page regression test;
- mobile capacity diagnostics: SQLite allocated bytes и offline media
  files/bytes в профиле с near-limit warning; device-shift evidence pending;
- remote mobile revocation: failed refresh becomes terminal `authLost`, stops
  retry, single-flight wipes media/operational SQLite/SecureStore and returns
  to login; all backends are attempted on partial failure. Mobile 173/173 PASS;
  signed Android/iOS device evidence remains external;
- mobile operational SQLite at rest: SQLCipher 4 включён для Android/iOS native
  builds, device-only 256-bit SecureStore key не регенерируется поверх
  существующей encrypted DB; legacy plaintext migration сверяет schema/row
  inventory, marker и `cipher_integrity_check` до удаления исходника и
  fail-closed показывает privacy-safe RU/AZ recovery. Durable offline
  photo/video/commercial/visit/document files шифруются AES-256-GCM отдельным
  device-only key: journalled legacy migration, atomic decrypt/byte-verify до
  удаления plaintext, startup integrity scan, fail-closed missing key/corrupt
  file, temporary decrypt cleanup и full logout/revoke wipe; Android backup
  отключён. Mobile 173/173, typecheck, Expo config и production web build PASS;
  это code/config evidence, а не signed-device proof. Physical DB/media
  migration/upload/preview/revocation и low-end memory matrix, iOS bundle
  identifier/signing и recovery approval остаются внешними блокерами;
- authenticated API boundary emits privacy-safe allowlisted structured JSON
  with method/path/correlation/organization/user/device/task context; query,
  authorization, session ID and arbitrary headers are excluded by tests;
- strict optional ERP manifest для sync/queue imports с persisted expected
  rows/SHA-256/entity-specific totals, точной BigInt decimal-сверкой и
  fail-visible COMPLETED_WITH_ERRORS при mismatch; локальные unit/integration
  tests PASS, реальный клиентский manifest не заявляется;
- isolated PostgreSQL core-workflow test: product import -> equipment/planogram
  -> publish/task -> persisted proof -> human review -> completed -> sales
  reconciliation/aggregate; fixture cleanup оставил residue=0. Это DB-level
  evidence, не замена HTTP multipart/S3/native user walkthrough;
- controlled tenant DB offboarding CLI с dry-run row/media inventory, exact
  ID+slug confirmation, dual approval, external backup/media receipts,
  legal-hold gate, FK-safe serializable delete и zero-residue verification;
  integration test сохранил соседний tenant. External S3/backups purge и
  policy/legal сроки остаются внешними gates;
- guarded retention CLI с explicit UTC as-of и отдельными media/GPS/audit
  сроками, manifest SHA-256 drift guard, dual approval/receipts/legal hold,
  tenant lock + serializable execution, derived-frame inventory и fail-closed
  GoldenReference guard; удаляет expired DB media/location/audit
  и redacts GPS в Visit/EXIF/geofence/visit-alert JSON, затем атомарно пишет
  минимальный retention audit event. На изолированной схеме
  33/33 migrations и DB 92/92 PASS; recent/neighbor сохранены. Двухфазный
  external-media workflow локально связывает этот DB digest с exact tenant S3
  keys, paginated object versions/delete markers, expiring dual approvals,
  backup/legal-hold receipts, preflight drift, expiry-blocked untouched start,
  idempotent post-expiry partial retry и
  post-delete zero-version verification; worker fake-versioned-store + DB
  integration и pagination/cursor tests в worker 68/68 PASS. Actual adapter
  drill на isolated local versioned MinIO также PASS: 2 versions
  →0, head=false и bucket после trap отсутствует. Это local capability, не
  staging provider/least-privilege evidence. Manifest >64 MiB отклоняется
  fail-closed. Реальный versioned staging S3, утверждённые сроки/legal basis,
  scheduler, автоматизированный tenant media-write quiescence/batching и backup
  lifecycle остаются gates;
- controlled DSAR CLI строит tenant/subject inventory, не выводит PII или
  subject/request identifiers в stdout, требует manifest match, exact
  confirmation, dual approval и legal-basis receipt, создаёт только новый
  mode-0600 AES-256-GCM artifact и минимальный audit event. Credential hashes,
  JTI и push tokens исключены; encrypted bundle покрывает GPS/media metadata,
  sync и authored/agent commercial records. Tenant-isolation/decrypt/secret
  regression PASS; approved real delivery/decrypt/delete drill остаётся gate;
- mobile push domain log фиксирует только correlationId/org/device/opId/kind/
  status после schema validation; unit доказывает отсутствие payload/result
  detail, GPS, token/email и отбрасывание unsafe IDs; web 140/140 PASS;
- demo seed больше не выводит пароль/PIN, email/display names или raw error в
  CI/stdout: success/failure — allowlisted structured events, а regression 2/2
  проверяет отсутствие credential/private error material;
- Sentry envelopes для web/workers/mobile больше не содержат raw message,
  stack или arbitrary context: exception сводится к safe type, metadata — к
  bounded allowlist. Негативные tests внедряют email/PIN/password/bearer/JWT,
  private paths и nested objects и доказывают их отсутствие; HTTP reject ingest
  не считается доставкой. Реальные production projects/event/access/retention
  остаются внешним observability gate;
- `/api/metrics` теперь отдаёт aggregate rolling-15m failures для mobile
  outbox/import/proof/notifications; migration 33 добавляет шесть partial
  indexes, а forced EXPLAIN доказал Index Only Scan для failure/oldest-work
  queries. Набор
  из 19 Prometheus rules покрывает web/storage availability, queue/failure/lag,
  sync-conflict growth,
  full-sync approval wait/cancel cleanup, 5xx/P95, backup/disk/TLS; pinned promtool syntax PASS и все 19 firing fixtures
  PASS, `pnpm alerts:check` включён в обязательный PR CI. External
  scraper/Alertmanager, named routing и staging delivery
  остаются gates;
- account-wide web/mobile lockout: durable tenant-qualified HMAC-SHA-256
  principal с отдельным secret-manager pepper без IP/PII; web login, limiter и
  lockout требуют organization slug, поэтому одинаковые email разных tenants
  изолированы. Case-insensitive DB uniqueness защищает slug/email/employeeCode,
  а migration collision preflight не печатает conflicting PII;
  atomic threshold/window/duration, generic response, no attack extension,
  success reset, новое окно после timed unlock, allowlisted audit и fail-closed
  readiness без approved policy/pepper. PostgreSQL concurrency 12→threshold 5
  PASS. Controlled manual unlock реализован disabled-by-default через bounded
  mode-0600/O_NOFOLLOW request file, state digest + exact confirmation, dual
  approvals, ticket/reason, serializable locks, zero-residue verification и
  tenant audit без principal. DB profile 6/6, web auth 10/10, full suite
  610/610 и browser regression 15/15 PASS. Production values, named owners,
  approval policy, migration rehearsal и реальный unlock drill остаются gates;
- backup/restore, incident, ERP, privacy, pilot/GA runbooks и evidence templates.

## Технические блокеры до client production

1. Проверить production load balancer/replicas на production-like data и
   выполнить soak. Local 200 distinct users/cursor sets PASS на одном и двух
   standalone instances; это не доказывает network balancing, peak pool или
   долговременный рост.
2. Выполнить client XLSX/complex-ref import, reference-network/real camera
   video+analysis и
   slow/failing production-S3 upload tests, production-volume sales/stock analytics,
   proxy/multi-replica export и worker
   backlog/failure tests;
   повторить publish с concurrent multi-tenant/replica нагрузкой. Sales snapshot
   CSV queue 100k/500k и isolated publish-500 уже PASS limited.
   Локальная механика retry/stale recovery/concurrent claim для import,
   notification и proof workers PASS; import backlog 500 jobs/4 concurrent
   loops PASS local (2.970 s, 0 failed/duplicates/artifacts). Import runner
   пережил два реальных local PostgreSQL stop/start цикла: capped backoff
   вырос во время outage и сбросился после recovery. Local MinIO upload outage
   также PASS без DB/object artifacts и с успешным post-recovery retry.
   Production DB/S3 outage, long backlog/soak и multi-container recovery ещё
   не проверены.
3. Подключить production S3/R2 с versioning/lifecycle/least privilege и
   выполнить реальный encrypted backup + restore drill.
4. Настроить external metrics scraper, alerts, log collector/retention,
   Sentry DSN/test events и named on-call owners.
5. Выполнить независимый pentest точного deployed image/environment. Локально
   все 29 ID-bearing HTTP route-файлов покрыты 33 read/write/delete cases,
   все 40 office mutations — denied-role matrix, durable/scheduled jobs —
   PostgreSQL tenant-boundary tests.
6. Утвердить retention сроки/legal basis и подключить scheduler + external
   media purge к реализованному tenant-safe CLI; выполнить approved DSAR
   delivery/decrypt/delete drill; решить face/privacy режим до persistence.
7. Выпустить подписанные APK/AAB/IPA и пройти physical-device, offline/kill,
   permission, disk-full, battery/memory/SQLite shift matrix.

## Внешние доказательства до pilot/GA

- production URL/TLS/secrets и владельцы инфраструктуры;
- реальный клиентский ERP mapping + 14 последовательных reconciliation runs;
- privacy/legal basis, retention, consent и режим съёмки покупателей;
- обучение 10–20 пользователей и пилот 2–4 недели на 3–5 магазинах;
- договорный support SLA/on-call и подписанное GO/NO-GO решение;
- AI остаётся disabled/stub до 20–50+ размеченных proof и измеренных
  precision/recall/cost/latency.

## Следующее решение

Можно готовить commit/PR и controlled internal environment. Нельзя объявлять
client production/GA или включать реальные клиентские данные, пока отсутствуют
production-like load/soak и infrastructure/mobile/privacy/pilot evidence.
Канонический порядок и владельцы: `docs/03-roadmap-backlog.md` и
`deploy/PILOT_GA_RUNBOOK.md`.

Интегрированная инженерная база ветки `codex/production-readiness` на exact
feature SHA `a257fa3f1e91150d3c9d60055855bafdc5dcbb2b` прошла draft PR #19: remote
`ci` и secret/four-image vulnerability gate завершились SUCCESS, production
deploy закономерно SKIPPED для pull request. Полный минимально-привилегированный
handoff по отсутствующим placeholders: `deploy/EXTERNAL_READINESS_HANDOFF.md`.
Публичный read-only smoke дополнительно подтвердил, что текущий runtime старее
этого commit; deploy не выполнялся и без явного `Production deployment
разрешён: ДА` выполняться не будет.
