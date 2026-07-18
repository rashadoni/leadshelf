import http from "k6/http"
import { check } from "k6"
import { Counter, Trend } from "k6/metrics"

const baseUrl = (__ENV.BASE_URL || "").replace(/\/$/, "")
const tokens = (__ENV.MOBILE_ACCESS_TOKENS || "")
  .split(",")
  .map((token) => token.trim())
  .filter(Boolean)
const taskId = (__ENV.MEDIA_TASK_ID || "").trim()
const mutationGate = __ENV.RUN_MEDIA_UPLOAD_LOAD
const vus = Number(__ENV.MEDIA_VUS || 8)
const iterations = Number(__ENV.MEDIA_ITERATIONS || vus)
const overload = __ENV.MEDIA_EXPECT_BACKPRESSURE === "yes"
const clientPrefix = (__ENV.MEDIA_CLIENT_PREFIX || `k6-media-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "-")
const mediaPath = __ENV.MEDIA_FILE || "/media/proof.png"
const mediaBytes = open(mediaPath, "b")

const acceptedUploads = new Counter("accepted_uploads")
const backpressureRejections = new Counter("backpressure_rejections")
const successfulUploadDuration = new Trend("successful_upload_duration", true)

export const options = {
  scenarios: {
    media: {
      executor: "shared-iterations",
      vus,
      iterations,
      maxDuration: __ENV.MEDIA_MAX_DURATION || "5m",
    },
  },
  thresholds: {
    checks: ["rate==1"],
    successful_upload_duration: ["p(95)<10000"],
    ...(overload ? { backpressure_rejections: ["count>0"] } : {}),
  },
}

export function setup() {
  if (mutationGate !== "yes-i-understand-dedicated-tenant") {
    throw new Error(
      "Set RUN_MEDIA_UPLOAD_LOAD=yes-i-understand-dedicated-tenant to allow media mutations",
    )
  }
  if (!/^https?:\/\/(127[.]0[.]0[.]1|localhost)(:[0-9]+)?$/.test(baseUrl)) {
    throw new Error("media upload fixture refuses a non-loopback BASE_URL")
  }
  if (!taskId || tokens.length < vus) {
    throw new Error("MEDIA_TASK_ID and at least MEDIA_VUS access tokens are required")
  }
  if (!Number.isInteger(vus) || vus < 1 || vus > 32) {
    throw new Error("MEDIA_VUS must be an integer between 1 and 32")
  }
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 64) {
    throw new Error("MEDIA_ITERATIONS must be an integer between 1 and 64")
  }
  if (mediaBytes.byteLength < 9 * 1024 * 1024 || mediaBytes.byteLength > 11 * 1024 * 1024) {
    throw new Error("MEDIA_FILE must be between 9 MiB and 11 MiB")
  }
  return { startedAt: new Date().toISOString() }
}

export default function (data) {
  const clientPhotoId = `${clientPrefix}-${__VU}-${__ITER}`
  const response = http.post(
    `${baseUrl}/api/v1/mobile/photos/upload`,
    {
      file: http.file(mediaBytes, `${clientPhotoId}.png`, "image/png"),
      clientPhotoId,
      taskId,
      takenAt: data.startedAt,
      mediaType: "photo",
    },
    {
      headers: {
        authorization: `Bearer ${tokens[__VU - 1]}`,
        "x-leadshelf-protocol": "1",
      },
      tags: { operation: "media-upload-10mb" },
      responseCallback: overload ? http.expectedStatuses(201, 503) : http.expectedStatuses(201),
    },
  )

  if (response.status === 201) {
    acceptedUploads.add(1)
    successfulUploadDuration.add(response.timings.duration)
  } else if (response.status === 503) {
    backpressureRejections.add(1)
  }
  check(response, {
    "upload accepted or explicitly backpressured": (result) =>
      result.status === 201 || (overload && result.status === 503),
    "accepted upload returns matching media key": (result) =>
      result.status === 503 ||
      (result.json("key") || "").includes(clientPhotoId),
    "backpressure includes retry-after": (result) =>
      result.status !== 503 || Number(result.headers["Retry-After"]) > 0,
  })
}
