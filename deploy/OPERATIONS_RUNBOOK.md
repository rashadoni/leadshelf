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

1. CI для точного commit SHA зелёный; артефакт образа неизменяем и помечен SHA.
2. Нет незакрытого P0-инцидента, backup/verify timers зелёные.
3. Выполнить `backup-production.sh`; записать snapshot ID.
4. Выполнить `verify-production-backup.sh`; при любой ошибке релиз запрещён.
5. Новые миграции прогнать через `rehearse-migrations.sh` на свежем
   обезличенном dump production-подобного объёма.
6. Проверить совместимость: текущий mobile protocol не получает 426 от нового
   сервера; предыдущий web image совместим с новой схемой.
7. Зафиксировать release SHA, предыдущий image SHA, окно и release owner.

## Deploy

```bash
cd /opt/leadshelf/prod/app
export DEPLOY_MODE=client
docker compose -f deploy/docker-compose.prod.yml pull
docker compose -f deploy/docker-compose.prod.yml run --rm web \
  pnpm --filter @leadshelf/db exec prisma migrate deploy
docker compose -f deploy/docker-compose.prod.yml up -d --remove-orphans
docker compose -f deploy/docker-compose.prod.yml ps
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
