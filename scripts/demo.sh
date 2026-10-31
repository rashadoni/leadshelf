#!/usr/bin/env bash
# Демо-стенд LeadShelf: один полный продукт с демо-данными, поднятый из этого
# репозитория. Нужен, чтобы показать LeadShelf клиенту — на ноутбуке или по
# ссылке — не трогая ничей прод и ничего не настраивая руками.
#
#   scripts/demo.sh up                      # локально, http://127.0.0.1:8080
#   scripts/demo.sh up --domain demo.ваш.домен   # публично, HTTPS + вход по паролю
#   scripts/demo.sh status | logs | down | reset
#
# Стенд живёт в отдельном compose-проекте leadshelf-demo со своими томами,
# поэтому `reset` физически не может задеть чужие данные. Это не прод: бэкапов,
# внешнего S3 и релизных расписок здесь нет — см. docs/DEMO-STAND.md.
set -Eeuo pipefail

# Чужие COMPOSE_* из окружения увели бы команды в другой проект, а `reset`
# сносит тома — поэтому имя проекта задаёт только сам compose-файл.
unset COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$repo_root/deploy/docker-compose.demo.yml"
env_file="$repo_root/deploy/.env.demo"
public_file="$repo_root/deploy/.env.demo.public"

# Организация, почта и пароль демо-тенанта заданы в
# packages/db/prisma/seed-demo.ts — форма входа спрашивает все три.
readonly DEMO_ORG="demo"
readonly DEMO_LOGIN="admin@leadshelf.com"
readonly DEMO_PASSWORD="demo1234"
readonly WORKER_SERVICES=(vision worker-import worker-notifications worker-proof-analysis)

fail() { printf '[demo] %s\n' "$*" >&2; exit 1; }
say()  { printf '[demo] %s\n' "$*"; }

compose() { docker compose -f "$compose_file" "$@"; }

load_env() {
  set -a
  # shellcheck disable=SC1090
  [ -f "$env_file" ] && . "$env_file"
  # shellcheck disable=SC1090
  [ -f "$public_file" ] && . "$public_file"
  set +a
}

require_tools() {
  for tool in docker openssl curl; do
    command -v "$tool" >/dev/null 2>&1 || fail "не хватает команды: $tool"
  done
  docker compose version >/dev/null 2>&1 || fail "нужен docker compose v2 (docker compose version)"
  docker info >/dev/null 2>&1 || fail "docker не отвечает — запущен ли демон и есть ли к нему доступ?"
}

# Переписывает одну переменную в .env.demo, не трогая сгенерированные секреты:
# адрес стенда зависит от режима запуска и меняется между up, а пароли — нет.
set_env_var() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp "${env_file}.XXXXXX")"
  grep -v "^${key}=" "$env_file" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$env_file"
}

ensure_env() {
  [ -f "$env_file" ] && return 0
  local db_password minio_password
  db_password="$(openssl rand -hex 24)"
  minio_password="$(openssl rand -hex 24)"
  ( umask 077
    cat > "$env_file" <<ENV
# Сгенерировано scripts/demo.sh. Это секреты демо-стенда: файл не попадает в
# git (.gitignore: .env.*) и не годится для клиентского прода.
POSTGRES_USER=leadshelf
POSTGRES_PASSWORD=${db_password}
POSTGRES_DB=leadshelf
DATABASE_URL=postgresql://leadshelf:${db_password}@postgres:5432/leadshelf?schema=public

JWT_SECRET=$(openssl rand -hex 32)
# demo включает демо-копию в интерфейсе и синтетические картинки товаров.
LEADSHELF_RUNTIME_PROFILE=demo

AUTH_LOCKOUT_MAX_FAILURES=5
AUTH_LOCKOUT_WINDOW_SECONDS=900
AUTH_LOCKOUT_DURATION_SECONDS=1800
AUTH_LOCKOUT_PEPPER=$(openssl rand -hex 32)

# На стенде только синтетические фото из сида, живых людей в кадре нет.
LEADSHELF_PROOF_PRIVACY_MODE=no_people_in_frame_attestation
LEADSHELF_PROOF_PRIVACY_APPROVAL=DEMO-STAND-SYNTHETIC-DATA

MINIO_ROOT_USER=leadshelf
MINIO_ROOT_PASSWORD=${minio_password}
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=leadshelf
S3_SECRET_KEY=${minio_password}
S3_BUCKET=leadshelf-media
S3_REGION=us-east-1

METRICS_BEARER_TOKEN=$(openssl rand -hex 32)

# stub — распознавание без внешнего ключа: показывает путь фото-пруфа целиком,
# не тратя деньги. Реальный Gemini включают на клиентском проде.
VISION_PROVIDER=stub
VISION_SERVICE_URL=http://vision:4010
VISION_MEDIA_SIGNING_SECRET=$(openssl rand -hex 32)
VISION_MEDIA_PUBLIC_BASE_URL=http://localhost:8080
LEADSHELF_DEMO_PORT=8080
ENV
  )
  say "создан $env_file (секреты сгенерированы, права 600)"
}

wait_ready() {
  local url="$1" deadline=$((SECONDS + 300)) body
  while (( SECONDS < deadline )); do
    body="$(curl -fsS --max-time 5 "$url" 2>/dev/null || true)"
    case "$body" in *'"status":"ready"'*) return 0 ;; esac
    sleep 3
  done
  printf '%s\n' "$body" >&2
  return 1
}

