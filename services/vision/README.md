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
OPENAI_VISION_MODEL=gpt-5.5
VISION_PUBLIC_BASE_URL=https://hermescrm.xyz/
```

`OPENAI_API_KEY` is a server secret. This is not connected to a Codex or
ChatGPT subscription. The provider sends the target shelf photo and optional
golden reference photo to OpenAI Responses API using `input_image`, then parses
strict JSON detections and computes compliance through LeadShelf core scoring.

`photoUrl` and `goldenReferenceUrl` must be HTTPS/data-image URLs, or relative
paths resolvable through `VISION_PUBLIC_BASE_URL`. If no public/presigned image
URL is available, the scan fails explicitly and stays in human-review workflow.
