# LeadShelf security and privacy runbook

Статус: технический baseline; юридические решения и production evidence
заполняются владельцами клиента до пилота.

## Secret inventory и ротация

| Secret | Где хранить | Ротация | Проверка после |
| --- | --- | --- | --- |
| JWT signing | secret manager/runtime only | 90 дней/инцидент | web + mobile login/refresh/revoke |
| PostgreSQL | secret manager/runtime only | 90 дней/инцидент | readiness, migrations, backup |
| S3 keys | отдельный least-privilege user | 90 дней/инцидент | upload/read/backup/restore |
| Vision provider | worker runtime only | 90 дней/инцидент | disabled/stub или test proof |
| Deploy SSH | CI protected secret | 90 дней/смена owner | immutable image deploy |
| Backup/restic | root-only secret file | 90 дней/инцидент | backup + isolated restore |
| Metrics/alert webhook | runtime/root-only | 90 дней/инцидент | scrape/test alert |
| ERP full-sync approval signing | secret manager -> owner-only file | 90 дней/инцидент | issue + validate canary token; no destructive execution |

Ротация: создать новый credential → обновить consumers → smoke → отозвать
старый → проверить логи/очереди → записать evidence. Не печатать значения в
shell history, CI artifacts, тикеты или Git. После подозрения на компрометацию
ротация немедленная, а не по календарю.

## Authentication lockout policy

Production owner письменно утверждает threshold, observation window и lock
duration, затем задаёт все четыре runtime-параметра вместе:

- `AUTH_LOCKOUT_MAX_FAILURES` — integer 2..100;
- `AUTH_LOCKOUT_WINDOW_SECONDS` — 60..86400;
- `AUTH_LOCKOUT_DURATION_SECONDS` — 60..604800;
- `AUTH_LOCKOUT_PEPPER` — secret manager only, не менее 32 символов.

Developer defaults отсутствуют. Неполная/невалидная policy отклоняется, а при
полностью отсутствующей policy `/api/ready` возвращает fail-closed 503. Web и
mobile используют разные tenant-qualified HMAC-SHA-256 keys без email,
employeeCode, organization slug или IP в persistence/logs. Web login всегда
требует `organizationSlug + email + password`; одинаковый email в двух tenants
не разделяет login/lockout/rate-limit state. Ответ locked и неверный credential
одинаков (`invalid_credentials` + одинаковый короткий `Retry-After`); новые
атаки не продлевают действующий lock и точный остаток duration клиенту не
раскрывается.
Pepper не хранится в БД и не выводится в логи; его ротация инвалидирует текущие
lockout rows и поэтому выполняется только по утверждённой incident procedure.
Успешная проверка после окончания duration очищает failures. До утверждения
support policy ручной unlock через ad-hoc SQL запрещён. Controlled CLI
реализован, но execute disabled-by-default и разрешается только после утверждения
support policy, named owners и двух независимых approval IDs.

### Controlled manual unlock

Principal нельзя передавать через argv, stdout, ticket или shell history.
Оператор создаёт временный JSON-файл в защищённом каталоге с permissions `0600`
или строже. CLI открывает его с `O_NOFOLLOW`, ограничивает размер 16 KiB,
отклоняет symlink/неизвестные поля и никогда не возвращает principal:

```json
{
  "organizationId": "APPROVED_ORGANIZATION_ID",
  "slug": "approved-organization-slug",
  "channel": "web",
  "principal": "VALUE_FROM_VERIFIED_SUPPORT_CHANNEL",
  "ticketId": "SUP-12345",
  "reasonCode": "verified_account_recovery",
  "approvals": ["support-owner:approval-1", "security-owner:approval-2"]
}
```

Сначала preview с `AUTH_LOCKOUT_PEPPER` из secret manager:

```bash
pnpm --filter @leadshelf/db auth:unlock -- preview \
  --request-file /secure/ephemeral/auth-unlock.json
```

Preview проверяет точную пару organization ID/slug, active user и текущий
tenant-qualified lockout; выводит только состояние, state digest и exact
confirmation. Оператор добавляет `stateDigest` и `confirmation` в тот же 0600
файл. Execute допускается только one-shot runtime с точным значением флага:

```bash
AUTH_LOCKOUT_MANUAL_UNLOCK_ENABLED=true \
pnpm --filter @leadshelf/db auth:unlock -- execute \
  --request-file /secure/ephemeral/auth-unlock.json
```

В serializable transaction CLI берёт tenant advisory lock и row lock, повторно
сверяет state digest/confirmation, требует два разных approvals, удаляет ровно
одну lockout row, проверяет отсутствие residue и пишет
`authentication.manual_unlock` в tenant AuditLog. Audit содержит только channel,
ticket/reason, approval IDs, previous state и digest — без principal/pepper.
После операции owner проверяет вход, audit event и отсутствие неожиданной
блокировки соседнего tenant, выключает one-shot flag и безопасно уничтожает
request file согласно support evidence policy. Любой drift требует нового
preview; прямой SQL по-прежнему запрещён.

## Privacy decisions до пилота

