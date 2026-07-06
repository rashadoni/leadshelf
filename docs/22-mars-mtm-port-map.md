# LeadShelf: Mars/LeadDrive MTM port map

Обновлено: 2026-07-06.

Этот документ фиксирует честный статус переноса маршрутного MTM-модуля из
LeadDrive/Mars reference в LeadShelf. Он нужен, чтобы не смешивать:

- прямой перенос кода;
- портирование логики с адаптацией под модели LeadShelf;
- реализацию новой логики по мотивам reference;
- неперенесенные или заблокированные части.

## Источники и границы

Source reference:

- `/Users/rashadrahimov/Projects/leaddrive-v2`
- production UI reference: `https://mars.leaddrivecrm.org`

Target:

- `/Users/rashadrahimov/Projects/leadshelf`
- production UI: `https://hermescrm.xyz`

Mobile source:

- ожидаемый старый путь `/Users/rashadrahimov/Projects/mtm/MTMobileApp`
  сейчас не найден;
- поиск по `/Users/rashadrahimov/Documents` тоже не нашел `MTMobileApp`;
- мобильная часть пока не считается перенесенной.

## Статусы

- `COPIED`: файл можно перенести почти без изменений.
- `PORTED`: логика перенесена и адаптирована под контракты LeadShelf.
- `ADAPTED`: поведение восстановлено по reference, но реализация новая.
- `REBUILT`: написано заново, потому что source тесно связан с CRM-моделями.
- `NOT PORTED`: пока не перенесено.
- `OUT OF SCOPE`: не относится к LeadShelf boundary.
- `BLOCKED`: нужен отсутствующий source, секрет, внешний аккаунт или pilot data.

## Почему прямой copy невозможен для route module

LeadDrive/Mars использует CRM-ориентированные сущности:

- `mtmRoute`;
- `mtmRoutePoint`;
- `mtmCustomer`;
- отдельную `mtmAgent` модель с password/role/manager/status;
- `withRls`, `mtm-validators`, `writeMtmAudit`.

LeadShelf использует shelf-execution модели:

- `Route`;
- `RouteStop`;
- `Store`;
- `FieldAgent`;
- `User`;
- `Team`;
- `requireApiSession`;
- tenant-safe `workerDb`.

Поэтому безопасный путь: переносить рабочую логику и UX-поведение, но не
копировать файл целиком.

## Web route module

| Source | Target | Status | Notes |
| --- | --- | --- | --- |
| `src/app/(dashboard)/mtm/map/page.tsx` | `apps/web/src/app/[locale]/(app)/field-force/field-force-dashboard.tsx` | `ADAPTED` | Dashboard/live map уже работает на LeadShelf API; это не direct copy. |
| `src/components/mtm/live-map.tsx` | `apps/web/src/components/field-force/live-map.tsx` | `ADAPTED` | Leaflet/OSM идея сохранена, типы и данные LeadShelf отличаются. |
| `src/app/(dashboard)/mtm/routes/page.tsx` | `field-force-workspace.tsx`, tab `routes` | `PORTED` in progress | Список, поиск, статус, export есть; create/edit/cancel добавлены в текущем срезе. |
| `src/components/mtm/route-form.tsx` | `field-force-workspace.tsx`, inline route form | `PORTED` in progress | Перенесены ключевые идеи: агент, дата, список точек, порядок, past-date confirm. Используются `Store`, не `Customer`. |
| `src/app/(dashboard)/mtm/agents/page.tsx` | `field-force-workspace.tsx`, tab `agents` | `ADAPTED` in progress | Список/статусы есть; create/edit agent добавлены через `User` + `FieldAgent`. |
| `src/components/mtm/agent-form.tsx` | `field-force-workspace.tsx`, inline agent form | `ADAPTED` | В LeadShelf нельзя создавать отдельного MTM-agent с паролем; агент привязывается к существующему пользователю. |
| `src/app/(dashboard)/mtm/leaderboard/page.tsx` | `field-force-workspace.tsx`, tab `leaderboard` | `ADAPTED` | UI читает dedicated LeadShelf leaderboard API; scoring server-side, не direct copy. |
| `src/app/(dashboard)/mtm/activity/page.tsx` | `field-force-workspace.tsx`, tab `activity` | `ADAPTED` | Активность читает dedicated LeadShelf API из visits + locations. |
| `src/app/(dashboard)/mtm/reports/page.tsx` | `field-force-workspace.tsx`, tab `reports` | `ADAPTED` | Сводка читает dedicated report API; route/agent rows остаются LeadShelf-shaped. |
| `src/app/(dashboard)/mtm/settings/page.tsx` | `field-force-workspace.tsx`, tab `settings` | `ADAPTED` | Добавлены `FieldForceSetting`, server API и UI; offline status использует сохраненный порог. |

