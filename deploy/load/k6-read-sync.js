import http from "k6/http"
import exec from "k6/execution"
import { check, sleep } from "k6"

const syncVus = Number(__ENV.SYNC_VUS || 10)

export const options = {
  scenarios: {
    readiness: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.READINESS_RPS || 5),
      timeUnit: "1s",
      duration: __ENV.DURATION || "2m",
      startTime: __ENV.READINESS_START || "5s",
      preAllocatedVUs: 10,
      maxVUs: 100,
      exec: "readiness",
    },
    mobileSync: {
      executor: "constant-vus",
      vus: syncVus,
      duration: __ENV.DURATION || "2m",
      exec: "mobileSync",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.005"],
    "http_req_duration{scenario:readiness}": ["p(95)<500", "p(99)<2000"],
    "http_req_duration{scenario:mobileSync}": ["p(95)<3000"],
    "http_req_duration{operation:initial-pull}": ["p(95)<3000"],
    "http_req_duration{operation:delta-pull}": ["p(95)<3000"],
  },
}

const baseUrl = (__ENV.BASE_URL || "").replace(/\/$/, "")
const tokenSource = __ENV.MOBILE_ACCESS_TOKENS_FILE
  ? open(__ENV.MOBILE_ACCESS_TOKENS_FILE)
  : (__ENV.MOBILE_ACCESS_TOKENS || "")
const accessTokens = tokenSource
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)

let syncCursors = {}

export function setup() {
  if (!baseUrl) throw new Error("BASE_URL is required")
  if (accessTokens.length < syncVus) {
    throw new Error(
      `MOBILE_ACCESS_TOKENS needs at least ${syncVus} tokens from distinct devices; got ${accessTokens.length}`,
    )
  }
}

function authHeaders() {
  const token = accessTokens[(exec.vu.idInTest - 1) % accessTokens.length]
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  }
}

export function readiness() {
  const response = http.get(`${baseUrl}/api/ready`)
  check(response, { "readiness 200": (result) => result.status === 200 })
}

export function mobileSync() {
  const initial = Object.keys(syncCursors).length === 0
  const pull = http.post(
    `${baseUrl}/api/v1/mobile/sync/pull`,
    JSON.stringify({ protocolVersion: 1, cursors: syncCursors }),
    {
      headers: authHeaders(),
      tags: { operation: initial ? "initial-pull" : "delta-pull" },
    },
  )
  const valid = check(pull, {
    "pull 200": (result) => result.status === 200,
    "pull has cursors": (result) => Boolean(result.json("cursors")),
  })
  if (valid) {
    const nextCursors = pull.json("cursors")
    if (nextCursors && typeof nextCursors === "object") syncCursors = nextCursors
  }

  sleep(1)
}
