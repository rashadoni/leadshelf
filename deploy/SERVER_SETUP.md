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
- TODO владельца: удалить случайный дубль `ubuntu-8gb-fsn1-1`
  (167.233.203.207, Falkenstein) — ••• -> Delete.
- TODO: Hetzner Firewall (22/80/443), Storage Box для бэкапов до
  пилотных данных.
- Осталось от владельца: **домен/поддомен** для демо (A-запись на
  157.90.227.191); Caddy сам получит TLS-сертификат.

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

## Шаг 3. Стек на сервере

`deploy/docker-compose.prod.yml` (появится вместе со скаффолдом web):

- `caddy` — reverse proxy + авто-TLS (80/443);
- `web` — Next.js (образ из GitHub Container Registry);
- `worker` — pg-boss джобы (тот же образ, другая команда);
- `postgres:16` — данные в volume;
- `minio` — фото, volume.

Postgres и MinIO наружу НЕ торчат — только через docker-сеть.

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