cmd_up() {
  local domain="" port="8080" with_workers=1
  while (( $# )); do
    case "$1" in
      --domain) [ "${2:-}" ] || fail "--domain без значения"; domain="$2"; shift 2 ;;
      --port)   [ "${2:-}" ] || fail "--port без значения";   port="$2";   shift 2 ;;
      --no-workers) with_workers=0; shift ;;
      *) fail "неизвестный аргумент: $1" ;;
    esac
  done
  [[ "$port" =~ ^[0-9]+$ ]] || fail "порт должен быть числом: $port"
  [ -z "$domain" ] || [[ "$domain" =~ ^[a-zA-Z0-9.-]+$ ]] || fail "домен выглядит неправильно: $domain"

  require_tools
  ensure_env
  set_env_var LEADSHELF_DEMO_PORT "$port"

  local public_url="http://localhost:$port"
  [ -z "$domain" ] || public_url="https://$domain"
  # vision скачивает картинку по этому адресу, поэтому он обязан совпадать с
  # тем, по которому стенд реально открывается.
  set_env_var VISION_MEDIA_PUBLIC_BASE_URL "$public_url"
  load_env

  local services=(web)
  (( with_workers )) && services+=("${WORKER_SERVICES[@]}")

  say "собираю образы (первый раз это долго — тянется pnpm install и next build)"
  compose build postgres "${services[@]}"

  local auth_user="" auth_password=""
  if [ -n "$domain" ]; then
    compose --profile public build caddy
    auth_user="demo"
    auth_password="$(openssl rand -hex 12)"
    local auth_hash
    auth_hash="$(compose --profile public run --rm --no-deps --entrypoint caddy caddy \
      hash-password --plaintext "$auth_password" | tr -d '\r\n')"
    [ -n "$auth_hash" ] || fail "caddy не выдал хеш пароля"
    ( umask 077
      cat > "$public_file" <<PUB
# Публичный вход стенда. Перезаписывается на каждый запуск с --domain.
LEADSHELF_DEMO_DOMAIN=${domain}
LEADSHELF_DEMO_AUTH_USER=${auth_user}
LEADSHELF_DEMO_AUTH_HASH='${auth_hash}'
PUB
    )
    load_env
  fi

  say "поднимаю базу и хранилище"
  compose up -d --wait postgres minio

  say "накатываю миграции"
  compose run --rm migrate
  say "заливаю демо-данные"
  compose run --rm seed-demo
  compose run --rm media-backfill --apply >/dev/null

  say "запускаю приложение"
  compose up -d --wait "${services[@]}"
  if [ -n "$domain" ]; then
    compose --profile public up -d --wait caddy
  fi

  say "жду готовности"
  wait_ready "http://127.0.0.1:$port/api/ready" || fail "стенд не дошёл до ready — смотри scripts/demo.sh logs web"

  printf '\n'
  say "стенд готов: $public_url"
  if [ -n "$domain" ]; then
    say "сначала браузер спросит пароль входа: $auth_user / $auth_password"
    say "(домен уже должен указывать A-записью на эту машину — сертификат берёт Caddy)"
  fi
  say "вход в LeadShelf — организация: $DEMO_ORG, почта: $DEMO_LOGIN, пароль: $DEMO_PASSWORD"
  (( with_workers )) || say "фоновые сервисы не поднимались (--no-workers)"
  printf '\n'
}

cmd_down() {
  require_tools
  load_env
  compose --profile public --profile tools down
  say "стенд остановлен, данные остались — следующий up поднимет его как был"
}

cmd_reset() {
  require_tools
  load_env
  if [ "${1:-}" != "--yes" ]; then
    printf '[demo] снести демо-данные стенда (тома leadshelf-demo_*)? [y/N] '
    read -r answer
    case "$answer" in [yY]|[yY][eE][sS]) ;; *) fail "отменено" ;; esac
  fi
  compose --profile public --profile tools down -v
  rm -f "$public_file"
  say "тома удалены; deploy/.env.demo оставлен, чтобы адреса и пароли не менялись"
}

cmd_status() { require_tools; load_env; compose --profile public ps; }
cmd_logs() {
  require_tools; load_env
  # По умолчанию следим за логами вживую; --no-follow нужен неинтерактивным
  # вызовам (CI), где `logs -f` висел бы до таймаута джобы.
  local follow=(-f)
  if [ "${1:-}" = "--no-follow" ]; then follow=(); shift; fi
  compose --profile public logs "${follow[@]}" --tail 200 "$@"
}

cmd_url() {
  load_env
  printf '%s\n' "${VISION_MEDIA_PUBLIC_BASE_URL:-http://localhost:8080}"
}

usage() {
  cat <<USAGE
Демо-стенд LeadShelf.

  scripts/demo.sh up [--domain <host>] [--port <n>] [--no-workers]
  scripts/demo.sh down     остановить, данные сохранить
  scripts/demo.sh reset    остановить и стереть демо-данные
  scripts/demo.sh status   что запущено
  scripts/demo.sh logs [сервис]
  scripts/demo.sh url      адрес стенда

Подробности и путь до клиентского прода: docs/DEMO-STAND.md
USAGE
}

case "${1:-}" in
  up)     shift; cmd_up "$@" ;;
  down)   shift; cmd_down "$@" ;;
  reset)  shift; cmd_reset "$@" ;;
  status) shift; cmd_status "$@" ;;
  logs)   shift; cmd_logs "$@" ;;
  url)    shift; cmd_url "$@" ;;
  ""|-h|--help|help) usage ;;
  *) usage >&2; exit 1 ;;
esac
