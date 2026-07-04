# services/worker — фоновые задачи

Импорт 1C/CSV, публикация планограмм, ночные агрегации аналитики, sync.

Текущие runner'ы:

- `pnpm --filter @leadshelf/worker import:queue` — file-backed import queue
  (`LEADSHELF_IMPORT_QUEUE_DIR`, по умолчанию `.data/import-queue`).
- `pnpm --filter @leadshelf/worker notifications` — обработка
  `NotificationDelivery` через Expo push sender abstraction.

В production compose они запущены отдельными сервисами:
`worker-import` и `worker-notifications`.