Владелец privacy документирует purpose/legal basis, категории субъектов,
географию хранения, processors/subprocessors, сроки, DSAR/export/delete,
legal hold и incident notification. Отдельно утверждаются:

- фото полки и допустимость попадания покупателей/сотрудников;
- GPS точность, период хранения и доступные роли;
- audit/security events и минимизация идентификаторов;
- ERP/user fields и запрет свободного PII в комментариях.

Face blur до persistence сейчас не реализован. До утверждения и проверки blur
съёмка должна организационно исключать покупателей; AI/CV не отправляет фото
внешнему провайдеру. Этот риск нельзя считать закрытым feature flag самого AI.

## Mobile at-rest baseline

Operational SQLite использует SQLCipher 4 в signed Android/iOS native build.
Ключ — 32 random bytes, хранится только device-only в SecureStore и никогда не
выводится в логи, backup, support artifact или telemetry. При наличии encrypted
DB и отсутствии/повреждении ключа приложение обязано завершить startup
fail-closed: нельзя автоматически генерировать новый ключ, удалять базу или
предлагать пользователю «очистить данные», пока оператор не подтвердил, что
несинхронизированной работы нет.

Upgrade с legacy plaintext DB допускается только однонаправленно: создать новую
encrypted DB, выполнить `sqlcipher_export`, сверить schema и row inventory,
marker и полный `cipher_integrity_check`, и лишь затем удалить plaintext.
Перед pilot на каждом типе устройства записать evidence signed artifact SHA,
OS/device, upgrade с pending outbox/media, успешную синхронизацию, logout,
remote revoke, kill/restart и key-loss recovery. Дополнительно проверить, что
header DB не равен `SQLite format 3`. Expo Go не подтверждает SQLCipher.

Durable offline photo/video, commercial/visit media и upload/download documents
шифруются AES-256-GCM отдельным 32-byte device-only SecureStore key. Versioned
marker журналирует миграцию legacy plaintext; каждый startup повторно сканирует
известные каталоги, шифрует rollback-created plaintext и аутентифицирует каждый
ciphertext. Замена выполняется atomic move только после decrypt/byte-verify,
затем plaintext source удаляется; marker без ключа, truncated/corrupt file или
ошибка удаления fail-closed. Расшифрованные копии допустимы только в отдельном
temporary cache во время preview/open/upload, удаляются в `finally` и целиком
очищаются на startup. Android app backup отключён; key не мигрирует на другое
устройство. Wipe сначала удаляет все media directories, затем marker и только
потом key, чтобы частичный storage failure не сделал данные неявно
нерасшифровываемыми.

Это подтверждено code/config/unit evidence, но не signed native runtime. До
закрытия Phase 16 владелец утверждает iOS bundle/signing, key-loss recovery и
approved wipe после доказанной синхронизации либо зафиксированной потери данных;
device matrix подтверждает legacy migration, preview/upload/revoke/kill/restart
и memory profile на 35 MiB video. Expo Go не является native evidence.

## Retention baseline

Конкретные сроки не задаются разработчиком. Для каждого класса владелец
заполняет срок и основание: media originals/derivatives, GPS/visits, comments,
orders, imports/source files, sync conflicts, audit/security logs, backups и
support artifacts.

Tenant-safe purge запускается только с утверждёнными сроками и неизменяемым
UTC cutoff. Сначала получить inventory (команда не изменяет данные):

```bash
pnpm --filter @leadshelf/db retention -- preview \
  --organization-id ORG_ID --slug TENANT_SLUG \
  --as-of 2026-07-18T12:00:00.000Z \
  --media-days APPROVED_MEDIA_DAYS \
  --gps-days APPROVED_GPS_DAYS \
  --audit-days APPROVED_AUDIT_DAYS
```

Preview возвращает deletion manifest originals/thumbnails/persisted video
frames, число media rows, заблокированных GoldenReference, и SHA-256 digest.
При `goldenReferenceBlockedRows > 0` execute fail-closed: сначала нужна
отдельная approved reference lifecycle policy; deletion manifest будет пуст,
потому что удалять общий object key нельзя.
После
проверенного backup, удаления именно этого media manifest и проверки legal
hold разрешён execute:

```bash
pnpm --filter @leadshelf/db retention -- execute \
  --organization-id ORG_ID --slug TENANT_SLUG \
  --as-of 2026-07-18T12:00:00.000Z \
  --media-days APPROVED_MEDIA_DAYS \
  --gps-days APPROVED_GPS_DAYS \
  --audit-days APPROVED_AUDIT_DAYS \
  --media-manifest-digest SHA256_FROM_PREVIEW \
  --confirm "PURGE TENANT_SLUG ORG_ID 2026-07-18T12:00:00.000Z SHA256_FROM_PREVIEW" \
  --approval PRIVACY_APPROVAL_ID --approval INFRA_APPROVAL_ID \
  --backup-receipt VERIFIED_BACKUP_ID \
  --media-deletion-receipt VERIFIED_MEDIA_DELETE_ID \
  --legal-hold-cleared
```

