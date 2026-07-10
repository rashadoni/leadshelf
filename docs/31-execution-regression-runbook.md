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
