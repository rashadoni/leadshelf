# LeadShelf: единый контур сравнения выкладки

Статус: код фаз 0–8 реализован; authenticated web/mobile smoke закрыт, real-photo eval остаётся открытым gate, Phase 9 отложена. Обновлено: 2026-07-11.

## Цель

LeadShelf показывает результат проверки выкладки двумя связанными представлениями:

1. **Схема** — опубликованная планограмма против фактических SKU и facings.
2. **Фото** — golden reference против полевого фото с bbox-оверлеем.

Оба представления получают данные из одного `ShelfComparisonResult`. AI не
блокирует полевого сотрудника, а мобильная съёмка продолжает работать через
SQLite, photo queue и sync outbox.

## Неподвижные решения

- Реализация пишется заново внутри LeadShelf; код и контракты другого продукта не копируются.
- `PlanogramVersion` + `PlanogramPlacement` — источник ожидаемой выкладки.
- Не создаются вторые `Planogram`, `Product`, `Store`, `Visit` или `Photo`.
- Bbox: `{xPct,yPct,widthPct,heightPct}`, диапазон `0..100`, origin top-left.
- Structural compliance и visual confidence — разные сигналы, без слепого усреднения.
- Manual-wins, persist-first, идемпотентность и история анализов обязательны.
- AI error/parse failure даёт `UNAVAILABLE` или `REVIEW`, но не ложный нулевой score.
- Mobile protocol меняется только аддитивно; `MOBILE_PROTOCOL_VERSION` остаётся `1`.
- Любые новые mobile-строки одновременно добавляются в AZ и RU.
- OCR, обучение модели и расширенный anti-fraud не блокируют основной контур.

## Baseline

- [x] Ветка `feat/mobile-bottom-tabs` сохранена; draft PR #17 открыт.
- [x] PR #17 CI зелёный перед началом работ.
- [x] Ветка rebased на `origin/main` (`20/0` относительно main после rebase).
- [x] `pnpm typecheck` — passed.
- [x] `pnpm db:validate` — passed.
- [x] `packages/core` — 84/84 passed.
- [x] `apps/mobile` — 65/65 passed.
- [x] `services/vision` — 13/13 passed.
- [x] `packages/db` — 60/60 passed с локальным Postgres.
- [x] `.artifacts/` признан посторонним untracked-каталогом и не затрагивается.

## Сверка: existing / extend / new / reject

| Область | Статус | Действие |
|---|---|---|
| Catalog, Store, User, Visit | existing | использовать |
| Versioned planogram и placements | existing | использовать как expected truth |
| Tasks, PhotoSubmission, SQLite/outbox | existing | сохранить field flow |
| Golden reference и slot editor | existing | расширить |
| Vision v1 provider protocol | existing | расширить обратно совместимо |
| HumanReview | existing | расширить manual correction |
| Shelf comparison engine | new | создать в `packages/core` |
| Web dual viewer | new | создать |
| Analysis run history | new | создать аддитивной миграцией |
| Inline mobile base64 scan/polling | reject | использовать sync pull |
| Второй JSON-planogram | reject | использовать placements |
| OCR / training / advanced anti-fraud | later | после стабильного review loop |

## Фаза 0 — Reconciliation и baseline

- [x] Прочитать репо-инструкции и текущий reference-документ.
- [x] Проверить remote, ветку, PR и CI.
- [x] Rebase на актуальный main.
- [x] Зафиксировать baseline тестов.
- [x] Перевести reference-документ из «переноса» в reference-only статус.
- [x] Удалить из активной спецификации decommission LeadDrive.
- [x] Зафиксировать текущие LeadShelf сущности и отклонённые дубликаты.
- [x] Создать этот roadmap.

Gate: документация не предлагает второй доменный контур и baseline воспроизводим.

## Фаза 1 — ShelfComparisonResult и domain engine

