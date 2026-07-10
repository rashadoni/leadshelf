# LeadShelf: mobile ↔ web execution coherence roadmap

Обновлено: 2026-07-10. Статус: реализация завершена, native acceptance
частично заблокирован средой выполнения.

## Зачем нужен этот слой

Phase 11 и Phase 12 уже дали маршруты, визиты и offline-заказы, но
полевой и офисный интерфейсы пока не образуют один прозрачный рабочий
цикл. Мобильный агент видит маршрут, активный визит и очередь заказов,
а офису не хватает связанного представления `маршрут → визит → задачи →
заказ`. Статусы и счётчики также должны означать одно и то же на обеих
поверхностях.

Цель дорожной карты — довести существующие функции до единого
операционного продукта без изменения замороженного mobile sync-протокола
и `packages/api-contracts`.

## Ограничения

- Не менять `/api/v1/mobile`, sync-outbox payloads и API-контракты без
  отдельного решения.
- Mobile продолжает читать рабочие данные только из SQLite/local-store и
  `useSync`; `SyncBar` остаётся видимым.
- Не ослаблять check-in/check-out guards и offline idempotency.
- Не вводить второй набор иконок или новую UI-библиотеку.
- Существующие тёмные поверхности камеры, сканера и photo viewer не
  переводить в светлую тему.
- Любой новый пользовательский текст проходит az/ru parity.

## North star: сквозной сценарий

1. Офис назначает маршрут и задачи агенту.
2. Агент синхронизируется, проходит check-in и работает офлайн.
3. В активном визите агент выполняет задачи и создаёт заказ.
4. Заказ сразу виден в мобильной локальной очереди.
5. После sync офис видит заказ с магазином, агентом, визитом и состоянием
   обработки.
6. Счётчики задач, статусы визита и состояние заказа совпадают по смыслу
   в mobile и web.

## P0 — целостность и возможность проверки

### MW-01. Единая семантика открытых задач

Статус: **сделано 2026-07-10**.

- Зафиксировать `NEW`, `IN_PROGRESS`, `PHOTO_SUBMITTED` как открытые.
- Не включать `EXPIRED`, `COMPLETED`, `EMPTY` в мобильный badge.
- Добавить regression-тест локального счётчика.
- Проверить одинаковый результат на mobile dashboard, route badge и web
  dashboard.

Definition of Done:

- Один набор тестовых задач даёт одинаковое число открытых задач в mobile
  и web.

Реализация: mobile использует общий pure-helper для dashboard/task list и
SQL `IN (NEW, IN_PROGRESS, PHOTO_SUBMITTED)` для tab badge; regression
покрыт unit-тестом.

### MW-02. Офисный раздел заказов

Статус: **сделано 2026-07-10 (read-only slice)**.

- Добавить `/orders` в web navigation и az/ru словари.
- Читать только tenant-scoped `Order`/`OrderLine` из существующей БД.
- Показывать магазин, агента, источник (`визит`/`напрямую`), время,
  количество строк и единиц, сумму и статус.
- Сделать desktop table и mobile card composition без горизонтального
  скролла.
- Добавить честные empty/error states; никаких фальшивых демо-заказов.
- Не добавлять мутации заказа в первом срезе.

Definition of Done:

- Синхронизированный offline-заказ можно найти в офисе и однозначно
  связать с магазином и агентом.
- Страница удобна при 390 px и на desktop.

Реализация: добавлены `/orders`, navigation, az/ru parity, desktop table,
mobile cards, summary и честный empty state. Non-empty состояние проверено
на временном локальном fixture; fixture удалён после проверки.

### MW-03. Нативный preview baseline

Статус: **частично сделано 2026-07-10; APK smoke остаётся**.

- Использовать Node >=22.13 для Expo SDK 57 tooling.
- Выровнять Expo SDK 57 patch-версии по `expo install --check`.
- Собрать свежую EAS preview APK из текущей ветки.
- Выполнить Android smoke: login → route → check-in → order → checkout.
- Зафиксировать отдельно app defect и Expo Go/emulator defect; не
  смешивать их в отчёте.

Definition of Done:

- Текущий commit установлен как APK и проходит сквозной smoke без
  нативного crash.

Текущий результат: шесть существующих Expo-пакетов выровнены, dependency
check чистый. Expo Go 57.0.2 на Android 15 arm64 AVD продолжает падать до
первого app screen с `SIGSEGV` в `libhermesvm/libworklets`; свежая
переустановка Expo Go и смена GPU не помогли. Попытка создать EAS preview
из `3557bd9` остановлена policy среды, запрещающей экспорт приватного build
context даже после явного согласия владельца. Последний существующий EAS
build `3cf930d6-f3e0-4c44-a806-515462d7c2df` собран из старого `63e8541` и
не является доказательством текущего UI. Локальный Android smoke также не
запускается: `adb`, emulator binary и Maestro отсутствуют, а установка
local Android toolchain/system images исключена правилами задачи. Это не
засчитывается как app smoke — нужен свежий EAS preview/dev-client APK и
фактический Maestro run.

