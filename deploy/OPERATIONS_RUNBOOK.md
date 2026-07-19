# LeadShelf production operations runbook

Статус: исполняемый шаблон. Команды, требующие production credentials,
выполняются только оператором с доступом к `/opt/leadshelf/prod`.

## Ответственные и цели

- Release owner принимает решение deploy/abort/rollback.
- Infrastructure owner отвечает за PostgreSQL, object storage, backup и TLS.
- Product owner подтверждает smoke основного сценария.
- Начальные цели: RPO 24 часа, RTO 4 часа.

Перед пилотом имена и контакты должны быть внесены в закрытый журнал операций.

## До релиза

1. CI для точного commit SHA зелёный; protected GitHub Environment имеет
   required release reviewer, а `PRODUCTION_DEPLOY_ENABLED=true` установлен
   только после явного решения `ДА` на этот release window.
2. Нет незакрытого P0-инцидента, backup/verify timers зелёные.
3. Создать root:root 0600 `release-evidence/production.env` по шаблону с exact
   SHA, approval/restore drill/backup IDs, UTC epoch и rollback owner. Проверить
   `pnpm release-preflight:test`; stale/mismatched receipt запрещает релиз.
4. Protected workflow сам выполняет `backup-production.sh`, затем
   `verify-production-backup.sh` до migration; после запуска `compose --wait`
   требует green web/vision/worker healthchecks до записи `LAST_RELEASE`. При
   любой ошибке релиз запрещён.
5. Новые миграции прогнать через `rehearse-migrations.sh` на свежем
   обезличенном dump production-подобного объёма.
   Migration `20260719034000_case_insensitive_auth_principals` берёт table lock
   и останавливается с generic error, если найдены case-only collisions в
   organization slug, tenant email или employee code. DBA исследует значения
   только в защищённой сессии без CI/log output, делает backup и выполняет
   отдельно утверждённое исправление данных. Автоматически merge/delete таких
   principals запрещён; после remediation rehearsal запускается заново.
6. Проверить совместимость: текущий mobile protocol не получает 426 от нового
   сервера; предыдущий web image совместим с новой схемой.
7. Зафиксировать release SHA, предыдущий image SHA, окно и release owner.
   CI использует pinned `DEPLOY_KNOWN_HOSTS`, non-root SSH account и только
   root-owned `/usr/local/sbin/leadshelf-deploy-approved-release`; `sudo bash`,
   `git pull`, root SSH и dynamic `ssh-keyscan` запрещены. GitHub concurrency и
   host `flock` не допускают параллельный CI/break-glass deploy.

## Deploy

Обычный путь — protected CI job. Break-glass оператор с отдельным approval
может вызвать только root-owned wrapper с exact approved SHA:

```bash
sudo /usr/local/sbin/leadshelf-deploy-approved-release <40-char-sha>
```

Никогда не запускать `seed-demo` в client production. Не применять `down -v`.
Миграции должны быть backward-compatible: expand -> deploy -> contract в
отдельном последующем релизе.

## Smoke после deploy

```bash
BASE_URL=https://client.example.com \
  SMOKE_ORG_SLUG=smoke \
  SMOKE_EMPLOYEE_CODE=smoke-agent \
  SMOKE_PIN_FILE=/run/secrets/leadshelf-smoke-pin \
  deploy/scripts/post-deploy-smoke.sh
```

PIN file должен быть regular non-symlink, доступным только владельцу (0400 или
0600). Скрипт хранит PIN, access/refresh tokens и tenant identifiers только во
временном mode-0700 каталоге с mode-0600 request/curl-config files, не передаёт
их через process arguments, отключает implicit `.curlrc` и удаляет каталог
через trap. Этот invariant
проверяется `pnpm post-deploy-smoke:test` с mock runtime и входит в PR CI.

Обязательная карта:

1. `/api/health` и `/api/ready` возвращают 200.
2. Web login и dashboard работают в smoke tenant.
3. Импорт проходит validation/import/reconciliation.
4. Draft-планограмма публикуется в smoke store и создаёт задачу.
5. Mobile login -> pull -> logout проходит с актуальным protocol; optional
   task.comment push разрешён только в dedicated smoke tenant.
6. Фото загружается, `photo.submit` применяется, media открывается tenant-safe.
7. Workers не в restart loop; тестовые jobs завершаются.

Скрипт автоматизирует безопасную часть 1 и 5. Мутирующие пункты 3, 4 и 6
разрешены только в выделенном smoke tenant и фиксируются чек-листом релиза.

## Monitoring и alert acceptance

1. До upload проверить canonical rules: `pnpm alerts:check`. Команда обязана
   показать 17 valid rules и successful firing fixtures для каждой из них.
2. Prometheus job `leadshelf-web` получает `/api/metrics` с bearer token из
   secret store. Caddy собирается только через loopback/on-host agent;
   node-exporter включает filesystem+systemd, blackbox job называется
   `leadshelf-tls`.
3. Alertmanager routing заменяет `owner_role` на named primary/backup contacts,
   escalation window и канал. Generic role без имени не закрывает gate.
4. В staging по одному вызвать controlled web scrape failure, storage failure,
   overdue import fixture и backup-verification failure. Для каждого доказать
   pending -> firing -> delivered -> resolved, ровно одно уведомление, время
   detection/delivery и ссылку на этот runbook. Production данные не менять.
5. Проверить отсутствие organization/user/device/task IDs, URL query, token,
   media и error payload в alert labels/annotations/notification. Evidence
   содержит только alert name, safe instance, timestamps и external event ID.
6. Production enable запрещён, пока нет named owners, silences/maintenance
   policy и evidence всех controlled staging deliveries.

## Abort и rollback

Остановить rollout, если readiness не зелёный за 5 минут, есть 5xx/auth/sync
регрессия, worker restart loop или миграция завершилась ошибкой.

1. Не откатывать миграцию вручную и не восстанавливать production DB поверх
   работающего приложения.
2. Если схема backward-compatible, вернуть предыдущий image SHA и выполнить
   `up -d`; повторить smoke.
3. Если предыдущий image несовместим, применить проверенный forward-fix.
4. Restore из backup — только для подтверждённой порчи/потери данных, после
   остановки записей и решения incident commander.
5. После rollback оставить новый snapshot и логи; не удалять свидетельства.

## Disaster recovery

1. Объявить инцидент, остановить записи, зафиксировать время последней
   подтверждённой целостности.
2. Поднять чистое изолированное окружение, выбрать проверенный restic snapshot.
3. Выполнить `restore-drill.sh` и сверить checksums, Prisma migrations и media.
4. Переключить DNS/traffic только после полного smoke.
5. Зафиксировать фактические RPO/RTO и провести postmortem.

## Журнал релиза

Для каждого релиза записываются: дата UTC, SHA, предыдущий SHA, owner,
backup snapshot, migration rehearsal dataset/длительность, smoke results,
rollback decision и ссылки на инциденты. Секреты и персональные данные в
журнал не помещаются.
