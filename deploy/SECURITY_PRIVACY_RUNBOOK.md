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

До появления автоматического tenant-safe purge сроки исполняются
контролируемой операцией с dry-run inventory, backup, dual approval, scoped
delete, повторным inventory и restore/tenant-isolation evidence. Массовое
удаление через ad-hoc SQL/S3 команды запрещено.

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
- policy-driven retention purge и проверенный DSAR export; controlled tenant
  DB delete с dry-run/dual approval/zero-residue уже реализован;
- face blur before persistence либо юридически принятый режим;
- production container/secret scan и runtime secret-rotation evidence.

До закрытия/принятия этих пунктов Phase 16 и GA не отмечаются выполненными.
