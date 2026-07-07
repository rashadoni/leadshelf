# LeadShelf: Guided Shelf Proof roadmap

Обновлено: 2026-07-06.

Этот документ фиксирует план модуля `Guided Shelf Proof`: сотрудник не
загружает фото/видео свободно, а проходит обязательный сценарий съемки как в
приложениях аренды самоката/велосипеда. Цель — сделать фото/видео-проверку
полки дисциплинированной, доказательной и пригодной для AI-анализа.

## Принципы

- Водяные знаки не являются требованием. Доказательство строится на capture
  metadata: пользователь, задача, торговая точка, GPS, время, устройство,
  версия приложения, шаг сценария и audit trail.
- AI не должен обещать то, чего не видно. Если глубина не показана камерой,
  результат должен быть `depth_not_confirmed`, а не `OK`.
- Видео не отправляется в AI целиком. Оригинал хранится для аудита, worker
  извлекает кадры/кропы и анализирует только полезные кадры.
- Сценарий должен быть понятен полевому сотруднику без обучения: один экран,
  один шаг, одна инструкция, один результат качества.

## Проверяемые стандарты

- SKU стоит на нужной полке/в зоне.
- Порядок товаров соответствует планограмме.
- Facings X/Y/Z соответствуют версии планограммы.
- Логотип/фронт упаковки смотрит вперед.
- Товар стоит ровно, не лежит и не повернут без правила.
- Глубина подтверждена: за первым рядом есть требуемый товар.
- Ценник находится под правильным SKU, если это обязательный стандарт.
- Нет пустот, лишнего товара, смешивания SKU и чужого товара в зоне.
- Фото/видео снято в нужной торговой точке и по нужной задаче.

## Capture сценарий

### Шаг 0. Подготовка

- Подтвердить торговую точку по задаче и GPS.
- Показать мини-планограмму и место оборудования на плане зала.
- Заблокировать отправку из галереи для обычных сотрудников.
- Дать возможность выбрать причину невозможности съемки.

### Шаг 1. Front

- Фото или короткий клип 5-8 секунд.
- Камера параллельно полке, полка целиком в рамке.
- Цель: порядок, наличие SKU, facings, логотипы, ценники.
- Quality gate: полка не обрезана, не темно, не смазано, движение не слишком
  быстрое.

### Шаг 2. Left depth

- Фото или клип 3-6 секунд слева/под углом.
- Цель: увидеть второй/задний ряд слева.
- Если угол не отличается от front, шаг не засчитывается.

### Шаг 3. Right depth

- Фото или клип 3-6 секунд справа/под углом.
- Цель: увидеть второй/задний ряд справа.
- Если глубина не видна, фиксировать `depth_not_confirmed`.

### Шаг 4. Detail

- Close-up 2-5 секунд или фото для спорных SKU/ценников.
- Обязателен для похожих упаковок, мелкого текста, barcode/label и низкой
  уверенности AI.

## Mobile backlog

- `CaptureTemplate`: список обязательных шагов для задачи/планограммы.
- UI wizard: `Front -> Left depth -> Right depth -> Detail -> Review`.
- Камера с рамкой, текущей инструкцией, таймером и selected placement.
- Локальный progress: какие шаги приняты, какие нужно переснять.
- Capture metadata на каждый media object: `scenarioId`, `stepId`,
  `stepKind`, `required`, `qualityGate`, `deviceLocation`, `capturedAt`.
- Offline queue должна хранить proof media по шагам, а не только один
  безымянный photo proof.
- Кнопка `Отправить` активна только после обязательных шагов или причины
  исключения.
- Для первого среза видео можно не писать нативно: начать с обязательных фото
  по шагам и metadata, затем добавить короткие клипы.

## Backend/API backlog

- Расширить mobile upload contract полями capture step metadata.
- `PhotoSubmission.exif` переименовать по смыслу в capture metadata на уровне
  кода/API без обязательного database rename в первом срезе.
- Валидатор должен проверять `Software`, timestamp, task/store/user identity,
  GPS и capture step, но не требовать watermark marker.
- Добавить типы результатов quality gate: `accepted`, `needs_retake`,
  `manual_exception`.
- Сохранить причину исключения, если сотрудник не может снять шаг.
- Синхронизация должна возвращать офису статус каждого proof step.

## Worker/AI backlog

- Хранить оригинал фото/видео в object storage.
- Для видео извлекать 8-20 полезных кадров, максимум 30 на сложную полку.
- Удалять смазанные, темные и дублирующиеся кадры до AI.
- Анализировать кадры по зонам планограммы, а не открытым вопросом.
- Первый проход делать дешевым, дорогой detail/original — только для спорных
  crops.
- Возвращать структурированный результат:
  - `sku_missing`;
  - `wrong_shelf`;
  - `wrong_order`;
  - `facing_mismatch`;
  - `logo_not_front`;
  - `depth_not_confirmed`;
  - `empty_back_row`;
  - `price_tag_missing`;
  - `manual_review_required`.

## Web review backlog

- В задаче и `/reviews` показывать proof как сценарий, а не список фото.
- Для каждого шага показывать статус: принято, переснять, не подтверждено,
  исключение.
