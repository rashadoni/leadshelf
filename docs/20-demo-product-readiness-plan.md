# LeadShelf: demo/product-readiness plan

Обновлено: 2026-07-05.

Этот документ фиксирует рабочий план после live-аудита production UI
`https://hermescrm.xyz`. Это не новая продуктовая фаза 14, а слой доведения
текущих Phase 1-13 до состояния, которое можно уверенно показывать владельцу,
пилотному клиенту и команде продаж.

## Цель

При открытии LeadShelf должно быть понятно, что это система для:

1. каталога и качества master-data;
2. библиотеки торгового оборудования;
3. планов залов;
4. планограмм;
5. публикации задач на торговые точки;
6. фото-контроля;
7. полевой команды;
8. аналитики эффективности полки.

Сейчас backend/product spine есть, но demo-story и UI-полировка отстают от
кодовой готовности.

## Live-аудит: краткий вывод

- Архитектурно продукт похож на задуманный LeadShelf.
- Это уже не пустой шаблон: каталог, оборудование, планограмма, задача и
  аналитика связаны.
- Для серьезного показа продукт выглядит как сильный технический MVP, а не
  законченный SaaS.
- Главные слабые места: placeholder dashboard, смешанные языки в demo-данных,
  пустой floor-plan/photo/field-force story, слабые demo sales данные,
  переполненные таблицы, не до конца убедительный 3D preview.

## P0 - перед любым серьезным показом

### 1. Переделать главную панель

Текущее состояние: `/ru` показывает placeholder «Разделы включаются по фазам».

Сделать:

- KPI: активные планограммы;
- открытые задачи;
- просроченные задачи;
- фото на проверке;
- товары без фото / без штрих-кода / без размеров;
- магазины без плана зала;
- быстрые переходы: создать планограмму, импорт, задачи, фото-проверка.

Definition of Done:

- Первый экран сразу объясняет ценность продукта.
- Нет текста про будущие фазы.

### 2. Почистить demo-данные и языки

Проблемы:

- RU-интерфейс показывает `Rəf`, `Demo Aptek`, `Bakı`, `Standart`.
- AZ-интерфейс показывает русские товары/категории.
- Для клиента это выглядит как незавершенность, даже если код работает.

Сделать:

- выбрать один demo-язык для показа;
- привести store names, city/address, format, equipment type, product names,
  categories, brands к одному языку;
- убрать технические/сырьевые labels из видимых карточек.

Definition of Done:

- RU экран не содержит AZ labels, кроме осознанных брендов/адресов.
- AZ экран не содержит русские системные labels.

### 3. Исправить переполнение таблиц

Проблемные разделы:

- `/catalog`;
- `/stores`;
- `/tasks`;
- `/analytics`.

Сделать:

- горизонтальный scroll-контейнер для широких таблиц;
- sticky first column или action column там, где полезно;
- на ширине около 1024px таблицы не должны ломать layout;
- на мобильной ширине web-admin может быть desktop-first, но не должен
  визуально разрушаться.

Definition of Done:

- Нет элементов, визуально уходящих за рабочую область без управляемого scroll.
- Действия в строках остаются доступными.

### 4. Добавить demo floor plan

Текущее состояние: `/floor-plans` показывает форму, но demo-плана нет.

Сделать:

- один demo-план для `Demo Aptek №1`;
- разместить минимум один аптечный стеллаж;
- показать связь с активной планограммой;
- дать понятный preview плана зала.

Definition of Done:

- Раздел «Планы залов» не пустой.
- Из store/floor-plan можно понять, где стоит оборудование и какая
  планограмма к нему относится.

### 5. Добавить demo photo proof

Текущее состояние: `/reviews` пустой.

Сделать:

- одна задача с photo submission;
- статус `PHOTO_SUBMITTED`;
- review queue с фото;
- approve/reject action;
- quality score / compliance summary;
- связь с task и planogram.

Definition of Done:

- Можно показать цикл «задача -> фото -> проверка -> результат».

## P1 - усиление ядра продукта

### 6. Planogram editor polish

Сильные стороны:

- 2D-полка реально отображается;
- published version read-only;
- есть next draft;
- есть capacity по полкам;
- есть 3D preview;
- есть version history.

Сделать:

- product detail panel должен быть очевидно доступен;
- demo zones не должны быть пустыми;
- capacity labels привести к аккуратному виду;
- состояние published/read-only объяснить коротко, без технического шума;
- next draft flow сделать главным CTA;
- добавить видимые метрики SKU рядом с placement, где есть данные.

Definition of Done:

- Редактор выглядит как центральный продуктовый экран, не как debug-canvas.

### 7. Проверить 2D/3D соответствие

Наблюдение:

- в 2D видно 3 SKU;
- в 3D preview визуально уверенно виден не весь набор.

Сделать:

- проверить geometry mapping 2D -> 3D;
- убедиться, что все placements рендерятся;
- добавить нормальный camera angle / fit-to-view;
- добавить легенду/labels или hover в 3D, если это не перегружает экран.

Definition of Done:

- 3D preview не спорит с 2D-полкой.

### 8. Улучшить список планограмм

Текущее состояние: список слишком бедный.

Сделать:

