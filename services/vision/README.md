# services/vision — optional AI service (Phase 10)

Golden reference + detector/embedding (порт архитектуры из
mtm-shelf-ai-golden-reference-architecture.md). MVP работает без этого сервиса.

## HTTP contract

- `GET /health`
- `POST /v1/scan`

The current provider is `leadshelf-stub`: it mirrors reference slots into
low-confidence detections and always requires human review. It exists to harden
the service boundary before connecting a real detector/embedding provider.
