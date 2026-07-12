# services/vision — optional AI service (Phase 10)

Golden reference + detector/embedding (порт архитектуры из
mtm-shelf-ai-golden-reference-architecture.md). MVP работает без этого сервиса.

## HTTP contract

- `GET /health`
- `POST /v1/scan`

The current provider is `leadshelf-stub`: it mirrors reference slots into
low-confidence detections and always requires human review. It exists to harden
the service boundary before connecting a real detector/embedding provider.

## Providers

Default:

```bash
VISION_PROVIDER=stub
```

OpenAI Responses API provider:

```bash
VISION_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_VISION_MODEL=gpt-5.4
```

`OPENAI_API_KEY` is a server secret. This is not connected to a Codex or
ChatGPT subscription. The provider sends the target shelf photo and optional
golden reference photo to OpenAI Responses API using `input_image`, then parses
strict JSON detections and computes compliance through LeadShelf core scoring.

`photoUrl` and `goldenReferenceUrl` must be HTTPS/data-image URLs, or relative
paths resolvable through `VISION_PUBLIC_BASE_URL`. If no public/presigned image
URL is available, the scan fails explicitly and stays in human-review workflow.

For production LeadShelf web -> vision scans, configure the web app to mint
short-lived signed media URLs before sending requests to this service:

```bash
VISION_MEDIA_PUBLIC_BASE_URL=https://hermescrm.xyz
VISION_MEDIA_SIGNING_SECRET=...
```

The signed route is `/api/vision-media/photos/...` and is limited to `photos/*`
object keys with an expiry and HMAC signature. Keep `/api/media` session-guarded
for normal users.

## Private evaluation runner

Real photos and generated reports stay outside Git. The runner validates the
versioned manifest, evaluates every scenario separately, aggregates
localization/SKU/calibration metrics and sweeps confidence thresholds only on
the `calibration` split:

```bash
node --import tsx src/eval-cli.ts \
  --manifest /private/path/dataset/manifest.json \
  --output /private/path/dataset/reports/run.json
```

The default stub is useful only as a wiring dry-run and is never eligible to
recommend a confidence threshold. OpenAI and Gemini runs are privacy-gated and
require both the provider env and the explicit `--allow-external` flag:

```bash
node --import tsx src/eval-cli.ts \
  --manifest /private/path/dataset/manifest.json \
  --env /private/path/vision.env \
  --output /private/path/dataset/reports/provider-run.json \
  --allow-external
```

That flag means the target and golden-reference photos will be uploaded to the
configured external provider. Reports keep `costUsd: null` until the provider
path exposes trustworthy usage/cost data. A calibration-only dataset can
suggest a threshold, but it cannot validate accuracy or select production
provider/model without a separate validation split.

Provider output remains strictly schema-validated, but the parser tolerates a
JSON object wrapped in Markdown/prose because Gemini may ignore
`responseMimeType`. Bounding boxes returned in unit-interval coordinates are
normalized to 0..100 percentages and emit `bbox_unit_interval_normalized` for
auditability.

### Local Apple Vision OCR baseline (macOS only)

When external photo upload is unavailable, the repository includes a local
Apple Vision OCR probe. It never calls a network service:

```bash
CLANG_MODULE_CACHE_PATH=/tmp/leadshelf-clang-cache clang \
  -fobjc-arc -framework Foundation -framework AppKit -framework Vision \
  tools/apple-vision-ocr.m -o /tmp/leadshelf-apple-vision-ocr

/tmp/leadshelf-apple-vision-ocr /private/path/sample.png \
  > /private/path/ocr/sample.json

node --import tsx src/apple-vision-ocr-eval-cli.ts \
  --manifest /private/path/dataset/manifest.json \
  --ocr-dir /private/path/ocr \
  --output /private/path/reports/apple-vision-ocr.json
```

The resulting mode is intentionally named `oracle-box-text-evidence` and sets
`oracleLocalization: true`: OCR text centers are checked inside human-annotated
product boxes. It measures whether readable text exists, not object detection
or SKU-classification accuracy. The Objective-C binary may need to run outside
a restricted sandbox so macOS can access the on-device Vision model; this does
not authorize or perform network transfer.
