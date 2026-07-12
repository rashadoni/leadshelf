# Полевой сбор фото для vision-eval (validation/test)

Статус: гейт `accuracyClaims` закрыт до **≥20 успешных real-сэмплов в
validation/test** (константа `MIN_REAL_SAMPLES_FOR_ACCURACY_CLAIMS`,
services/vision/src/eval-runner.ts). Календибровочный пилот (6 фото) уже
существует и живёт в приватном хранилище вне git. Этот документ — что и как
доснять, чтобы открыть гейт честно.

## Что снять (рекомендация: 24–30 фото)

Представительность важнее количества. Покрыть:

| Сценарий (`--scenario`) | Мин. фото | Комментарий |
|---|---|---|
| `golden` | 3 | Полностью корректная выкладка, разные точки |
| `missing_sku` | 4 | 1–2 SKU отсутствуют |
| `wrong_position` | 4 | SKU переставлены местами |
| `extra_facing` | 3 | Лишние фронты / чужой товар |
| `perspective` | 3 | Съёмка под углом (как реально снимает агент) |
| `rotated_label` | 3 | Этикетки повёрнуты/боком |
| `partial_occlusion` | 2 | Частично перекрытые товары |
| `low_light` / `blur` | 2+2 | Вечернее освещение; смаз |

Требования к кадру: телефон вертикально, весь стеллаж в кадре (как в guided
capture), реальные аптеки/точки, РАЗНЫЕ стеллажи (не 30 фото одной полки —
иначе split-ы не независимы). Без людей в кадре.

## Разметка

На каждое фото — JSON-файл аннотаций (массив, схема
`visionEvalAnnotationSchema`):

```json
[
  {
    "id": "box-1",
    "productSku": "OTC-001",
    "bbox": { "xPct": 12.5, "yPct": 8.0, "widthPct": 14.0, "heightPct": 22.0 },
    "facings": 2,
    "recognitionCondition": "clear"
  }
]
```

- Один бокс = одна позиция (facings — сколько одинаковых фронтов накрывает).
- `recognitionCondition`: `clear` | `rotated_label` | `partial_occlusion` |
  `occluded` — честно, это входит в разрез метрик.
- Координаты в процентах 0..100, origin верхний левый (как в ShelfAnnotator).

## Загрузка в датасет

Из `services/vision`, по одному фото:

```bash
node --import tsx src/dataset-cli.ts add-sample \
  --manifest /private/path/dataset/manifest.json \
  --id <точка>-<стеллаж>-<номер> \
  --photo /path/IMG_XXXX.jpg \
  --annotations /path/IMG_XXXX.annotations.json \
  --planogram-version <id опубликованной версии> \
  --golden-ref "private://<datasetId>/photos/<golden>.png" \
  --scenario missing_sku \
  --source real
```

Split назначится детерминированно (40/40/20) — НЕ выбирать вручную и не
переносить сэмплы между сплитами задним числом. После загрузки:

```bash
node --import tsx src/dataset-cli.ts check --manifest .../manifest.json
node --import tsx src/dataset-cli.ts stats --manifest .../manifest.json
```

`stats.bySourceKind.real` в validation+test должно стать ≥20 (при 40/40/20 и
~30 добавленных фото это выполняется; если не хватило validation-доли —
доснять ещё, НЕ переразмечать сплиты).

## Eval-прогоны

Локально без внешней передачи (wiring, бесплатно):

```bash
VISION_PROVIDER=stub node --import tsx src/eval-cli.ts \
  --manifest .../manifest.json --mode oracle_boxes
```

Внешний прогон (Gemini/OpenAI) = **загрузка фото внешнему провайдеру** —
только с явного разрешения владельца, флаг обязателен:

```bash
node --import tsx src/eval-cli.ts \
  --manifest .../manifest.json --env /private/vision.env \
  --mode end_to_end --allow-external --output .../reports/e2e.json

node --import tsx src/eval-cli.ts \
  --manifest .../manifest.json --env /private/vision.env \
  --mode oracle_boxes --allow-external --output .../reports/oracle.json
```

`--include-test` НЕ добавлять до release-сравнения. Отчёт годен для
заявлений о точности только при `accuracyClaims.allowed: true` — это
проверяется автоматически, вручную ничего доказывать не нужно.
