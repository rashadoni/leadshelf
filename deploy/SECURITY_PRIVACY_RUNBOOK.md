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

Ротация: создать новый credential → обновить consumers → smoke → отозвать
старый → проверить логи/очереди → записать evidence. Не печатать значения в
shell history, CI artifacts, тикеты или Git. После подозрения на компрометацию
ротация немедленная, а не по календарю.

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

## Проверки релиза

1. `pnpm audit --prod --audit-level moderate` зелёный.
2. Container и secret scan выполнены доверенным pinned scanner; critical/high
   triaged, exceptions имеют owner/expiry.
3. Negative RBAC/cross-tenant suite зелёный для API/jobs/export/media.
4. Upload size/MIME/magic/path guard и malicious Origin tests зелёные.
5. Клиентские bundles/artifacts проверены на отсутствие server secrets.
6. Логи и support errors не содержат token/PIN/email/IP/media payload;
   correlation ID безопасен и доступен в API response header.
7. Mobile logout/revoke/at-rest policy проверена на реальном устройстве.

## Незакрытые гейты

- account lockout policy: durable rate limit уже реализован, но threshold/
  duration/unlock требуют business/support решения;
- независимый pentest deployed environment; локальная API/job/export/media
  cross-tenant и denied-role matrix уже проходит;
- app-level encryption мобильной SQLite/media и physical-device проверка;
  remote revocation wipe реализован и покрыт unit;
- утверждённые retention сроки/legal basis, external media orchestration,
  scheduler и проверенный DSAR export; guarded policy purge и controlled
  tenant delete уже реализованы;
- face blur before persistence либо юридически принятый режим;
- production container/secret scan и runtime secret-rotation evidence.

До закрытия/принятия этих пунктов Phase 16 и GA не отмечаются выполненными.
