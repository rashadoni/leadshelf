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
