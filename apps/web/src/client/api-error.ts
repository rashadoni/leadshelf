const SAFE_CORRELATION_ID = /^[a-zA-Z0-9._:-]{1,128}$/

type ResponseWithHeaders = Pick<Response, "headers" | "ok" | "status">

export class ApiResponseError extends Error {
  readonly status: number
  readonly correlationId: string | null

  constructor(response: ResponseWithHeaders) {
    super(`api_response_${response.status}`)
    this.name = "ApiResponseError"
    this.status = response.status
    this.correlationId = correlationIdFromResponse(response)
  }
}

export function correlationIdFromResponse(response: Pick<Response, "headers">): string | null {
  const value = response.headers.get("x-correlation-id")?.trim() ?? ""
  return SAFE_CORRELATION_ID.test(value) ? value : null
}

export function requireApiResponse(
  response: ResponseWithHeaders,
  acceptedStatuses: readonly number[] = [],
): void {
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    throw new ApiResponseError(response)
  }
}

export function formatApiError(
  error: unknown,
  fallback: string,
  formatSupportCode: (correlationId: string) => string,
): string {
  return error instanceof ApiResponseError && error.correlationId
    ? `${fallback} ${formatSupportCode(error.correlationId)}`
    : fallback
}

export function formatResponseError(
  response: Pick<Response, "headers">,
  fallback: string,
  formatSupportCode: (correlationId: string) => string,
): string {
  const correlationId = correlationIdFromResponse(response)
  return correlationId ? `${fallback} ${formatSupportCode(correlationId)}` : fallback
}

export async function fetchApiResponse(
  input: RequestInfo | URL,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  try {
    return await fetchImpl(input, init)
  } catch {
    return new Response(JSON.stringify({ error: "network_unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })
  }
}
