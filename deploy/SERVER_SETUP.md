# Настройка прод-сервера LeadShelf

Решение: docs/12 — Hetzner VPS с первого дня, CI → сервер.

## Сервер (создан 2026-07-02)

- **leadshelf-1** — Hetzner Cloud, проект `leadshelf`.
- Тип: **CX33** (4 vCPU Intel/AMD, 8 GB RAM, 80 GB NVMe), $8.99/мес
  (+$0.60 IPv4 = $9.59/мес).
- Локация: Nuremberg (nbg1). Образ: Ubuntu 24.04 LTS.
- IP: **157.90.227.191** (IPv4 + IPv6).
- SSH: ключ `rashadrahimov@Rashads-MacBook-Air.local` (ed25519, default
  в проекте), root-доступ проверен.
- **Демо/production домен зафиксирован:** `https://hermescrm.xyz`
  (за Cloudflare; запасной прямой вход `https://157-90-227-191.sslip.io`) —
  оба host работают по HTTPS; demo credentials передаются только утверждённым
  закрытым каналом и не фиксируются в Git/логах. Прод-стек в /opt/leadshelf/prod (compose
  leadshelf-prod: caddy+web+workers+postgres16; media во внешнем S3), секреты в
  .env.production (root:600, сгенерированы на сервере).
- **Автодеплой**: push в main -> CI (тесты) -> deploy job (ssh, git pull,
  build, migrate, up) -> smoke check. Ключ CI — отдельный, в GH secrets.
- Repo подключен read-only deploy-ключом (leadshelf-1-deploy).
- TODO владельца: удалить случайный дубль `ubuntu-8gb-fsn1-1`
  (167.233.203.207, Falkenstein) — ••• -> Delete, если ещё не удален.
- TODO владельца: подключить production S3 provider и проверить DB+S3 backup до пилотных данных — см. Шаг 5.
- Смена домена / Namecheap не планируется: задача закрыта решением владельца
  от 2026-07-05. `hermescrm.xyz` остается production/demo доменом.

## Шаг 2. Первичная настройка (сделает Claude по SSH или руками)

```bash
# как root на свежем сервере
apt update && apt upgrade -y
# Docker
curl -fsSL https://get.docker.com | sh
# отдельный пользователь для деплоя
useradd -m -s /bin/bash deploy && usermod -aG docker deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
# базовая гигиена
apt install -y unattended-upgrades fail2ban awscli
```

## Шаг 3. Структура на сервере: dev и prod ЖЁСТКО разделены

Решение владельца (2026-07-02): dev не имеет доступа к prod-БД; никакие
.env/volumes/compose-имена не пересекаются — одна ошибка
`docker compose down -v` не должна снести не то.

```text
/opt/leadshelf/
  prod/
    app/                    # git checkout (деплой из CI)
    docker-compose.yml      # name: leadshelf-prod
    .env.production         # root:root 600 — deploy-юзер НЕ читает
  dev/
    app/                    # рабочая копия для разработки на сервере
    docker-compose.yml      # name: leadshelf-dev
    .env.development        # deploy:deploy 600
  backups/                  # staging pg_dump + external-S3 mirror -> restic
  logs/
```

Правила изоляции:

- Compose project names: `leadshelf-prod` / `leadshelf-dev` (явный `name:`
  в compose) -> volumes автоматически префиксуются
  (`leadshelf-prod_pgdata` vs `leadshelf-dev_pgdata`), перепутать нельзя.
- Порты: prod web 3000 и dev web 3100 — только на 127.0.0.1; Postgres наружу
  не торчит (только docker-сеть). Наружу — только Caddy 80/443.
- Caddy: `hermescrm.xyz` -> prod:3000; `157-90-227-191.sslip.io` остается
  запасным прямым входом. Dev не публиковать наружу без отдельного решения —
  доступ через SSH-туннель/basic auth.
- Prod-стек: `caddy` + `web` + workers + `postgres:16`; object storage —
  поддерживаемый внешний S3/R2 provider. Dev MinIO остаётся локальным
  эмулятором.

