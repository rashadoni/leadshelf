# LeadShelf: доведение мобильного приложения до безотказной работы

Обновлено: 2026-07-07.

Полный чек-лист того, что нужно сделать, чтобы мобильное приложение
(guided proof + field-force) работало в поле безотказно, правильно и
пригодно к пилоту. Основано на аудите кода 2026-07-07. Приоритеты:

- **P0** — корректность/блокеры: без них поведение неверное.
- **P1** — до пилота: без них пилот развалится в реальных условиях.
- **P2** — до GA/масштаба: качество, наблюдаемость, безопасность на объём.

Пункт считается закрытым только с тестом или проверкой на устройстве.

## Статус реализации — 2026-07-07

Сделано в этой сессии (P0 + часть P1), всё покрыто тестами, полный
`pnpm test` (233), lint, typecheck, `next build` зелёные:

- **[P0] Доставка пересъёмки** — `requestCaptureRetake`/`resolve...`
  бампают `task.updatedAt` в транзакции; тесты на touch задачи.
- **[P0] Изоляция битого фото** — per-фото try/catch в sync-manager,
  `HttpError` со статусом, карантин на 4xx, счётчик попыток на 5xx/сети,
  видимость `quarantinedPhotos` в SyncBar; тесты изоляции.
- **[P1] protocolVersion enforcement** — заголовок `x-leadshelf-protocol`
  во всех mobile-запросах, enforce на upload (обязателен) и media
  (validate-if-present); logout теперь требует protocolVersion и клиент
  зовёт серверный logout best-effort (отзыв refresh); unit-тесты.
- **[P1] Роль исполнителя** — assign API ограничен полевыми ролями через
  единый `ASSIGNABLE_ROLES`; тест office↔field.
- **[P1] Сборка** — `eas.json` (dev-client/preview-APK/prod-AAB) +
  `expo-sensors` motionPermission в `app.json`. Сам build не запускался
  (нужен EAS-аккаунт).

Осталось (блокеры не на разработчике): device smoke, запуск `eas build`
и раздача APK, `OPENAI_API_KEY` на проде, face-blur/CV (срез 2, решение по
CV-инфраструктуре), Sentry DSN.

## 1. Корректность (P0)

- [x] **Доставка запросов пересъёмки.** Реализовано 2026-07-07: create и
  resolve бампают `task.updatedAt` в транзакции, тесты на touch.
  Файлы: `packages/db/src/repos/capture.ts`, `mobile-sync.ts`.
- [ ] **Тест сквозной доставки captureTemplate** после изменения шаблона
  (сейчас known limitation: смена шаблона не переотдаёт task rows).
  Решить осознанно: touch задач при смене активного шаблона или принять.
- [ ] **Единый источник времени.** `activeRetakeStepIds` сравнивает ISO-
  строки; убедиться, что все `takenAt`/`requestedAt` в UTC `Z` (сейчас да).
  Добавить регресс-тест на смешанные таймзоны.

## 2. Устойчивость синхронизации / offline (P0-P1)

- [ ] **Изоляция «ядовитого» фото (P0).** `sync-manager` грузит все фото в
  общем `try`; один постоянный отказ (413/415) валит весь `runSync` и
  блокирует push навсегда. Нужен per-фото `try/catch`, счётчик попыток и
  карантин (как `MAX_ATTEMPTS` в outbox). Файл: `sync/sync-manager.ts`.
- [x] **Экспоненциальный backoff** после ошибки синка (2026-07-07):
  чистый `nextBackoffMs` + планировщик в `sync-context` (ретрай растёт
  5s→...→cap 5м, сбрасывается на успех, отменяется на offline/upgrade;
  триггеры сети/foreground его опережают). Тесты на backoff.
- [ ] **Различать 4xx (перманентный, карантин) и 5xx/сеть (ретрай).**
  Сейчас любая ошибка = «повторить». 400/413/415 не должны ретраиться.
- [ ] **Видимость застрявших операций офицеру и агенту.** conflict/rejected
  из outbox показывать в UI с причиной и действием (сейчас статус есть,
  но нет разбора причин и recovery-действия).
- [ ] **Ретраи фоновой синхронизации** при возврате сети (NetInfo listener)
  и на app foreground, с дебаунсом.