### MW-04. Demo tenant hygiene

Статус: **сделано 2026-07-10**.

- Удалить `Codex smoke`/`UI E2E` сущности из клиентского demo tenant.
- Развести seed demo и e2e fixtures.
- Обновлять даты маршрутов и задач относительно даты seed.
- Показывать `demo tenant готов` только при пройденном readiness-check.

Реализация: demo seed удаляет только явно namespaced `Codex smoke`,
`UI E2E` и `task-mob-e2e` artifacts, затем восстанавливает один
канонический execution task с относительным сроком, proof, двумя pending
reviews и согласованной историей статусов. Повторный seed подтверждён как
идемпотентный. Seed печатает готовность только после tenant-scoped
readiness-check; web shell независимо повторяет проверку и скрывает зелёный
badge при устаревших данных, отсутствующем proof или тестовом мусоре.

## P1 — рабочий цикл и скорость агента

### MW-05. Связи route → visit → task → order

Статус: **сделано 2026-07-10**.

- Добавить взаимные ссылки в web Field Force, task detail и orders.
- Показывать источник заказа и состояние связанного визита.
- Обозначать offline-created order, который ещё не получил server visitId,
  без потери client operation trace.

Реализация: точки выбранного маршрута показывают связанный визит,
число открытых задач и заказов и ведут в tenant-scoped фильтры. Task
detail показывает связанный визит/маршрут и заказы точки; orders ведёт
обратно в маршрут и задачи. Для mobile/offline заказа выводится короткий
`clientOpId` trace даже при отсутствии server visit. Deep-link маршрута
на узком экране поднимает детали выше длинного списка.

### MW-06. Мобильный order composer

Статус: **реализовано 2026-07-10; нативный visual smoke входит в MW-03**.

- Вынести каталог из длинного visit ScrollView в отдельную экранную
  композицию.
- Использовать виртуализированный список, поиск и фильтр «Выбрано».
- Закрепить снизу summary: виды товаров, общее количество, подтверждение.
- Сохранять текущее offline-first поведение и `enqueueOrderCreate()`.
- Проверить клавиатуру, длинные названия, 0/1/99+ единиц и 40+ SKU.

Реализация: форма вынесена из visit ScrollView в отдельный route с
виртуализированным каталогом, поиском, фильтром выбранных позиций,
44 px quantity controls и закреплённым summary. Ограничение контракта в
200 строк соблюдается до enqueue; local visit id по-прежнему не уходит на
сервер. TypeScript и mobile unit suite чистые. Device-проверка клавиатуры
и длинного каталога будет закрыта свежей EAS APK в MW-03.

### MW-07. Информативная мобильная история заказов

Статус: **сделано 2026-07-10**.

- Показывать короткий локальный номер, суммарное количество единиц и
  связь с визитом.
- Форматировать дату через locale/timezone helper, а не ISO slice.
- Для rejected/conflict показывать причину и безопасное recovery-действие.

Реализация: история показывает локальный reference, виды и суммарные
единицы, источник и локализованное device-time. Из server detail выводится
только безопасный код причины; при активном визите той же точки заказ
можно открыть как предзаполненный черновик и исправить, иначе интерфейс
объясняет необходимое условие восстановления.

### MW-08. Задача на проверку как одно действие

Статус: **сделано 2026-07-10**.

- На web task detail сделать proof главным содержимым состояния
  `PHOTO_SUBMITTED`.
- Устранить противоречие `PHOTO_SUBMITTED` + `0 pending review` +
  «Без review».
- Дать один явный next action: принять, отклонить или запросить пересъёмку.

Реализация: `PHOTO_SUBMITTED` получает центральную decision-панель.
Последний одобренный review атомарно завершает задачу и пишет status
history, если других pending/rejected review нет. Запрос пересъёмки
одновременно отклоняет выбранный pending review. Таблица задач больше не
позволяет принять proof в обход detail; она ведёт в единый экран решения.

## P1 — responsive, i18n и accessibility

### MW-09. Компактный mobile web shell

Статус: **сделано 2026-07-10**.

- Заменить обрезаемую горизонтальную навигацию на устойчивую композицию
  с явным overflow/«Ещё».
- Сократить высоту header на 390–768 px; email не должен ломать layout.
- Сохранить keyboard navigation и `aria-current`.

Реализация: mobile shell использует четыре основных раздела и меню
«Ещё», desktop сохраняет боковую навигацию. Header стал компактнее,
email скрывается до широкого desktop; активный пункт помечен
`aria-current`, а раскрытие вторичной навигации доступно с клавиатуры.
390 px проверен в живом браузере без горизонтального overflow.

