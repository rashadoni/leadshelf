# LeadShelf vision eval data

Private shelf photos and annotations must not be committed. Keep the real
manifest in private object storage and validate it with
`visionEvalManifestSchema`. The repository contains only code and synthetic
unit fixtures.

Use the `calibration` split to select confidence/IoU thresholds, `validation`
for iteration, and touch `test` only for a release comparison. Report
localization precision/recall separately from SKU accuracy and end-to-end
recall. Provider, model version, token usage, latency and cost are recorded on
`ShelfAnalysisRun`; missing cost must remain `null`, never an invented zero.

## Expanding the dataset

Grow the private dataset with `dataset-cli` — it enforces the split
discipline so a human never juggles them by hand:

```bash
node --import tsx src/dataset-cli.ts check --manifest /private/path/manifest.json
node --import tsx src/dataset-cli.ts stats --manifest /private/path/manifest.json
node --import tsx src/dataset-cli.ts add-sample \
  --manifest /private/path/manifest.json \
  --id store-42-shelf-3 --photo /private/incoming/IMG_0042.jpg \
  --annotations /private/incoming/IMG_0042.annotations.json \
  --planogram-version <id> --golden-ref "private://<datasetId>/photos/golden.png" \
  --scenario missing_sku --source real
```

Rules the tooling enforces:

- **Split assignment is deterministic** (`sha256(sampleId)`, default 40/40/20)
  and a sample is NEVER reassigned afterwards — moving photos between splits
  retroactively is leakage.
- The same `photoRef` cannot appear in two splits; duplicate sample or
  annotation ids are rejected (`check` reports the same issues).
- `--source real|synthetic` is required knowledge: only `real` samples count
  toward the accuracy-claims gate. Synthetic samples are for wiring and
  regression only.
- Annotation JSON is an array of `{id, productSku, bbox, facings,
  recognitionCondition?}` validated by `visionEvalAnnotationSchema`.

## Split discipline in eval runs

`eval-cli` runs `calibration,validation` by default. The `test` split is
excluded unless `--include-test` is passed explicitly and is reserved for
release comparisons. Reports record `requestedSplits`, `includedSplits` and
`testIncluded`; the confidence-threshold sweep is hard-filtered to the
calibration split regardless of what was requested.

## Localization vs SKU classification

`--mode end_to_end` (default) measures the single-stage scan. `--mode
oracle_boxes` feeds the human-annotated boxes to the SKU recognizer, so
localization is an oracle (=1.0 by construction) and `skuAccuracyOnLocalized`
becomes a pure classification measurement. Candidate SKUs come from the golden
sample only — answers outside the candidate list are forced to `null` with a
warning. `--mode two_stage` connects the evaluation-only NVIDIA
LocateAnything localizer to the configured SKU recognizer. It requires the
separate local GPU worker and explicit non-commercial evaluation
acknowledgement documented in `../README.md`; it is not a production provider.

## Accuracy claims

Every report carries a machine-readable `accuracyClaims` block: claims stay
`allowed: false` until validation/test contain at least 20 successful
`sourceKind: "real"` samples and the active provider is not a stub. Do not
quote accuracy numbers from reports where `accuracyClaims.allowed` is false.