- preview thumbnail;
- status/version;
- target stores/formats;
- count of placements;
- linked tasks status;
- publish date / updated date;
- quick action: open, next draft, tasks.

Definition of Done:

- По списку понятно, какие планограммы активны и где они применяются.

### 9. Улучшить задачи

Проблемы:

- таблица переполняется;
- действия статуса находятся прямо в строке и выглядят опасно;
- нет detail view.

Сделать:

- task detail page или drawer;
- история статусов;
- исполнитель;
- комментарии;
- фото;
- ссылка на планограмму;
- подтверждение для destructive/terminal transitions.

Definition of Done:

- Офис может понять состояние задачи без чтения сырой таблицы.

### 10. Сделать торговую точку кликабельной сущностью

Текущее состояние: `/stores` показывает сводку, но не дает полноценного
store detail.

Сделать:

- store detail route/drawer;
- активный floor plan;
- активные planogram assignments;
- задачи;
- последние фото;
- маршруты/визиты;
- data quality по точке.

Definition of Done:

- Торговая точка становится операционным объектом, а не просто строкой.

## P2 - demo analytics

### 11. Наполнить demo sales/stock данными

Проблема:

- аналитика широкая, но оборот/прибыль часто `0.00`;
- LFL и space productivity выглядят слабо без живых чисел.

Сделать:

- demo sales за минимум 60 дней;
- demo stock snapshots;
- demo price snapshots;
- один товар с over-space, один с under-space, один balanced;
- данные должны объяснять выводы аналитики.

Definition of Done:

- На первом экране аналитики есть ненулевые оборот, прибыль, продажи,
  stock days и meaningful deltas.

### 12. Упростить первый экран аналитики

Проблема:

- слишком много таблиц подряд;
- правильные блоки есть, но нет executive summary.

Сделать:

- 3-5 главных инсайтов сверху;
- затем LFL summary;
- затем shelf share / sales share;
- остальные таблицы ниже или за tabs.

Definition of Done:

- Пользователь понимает «что не так с полкой» за 30 секунд.

### 13. Сделать heatmap / space productivity визуально понятными

Сделать:

- цветовой слой с легендой;
- ссылка из insight к planogram;
- объяснение: пере-выделено / недо-выделено / нет продаж / нет остатков;
- цвет не должен быть только декоративным.

Definition of Done:

- Heatmap помогает принять решение, а не просто показывает таблицу.

## P3 - field/mobile story

### 14. Demo field-force сценарий

Текущее состояние:

- верхние счетчики показывают 0;
- forms есть, но нет маршрута/визита;
- live map пустой.

Сделать:

- один agent;
- один route;
- один visit;
- check-in/check-out;
- одна location entry;
- один anomaly/no anomaly example.

Definition of Done:

- Раздел показывает, как офис видит полевого исполнителя.

### 15. Связать web и mobile story

Сделать единую demo-цепочку:

1. опубликована планограмма;
2. создана задача;
3. назначена агенту;
4. агент видит задачу в mobile;
5. отправляет фото;
6. офис проверяет фото;
7. analytics/task KPI обновляются.

Definition of Done:

- Demo можно пройти как историю, а не как набор отдельных экранов.

### 16. Отдельно проверить Expo/mobile app

Web-admin не обязан быть полноценным mobile UI, но mobile app должен быть
убедительным.

Проверить:

- login `org=demo`, `employeeCode=M-001`, `PIN=1234`;
- task list;
- planogram view;
- product tap;
- barcode finder;
- photo upload;
- offline outbox;
- sync retry.

Definition of Done:

- Полевой MVP работает без объяснения «это потом».

## P4 - визуальная полировка

### 17. Переработать layout shell

Сделать:

- consistent page header;
- breadcrumbs;
- primary/secondary actions;
- tabs where they reduce table overload;
- restrained dense SaaS style;
- cards только для repeated items / summaries, не для всего подряд.

Definition of Done:

- UI выглядит как рабочий operational tool, а не scaffold.

### 18. Убрать сырой demo-copy

Убрать:

- «разделы включаются по фазам»;
- пустые состояния без следующего действия;
- технические формулировки в пользовательских местах.

Сделать:

- empty states с конкретным next action;
- business-language labels;
- минимум внутренних терминов.

### 19. Навести порядок в кнопках и статусах

Сделать:

- единый status vocabulary;
- единые badge styles;
- destructive/terminal actions с подтверждением;
- icon+label для частых действий;
- не смешивать `Draft/Published` с сырыми enum names.

### 20. Responsive minimum

Требование:

- desktop 1280+ нормальный;
- laptop/tablet 1024 нормальный;
- mobile web допускает scroll/read-only, но не визуальный развал;
- Expo app отвечает за полевой mobile workflow.

## Рекомендуемый порядок выполнения

1. Dashboard + demo data cleanup.
2. Floor plan demo.
3. Photo proof demo.
4. Table overflow/responsive fixes.
5. Planogram editor polish + 3D consistency.
6. Task detail + store detail.
7. Analytics demo data + summary.
8. Field-force demo scenario.
9. Expo/mobile verification.
10. Final browser walkthrough on production.

## Не считать закрытым, пока

- production UI не проверен браузером после правок;
- demo-flow не проходит от dashboard до photo review;
- нет актуального отчета: что стало лучше, что осталось не на 100%.
