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

AI provider:

- По умолчанию используется честный `leadshelf-stub`: кадры извлекаются и
  сохраняются, но реального vision inference нет.
- Для OpenAI/GPT нужно задать `VISION_PROVIDER=openai`,
  `OPENAI_API_KEY` и при необходимости `OPENAI_VISION_MODEL`
  (default: `gpt-4o-mini`). Видео целиком в OpenAI не отправляется, только
  выбранные JPEG frames.
