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

// Безопасный минимум для разбора инцидента. В нём принципиально нет URL,
// response body, токенов, координат или текстов backend-ошибок.
export type MobileOperation = "shelf.sync.pull" | "route.targets.load"

export type MobileFailureStage = "network" | "http" | "response" | "contract"

export type MobileFailureDiagnostic = {
  operation: MobileOperation
  stage: MobileFailureStage
  statusCode: number | null
  correlationId: string
}

export class MobileOperationError extends Error {
  constructor(public diagnostic: MobileFailureDiagnostic) {
    super(`${diagnostic.operation}:${diagnostic.stage}`)
    this.name = "MobileOperationError"
  }
}

// Несёт HTTP-статус, чтобы движок мог отличить перманентный 4xx (карантин)
// от транзиентного 5xx/сети (ретрай). docs/26 §2. `detail` остаётся только
// для allow-listed кодов UI; его нельзя писать в логи или показывать как текст.
export class HttpError extends Error {
  constructor(
    public status: number,
    message?: string,
    public detail?: unknown,
    public diagnostic?: MobileFailureDiagnostic,
  ) {
    super(message ?? `HTTP ${status}`)
  }
}