- [ ] **Ограничение размера очереди/диска.** Политика при переполнении
  documentDirectory (старые загруженные медиа чистить, предупреждать).
- [ ] **Целостность после kill приложения** в середине upload/push —
  тест: убить процесс между copy и enqueue, между upload и markUploaded.

## 3. Камера и захват на устройстве (P0-P1)

- [ ] **Device smoke (P0-блокер пилота):** реальная съёмка фото/burst,
  видео `recordAsync`, акселерометр, вибрация, GPS-permission на
  физических iOS и Android (мин. 1 low-end Android).
- [ ] **Обработка ошибок burst.** 3 `takePictureAsync` подряд без
  per-кадр `try/catch` и без проверки готовности камеры; на реальных
  устройствах быстрые съёмки бросают/тормозят. Обернуть каждый кадр,
  fallback на 1 кадр при таймауте. Файл: `app/(app)/tasks/[taskId].tsx`.
- [ ] **Готовность камеры** (`onCameraReady`) перед первым снимком.
- [ ] **Ориентация/EXIF-orientation** кадров: проверить, что портрет не
  улетает боком в upload и в silhouette-геометрию.
- [ ] **Чистка временных файлов** burst (не-лучшие удаляются — проверить,
  что при ошибке ветки тоже, без утечек в documentDirectory).
- [ ] **Поведение при отзыве разрешения камеры** в середине сценария.
- [ ] **Лимиты медиа**: размер/битрейт видео, разрешение фото — согласовать
  с серверными `MAX_PHOTO_SIZE`/`MAX_VIDEO_SIZE`, показывать понятную
  ошибку вместо «застряло».
- [ ] **Low-light/vibration UX**: подтвердить пороги quality gate на
  реальных полках (нижние полки, блики холодильников).

## 4. Гид и датчики (P1)

- [ ] Проверить `Accelerometer` на нативе; при необходимости добавить
  `expo-sensors` в `app.json` plugins и `NSMotionUsageDescription`.
- [ ] Деградация без акселерометра/гироскопа (старые Android) —
  статичная рамка вместо гейта (частично есть, проверить на устройстве).
- [ ] Заменить `Vibration` на `expo-haptics` (мягче, уместнее) — опционально.
- [ ] Силуэт для планограмм с несколькими единицами оборудования (сейчас
  берётся `equipment[0]`) — выбирать по активному placement/шагу.
- [ ] Активировать CV/датчики только внутри шага съёмки (батарея) — есть,
  подтвердить профилировкой.

## 5. Аутентификация и сессии (P1)

- [ ] Полный цикл refresh-токена на устройстве: истечение access в оффлайне,
  ротация, grace-retry, отзыв устройства.
- [ ] Поведение `logout` (очистка SQLite/secure-store/очередей).
- [ ] `upgradeRequired` flow: экран есть — проверить принудительный апгрейд
  при рассинхроне `protocolVersion`.
- [ ] PIN: лимит попыток/локаут, защита от подбора на сервере.
- [ ] Привязка устройства: `MobileDevice.id` — client-supplied глобальный
  PK без `organizationId` (пункт из раннего ревью). Оценить риск cross-
  tenant/device коллизии; при пилоте >1 клиента — сделать
  `organizationId + clientDeviceId`.

## 6. Данные и схема (P1)

- [ ] Убедиться, что все новые модели tenant-scoped (есть: CaptureTemplate,
  CaptureStepException, CaptureRetakeRequest в `TENANT_MODELS`).
- [ ] Индексы под реальные запросы pull (task/step, retake open) — проверить
  план на объёме демо+.
- [ ] Аддитивность миграций и совместимость старый app ↔ новый сервер и
  новый app ↔ старый сервер (контракт mobile/v1 аддитивный — есть; добавить
  контракт-тесты обеих сторон).
- [ ] `assignee` для mobile: сейчас assignee может быть любой active user;
  ограничить полевыми ролями (пункт из раннего ревью).

## 7. Vision / AI в проде (P1)

- [x] **Gemini-провайдер за boundary** (2026-07-07): `GeminiVisionProvider`
  в `services/vision/provider.ts` (inline_data base64, `x-goog-api-key`,
  responseMimeType JSON + zod), выбор `VISION_PROVIDER=gemini` +
  `GEMINI_API_KEY` (+ `GEMINI_VISION_MODEL`, default `gemini-2.5-flash`);
  тесты. Ключ — только в env сервиса, никогда в git/приложение.