- [x] Определить versioned `ShelfComparisonResult` и входные типы.
- [x] Нормализовать expected placements, reference slots и detections.
- [x] Валидировать bbox; отсутствие координат хранить как `null`.
- [x] Суммировать detections одного SKU по facings.
- [x] Не схлопывать один SKU с разных полок в один spatial block.
- [x] Рассчитать outcomes: matched/missing/wrong_product/wrong_position/facing_mismatch/extra.
- [x] Рассчитать lenient и strict compliance.
- [x] Рассчитать OOS, share of shelf и brand share.
- [x] Сгенерировать restock/add_facings/remove_facings/move/manual_review actions.
- [x] Разделить structural score и visual confidence.
- [x] Обеспечить детерминированную сортировку и результат.
- [x] Покрыть unit-тестами полный match, partial match, duplicates, unknown SKU,
      low confidence, invalid bbox, empty planogram и AI unavailable.

Проверка checkpoint: `packages/core` 100/100, полный monorepo test passed,
полный monorepo typecheck passed.

Gate: чистый `packages/core` API не зависит от Prisma/UI/provider и все тесты зелёные.

## Фаза 2 — Web viewer «Схема / Фото / Результат»

- [x] Создать adapter текущего `HumanReview.findings.vision`.
- [x] Создать server view model с planogram, golden, field photo и comparison.
- [x] Реализовать схему с outcome-цветами и expected/actual/delta.
- [x] Реализовать фото-режимы Golden/Actual/Overlay.
- [x] Связать selection между placement и bbox.
- [x] Добавить фильтры All/Issues/Uncertain.
- [x] Добавить action list и понятные pending/error/empty states.
- [x] Добавить AZ/RU web i18n и accessibility labels.
- [x] Покрыть parsing/view-model тестами.
- [x] Выполнить browser smoke на 390/768/1280 px; tablet grid исправлен после визуального осмотра.

Gate: один comparison читается и как схема, и как визуальное доказательство.

## Фаза 3 — Канонические analysis runs

- [x] Добавить аддитивную модель `ShelfAnalysisRun` и enum статусов.
- [x] Связать run с org, PhotoSubmission, PlanogramVersion и GoldenReference.
- [x] Хранить provider/model/comparisonVersion/inputHash/result/error/timestamps/token/cost telemetry.
- [x] Поддержать несколько run одного фото и явный canonical result.
- [x] Добавить idempotent repository API и tenant isolation guard.
- [x] Связать HumanReview с конкретным run без удаления старых данных.
- [x] Сохранить backward-compatible чтение legacy `HumanReview.findings.vision`.
- [x] Обе аддитивные миграции применены к локальному Postgres; DB repository/race suite — 67/67.

Gate: HumanReview больше не единственное хранилище AI-результата, история не теряется.

## Фаза 4 — Worker reliability

- [x] Persist analysis run до обращения к provider.
- [x] Реализовать атомарный claim/CAS и защиту от двойного worker-а.
- [x] Реализовать retry/backoff, max attempts и stale recovery.
- [x] Разделить permanent missing-provider configuration и retryable worker failures.
- [x] Не сохранять parse failure как structural FAIL/0%; canonical result становится `UNAVAILABLE`.
- [x] Зафиксировать provider/model/token/cost/latency telemetry (`null`, если provider не отдал значение).
- [x] Унифицировать photo/video output и убрать inline photo inference из upload request.
- [x] Idempotency, exact-once claim, stale recovery и manual race доказаны: worker 20/20, DB 67/67.

Gate: таймаут, crash или повторный job не теряют фото и не портят результат.

## Фаза 5 — Manual review и correction

- [x] Редактировать/добавлять/удалять bbox с live overlay.
- [x] Выбирать SKU из tenant catalog и менять facings.
- [x] Пересчитывать comparison после ручной корректировки.
- [x] Сохранять provenance, reviewer и timestamps.
- [x] Реализовать approve/reject/request-retake.
- [x] Зафиксировать manual-wins транзакционно через lock родительского proof.
- [x] Audit trail и manual-wins regression/race tests выполнены на мигрированной локальной БД.

Gate: повторный worker run не изменяет утверждённый manual result.

## Фаза 6 — Offline mobile result

