# LeadShelf external production-readiness handoff

Статус: **NO-GO**. Документ перечисляет только отсутствующие внешние входы.
Секретные значения нельзя добавлять в этот файл, Git, issue, PR или чат:
передавать их через runtime secret manager/защищённый CI environment.

Проверенная инженерная база evidence: ветка `codex/production-readiness`,
remotely validated feature SHA `a257fa3f1e91150d3c9d60055855bafdc5dcbb2b`,
draft PR #19. Для
последующих docs/CI-pin commits authoritative SHA и checks берутся из PR.
Push, draft PR и read-only Actions checks выполнены; это не предоставляет
staging/production, S3, monitoring, mobile signing или client-data access.

## Доступы и минимальные права

| Gate | Что требуется | Минимальные права | Безопасная проверка предоставления |
| --- | --- | --- | --- |
| GitHub/CI | **ЧАСТИЧНО**: ветка/PR/push доступны; новые jobs блокирует billing аккаунта | push только ветки `codex/production-readiness`, read Actions/checks | PR #19 draft; feature SHA `a257fa3f...`, run 29669623000: 582-test `ci`, cross-browser smoke и secret/four-image scans SUCCESS; deploy SKIPPED. Media-encryption implementation SHA `7221c1e...`, run 29671574904: `ci` и secret/image scan получили zero-step account-level billing rejection, deploy SKIPPED |
| Staging | HTTPS URL и deploy target | deploy только staging namespace/service; read logs/health | `/api/ready`, TLS и immutable image SHA; никаких client production данных |
| Production deploy | Явное `Production deployment разрешён: ДА` | только release owner/CI environment после backup gate | verified backup+restore receipt, approved SHA, change window и rollback owner |
| PostgreSQL | Обезличенный production-like dump/staging DB | schema migrate/read/write только staging; production read запрещён до GO | restore в изоляции, `prisma migrate deploy/status`, row/checksum report |
| S3/R2 | endpoint/bucket/region и runtime credentials | app prefix read/write/delete; backup principal read-only; lifecycle admin отдельно | readiness, canary upload/read/delete и versioning/lifecycle evidence без вывода key |
| Backup | внешний restic repository и alert endpoint | append backup; restore в изолированный target; root-only runtime secret | backup → 100% check → isolated DB/media restore → checksum/RPO/RTO receipt |
| Monitoring | scraper, alert channel, log collector, Sentry projects | ingest/write для apps; read dashboards/checks; без admin за пределами проекта | test metric scrape, test alert delivery, Sentry test event и log redaction check |
| ERP/1C | mapping sheet, 14 input manifests/fixtures и data owner | read согласованных staging files/API; без произвольного ERP write | count/SHA-256/totals reconciliation и replay report на каждом exchange |
| Mobile signing | EAS/Apple/Google signing environments + утверждённый iOS bundle identifier (config пока placeholder) | build/sign/internal distribution; без store production publish до GO | immutable APK/AAB/IPA SHA, SQLCipher availability/header/integrity, plaintext upgrade, install/upgrade/rollback на matrix devices |
| Devices | iOS, current Android, low-end Android | test devices без реальных персональных данных | device IDs/OS/app SHA + signed smoke/offline/kill/disk-full/8h shift report |
| Pilot | 1 client, 3–5 stores, 10–20 trained users, 2–4 weeks | изолированный tenant и согласованный support channel | acceptance log, incident/feedback journal, daily evidence и owner signatures |

## Решения владельцев

До любых необратимых действий должны быть письменно заполнены и иметь owner,
дату, evidence ID и review date:

| Решение | Обязательное значение |
| --- | --- |
| Фото retention | число дней + legal basis + backup/lifecycle treatment |
| GPS retention | число дней + purpose + роли доступа |
| Audit retention | число дней + security/legal basis |
| Privacy mode | verified pre-persistence face blur **или** режим без покупателей |
| Mobile encryption | SQLCipher operational SQLite и AES-256-GCM durable offline media уже реализованы; утвердить key-loss recovery/approved wipe, iOS identity/signing и получить signed-device DB/media migration/upload/preview/revocation + low-end memory evidence |
| Login lockout | durable HMAC machinery/timed unlock уже реализованы; утвердить threshold/window/duration, secret-manager pepper и controlled manual unlock/support owner |
| SLA/on-call | timezone, support hours, P0–P3 targets, named L1/L2/incident commander |
| ERP destructive full sync | absence semantics, confirmation threshold и recovery owner |
| Production deploy | точное `ДА`, approved SHA, окно, backup receipt и rollback owner |

## Порядок приёмки

1. Владелец заполняет доступы/решения вне Git и выдаёт evidence IDs.
2. Release owner проверяет минимальные права read-only/preflight операциями.
3. Сначала staging: migrations, smoke, failure tests, restore, security, load.
4. Затем signed mobile matrix и 8-часовая смена; после — 14 ERP exchanges.
5. Pilot стартует только при зелёных entry gates из `PILOT_GA_RUNBOOK.md`.
6. Production deploy разрешён только при явном `ДА`; отсутствие поля = запрет.
7. GA остаётся `NO-GO`, пока 2–4 week pilot и подписи владельцев не завершены.

## Сейчас отсутствует

В переданном промте все значения остались буквальными placeholders (`[URL]`,
`[СПОСОБ ДОСТУПА]`, `[ДА/НЕТ]`). Это не доступ и не решение. Единственное
новое локальное evidence — подготовленный commit. Push ветки
`codex/production-readiness` и запуск GitHub Actions явно разрешены
2026-07-19; production deploy этим разрешением не разрешён.

Read-only runtime evidence 2026-07-18 22:56 UTC: публичный `/api/health`
отвечает 200, но `/api/ready` и `/api/metrics` отвечают 404; direct readiness
тоже 404. Login не отдаёт новый security-header baseline. Следовательно,
текущий production работает не на `bae29c8`; это **не** разрешение deploy.
