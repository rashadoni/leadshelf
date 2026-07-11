# LeadShelf: единый контур сравнения выкладки

Статус: active implementation roadmap. Обновлено: 2026-07-11.

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

- [ ] Определить versioned `ShelfComparisonResult` и входные типы.
- [ ] Нормализовать expected placements, reference slots и detections.
- [ ] Валидировать bbox; отсутствие координат хранить как `null`.
- [ ] Суммировать detections одного SKU по facings.
- [ ] Не схлопывать один SKU с разных полок в один spatial block.
- [ ] Рассчитать outcomes: matched/missing/wrong_product/wrong_position/facing_mismatch/extra.
- [ ] Рассчитать lenient и strict compliance.
- [ ] Рассчитать OOS, share of shelf и brand share.
- [ ] Сгенерировать restock/add_facings/remove_facings/move/manual_review actions.
- [ ] Разделить structural score и visual confidence.
- [ ] Обеспечить детерминированную сортировку и результат.
- [ ] Покрыть unit-тестами полный match, partial match, duplicates, unknown SKU,
      low confidence, invalid bbox, empty planogram и AI unavailable.

Gate: чистый `packages/core` API не зависит от Prisma/UI/provider и все тесты зелёные.

## Фаза 2 — Web viewer «Схема / Фото / Результат»

- [ ] Создать adapter текущего `HumanReview.findings.vision`.
- [ ] Создать server view model с planogram, golden, field photo и comparison.
- [ ] Реализовать схему с outcome-цветами и expected/actual/delta.
- [ ] Реализовать фото-режимы Golden/Actual/Overlay.
- [ ] Связать selection между placement и bbox.
- [ ] Добавить фильтры All/Issues/Uncertain.
- [ ] Добавить action list и понятные pending/error/empty states.
- [ ] Добавить AZ/RU web i18n и accessibility labels.
- [ ] Покрыть parsing/view-model тестами.
- [ ] Выполнить browser smoke на desktop и узкой ширине.

Gate: один comparison читается и как схема, и как визуальное доказательство.

## Фаза 3 — Канонические analysis runs

- [ ] Добавить аддитивную модель `ShelfAnalysisRun` и enum статусов.
- [ ] Связать run с org, PhotoSubmission, PlanogramVersion и GoldenReference.
- [ ] Хранить provider/model/protocol/inputHash/result/score/confidence/error/timestamps.
- [ ] Поддержать несколько run одного фото и явный current result.
- [ ] Добавить idempotent repository API и tenant isolation.
- [ ] Связать HumanReview с конкретным run без удаления старых данных.
- [ ] Сохранить backward-compatible чтение legacy `HumanReview.findings.vision`.
- [ ] Добавить migration, Prisma validation и DB tests.

Gate: HumanReview больше не единственное хранилище AI-результата, история не теряется.

## Фаза 4 — Worker reliability

- [ ] Persist analysis run до обращения к provider.
- [ ] Реализовать атомарный claim/CAS и защиту от двойного worker-а.
- [ ] Реализовать retry/backoff, max attempts и stale recovery.
- [ ] Разделить transient/permanent errors.
- [ ] Не сохранять parse failure как compliance result.
- [ ] Зафиксировать provider/model/cost/latency.
- [ ] Унифицировать photo/video output.
- [ ] Доказать idempotency и гонки тестами.

Gate: таймаут, crash или повторный job не теряют фото и не портят результат.

## Фаза 5 — Manual review и correction

- [ ] Редактировать/добавлять/удалять bbox.
- [ ] Выбирать SKU из локального каталога и менять facings.
- [ ] Пересчитывать comparison после ручной корректировки.
- [ ] Сохранять provenance, reviewer и timestamps.
- [ ] Реализовать approve/reject/request-retake.
- [ ] Зафиксировать manual-wins транзакционно.
- [ ] Добавить audit trail и regression tests.

Gate: повторный worker run не изменяет утверждённый manual result.

## Фаза 6 — Offline mobile result

- [ ] Аддитивно расширить mobile v1 payload optional comparison summary.
- [ ] Обновить server sync mapping и SQLite migration.
- [ ] Сохранять summary/actions/detections локально.
- [ ] Показать states queued/uploaded/analyzing/review/approved/retake/unavailable.
- [ ] Добавить action-first результат и режимы Схема/Фото.
- [ ] Не блокировать task/visit completion ожиданием AI.
- [ ] Сохранить видимый SyncBar и тёмные camera/photo surfaces.
- [ ] Добавить все ключи в AZ и RU, обновить parity tests.
- [ ] Выполнить offline capture -> sync -> result emulator smoke.
- [ ] Собрать APK локально и записать SHA-256.

Gate: офлайн-съёмка остаётся рабочей, результат появляется после sync.

## Фаза 7 — Analytics

- [ ] Строить compliance/OOS/facings/share/actions из current confirmed runs.
- [ ] Добавить store/agent/planogram/time filters.
- [ ] Добавить snapshots/aggregation и нужные indexes.
- [ ] Добавить human-review и retake quality metrics.
- [ ] Проверить tenant isolation и performance.

Gate: аналитика не читает произвольный legacy JSON как источник истины.

## Фаза 8 — AI evaluation и улучшение

- [ ] Создать репрезентативный eval manifest без приватных фото в git.
- [ ] Отделить detector/localization от SKU recognition.
- [ ] Добавить deterministic golden comparison path.
- [ ] Калибровать thresholds только на LeadShelf eval data.
- [ ] Сравнивать providers по accuracy/stability/cost/latency.
- [ ] Не заявлять подтверждённую accuracy без реальных размеченных фото.

Gate: provider выбирается по воспроизводимому eval, а не по названию модели.

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