Production precondition: заранее создать private bucket, включить versioning
и lifecycle/retention по договору, выдать отдельные least-privilege credentials
и заполнить `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
`S3_BUCKET`. `/api/ready` обязан подтвердить `storage.status=up`. Archived
MinIO Community image запрещён в production; он не получает security fixes.
`LEADSHELF_MEDIA_UPLOAD_CONCURRENCY` задаётся на каждую web replica (default 8,
range 1..32) и ограничивает одновременную буферизацию multipart photo/video.
До rollout owner также задаёт утверждённые `AUTH_LOCKOUT_MAX_FAILURES`,
`AUTH_LOCKOUT_WINDOW_SECONDS`, `AUTH_LOCKOUT_DURATION_SECONDS` и не менее чем
32-символьный `AUTH_LOCKOUT_PEPPER` из secret manager; отсутствие или частичная
policy делает `/api/ready` красным намеренно.

Секреты:

- `.env.production` принадлежит root (600); контейнеры прод-стека запускает
  systemd-unit/root. Claude/Codex на сервере работают под `deploy` в
  `/opt/leadshelf/dev/` и prod-секреты прочитать не могут.
- Секреты не попадают в shell history/доки: только .env-файлы и GitHub
  Actions secrets. `history -d` не спасает — просто не вставлять секреты
  в команды.

## Шаг 4. CI → сервер

GitHub Actions (появится с web-скаффолдом):

1. PR: typecheck + prisma validate + vitest (+ тесты изоляции тенанта).
2. push в main: build образа → push в ghcr.io → ssh на сервер →
   `docker compose pull && docker compose up -d` → `prisma migrate deploy`.

Секреты в GitHub: `SSH_HOST`, `SSH_KEY`, `DATABASE_URL`, `JWT_SECRET`,
`S3_*`. На сервере — `.env` рядом с compose (не в git).

Repository variable `DEPLOY_MODE` принимает только `client` или `demo`.
Значение по умолчанию — `client`: миграции выполняются, но demo seed никогда
не запускается. `demo` разрешён только для отдельного демонстрационного
окружения. Переключение клиентского production в `demo` запрещено, потому что
seed создаёт демонстрационные организации, пользователей и операционные
данные.

## Шаг 4a. Vision / AI (photo-proof анализ)

Security/operations variables in `.env.production`:

```text
# Long random bearer used only by the metrics scraper; endpoint returns 404 otherwise.
METRICS_BEARER_TOKEN=<random-secret>
# Optional comma-separated secondary web origins. Primary request origin is automatic.
ALLOWED_WEB_ORIGINS=https://www.client.example.com
SENTRY_DSN=<server-side-dsn>
```

Only `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_SENTRY_DSN` may enter the mobile
bundle. JWT/S3/provider/deploy/metrics secrets must never use `EXPO_PUBLIC_`.

Photo-proof анализируется отдельным сервисом `vision` (см. compose). Он не
публикуется наружу; web зовёт его по внутреннему имени. Video-proof идёт
через `worker-proof-analysis`. Обоим ключ даётся через `.env.production`.

Добавить в `/opt/leadshelf/prod/.env.production` (root:600):

```
# web -> vision boundary
VISION_SERVICE_URL=http://vision:4010
# signed URL, по которому vision скачивает картинку (Gemini инлайнит байты)
VISION_MEDIA_PUBLIC_BASE_URL=https://hermescrm.xyz
VISION_MEDIA_SIGNING_SECRET=<длинный случайный секрет>

# провайдер распознавания: stub | openai | gemini
VISION_PROVIDER=gemini
GEMINI_API_KEY=<ключ Google AI Studio>
GEMINI_VISION_MODEL=gemini-2.5-flash
```

Замечания:

- Без `VISION_SERVICE_URL` web честно пишет stub и НЕ зовёт сервис.
- Без `VISION_MEDIA_*` `buildVisionMediaUrl` отдаёт сырой ключ, который
  Gemini скачать не сможет — фото-скан не пройдёт. Оба обязательны для
  реального распознавания.
- `vision` с `VISION_PROVIDER=gemini` без `GEMINI_API_KEY` падает на старте
  (fail-fast). Ставь ключ до `up -d`, иначе restart-loop.
- Ключ — секрет: только в `.env.production` на сервере, никогда в git и не
  в мобильное приложение.

## Шаг 5. Бэкапы (до загрузки пилотных данных)

Backup считается настроенным только после успешного restore drill. Локальный
volume не является backup: restic repository обязан находиться вне VPS.

1. Установить `restic` из репозитория Ubuntu и создать root-only конфигурацию:

```bash
apt install -y restic
install -m 600 /opt/leadshelf/prod/app/deploy/.env.backup.example \
  /opt/leadshelf/prod/.env.backup