- [x] **Gemini в прод-воркере** (2026-07-07): `scanWithGemini` в
  `services/worker/.../analyzer.ts` (кадры инлайнятся как base64, общий
  `finalizeFrameAnalysis` с OpenAI-путём), выбор `VISION_PROVIDER=gemini`
  или `LEADSHELF_PROOF_AI_PROVIDER=gemini`; тест с mock fetch. Это
  фактический прод-путь: отдельный vision-сервис в compose не деплоится,
  распознавание идёт через `worker-proof-analysis`. Ключ в
  `deploy/.env.production` (env_file) на сервере.
- [x] **Photo-path задеплоен** (2026-07-07): `vision`-сервис добавлен в
  `deploy/docker-compose.prod.yml` (target worker, `serve`=tsx,
  expose 4010, env_file), Dockerfile копирует `services/vision/package.json`
  до install. Web зовёт его через `VISION_SERVICE_URL=http://vision:4010`;
  картинку vision тянет по signed `/api/vision-media` URL
  (`VISION_MEDIA_PUBLIC_BASE_URL` + `VISION_MEDIA_SIGNING_SECRET`).
  Boot-smoke: `serve` стартует с `VISION_PROVIDER=gemini`, `/health`
  отдаёт `google-gemini`. Env-инструкции — `deploy/SERVER_SETUP.md` §4a.
  Docker build/deploy на сервере не выполнялся (нет доступа/push заблокирован).
- [ ] Включить `VISION_PROVIDER=openai|gemini` + ключ на сервере; без
  ключа — честный `leadshelf-stub`.
- [ ] Verification-not-recognition: подавать per-zone ожидаемые SKU +
  эталонные фото каталога (few-shot), просить структурированный JSON
  (findings из docs/23).
- [ ] OCR-слой для ценников/мелкого текста на detail-кропах (Google Cloud
  Vision TEXT_DETECTION); штрихкоды оставить on-device.
- [ ] Cost-control: дешёвый первый проход, дорогой detail только для
  спорных crops; лимит кадров/визит; логировать стоимость на визит.
- [ ] Идемпотентность/ретраи `worker-proof-analysis`, dead-letter для
  битых медиа, алерт при росте FAILED.
- [ ] Клик по AI finding → кадр/зона планограммы (docs/23 backlog).
- [ ] Честные статусы: `depth_not_confirmed` не выдавать за OK; офис в
  отчётах отличает `proof_submitted` от `proof_scenario_complete`.

## 8. Сборка и релиз (P1)

- [ ] **`eas.json` отсутствует** — завести build-профили (preview/prod),
  собрать APK/AAB (`eas build -p android`), IPA (`-p ios`).
- [ ] Версионирование + `runtimeVersion` политика; upgrade-required завязать
  на `protocolVersion`.
- [ ] OTA-обновления (expo-updates) с каналами (preview/prod), стратегия
  отката.
- [ ] Подпись, app store / внутренняя раздача (пилот — internal distribution).
- [ ] Все нативные пермишены в `app.json` (камера, гео, sensors/motion).

## 9. Тестирование (P1-P2)

- [ ] Unit — есть (mobile 40 тестов); держать pure-логику покрытой.
- [ ] **Device smoke** (см. §3) — обязательный ручной прогон на iOS+Android.
- [ ] E2E на устройстве/эмуляторе (Maestro или Detox): login → route →
  check-in → guided proof по шагам → exception → retake → checkout.
- [ ] Offline-симуляция: авиарежим на каждом шаге, kill процесса,
  восстановление, дубликаты.
- [ ] Контракт-тесты mobile/v1 обе стороны (старый/новый).
- [ ] Нагрузка pull/push на реалистичном числе задач/медиа.

## 10. Наблюдаемость (P1-P2)

