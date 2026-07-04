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
  оба host работают по HTTPS, логины demo-тенанта
  (пароль demo1234). Прод-стек в /opt/leadshelf/prod (compose
  leadshelf-prod: caddy+web+postgres16+minio), секреты в
  .env.production (root:600, сгенерированы на сервере).
- **Автодеплой**: push в main -> CI (тесты) -> deploy job (ssh, git pull,
  build, migrate, up) -> smoke check. Ключ CI — отдельный, в GH secrets.
- Repo подключен read-only deploy-ключом (leadshelf-1-deploy).
- TODO владельца: удалить случайный дубль `ubuntu-8gb-fsn1-1`
  (167.233.203.207, Falkenstein) — ••• -> Delete, если ещё не удален.
- TODO: бэкапы (pg_dump + minio volume) до пилотных данных — см. Шаг 5.
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
apt install -y unattended-upgrades fail2ban
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
  backups/                  # pg_dump + minio-snapshots
  uploads/                  # (если фото вне minio-volume)
  logs/
```

Правила изоляции:

- Compose project names: `leadshelf-prod` / `leadshelf-dev` (явный `name:`
  в compose) -> volumes автоматически префиксуются
  (`leadshelf-prod_pgdata` vs `leadshelf-dev_pgdata`), перепутать нельзя.
- Порты: prod web 3000 и dev web 3100 — только на 127.0.0.1; Postgres/MinIO
  наружу не торчат вообще (только docker-сеть). Наружу — только Caddy 80/443.
- Caddy: `hermescrm.xyz` -> prod:3000; `157-90-227-191.sslip.io` остается
  запасным прямым входом. Dev не публиковать наружу без отдельного решения —
  доступ через SSH-туннель/basic auth.
- Prod-стек: `caddy` + `web` (образ из ghcr.io) + `worker` + `postgres:16`
  + `minio`. Dev-стек: то же, но локальная сборка и отдельные volumes.

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

## Шаг 5. Бэкапы (до загрузки пилотных данных)

- Ночной `pg_dump` в MinIO/Storage Box + ротация 14 дней.
- Бэкап MinIO-volume (фото) на Storage Box.
- Раз в месяц — проверка восстановления на локальной машине.

## Предварительное условие

CI требует GitHub-репозиторий — код должен быть закоммичен и запушен.