# Заполнить RESTIC_REPOSITORY/RESTIC_PASSWORD и credentials внешнего S3.
restic init
```

2. Выполнить первый backup и проверить repository:

```bash
/opt/leadshelf/prod/app/deploy/scripts/backup-production.sh
/opt/leadshelf/prod/app/deploy/scripts/verify-production-backup.sh
```

Backup включает custom-format `pg_dump`, полный mirror media bucket,
`SHA256SUMS` и несекретный metadata-файл. Снапшот шифруется restic. Политика
по умолчанию: 14 daily, 8 weekly, 12 monthly.

3. Установить timers:

```bash
install -m 644 /opt/leadshelf/prod/app/deploy/systemd/leadshelf-backup* \
  /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now leadshelf-backup.timer leadshelf-backup-verify.timer
systemctl list-timers 'leadshelf-backup*'
```

Before enabling timers, set `OPERATIONS_ALERT_WEBHOOK_URL` in the root-only
`.env.backup`. Both backup services have `OnFailure` handlers. Trigger a
controlled failing verification in a non-production repository and confirm
that the external incident channel receives exactly one alert.

4. До пилотных данных и затем ежемесячно выполнить изолированный drill:

```bash
/opt/leadshelf/prod/app/deploy/scripts/restore-drill.sh
```

Drill не подключается к production: он поднимает временные PostgreSQL,
проверяет checksums, восстанавливает БД, наличие завершённых Prisma migrations
и restored media checksums/bytes, затем удаляет только свои контейнеры/temporary dir.
Зафиксировать дату, snapshot ID, длительность и результат в журнале операций.

RPO: 24 часа. Начальный RTO: 4 часа; уточнить по результату первого drill.
Отказ backup/verify unit должен быть подключён к production alerting в Phase 17.

Prometheus-compatible operational metrics are available at `/api/metrics`
only with `Authorization: Bearer $METRICS_BEARER_TOKEN`. The endpoint exposes
aggregate counts/lag/readiness without tenant identifiers. Configure the
external monitor to alert on readiness=0, pending queue age, failed proof/
notification growth and database capacity. Canonical rules are
`deploy/monitoring/leadshelf-alerts.yml`; validate them before upload with
`pnpm alerts:check`. The verifier uses the digest-pinned official Prometheus
3.12.0 image and runs both syntax and firing fixtures.

Caddy exposes aggregate HTTP histograms only on production-host loopback at
`http://127.0.0.1:2019/metrics`; its admin API is disabled. These metrics cover
round-trip latency, TTFB, status codes, in-flight requests and body sizes:

Both public sites emit one-line JSON access logs to container stdout. The
production log collector must ingest that stream, restrict operator access and
apply the approved retention period. Never put credentials or personal data in
URL query parameters; use `x-correlation-id` to join an API response with its
request record and the privacy-safe worker JSON events.

```bash
curl --fail --silent http://127.0.0.1:2019/metrics >/dev/null
```

Initial Prometheus SLO queries (5-minute windows):

```promql
# P95 round-trip latency
histogram_quantile(0.95, sum(rate(caddy_http_request_duration_seconds_bucket{handler="reverse_proxy"}[5m])) by (le))

# P99 round-trip latency
histogram_quantile(0.99, sum(rate(caddy_http_request_duration_seconds_bucket{handler="reverse_proxy"}[5m])) by (le))

# 5xx ratio
sum(rate(caddy_http_request_duration_seconds_count{handler="reverse_proxy",code=~"5.."}[5m])) / sum(rate(caddy_http_request_duration_seconds_count{handler="reverse_proxy"}[5m]))
```

Certificate/disk capacity stays a host-exporter rule; object bytes/retention
comes from the external S3 provider metrics and billing API.

External monitoring prerequisites:

- scrape `/api/metrics` as job `leadshelf-web` with the bearer token supplied
  from the monitor secret store, never a URL parameter;
- collect loopback Caddy metrics through an on-host agent;
- enable node-exporter filesystem + systemd collectors so
  `node_systemd_timer_last_trigger_seconds` and root-filesystem metrics exist;
- configure blackbox TLS probe job `leadshelf-tls`;
- load the canonical rule file and map every `owner_role` to a named on-call
  route. A generic role label is not accepted as owner evidence.

Full release procedure: `deploy/OPERATIONS_RUNBOOK.md`.

## Предварительное условие

CI требует GitHub-репозиторий — код должен быть закоммичен и запушен.