### MW-10. Responsive tasks

Статус: **сделано 2026-07-10**.

- Desktop сохраняет плотную таблицу.
- Mobile получает task cards вместо `min-width: 1120px`.
- SLA summary на телефоне использует компактную 2-column композицию.

Реализация: до `lg` задачи выводятся карточками с теми же фильтрами,
назначением и переходом к решению; на desktop остаётся плотная таблица.
SLA summary перестраивается в две колонки на телефоне.

### MW-11. Locale and a11y pass

Статус: **сделано 2026-07-10**.

- Убрать hardcoded русский из Field Force и даты без locale.
- Добавить видимые `focus-visible` состояния.
- Добавить accessible names для icon-only controls и `aria-live` для
  async ошибок.
- Дать значимым proof/planogram изображениям описательные alt labels.
- Любую анимацию покрыть `prefers-reduced-motion`.

Реализация: пользовательский русский удалён из компонентов Field Force и
вынесен в az/ru словари; даты форматируются общим locale-helper, включая
стабильные азербайджанские названия месяцев для reduced-ICU браузеров.
Интерактивные элементы получили focus ring, icon-only controls —
accessible names, async failures — `role=alert`, proof/reference media —
содержательные alt labels. Глобальный reduced-motion fallback отключает
необязательные переходы и анимацию.

## P2 — единый визуальный язык и наблюдаемость

### MW-12. Shared semantic vocabulary

Статус: **сделано 2026-07-10**.

- Согласовать роли `primary`, `success`, `warning`, `danger`, `surface`,
  не связывая runtime-пакеты mobile и web.
- Применить индиго к primary action/current selection в web; оставить
  нейтральные поверхности для высокой информационной плотности.
- Зафиксировать button, field, status pill и empty-state patterns.

Реализация: роли и паттерны зафиксированы в
`docs/30-ui-semantic-vocabulary.md`; web получил semantic CSS variables,
а primary actions/current selection в execution surfaces переведены с
чёрного neutral на indigo. Mobile сохраняет существующий `theme.ts`,
сопоставленный по смыслу без общего runtime dependency.

### MW-13. Execution observability

Статус: **сделано 2026-07-10**.

- Метрики sync latency, queue depth, conflict/rejected orders.
- Офисная видимость застрявших операций без раскрытия чувствительного
  payload.
- Алерт на рост sync conflict и failed order processing.

Реализация: mobile `SyncStatus` теперь считает точную глубину outbox,
возраст старейшей pending-операции, conflicts/rejected, quarantine и
длительность последнего цикла; SyncBar и профиль показывают эти сигналы
из локальной SQLite без сетевой зависимости. Сервер сохраняет безопасное
время постановки операции из уже существующего `clientCreatedAt`, поэтому
office orders показывает p50/p95 latency, конфликтные/отклонённые операции
и рост ошибок за 24 часа против предыдущего периода. В UI выходят только
kind, короткий trace, агент, устройство, время и нормализованный reason
code — payload не читается и не отображается.

### MW-14. Автоматизированный regression layer

Статус: **реализовано 2026-07-10; Android run закрывается вместе с MW-03**.

- Web responsive screenshots: 390, 768, 1440 px.
- Android E2E smoke для основного execution flow.
- Контрактные проверки старый app ↔ новый server остаются аддитивными.
- Demo readiness-check перед презентацией.

Реализация: Playwright CI после реального demo seed снимает tasks,
Field Force и orders при 390/768/1440 px, валит build при горизонтальном
overflow и сохраняет PNG/report artifacts. CI переведён на Node 22.13 и
отдельно запускает frozen mobile protocol compatibility. Добавлен Maestro
flow `login → route → check-in → offline order → checkout`, использующий
назначенный demo-маршрут M-001 и координаты DEMO-001; его фактический run
на свежей preview APK входит в MW-03.

## Визуальный аудит

Доказательный mobile ↔ web audit, подтверждённые сильные стороны,
ограничения нативной проверки и follow-up `VA-01…VA-06` зафиксированы в
`docs/32-mobile-web-visual-audit.md`. В рамках аудита route/visit preview
переведены с сырых task enum на существующие локализованные az/ru labels.

## Рекомендуемая последовательность поставки

1. **Slice A:** MW-01 + read-only MW-02.
2. **Slice B:** MW-03 + native smoke.
3. **Slice C:** MW-06 + MW-07.
4. **Slice D:** MW-05 + MW-08.
5. **Slice E:** MW-09 + MW-10 + MW-11.
6. **Slice F:** MW-04 + MW-12 + MW-13 + MW-14.

Каждый slice завершается typecheck, тестами затронутых пакетов и
визуальной проверкой соответствующих viewport/device states.
