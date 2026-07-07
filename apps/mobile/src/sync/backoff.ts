// Экспоненциальный backoff между авто-ретраями синка после ошибки
// (docs/26 §2). Чистая функция — тестируется в CI. Триггеры сети/foreground
// синк не ждут; backoff нужен, когда других сигналов нет, чтобы не долбить
// сервер и при этом не застрять навсегда после временного сбоя.

export interface BackoffOptions {
  baseMs?: number
  factor?: number
  capMs?: number
}

export function nextBackoffMs(consecutiveErrors: number, opts: BackoffOptions = {}): number {
  const base = opts.baseMs ?? 5_000
  const factor = opts.factor ?? 2
  const cap = opts.capMs ?? 5 * 60_000
  if (consecutiveErrors <= 0) return 0
  const delay = base * factor ** (consecutiveErrors - 1)
  return Math.min(cap, Math.round(delay))
}