- [x] Crash reporting (Sentry) — 2026-07-07, env-gated. Зависимость-free
  репортёр (envelope через fetch) в `packages/core/observability/sentry.ts`
  (web+worker) и RN-safe копия в `apps/mobile/src/observability`
  (regex-DSN, ErrorUtils hook). Web: `instrumentation.ts` `onRequestError`;
  worker: process-обработчики во всех раннерах; mobile: init в `_layout`.
  Sentry-проекты `leadshelf-web`/`leadshelf-mobile` созданы; оба DSN
  проверены live (HTTP 200). DSN в gitignored env (`SENTRY_DSN`,
  `EXPO_PUBLIC_SENTRY_DSN`), пусто = выключено. Ограничение: это не полный
  `@sentry/react-native` — нативные краши/breadcrumbs/tracing не ловятся,
  только JS-исключения; апгрейд на официальный SDK — при переходе на
  dev-client/EAS сборку.
- [ ] Структурные логи sync-фаз и ошибок upload/push с device/opId.
- [ ] Метрики: успех/латентность синхронизации, глубина очереди, доля
  пересъёмок, время-до-принятого-кадра (телеметрия гида уже пишется —
  довести до дашборда).
- [ ] Понятные ошибки пользователю вместо «phase: error».
- [ ] Серверные алерты на всплеск SyncConflict/rejected/vision FAILED.

## 11. Безопасность и приватность (P1-P2)

- [ ] **Face blur покупателей** до персистентности (docs/24 срез 2) —
  приватность в договоре сети.
- [ ] Шифрование локальной очереди/медиа at-rest (SQLCipher/secure-store
  для чувствительного). `[частично реализовано 2026-07-19: operational SQLite
  использует SQLCipher 4, device-only 256-bit SecureStore key, fail-closed
  startup и inventory/integrity-verified plaintext migration; mobile 166/166,
  typecheck и Android/iOS Expo native config introspection PASS. Не закрыто:
  signed device upgrade/rollback evidence, шифрование отдельных media files,
  iOS bundle/signing и утверждённая recovery policy.]`
- [ ] Медиа не публичны — signed access есть; проверить tenant-guard на
  всех media-роутах.
- [ ] Consent на GPS-трекинг агента и съёмку в торговом зале (пилот-договор).
- [ ] Антифрод для доказательности (rooted-устройства): тайминг шагов,
  perceptual hash против прошлых визитов, детекция «фото фотографии».
- [ ] Rate limiting и валидация на всех mobile-роутах; `protocolVersion`
  enforced везде (проверить logout/photos/media — пункт из раннего ревью).

## 12. Производительность и батарея (P2)

- [ ] Профиль батареи за смену (8 ч, ~15 точек); CV/датчики только в шаге.
- [ ] Память при burst и больших bundle (планограммы «тяжёлые»).
- [ ] Размер/скорость SQLite при накоплении визитов/медиа; политика архивации.

## 13. Локализация и эргономика поля (P2)

- [x] Полнота az/ru: гард парности ключей в тестах (2026-07-07) — mobile
  `DICT.az`/`DICT.ru` и web `ru.json`/`az.json` сверяются рекурсивно,
  пропущенный перевод валит тест.
- [ ] Крупные кнопки, читаемость на солнце, одноручный сценарий, работа в
  перчатках; голосовые подсказки (docs/24 уровень 3) — на вырост.

## 14. Ops и раннбук (P2)

- [ ] Runbook: деплой миграций (seed после migrate есть), откат, восстановление
  demo-tenant.
- [ ] Мониторинг воркера и очередей на проде.
- [ ] Резервное копирование БД и медиа-хранилища.

## Гейты готовности к пилоту

1. Все P0 закрыты и покрыты тестами.
2. Device smoke на iOS+Android пройден (§3), включая burst/видео/GPS.
3. APK/AAB собран и роздан пилотной группе (§8).
4. Sync устойчив к офлайну, kill-у и «ядовитому» фото (§2).
5. Vision включён на проде или честно помечен stub (§7).
6. Crash reporting и базовые метрики онлайн (§10).
7. Face blur + consent улажены с пилотной сетью (§11).
8. 20-50 реальных shelf proof размечены, точность/стоимость измерены
   (docs/23 pilot backlog).

## Связанные документы

- `docs/23-guided-shelf-proof-plan.md` — сценарий и pilot backlog.
- `docs/24-guided-capture-plan.md` — гид съёмки, срезы 1-4.
- `docs/25-product-scenario.md` — сквозной сценарий продукта.
