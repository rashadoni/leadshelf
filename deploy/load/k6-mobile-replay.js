import http from "k6/http"
import { check, fail } from "k6"

const baseUrl = (__ENV.BASE_URL || "").replace(/\/$/, "")
const accessToken = (__ENV.MOBILE_ACCESS_TOKEN || "").trim()
const taskId = (__ENV.REPLAY_TASK_ID || "").trim()
const mutationGate = __ENV.RUN_MUTATING_REPLAY
const replayVus = Number(__ENV.REPLAY_VUS || 20)
const replayIterations = Number(__ENV.REPLAY_ITERATIONS || 100)

export const options = {
  scenarios: {
    replay: {
      executor: "shared-iterations",
      vus: replayVus,
      iterations: replayIterations,
      maxDuration: __ENV.REPLAY_MAX_DURATION || "2m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.001"],
    http_req_duration: ["p(95)<3000"],
    checks: ["rate==1"],
  },
}

function headers() {
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  }
}

function push(operation) {
  return http.post(
    `${baseUrl}/api/v1/mobile/sync/push`,
    JSON.stringify({ protocolVersion: 1, operations: [operation] }),
    { headers: headers(), tags: { operation: "task-comment-replay" } },
  )
}

export function setup() {
  if (mutationGate !== "yes-i-understand") {
    throw new Error("Set RUN_MUTATING_REPLAY=yes-i-understand to allow the controlled mutation")
  }
  if (!baseUrl || !accessToken || !taskId) {
    throw new Error("BASE_URL, MOBILE_ACCESS_TOKEN and REPLAY_TASK_ID are required")
  }
  if (!Number.isInteger(replayVus) || replayVus < 1 || replayVus > 100) {
    throw new Error("REPLAY_VUS must be an integer between 1 and 100")
  }
  if (!Number.isInteger(replayIterations) || replayIterations < 1 || replayIterations > 200) {
    throw new Error("REPLAY_ITERATIONS must be an integer between 1 and 200")
  }

  const clientOpId = `k6-replay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const operation = {
    clientOpId,
    kind: "task.comment",
    payload: { taskId, body: `k6 idempotency probe ${clientOpId}` },
    clientCreatedAt: new Date().toISOString(),
  }
  const first = push(operation)
  const accepted = check(first, {
    "initial push 200": (response) => response.status === 200,
    "initial push applied": (response) => response.json("results.0.status") === "applied",
  })
  if (!accepted) fail(`Initial mutation failed with HTTP ${first.status}: ${first.body}`)

  return { operation }
}

export default function (data) {
  const response = push(data.operation)
  check(response, {
    "replay 200": (result) => result.status === 200,
    "replay returns original applied result": (result) =>
      result.json("results.0.clientOpId") === data.operation.clientOpId &&
      result.json("results.0.status") === "applied",
    "replay returns one result": (result) =>
      Array.isArray(result.json("results")) &&
      result.json("results").length === 1,
  })
}

export function teardown(data) {
  const finalReplay = push(data.operation)
  const valid = check(finalReplay, {
    "final replay 200": (response) => response.status === 200,
    "final replay is stable": (response) =>
      response.json("results.0.clientOpId") === data.operation.clientOpId &&
      response.json("results.0.status") === "applied",
  })
  if (!valid) fail(`Final replay verification failed: ${finalReplay.body}`)
}