## API route module

| Source | Target | Status | Notes |
| --- | --- | --- | --- |
| `src/app/api/v1/mtm/routes/route.ts` | `apps/web/src/app/api/v1/field-force/routes/route.ts` | `PORTED` in progress | GET/POST перенесены по смыслу: filter, create route, stops. Модель `Store` вместо `Customer`. |
| `src/app/api/v1/mtm/routes/[id]/route.ts` | `apps/web/src/app/api/v1/field-force/routes/[routeId]/route.ts` | `PORTED` in progress | PATCH/DELETE добавлены. Вместо soft-delete route points используется `isActive=false` и guarded rebuild stops. |
| `src/app/api/v1/mtm/agents/route.ts` | `apps/web/src/app/api/v1/field-force/agents/route.ts` | `ADAPTED` | GET/POST есть, но LeadShelf agent = user-bound field agent, не отдельный mobile login actor. |
| `src/app/api/v1/mtm/agents/[id]/route.ts` | `apps/web/src/app/api/v1/field-force/agents/[agentId]/route.ts` | `ADAPTED` in progress | PATCH добавлен для team/phone. Password/role/status не переносились из-за другой identity model. |
| `src/app/api/v1/mtm/customers/route.ts` | `apps/web/src/app/api/v1/field-force/stores/route.ts` | `PORTED` in progress | Stores используются как route points. |
| `src/app/api/v1/mtm/locations/route.ts` | `apps/web/src/app/api/v1/field-force/locations/route.ts` | `ADAPTED` | Уже читает LeadShelf locations/feed. Нужно сравнить фильтры и replay parity. |
| `src/app/api/v1/mtm/activity/route.ts` | `apps/web/src/app/api/v1/field-force/activity/route.ts` | `ADAPTED` | Server endpoint добавлен; данные берутся из LeadShelf `Visit`/`AgentLocation`. |
| `src/app/api/v1/mtm/leaderboard/route.ts` | `apps/web/src/app/api/v1/field-force/leaderboard/route.ts` | `ADAPTED` | Server-side score helper и endpoint добавлены; не direct copy. |
| `src/app/api/v1/mtm/reports/route.ts` | `apps/web/src/app/api/v1/field-force/reports/route.ts` | `ADAPTED` | Daily route/agent summary endpoint добавлен. |
| `src/app/api/v1/mtm/settings/route.ts` | `apps/web/src/app/api/v1/field-force/settings/route.ts` | `ADAPTED` | Добавлена tenant-scoped Prisma model `FieldForceSetting` вместо browser-local state. |

## Mobile and shelf-AI