- [x] Аддитивно расширить mobile v1 payload optional comparison summary без смены protocol version.
- [x] Обновить server sync mapping и SQLite migration.
- [x] Сохранять summary/actions/detections локально.
- [x] Показать states queued/uploaded/analyzing/review/approved/retake/unavailable.
- [x] Добавить action-first результат и режимы Схема/Фото/Результат.
- [x] Не блокировать task/visit completion ожиданием AI.
- [x] Сохранить видимый SyncBar и тёмные camera/photo surfaces.
- [x] Добавить все ключи в AZ и RU; parity и mobile tests 67/67.
- [x] На чистом Android 35 AVD `leadshelf_smoke` установлен локальный debug APK и пройден authenticated `login -> pull/ack sync -> comparison result`; после отключения сети маршрут и тот же result повторно открыты из локального хранилища, SyncBar показывал offline state. Новая offline-фотосъёмка в этом прогоне не выполнялась и не заявляется как проверенная вручную.
- [x] Локальный release APK собран после принудительного JS rebundle с `10.0.2.2:3100`: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`, SHA-256 `bca9ec3eb000b01f1955add7344ced6358a145874802bb77de3ca3d572649bc9`.
- [x] Для локального authenticated smoke собран штатный `assembleDebug` без изменения production manifest: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`, SHA-256 `2703af85096c4bb8eca605f4dfbfac3728e71341167de7a43d1511f91ca0bebe`; API передан Metro через `EXPO_PUBLIC_API_URL=http://10.0.2.2:3100`.

Gate: офлайн-съёмка остаётся рабочей, результат появляется после sync.

## Фаза 7 — Analytics

- [x] Строить compliance/OOS/facings/share/actions из canonical runs.
- [x] Добавить store/agent/planogram/status/time filters.
- [x] Добавить snapshots/aggregation и нужные indexes.
- [x] Добавить human-review и retake quality metrics.
- [x] Проверить tenant isolation и 10k aggregation performance на мигрированной локальной БД.

Gate: аналитика не читает произвольный legacy JSON как источник истины.

## Фаза 8 — AI evaluation и улучшение

- [x] Создать versioned eval manifest schema без приватных фото в git.
- [x] Зафиксировать отдельные `ShelfLocalizer` и `ShelfSkuRecognizer` интерфейсы и two-stage pipeline.
- [x] Добавить deterministic golden comparison path через общий engine.
- [ ] Калибровать thresholds только на реальном LeadShelf eval data; приватный calibration pilot собран, внешний inference-run ещё требует явного privacy-разрешения.
- [x] Добавить воспроизводимые localization/SKU/calibration metrics и provider/model/cost/latency telemetry.
- [x] Не заявлять подтверждённую accuracy без реальных размеченных фото.

Gate: provider выбирается по воспроизводимому eval, а не по названию модели.

Приватный размеченный calibration pilot теперь содержит шесть реальных фото:
golden, missing SKU, wrong position, perspective, extra facing и rotated label.
Фото и отчёты не хранятся в Git. Validation/test split пока отсутствуют, а
первый разрешённый Gemini provider-run выявил integration defects: пять ответов
не прошли JSON extraction, а успешный ответ вернул bbox в масштабе 0..1 вместо
0..100. Tolerant extraction и bbox normalization добавлены со строгой
последующей Zod-валидацией; повторный внешний run требует нового явного
privacy-разрешения. Поэтому результаты первого run не являются accuracy,
threshold calibration и выбор production provider/model ещё не подтверждены.

После запрета повторной внешней передачи выполнен полностью локальный Apple
Vision OCR baseline: текст найден в 41/42 human-annotated product boxes
(97,6%), в clear condition — 41/41, в rotated-label condition — 0/1. Отчёт
остаётся приватным. Это `oracle-box-text-evidence`, а не object localization и
не SKU accuracy; результат подтверждает только ценность OCR как uncertainty
signal для повёрнутой/нечитаемой этикетки.

### Расширение датасета и разделение localization/SKU (12 июля 2026)

- [x] Аддитивные поля манифеста (`version: 1` сохранён): `sourceKind:
      real|synthetic` и `notes` на сэмпле; старый пилотный манифест валиден
      без изменений.
- [x] `dataset-cli` (`check` / `stats` / `add-sample`): детерминированное
      hash-назначение сплита (40/40/20 по умолчанию), запрет переназначения,
      leakage-guard (одно фото не живёт в двух сплитах), покрытие по
      split/source/scenario/condition.
