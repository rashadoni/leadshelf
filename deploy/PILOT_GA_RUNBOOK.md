# LeadShelf pilot → GA runbook

Статус: исполняемый шаблон. Реальный пилот и GA не считаются пройденными, пока
владельцы клиента не подпишут доказательства из этого документа.

## 1. Объём пилота

- Один изолированный client tenant, 3–5 магазинов, 10–20 пользователей.
- Реальные SKU, оборудование, планограммы и физические Android/iOS устройства.
- Длительность 2–4 недели, включая минимум пять полных рабочих смен.
- AI/CV остаётся `disabled` или `stub + human review`; результат AI не
  меняет задачу автоматически.
- Demo tenant, demo credentials и demo seed запрещены в клиентском окружении.

До старта назначить по имени: client product owner, LeadShelf release owner,
infrastructure owner, ERP owner, mobile release owner, support L1/L2 и privacy
owner. Контакты хранятся в закрытом операционном журнале, не в Git.

## 2. Entry gates

Пилот запрещён, если отсутствует хотя бы одно доказательство:

1. production URL/TLS, client deploy profile и зелёные health/readiness;
2. внешний encrypted backup, успешный restore drill и согласованные RPO/RTO;
3. миграционный rehearsal на свежем обезличенном production-like dump;
4. подписанные mobile artifacts, device matrix и frozen protocol smoke;
5. клиентский ERP mapping/manifest и первая reconciliation без необъяснённых
   расхождений;
6. dependency/container/secret scan без открытых critical/high;
7. retention/legal basis, режим съёмки покупателей и процедура удаления;
8. monitoring, alert delivery, on-call contacts и incident bridge;
9. capacity baseline на согласованном объёме;
10. обучение всех ролей и выделенный smoke tenant.

## 3. Tenant onboarding

1. Создать organization с уникальным slug; проверить tenant isolation.
2. Создать роли с минимальными правами, запретить общие учётные записи.
3. Настроить SSO/password policy, mobile PIN issuance и процесс revoke.
4. Загрузить и сверить store formats, stores, users, equipment и catalog.
5. Согласовать timezone, currency, VAT, units, barcode policy и ERP cadence.
6. Настроить retention, consent notice, storage region и экспорт данных.
7. Создать smoke store/user/task, не содержащие клиентских персональных данных.
8. Выполнить основной сценарий и зафиксировать correlation IDs/release SHA.
9. Передать клиенту runbooks, SLA, каналы поддержки и список ограничений.
10. Product owner подписывает readiness; дата старта заносится в журнал.

## 4. Обучение по ролям

### Администратор (60–90 минут)

Tenant/users/roles, импорт и reconciliation, equipment/store setup, audit,
backup/restore contacts, revoke/offboarding. Практика: создать пользователя,
найти ошибку импорта и отозвать mobile session.

### Категорийный менеджер (90 минут)

Data quality, dimensions, equipment, draft/version/diff, planogram validation,
publish и analytics. Практика: импортировать SKU, собрать/проверить/опубликовать
версию без физической ошибки.

### Супервайзер (60 минут)

Routes/tasks, open/overdue semantics, proof review/retake, sync conflicts,
support correlation ID. Практика: назначить задачу, принять proof и запросить
retake.

### Сотрудник магазина/агент (45–60 минут)

Login/update, route/check-in, barcode, guided capture, offline queue,
recovery/quarantine, comment/order/checkout и безопасный logout. Практика:
потерять сеть, перезапустить приложение и дождаться пустой очереди без дублей.

Обучение принято только после самостоятельного практического сценария; факт,
версия материала и участники фиксируются без PIN/персональных payload.

## 5. Ежедневный pilot control

- Проверить readiness, backup/verify, worker restarts и storage/DB capacity.
- Проверить sync/outbox/conflicts, import freshness/reconciliation и media errors.
- Разобрать новые P0/P1, feedback и решения; назначить owner/due date.
- Сверить минимум одну цепочку:
  import → planogram → publish → execution → proof → review/retake → analytics.