- Клик по AI finding должен открывать кадр/зону/планограмму.
- Менеджер может принять, отклонить или запросить пересъемку конкретного шага.
  `[сделано 2026-07-07: per-step retake loop — CaptureRetakeRequest,
  роут /api/v1/tasks/[taskId]/capture-retake (office roles), кнопка и
  бейджи в task detail; открытые запросы едут в sync pull и переоткрывают
  шаг в мобильном wizard; новое фото шага авто-закрывает запрос на
  upload]`
- В отчетах отделять `proof_submitted` от `proof_scenario_complete`.

## Pilot backlog

- Собрать 20-50 реальных shelf proofs по Mars/FMCG.
- Разметить expected result вручную.
- Измерить точность по SKU, facings, logo-front, shelf order, depth и price
  tags.
- Измерить стоимость AI на один визит и среднее время сотрудника.
- Зафиксировать production limits: длительность, разрешение, количество кадров,
  confidence thresholds.

## Первый implementation slice

1. Добавить roadmap и capture terminology.
2. Убрать обязательность watermark marker из proof metadata validator.
3. Добавить mobile capture scenario steps для front/left/right/detail.
4. Сохранять `captureScenario` и `captureStep` в EXIF-like JSON.
5. Показать в mobile task detail прогресс по обязательным шагам.
6. Обновить тесты metadata validator и mobile metadata builder.

Definition of Done первого среза:

- Сотрудник видит пошаговый proof сценарий.
- Каждое фото в очереди знает, какой шаг сценария закрывает.
- Backend принимает proof metadata без watermark marker.
- Тесты подтверждают GPS/task/store/user проверку и capture step metadata.

## Implementation status - 2026-07-06

Срез 2 выполнен как `IMPLEMENTED/ADAPTED`, не как direct transfer из CRM:

- Mobile wizard теперь ведет обязательные шаги `front`, `left-depth`,
  `right-depth` как короткие видео, `detail` как фото. Локальная очередь
  хранит `mediaType`, `durationMs`, `captureStepJson` и EXIF-like metadata.
- Mobile upload contract принимает photo/video media, capture step JSON и
  duration. Sync/pull возвращает media type и capture step обратно в
  приложение, чтобы progress не терялся после синхронизации.
- `PhotoSubmission` расширен под proof media: media type, MIME, file size,
  duration, capture step fields и индекс по `taskId/captureStepId`.
- Backend upload сохраняет фото в `photos/`, видео в `videos/`, валидирует
  MIME/media mismatch, duration gates, capture metadata и не отправляет raw
  video в image-only vision pipeline. Video proof получает pending
  `VISION_COMPLIANCE` review и `ProofAnalysisStatus`.
- Добавлен deterministic frame plan для коротких proof-видео: пример 6 секунд
  -> кадры `900/3000/5100ms`. Это cost-control основа для worker/OpenAI
  анализа selected frames.
- Web review/task/store screens показывают video proof через `<video controls>`
  и не называют ролик фото.

Срез 3 добавлен 2026-07-06:

- `worker-proof-analysis` подключен в production compose/deploy. Worker
  claim-ит `VIDEO/PENDING`, скачивает оригинал из S3, извлекает JPEG frames
  через ffmpeg и сохраняет их в `frames/{org}/{photoSubmissionId}/...`.
- `PhotoSubmission` получил `analysisStatus`, attempts, provider/model,
  started/finished timestamps и error.
- `/reviews` показывает analysis status, worker status, selected frames,
  OpenAI/stub provider и AI findings.
- OpenAI/GPT selected-frame provider boundary реализован через Responses API
  и включается только env-переменными `VISION_PROVIDER=openai`,
  `OPENAI_API_KEY`, optional `OPENAI_VISION_MODEL`. Без ключа результат
  честно помечается как `leadshelf-stub`, а не GPT inference.

Проверено локально:

- core photo-proof tests: `13 passed`;
- mobile tests: `22 passed`;
- Prisma validate/generate, api-contracts/core/mobile/web/db typecheck;
- `pnpm lint`;
- browser smoke на свежем Next runtime: reviews, tasks, task detail с photo
  proof, task detail и review queue с synthetic 6s video proof.
- worker proof-analysis integration test: fake video queue -> selected frames
  -> `VISION_COMPLIANCE` review update.

Осталось не закрыто на 100%:

- Реальная запись на физическом iOS/Android устройстве не проверялась; код
  опирается на Expo Camera v57 `mode="video"` и `recordAsync`.
- Production OpenAI/GPT вызов не проверялся без `OPENAI_API_KEY` и
  `VISION_PROVIDER=openai` в server env.
- Pilot-точность по Mars/FMCG невозможна без 20-50 реальных shelf proofs и
  ручной разметки expected result.

## Связанные планы

- `docs/24-guided-capture-plan.md` — гид съемки в видоискателе, photo-first
  пересмотр обязательных шагов, серверное выпрямление кадра и
  мм-калибровка, capture templates по типу оборудования.
- `docs/25-product-scenario.md` — сквозной сценарий продукта: клиент-сеть
  vs клиент-бренд, режимы depth-проверки, in-visit correction loop,
  демо-сценарий.