- [x] Дисциплина сплитов в eval-cli: `test` исполняется только с явным
      `--include-test`; отчёт фиксирует `requestedSplits`/`testIncluded`;
      threshold sweep жёстко ограничен calibration.
- [x] `--mode oracle_boxes`: human-боксы -> `ShelfSkuRecognizer`, чистая
      SKU-классификация отдельно от object detection (localization = 1.0 по
      построению). Кандидаты только из golden-выкладки; ответ вне списка
      принудительно `null` + warning (анти-галлюцинация).
- [x] Recognizer-реализации: stub (wiring-only, отвечает «не уверен»),
      Gemini и OpenAI (full-photo + numbered boxes, строгая схема,
      privacy-gate `--allow-external` как у scan).
- [x] `two_stage` (localizer -> recognizer) прошит в runner и покрыт
      тестами со stub-стадиями; реального localization-провайдера ещё нет.
- [x] Машинно-видимый гейт `accuracyClaims` в каждом отчёте: `allowed=false`,
      пока validation/test не содержат >= 20 успешных real-сэмплов (порог —
      константа `MIN_REAL_SAMPLES_FOR_ACCURACY_CLAIMS`, менять — решением
      владельца) или активен stub.
- [ ] Наполнить validation/test реальными размеченными фото через
      `dataset-cli add-sample` (требует полевых съёмок владельца) и только
      после этого выполнять внешние provider-runs с новым явным
      privacy-разрешением.

Код и тесты не содержат приватных фото; AI остаётся review-only. Никакие
accuracy-числа не заявляются: пилот calibration-only, гейт в отчётах это
блокирует автоматически.

## Фаза 9 — Поздние возможности

- [ ] OCR и price compliance под feature flag OFF.
- [ ] COCO export подтверждённых аннотаций.
- [ ] Training runs и active model per organization.
- [ ] Photo-quality и anti-fraud только как false-positive-safe сигналы.
- [ ] Perfect Store после явной конфигурации бизнес-весов.

## Проверки каждого checkpoint

- `pnpm typecheck`
- `pnpm test` (DB suites с доступом к локальному Postgres)
- `pnpm db:validate`
- `pnpm db:generate` после schema changes
- targeted tests затронутого пакета
- browser smoke после web UI
- mobile `tsc`, tests, i18n parity и emulator smoke после mobile UI
- `git diff`, `git status`, secret/unrelated-file audit перед commit

## Финальная локальная матрица 2026-07-11

- [x] `pnpm typecheck` — все 8 затронутых workspace packages.
- [x] `pnpm lint`.
- [x] Prisma validate и generate; обе аддитивные миграции deployed локально.
- [x] Core 100/100, DB 67/67, worker 20/20, vision 16/16, web 52/52, mobile 67/67.
- [x] Отдельный mobile `tsc --noEmit` и AZ/RU parity.
- [x] Browser smoke viewer на 390/768/1280 выполнен до final schema migration; selection, action-first result и отсутствие horizontal overflow проверены.
- [x] Post-migration browser login в demo tenant пройден; dashboard открылся после авторизации.
- [x] Release APK build, install и cold launch.
- [x] Authenticated Android smoke пройден на чистом Android 35 AVD: login 200, sync pull/ack 200, task comparison с `Sxem / Foto / Nəticə`, затем offline reopen сохранённого result и схемы при видимом SyncBar.
- [ ] Новая offline capture -> reconnect -> upload не повторялась вручную в этом прогоне; код пути покрыт mobile/outbox тестами, но это остаётся отдельным расширенным device smoke, а не условием authenticated result gate.
- [x] `.artifacts/` не читался, не изменялся и не добавлялся в staging.

## Definition of done

- Оба режима работают от одного versioned comparison result.
- Схематическое и визуальное выделение синхронизированы.
- Manual-wins и worker idempotency доказаны тестами.
- AI failure не создаёт ложный нулевой compliance.
- Mobile capture остаётся offline-first, результат приходит через sync.
- Аналитика читает канонические confirmed/current analysis runs.
- Все обязательные проверки зелёные.
- Вертикальные срезы закоммичены и pushed в существующую ветку/PR.
- Итог содержит commit SHA, CI, ограничения, APK path и SHA-256.
