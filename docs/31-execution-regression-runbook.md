# Execution regression runbook

Обновлено: 2026-07-10.

## Web responsive screenshots

`@playwright/test` используется только как dev-инструмент. Тест логинится в
готовый demo tenant, открывает tasks, Field Force и orders при 390, 768 и
1440 px, проверяет горизонтальный overflow и сохраняет девять full-page PNG
в `apps/web/test-results`. CI загружает `playwright-report` и `test-results`
как artifact.

Локально после build и `pnpm --filter @leadshelf/db seed:demo`:

```bash
PLAYWRIGHT_CHANNEL=chrome pnpm --filter @leadshelf/web test:e2e:responsive
```

CI устанавливает pinned Chromium через Playwright CLI. Перед browser run
seed обязан завершиться строкой readiness; без целостного demo baseline
shell не показывает зелёный badge, а тесты не получают ожидаемые данные.

## Frozen mobile protocol

`pnpm --filter @leadshelf/web test:protocol` проверяет additive compatibility
старого mobile клиента с текущим server response. Изменение
`packages/api-contracts/mobile/v1`, порядка ack/apply или существующих полей
не входит в regression work и требует отдельного решения.

## Android native smoke

После установки свежей release/preview APK на Android API 31+ выполнить:

```bash
maestro test apps/mobile/e2e/execution-smoke.yaml
```

Flow выставляет геолокацию demo-точки и проходит
`login → route → check-in → offline order → checkout`. Он не обходит guards:
используется назначенный M-001 маршрут, координаты точки и реальный локальный
visit/outbox. Flow запускается против APK, не Expo Go; URL server должен быть
задан при сборке через `EXPO_PUBLIC_API_URL`.

Локальная release-сборка выполняется из `apps/mobile/android` с JDK 17 и
Android SDK. Для Expo SDK 57 в этом репозитории проверен Android API 35 arm64
AVD, compile/target SDK 36 и Node 24:

```bash
./gradlew app:assembleRelease --no-daemon \
  -PreactNativeArchitectures=arm64-v8a
```

Если URL API менялся после предыдущей сборки, сначала принудительно пересобрать
JS bundle (`app:createBundleReleaseJsAndAssets --rerun-tasks`), иначе Gradle
может оставить кэшированный bundle.

### Последняя попытка native baseline

10 июля 2026 по решению владельца EAS исключён из текущего процесса. Локально
собран arm64 release APK текущей ветки, установлен на Android 15 / API 35 AVD
и запущен без native crash. Подтверждены login screen и вход demo-сотрудником.
Отдельная smoke-сборка с `http://10.0.2.2:3100` также установлена; demo seed и
локальный web/API готовы.

Полный `route → check-in → order → checkout` не выдаётся за выполненный:
следующая команда управления ADB была отклонена средой из-за лимита
подтверждений. Maestro CLI не устанавливался. После разблокировки управления
эмулятором нужно продолжить с уже существующим flow, а не пересобирать APK.

### Offline photo proof smoke — 12 июля 2026

На Android 15 / API 35 пройден отдельный реальный цикл:

1. demo login и check-in с координатой точки;
2. API недоступен, первый guided-capture шаг сохранён в `photo_queue` и
   `outbox_ops`;
3. приложение принудительно остановлено и открыто снова — визит, файл,
   `1/4` и глубина очереди восстановились из SQLite;
4. после возврата API фото загрузилось multipart-запросом, worker создал
   canonical `REVIEW`-анализ, mobile pull сохранил comparison result;
5. при повторно выключенном API после перезапуска открылись локальные вкладки
   `Схема / Фото / Результат`.

Smoke выявил и закрыл две клиентские ошибки: Expo 57 / RN 0.86 больше не
принимает старый FormData-part `{ uri, name, type }` (используется
`expo-file-system` `File`), а `photo.submit` теперь не отправляется до
подтверждённого upload. Старые `photo_not_uploaded_yet` восстанавливаются с
новым идемпотентным `clientOpId`; одно и то же `clientPhotoId` не создаёт
дубликат фото.

Ограничение этого конкретного demo-прогона: выбранная задача уже имела
server status `EXPIRED`. Frozen server policy переводит фото в
`PHOTO_SUBMITTED` только из `IN_PROGRESS`, поэтому статусная операция осталась
видимым conflict, хотя файл и comparison result сохранены. Sync-протокол и
API-контракты не менялись; для полностью зелёного повторения нужен свежий
непросроченный task.

### Свежая photo-proof задача для зелёного smoke — 12 июля 2026

Чтобы закрыть предыдущее ограничение (`EXPIRED` -> conflict), demo seed теперь
детерминированно создаёт свежую задачу `Свежая выкладка OTC — фотоотчёт`
(`ensureFreshProofTask` в `packages/db/prisma/seed-demo.ts`):

- назначена M-001; store `DEMO-001` уже стоит в сегодняшнем маршруте
  `Mars Nizami pharmacy execution`;
- статус `IN_PROGRESS`, `dueAt` в будущем (`expireOverdueTasks` её не трогает);
- переиспользует опубликованную OTC-версию/assignment, поэтому sync pull отдаёт
  `captureTemplate` (rack, 4 шага) + planogram bundle;
- идемпотентна: повторный `seed:demo` сбрасывает её в чистый `IN_PROGRESS` и
  удаляет фото/анализ прошлого прогона строго по `task.id`, не трогая
  customer-facing showcase `Выполнить выкладку OTC-зоны` (остаётся
  `PHOTO_SUBMITTED`). Readiness-check требует ровно одну такую задачу.

Серверный/протокольный зелёный путь на этой фикстуре покрыт регрессией
`packages/db/src/__tests__/mobile-photo-proof.test.ts`: pull резолвит
`captureTemplate` + bundle, `photo.submit` из `IN_PROGRESS` -> `applied`
(не conflict/rejected) -> `PHOTO_SUBMITTED`, повтор `clientOpId` ->
`already_applied` без дубля фото.

Остаётся выполнить реальный on-device прогон (`maestro` / ручной цикл выше)
против этой свежей задачи и подтвердить device-observable критерии
(`pendingOps=0`, `pendingPhotos=0`, `rejectedOps=0`, `conflictOps=0`, видимый
SyncBar, тёмные поверхности камеры/viewer без изменений). Он требует
эмулятора/устройства с ADB и в headless-агенте не запускался.