CLI повторно строит inventory под tenant advisory lock и serializable
transaction, отклоняет изменившийся manifest/GoldenReference, удаляет
просроченные DB media
rows/AgentLocation/audit, обнуляет Visit coordinates и рекурсивно удаляет GPS
из EXIF, geofence anomaly и visit-alert JSON. Neighbor tenant не затрагивается.
После purge в той же транзакции создаётся минимальный `retention.execute`
audit event с policy/counts/digest и ID внешних approvals/receipts, без media
content или координат.
External S3/backups CLI намеренно не удаляет. Массовое удаление через ad-hoc
SQL/S3 команды запрещено. Периодический scheduler включается только после
утверждения сроков, legal basis, owner и external media orchestration.

## DSAR export baseline

DSAR export не является публичным API. Оператор сначала выполняет tenant-safe
inventory; stdout содержит только organization metadata, counts и SHA-256
manifest, без email/name/subject/request identifiers:

```bash
pnpm --filter @leadshelf/db dsar -- preview \
  --organization-id ORG_ID --slug TENANT_SLUG \
  --subject-user-id USER_ID --request-id APPROVED_DSAR_ID
```

Execute разрешён после проверки личности/полномочий заявителя, legal basis и
двух независимых approvals. Ключевой файл содержит 32 raw bytes либо 64 hex
symbols, имеет permissions `0600` или строже и не передаётся через argv/stdout.
Выходной файл создаётся эксклюзивно с mode `0600` и не перезаписывается:

```bash
pnpm --filter @leadshelf/db dsar -- execute \
  --organization-id ORG_ID --slug TENANT_SLUG \
  --subject-user-id USER_ID --request-id APPROVED_DSAR_ID \
  --manifest-digest SHA256_FROM_PREVIEW \
  --confirm "EXPORT TENANT_SLUG ORG_ID USER_ID APPROVED_DSAR_ID SHA256_FROM_PREVIEW" \
  --approval PRIVACY_APPROVAL_ID --approval SECURITY_APPROVAL_ID \
  --legal-basis-receipt VERIFIED_REQUEST_ID \
  --encryption-key-file ROOT_ONLY_KEY_FILE \
  --output NEW_ENCRYPTED_ARTIFACT_PATH
```

CLI повторно строит inventory под tenant advisory lock и serializable
transaction, отклоняет drift и соседний tenant, шифрует bundle AES-256-GCM и
пишет минимальный `dsar.export` audit event. Password/refresh hashes, JTI,
credential/secret/token fields и push tokens исключаются fail-closed по имени;
GPS, фото metadata, sync payloads и authored/agent commercial records остаются
только внутри ciphertext. Передача артефакта, срок его хранения, удаление и
расшифровка выполняются утверждённым внешним secure-delivery процессом.

## Проверки релиза

1. `pnpm audit --prod --audit-level moderate` зелёный.
2. Container и secret scan выполнены доверенным pinned scanner; critical/high
   triaged, exceptions имеют owner/expiry.
3. Negative RBAC/cross-tenant suite зелёный для API/jobs/export/media.
4. Upload size/MIME/magic/path guard и malicious Origin tests зелёные.
5. Клиентские bundles/artifacts проверены на отсутствие server secrets.
6. Логи и support errors не содержат token/PIN/email/IP/media payload;
   correlation ID безопасен и доступен в API response header.
   Sentry не является исключением: отправлять raw exception message/stack и
   arbitrary context запрещено. Текущий reporter экспортирует только safe
   error type, `has_stack` и bounded allowlisted operational fields. Проверка
   test event включает поиск seeded canary email/PIN/token/path в Sentry UI и
   export API; любое совпадение блокирует rollout и требует удаления event.
7. Mobile SQLite/media/logout/revoke/key-loss policy проверена signed build на
   реальных Android/iOS устройствах; Expo Go не принимается как evidence.

## Незакрытые гейты

- account-wide durable lockout machinery, HMAC principal/pepper, atomic concurrency,
  generic response, success reset, timed unlock, readiness gate и
  disabled-by-default controlled manual support unlock реализованы; production
  threshold/window/duration, named support/security owners, dual-approval
  policy и реальный controlled drill требуют business/support решения;
- независимый pentest deployed environment; локальная API/job/export/media
  cross-tenant и denied-role matrix уже проходит;
- SQLCipher для mobile operational SQLite и AES-256-GCM для durable offline
  media, fail-closed key handling, guarded plaintext migration и temporary-file
  cleanup реализованы и покрыты unit/config проверками; signed physical-device
  DB/media upgrade/upload/preview/revocation/key-loss evidence, low-end memory,
  iOS signing identity и утверждённая recovery policy остаются gates;
- утверждённые retention сроки/legal basis, external media orchestration и
  scheduler; guarded policy purge, controlled tenant delete и encrypted DSAR
  export реализованы локально, но реальный approved DSAR delivery/delete drill
  остаётся внешним evidence;
- face blur before persistence либо юридически принятый режим;
- production container/secret scan и runtime secret-rotation evidence.

До закрытия/принятия этих пунктов Phase 16 и GA не отмечаются выполненными.
