// Чистые классы ошибок sync-слоя (без expo/*): их знают и api-клиент, и
// движок, и UI. Держим здесь, чтобы не тянуть весь sync-manager в клиент.

export class UpgradeRequiredError extends Error {
  constructor() {
    super("protocol upgrade required")
  }
}

export class AuthLostError extends Error {
  constructor() {
    super("session lost")
  }
}

// Несёт HTTP-статус, чтобы движок мог отличить перманентный 4xx (карантин)
// от транзиентного 5xx/сети (ретрай). docs/26 §2.
export class HttpError extends Error {
  constructor(
    public status: number,
    message?: string,
    public detail?: unknown,
  ) {
    super(message ?? `HTTP ${status}`)
  }
}
