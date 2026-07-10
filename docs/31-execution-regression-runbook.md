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

После установки свежей EAS preview APK на Android API 31+ выполнить:

```bash
maestro test apps/mobile/e2e/execution-smoke.yaml
```

Flow выставляет геолокацию demo-точки и проходит
`login → route → check-in → offline order → checkout`. Он не обходит guards:
используется назначенный M-001 маршрут, координаты точки и реальный локальный
visit/outbox. Flow запускается против APK, не Expo Go; URL server должен быть
задан в EAS build environment.