| Source | Target | Status | Notes |
| --- | --- | --- | --- |
| `src/app/api/v1/mtm/mobile/auth/route.ts` | LeadShelf mobile auth | `ADAPTED` | Текущий LeadShelf API уже имеет employeeCode/PIN/device login; это не direct copy из Mars. |
| `src/app/api/v1/mtm/mobile/sync/pull/route.ts` | LeadShelf offline sync | `ADAPTED` | Pull уже отдает tasks/stores/planogramBundles/routes/visits/photoSubmissions; серверный route/visit тест есть. |
| `src/app/api/v1/mtm/mobile/sync/push/route.ts` | LeadShelf offline outbox | `ADAPTED` | Push применяет task/photo/comment/visit/location/order операции с идемпотентностью; mobile UI теперь делает optimistic check-in. |
| `src/app/api/v1/mtm/mobile/location/route.ts` | LeadShelf agent location | `ADAPTED` | Standalone route не нужен: location идет через offline `location.update` и visit check-in пишет `AgentLocation`. |
| `src/app/api/v1/mtm/mobile/planogram-checks/route.ts` | LeadShelf photo proof / checks | `PARTIAL/ADAPTED` | Фото-задача, upload, photo quality, vision review и статус proof уже есть; отдельный Mars planogram-check endpoint не переносился. |
| `src/app/api/v1/mtm/mobile/shelf-analytics/analyze/route.ts` | LeadShelf vision service | `ADAPTED` in progress | Добавлен OpenAI Responses API provider boundary в `services/vision`; это не direct copy Mars endpoint. Для production нужен `VISION_PROVIDER=openai`, серверный `OPENAI_API_KEY` и signed media env в web app. |
| `src/components/mtm/golden-reference-editor.tsx` | planogram golden reference UI | `PARTIAL/ADAPTED` | В LeadShelf есть golden reference модели; UX еще спорный и требует доработки. |
| `src/components/mtm/shelf-annotator.tsx` | planogram/photo annotation | `NOT PORTED` | Нужна проверка пригодности для LeadShelf planogram editor. |
| `src/lib/mtm/photo-quality/*` | LeadShelf photo quality core | `NOT PORTED` | Можно переносить как pure logic после review. |
| `src/lib/mtm/photo-watermark/*` | LeadShelf photo proof | `PARTIAL/ADAPTED` | Backend proof-metadata validator добавлен в `packages/core/photo-proof/watermark.ts` и подключен к mobile photo upload; mobile сохраняет EXIF-like proof metadata в SQLite-очередь, отправляет `exifJson` и добавляет device GPS через `expo-location`, если пользователь дал permission. Настоящий burned-in watermark в пикселях фото еще не перенесен/не проверен на устройстве. |
| `src/lib/mtm/visit-anomaly/*` | LeadShelf route/visit guard | `PARTIAL` | Нужна проверка текущих helpers и API integration. |
| `src/lib/mtm/territory-scope.ts` | LeadShelf team/agent scope | `NOT PORTED` | Желательно портировать до mobile/supervisor flow. |

## Out of scope для LeadShelf

Не переносить без отдельного решения владельца:

- orders;
- invoice generator;
- credit limits;
- promotions;
- generic CRM customers beyond `Store`;
- CRM dashboards;
- contracts/finance/loyalty/omnichannel.

## Следующий порядок работ

1. Browser-smoke `field-force`: production UI smoke пройден после среза
   `4396689` — создан `Codex smoke route 2026-07-06`, порядок точек изменен
   через стрелки, агент изменен с Farid Aliyev на Elnur Mammadov, тестовый
   маршрут отменен.
2. Mobile smoke на устройстве/Expo: native route + camera/photo pass еще
   нужен; production API smoke уже пройден после среза `11a1cab`: login
   M-001 -> pull route -> check-in -> checkout -> pull completed visit.
3. Shelf-AI: OpenAI provider boundary и signed `/api/vision-media/photos/*`
   URL слой добавлены, но production распознавание заработает только после
   серверного API key и `VISION_MEDIA_*` env на web. Backend watermark/EXIF
   validator добавлен; дальше нужны mobile watermark rendering/EXIF writing
   и native photo pass.

## Честный текущий вывод

Маршрутный workspace в LeadShelf уже есть и частично работает, но до этого
документа часть была `ADAPTED/REBUILT`, а не прямым переносом. Mobile source
`MTMobileApp` не найден, поэтому текущий mobile route flow считается
адаптацией существующего LeadShelf app/API: после среза 2026-07-06 check-in
создает локальный optimistic visit, sync заменяет временный id на серверный
`visitId`, checkout заблокирован до этой замены, экран маршрутов показывает
причины недоступных действий и pull-to-refresh. Production demo tenant отставал
по данным: у `M-001` не было активного route, поэтому через существующий web API
создан `Demo mobile route - 2026-07-06`; после этого mobile API smoke подтвердил
`routes=1`, check-in `applied`, checkout `applied`. Production browser smoke
по `/ru/field-force` подтвердил route create/reorder/edit/cancel через UI.
