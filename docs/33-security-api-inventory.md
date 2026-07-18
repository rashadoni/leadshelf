# API security inventory

Обновлено: 2026-07-18.

Автоматическая регрессия `api-route-inventory.test.ts` сканирует каждый
`apps/web/src/app/api/v1/**/route.ts` и запрещает незаметное расширение
публичной поверхности.

## Явно публичные v1 endpoints

- `mobile/auth/login` — credentials + durable rate limit;
- `mobile/auth/refresh` — rotating refresh token/device binding;
- `mobile/auth/logout` — idempotent refresh-session revocation;
- `mobile/protocol` — только номер публичного протокола.

Все остальные v1 routes обязаны вызывать `requireApiSession`. Каждая office
mutation обязана иметь role-denial path `forbidden`. Прямой `workerDb`
должен использовать `session.org`; единственное исключение — mobile sync ACK,
где cursor изменяется по `session.did`, связанному с подписанным access token.

Media/photo/export routes отдельно проверяются на session и tenant scope.
Тест fail-closed при появлении нового route без этих маркеров.

PostgreSQL integration test `idor-matrix.integration.test.ts` создаёт реальные
объекты tenant B и вызывает их access/mutation/delete handlers с JWT tenant A.
На 2026-07-18 матрица покрывает 33 операции во всех 29 текущих ID-bearing
route-файлах, ожидает только 403/404, затем сверяет неизменность target records
и нулевой остаток test fixtures.

Worker matrix отдельно создаёт повреждённые cross-tenant связи durable queue:
import job -> foreign batch, notification -> foreign device и proof -> foreign
user/store. Processors ставят `tenant_boundary_violation`, не меняют foreign
batch, не вызывают push sender/object storage и не создают review. Scheduled
overdue/stock-gap/digest jobs также проверены на игнорирование foreign rows.

Dynamic RBAC test через fail-closed `import.meta.glob` исполняет все 40
текущих office POST/PUT/PATCH/DELETE handlers с валидным JWT роли, запрещённой
конкретной policy, и требует точный `403 {error: forbidden}` до payload
parsing. Жёсткий count заставляет явно пересмотреть матрицу при новом method.

## Ограничение доказательства

Inventory — архитектурный fence, а динамическая матрица доказывает только
текущий ID-bearing HTTP surface и её конкретные payload paths. Динамические
tenant A → tenant B и role-policy проверки остаются обязательными для новых
routes/jobs; независимый production pen-test этими regression tests не
заменяется.