- Проверить, что pending mobile work сходится после offline/kill без дублей.
- Записать release SHA, метрики и ссылки на evidence; данные клиента не копировать.

## 6. Support и severity

| Severity | Пример | Initial response target | Действие |
| --- | --- | --- | --- |
| P0 | потеря/утечка данных, весь сервис недоступен | 15 минут | incident commander, остановка записей/rollout |
| P1 | основной поток/несколько магазинов заблокированы | 1 час | owner, workaround или hotfix plan |
| P2 | деградация с обходным путём | 1 рабочий день | backlog с приоритетом |
| P3 | UX/запрос улучшения | 3 рабочих дня | triage и решение |

Это начальные цели, не договорный SLA. До пилота клиент и поставщик должны
согласовать часы поддержки, timezone, каналы, on-call и обязательства.

Тикет содержит tenant slug, время UTC, release/app version, безопасное описание,
шаг, expected/actual и correlation ID. Не содержит PIN, token, полное фото,
GPS payload или DB dump.

## 7. Offboarding

1. Заморозить новые записи и отозвать web/mobile access.
2. Завершить или отменить очереди; зафиксировать unresolved operations.
3. Сформировать согласованный экспорт и checksum, передать защищённым каналом.
4. Получить письменное подтверждение удаления и legal hold exceptions.
5. Удалить tenant data/media/backups только утверждённой процедурой; проверить
   отсутствие cross-tenant impact и записать evidence.
6. Отозвать tenant-specific secrets/integrations и удалить monitoring targets.
7. Закрыть support, сохранить минимальный audit согласно retention policy.

DB-часть tenant delete автоматизирована контролируемым CLI. Сначала получить
неизменяемый preview (включая все таблицы с `organizationId` и ссылки на media):

```bash
pnpm --filter @leadshelf/db tenant:offboarding -- preview \
  --organization-id ORG_ID --slug TENANT_SLUG
```

После freeze записей, проверенного backup/export, удаления перечисленных media
и проверки legal hold выполнить удаление. `approval`, `backup-receipt` и
`media-deletion-receipt` — ID внешних evidence, не свободная замена самих
операций:

```bash
pnpm --filter @leadshelf/db tenant:offboarding -- execute \
  --organization-id ORG_ID --slug TENANT_SLUG \
  --confirm "DELETE TENANT_SLUG ORG_ID" \
  --approval PRIVACY_APPROVAL_ID --approval INFRA_APPROVAL_ID \
  --backup-receipt VERIFIED_BACKUP_ID \
  --media-deletion-receipt VERIFIED_MEDIA_DELETE_ID \
  --legal-hold-cleared
```

CLI берёт tenant advisory lock, повторно сверяет точную пару ID/slug, удаляет
все tenant-scoped таблицы в FK-safe порядке одной serializable-транзакцией и
проверяет нулевой residue. Он намеренно не удаляет S3/backups сам: эти внешние
системы должны быть очищены и подтверждены до необратимого DB execute.

## 8. Incident и decision log

Использовать `deploy/templates/pilot-event-log.csv` и
`deploy/templates/incident-postmortem.md`. Один immutable ID на событие.
В журнале: время UTC, тип, severity, tenant slug, release, owner, безопасное
резюме, correlation ID, решение, due/status и ссылка на evidence.

## 9. Exit/GA gates

GA допускается только если:

- 2–4 недели и согласованное число смен завершены без потери данных;
- нет открытых P0 и приняты все P1;
- core workflow выполняется обученным клиентом без разработчика;
- 14 ERP exchanges не имеют необъяснённых count/checksum/amount расхождений;
- restore, alert/failure, load/soak и mobile device evidence актуальны;
- security/privacy/contracts/support/capacity подписаны владельцами;
- известные P2 ограничения и rollback приняты product owner;
- AI имеет отдельное решение: остаётся stub/flag либо прошёл 20–50+
  размеченных proof с precision/recall/cost/latency и human-review guard.

Итоговое решение фиксирует дату, release SHA, владельцев, evidence links и
явное `GO` или `NO-GO`. Отсутствие доказательства означает `NO-GO`.
