# services/worker — фоновые задачи

Импорт 1C/CSV, публикация планограмм, ночные агрегации аналитики, sync.

Текущие runner'ы:

- `pnpm --filter @leadshelf/worker import:queue` — file-backed import queue
  (`LEADSHELF_IMPORT_QUEUE_DIR`, по умолчанию `.data/import-queue`).
- `pnpm --filter @leadshelf/worker notifications` — обработка
  `NotificationDelivery` через Expo push sender abstraction.
- `pnpm --filter @leadshelf/worker proof-analysis` — извлечение кадров из
  video proof, сохранение `frames/...` в S3 и selected-frame AI analysis.

В production compose они запущены отдельными сервисами:
`worker-import`, `worker-notifications` и `worker-proof-analysis`.

Все три очереди используют атомарный claim и ограниченные повторы. Import и
push delivery хранят следующее разрешенное время попытки; зависшие
`PROCESSING`/`SENDING` lease возвращаются в очередь, а после лимита становятся
`FAILED`. Proof analysis применяет ту же модель через поля `PhotoSubmission`.
Значения retry/lease настраиваются в `.env.example`; input import-файла после
terminal failure сохраняется для расследования и ручного решения оператора.
Products full-sync всегда идёт через durable queue и по умолчанию не claim-ится.
Он требует exact ERP manifest, controlled prepare/issue/attach workflow,
`LEADSHELF_FULL_SYNC_ENABLED=true` и абсолютный путь
`LEADSHELF_FULL_SYNC_APPROVAL_KEY_FILE` к owner-only signing key. В БД хранится
только путь к краткоживущему token-файлу, не bearer или signing key. Consumer
повторно проверяет source/counts/token и выполняет upsert + soft-deactivation
отсутствующих SKU + audit в serializable transaction под tenant advisory lock.
Token и source удаляются только после commit; cryptographic/context/source
drift terminal fail-closed без бессмысленных retry.
Ожидающий full-sync отменяется только dual-approval командой
`pnpm --filter @leadshelf/worker import:cancel-full-sync -- --control-file ...`.
Она сначала terminal fail-close фиксирует отмену в БД, затем проверенно удаляет
source/token; незавершённая очистка остаётся повторяемой и наблюдаемой через
отдельные metric/critical alert. Точный control contract описан в
`deploy/ERP_IMPORT_RUNBOOK.md`.
Retention external media purge использует отдельные
`retention:prepare-media-purge` и `retention:execute-media-purge`: DB manifest
связывается с exact tenant S3 versions в owner-only файле, а DB rows удаляются
только после version/delete-marker purge и zero-version verification. Workflow
default-disabled и требует approved policy/backup/legal-hold/dual approvals;
точный contract находится в `deploy/SECURITY_PRIVACY_RUNBOOK.md`.
Ошибки polling tick (включая временную недоступность PostgreSQL) не завершают
долгоживущий runner: общий lifecycle использует capped exponential backoff с
jitter до 60 секунд, пишет только безопасный код ошибки и сбрасывает backoff
после первого успешного tick. Режим `--once` по-прежнему fail-fast для cron/CI.

AI provider:

- По умолчанию используется честный `leadshelf-stub`: кадры извлекаются и
  сохраняются, но реального vision inference нет.
- Для OpenAI/GPT нужно задать `VISION_PROVIDER=openai`,
  `OPENAI_API_KEY` и при необходимости `OPENAI_VISION_MODEL`
- Внешние OpenAI/Gemini proof-вызовы имеют durable tenant ceiling:
  `LEADSHELF_PROOF_AI_MAX_PER_WINDOW` (default 100) за
  `LEADSHELF_PROOF_AI_WINDOW_MS` (default 1 час). Over-limit не читает media и
  уходит в сохранённый human-review fallback.
  (default: `gpt-4o-mini`). Видео целиком в OpenAI не отправляется, только
  выбранные JPEG frames.
