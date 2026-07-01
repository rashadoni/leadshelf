# MTM Shelf-AI — Self-Hosted Trained Object-Detector Plan (runbook)

> Status: **PLAN / not started.** Written 2026-06-17 per user decision. This is the
> reference doc to read before any code on the trained detector. Supersedes
> ad-hoc prompt-tweaking of Claude-Vision bboxes (which hit its ceiling — see
> "Why" below).

## 0. TL;DR

- **Goal:** replace Claude-Vision's *approximate* product-box localization with a
  **trained object detector** so auto-detect boxes sit tightly on each product —
  effie/Trax-parity. Claude stays excellent at *reading* labels; it is weak at
  *localizing* tight boxes on dense, reflective, back-lit shelves. Three prompt
  iterations (commits `c1723c4f`, `8b661eaa`, plus the tight-box rules) confirmed
  the VLM ceiling.
- **Big finding (workflow audit, 2026-06-17):** the trained-detector pipeline is
  **~90% already built and wired** in this repo — annotation persistence, COCO
  export, training-run state machine, per-org `activeModel` override, the inference
  provider interface, and multi-tenant gating all exist. What was built targets
  **Roboflow (hosted)**; the gaps are operational glue + the annotation labor.
- **User decisions (2026-06-17):**
  1. **Self-host** the detector (own GPU), NOT Roboflow hosted — data residency
     (FMCG competitive shelf data never leaves our infra) + zero recurring
     per-inference billing. Accept the higher engineering cost.
  2. **Architecture = RF-DETR** (Apache-2.0, NMS-free, set-based Hungarian
     matching), NOT YOLO+NMS. Hard requirement: NMS merges adjacent near-identical
     Pepsi facings → wrong facing counts. (YOLO11 is the fallback only if RF-DETR
     self-host proves impractical, with soft-NMS/class-agnostic-NMS mitigation.)
  3. **Written plan first** (this doc), then code.
- **Honest cost shape:** this is **weeks of work, and the dominant cost is
  annotation LABOR, not engineering.** Dense shelves = ~100–150 boxes/photo,
  ~3–6 min/photo even with auto-label assist. Engineering across Phases 0–3 is
  ~3–4 weeks *because so much already exists*; annotation pushes wall-clock to
  ~6–8 weeks. Accuracy ceiling on dense identical facings is realistically
  **~0.70–0.80 mAP@0.5** (~0.35–0.45 at mAP@[.5:.95]) — the same bar effie/Trax
  operate at; they lean on downstream metrics, not box perfection.

---

## 1. Why a trained detector (not more prompt-tuning)

A VLM (Claude Vision) does **multimodal reasoning** — it reads the label and tells
you *what* the product is, accurately. It estimates *where* (the bbox) only
approximately, and no prompt fixes that: on the Mars pilot golden photo the
products stand on a glossy table that mirrors them, are back-lit, and stand
edge-to-edge — the worst case for VLM localization. Tight per-product boxes are an
**object-detection** task. The right tool is a detector trained on the client's
SKUs. This is exactly what effie/Trax do (and the dormant Roboflow scaffolding in
this repo was built for).

---

## 2. What already exists (REUSE) — from the codebase audit

All of the following are present and `wired` (verified 2026-06-17):

| Component | Path | Reused as-is for self-host? |
|---|---|---|
| Annotation schema | `MtmShelfAnnotation` (prisma:4523-4545) — bbox 0-1, source MANUAL/AUTO/CONFIRMED | ✅ yes |
| Annotation API | `PUT/GET /api/v1/mtm/photos/[id]/annotations` | ✅ yes |
| Annotation/markup UI | `mtm/shelf-analytics/[id]/page.tsx` + the planogram/golden editor | ✅ yes (this is the annotator the user already uses) |
| **COCO export** | `src/lib/shelf-analysis/coco-export.ts` (normalized→pixel, SKU→category, label-collision safe) | ✅ yes — this is the dataset feed for *any* trainer |
| Image measurement | `src/lib/shelf-analysis/measure-image.ts` (sharp) | ✅ yes |
| Training-run schema | `MtmModelTrainingRun` (prisma:4562-4590) — status enum, counts, `metrics` JSON | ⚠️ **adapt** — fields are Roboflow-named (`roboflowProject`/`roboflowVersion`, schema:4572-4573); rename to provider-neutral (`modelRef`/`modelId`). Data-flow reused; contract migrated. |
| Training-run state machine | `transition-run.ts` (UPLOADED→TRAINING→READY→DEPLOYED, compare-and-set) | ⚠️ **adapt** — `:71` hard-requires `roboflowVersion` to reach READY and `:99-100` sets `{project, version}`; generalize the READY-required field + deploy payload to a model-ref. Semantics fit; field names don't. |
| Active-model pointer | `active-model.ts` get/setActiveModel via `MtmSetting['shelfModel.active']` | ⚠️ **adapt** — `ActiveModel = { project; version }` (`active-model.ts:13`) is the Roboflow shape; needs a weights/model-id descriptor. Storage (MtmSetting) reused; descriptor changes. |
| Provider OUTPUT contract | `DetectedSku` (`types.ts`) — label/bbox/confidence/facings | ✅ yes — the detector emits exactly this |
| Provider INPUT contract | `AnalysisInput.activeModel?: { project; version }` (`types.ts:24`) | ⚠️ **adapt** — exact Roboflow shape; self-host needs a different `activeModel` descriptor, so `ShelfAnalysisProvider`/`AnalysisInput` **do change**. NOT a pure drop-in. |
| Inference plug point — queue worker | `shelf-analysis.ts:260,262` — reads `getActiveModel`, provider-injected | ✅ yes — true drop-in here |
| Inference plug point — inline mobile | `mobile/shelf-analytics/analyze/route.ts` — calls `provider.analyze` directly at `:398` & `:531`, **does NOT read activeModel** | ⚠️ **adapt** — wiring the detector here needs the activeModel read ADDED, not just a constructor swap |
| Label→SKU decoupling | `matchSkuId()` `shelf-backstop-processor.ts:50-118` (detector outputs label+bbox only) | ✅ yes |
| Multi-tenant gating | `org.modules['mtm_model_training']` (`model-training-access.ts` + `api-auth.ts`) + dormant "Model Training" UI | ✅ yes |
| Training reaper cron | `mtm-training-reaper` + `reap-stuck-runs.ts` | ✅ yes |
| Stuck-run safety | reaper sweeps UPLOADING>30min → FAILED | ✅ yes |

**REPLACED for self-host (built for Roboflow hosted, not reused as-is):**

| Roboflow-specific piece | Path | Self-host replacement |
|---|---|---|
| Dataset *upload* to Roboflow | `roboflow-uploader.ts`, `run-training-upload.ts` | Export COCO to our **own dataset store** (disk/S3); training reads it directly. Keep the Roboflow uploader as a dormant alternative; don't delete. |
| Hosted *training* (manual in Roboflow UI) | n/a (no trigger API) | A **self-hosted training job**: a reproducible RF-DETR fine-tune script on a GPU, producing weights. |
| Hosted *inference* | `providers/roboflow.ts` → `detect.roboflow.com/{project}/{version}` | A new **`providers/object-detector.ts`** calling our **own inference service** (HTTP). Same `ShelfAnalysisProvider` contract → drop-in. |

> Net: the **data path** (annotate → COCO → activeModel → provider → scan) is
> reused in shape (with a provider-neutral `modelRef` rename of the Roboflow-named
> fields — see §6 P1). Only the **training compute** and the **inference endpoint**
> become ours instead of Roboflow's.

---

## 3. Target architecture (self-hosted)

```
                 ┌─────────────────────── LeadDrive app (Next.js, Hetzner) ───────────────────────┐
  field photo →  │  scan route ──> ShelfAnalysisProvider (activeModel) ──> object-detector provider │
  golden photo→  │  auto-detect route ── (same provider when activeModel set) ─────────┐            │
                 └───────────────────────────────────────────────────────────────────┼────────────┘
                                                                                       │ HTTP (image → boxes)
                                                                                       ▼
                              ┌──────────── Inference service (GPU or CPU box) ────────────┐
                              │  FastAPI / ONNX-Runtime (or Triton) serving RF-DETR weights │
                              │  /detect: image → [{label, bbox 0-1, confidence}] per FACING │
                              │  (one entry per facing; the provider aggregates → facings)   │
                              └─────────────────────────────────────────────────────────────┘
                                                       ▲ weights (.pth → ONNX/TensorRT)
                              ┌──────────── Training job (GPU box / cloud spot) ────────────┐
   COCO export (existing) ──▶ │  RF-DETR fine-tune on the org's COCO dataset → weights      │
                              │  emits metrics (mAP/precision/recall) → MtmModelTrainingRun  │
                              └─────────────────────────────────────────────────────────────┘
```

Key properties:
- **Same OUTPUT contract** — the detector emits `DetectedSku[]` (label, 0-1 bbox,
  confidence, facings); downstream `matchSkuId` + compliance untouched. The
  **INPUT** contract is NOT identical: `AnalysisInput.activeModel` is the Roboflow
  `{project, version}` shape (`types.ts:24`) and must become a provider-neutral
  model-ref — so `ShelfAnalysisProvider`/`AnalysisInput` get a small contract
  migration (P1), not a zero-change drop-in.
- **Per-org model** — `activeModel` in `MtmSetting` points to a model id/version;
  the inference service loads that org's weights. Mars-only blast radius.
- **Inference can be CPU** for pilot volume (a small RF-DETR / YOLO11n on CPU is
  viable at low photo throughput); GPU only if latency/volume demands it.
- **Training needs a GPU** (fine-tune) — cloud **spot** T4/L4 (~$0.50–1.00/hr
  on-demand, 50–70% cheaper spot) for the occasional retrain job. No always-on GPU.

---

## 4. Data plan (the real work)

(Numbers Perplexity-verified 2026-06-17; sources in §9.)

- **You're fine-tuning a pre-trained backbone, never training from scratch.**
- **Per-SKU images:** minimum viable ~100–200 img/SKU (each SKU across
  pose/lighting/position) + heavy augmentation → ~70–85% mAP@0.5 in controlled
  conditions. Production-grade across stores ~300–500 img/SKU → ~85–95% on a
  focused 10–50 SKU set.
- **Cheaper alternative — single "product" class** (SKU-110K style): if we only
  need *product-vs-background* boxes and let Claude/`matchSkuId` name them, we need
  far fewer images total (thousands, not thousands-per-SKU). **Strongly consider
  this for the pilot** — it sidesteps per-SKU class balance and pairs the detector
  (localization) with Claude (labeling) — each tool doing what it's best at.
- **Annotation effort:** ~100–150 boxes per dense photo; fully manual ~8–12
  min/photo; with auto-label assist (Grounding DINO + SAM2, or CVAT/Label-Studio
  + SAM) ~3–6 min/photo — BUT dense identical facings are the worst case for
  auto-label (Grounding DINO under-counts identical rows; SAM2 merges adjacent
  cans into one mask). **Auto-label is ~40–70% assistive, not automatic.**
- **Bootstrap trick:** after training a first in-domain detector, use **that
  model** to re-auto-label the rest of the photos — it handles our exact SKU
  appearance/spacing far better than generic foundation models. Active-learning
  loop from there. Plus copy-paste compositing (segment packshots → paste onto
  shelf backgrounds → auto-boxes) to multiply data cheaply.

---

## 5. Phased plan (self-hosted)

### Phase 0 — Proof slice (one shelf, ~5–10 SKUs) · **~1 week** (mostly labeling)
Prove the whole loop end-to-end before any infra investment.
- Capture 30–50 real photos of ONE Pepsi shelf/cooler.
- Hand-annotate every facing in the **existing** markup UI (source=MANUAL).
  - Decide here: **single "product" class** vs per-SKU classes (recommend single
    class for the proof — fastest, and Claude already names well).
- Export COCO via the **existing** `coco-export.ts` (add a small "download COCO"
  action — see gaps §6 — so we can feed a local trainer).
- Train RF-DETR-L locally: a throwaway script on a **cloud spot GPU** (rent
  ~1–2 hrs, ~$1–2) fine-tuning on the COCO export → weights → ONNX.
- Stand up a **minimal** inference endpoint (FastAPI + ONNX-Runtime, CPU ok for a
  few test images) and a temporary `object-detector` provider.
- Run the same test photos through the detector and **compare boxes vs Claude**
  (thin eval view — the only real Phase-0 code).
- **GO/NO-GO:** does RF-DETR give tight non-merged boxes on adjacent facings?

### Phase 1 — Productionize inference · **~1 week**
- Real `src/lib/shelf-analysis/providers/object-detector.ts` (implements
  `ShelfAnalysisProvider`, calls the inference service, normalizes to 0-1 bbox).
- Deploy the inference service (where? §7) with model-version loading from
  `activeModel`.
- **Wire the plug points** to use it when `activeModel` is set:
  - queue worker `shelf-analysis.ts` (already provider-injected + reads activeModel — true drop-in),
  - inline `mobile/.../analyze/route.ts` (calls `provider.analyze` directly at
    `:398` & `:531` and does NOT read activeModel today — must ADD the activeModel
    read + provider selection, not just swap the constructor),
  - **golden `auto-detect/route.ts`** — provider selection is ALREADY wired (commit
    `827d0c64`): `ObjectDetectorProvider` when `MTM_DETECTOR_URL` + `activeModel` are set,
    else `ClaudeVisionProvider`. The REMAINING golden work is the per-(label × shelf-block)
    granularity below — not the provider swap.
  - **CRITICAL for golden authoring — match the detector's granularity to the golden SLOT model.**
    A golden slot = one product BLOCK at a shelf position (a contiguous run of same-SKU
    facings), labelled once, with `facings = N`. `detectionsToSlotDrafts`
    (`golden-auto-detect.ts:38`) makes ONE slot per detection and carries `facings` as a
    field (input type `DetectionLike` at `src/lib/shelf-analysis/golden-auto-detect.ts:36`
    = `{ label, bbox, confidence?, facings?, skuId? }`);
    `slotsToExpectedSkus` → `clusterSlotsIntoShelves` then places each block on its real
    shelf by bbox `y`. So the detector must emit **one detection per (label × shelf-block)**
    — NOT either extreme:
    - `src/lib/shelf-analysis/providers/object-detector.ts:96-126` aggregates by label GLOBALLY (one `firstBbox` + summed
      facings + `maxConfidence` per label). Too COARSE for golden: a SKU on two shelves
      collapses to one box → multi-shelf placement dies, and `max()` hides an uncertain
      facing. (This aggregation is still CORRECT for the FIELD-SCAN scoring path —
      `computeOos`/`computeCompliance` sum detected facings by skuId anyway — keep it there.)
    - Raw per-facing (one slot per bottle, `facings = 1`) is too FINE: a 3-facing Pepsi
      block becomes 3 adjacent slots instead of one slot with `facings = 3`.
    The trained detector emits per-FACING boxes (service contract §3, on
    `result.rawResponse.detections` — `src/lib/shelf-analysis/providers/object-detector.ts:132`).
    To feed golden authoring, GROUP those per-facing detections into blocks — same label +
    same shelf band + adjacent in x (`clusterSlotsIntoShelves` gives the y-banding +
    left→right order ONLY; the x-gap/adjacency grouping into blocks is NEW code in this
    mode) — emitting one `DetectionLike` per block (`{ label, bbox: block-bounds,
    confidence: block-min — design choice (min = conservative flag), facings: count }`), then run
    `detectionsToSlotDrafts`. Claude already approximates this — it returns one entry per
    visible block with `facings = N` (one entry per shelf occurrence), which is why golden
    authoring works on the Claude path today; the goal is to give the detector the SAME
    per-block granularity. Cleanest: an `aggregate: 'block'` mode on `analyze` that does
    this per-shelf-block grouping (vs the current global-by-label), selected by the golden
    route. Do NOT change the field-scan path.
- **Keep Claude as Tier-2 fallback** for low-confidence/empty detector results
  (worker already supports a `tier2Provider`).
- Replace the **silent** degradation-to-defaults with a logged circuit-breaker +
  alert when the inference service is down (closes an audit gap).

### Phase 2 — Annotation scale-up + dataset quality · **~2–3 weeks** (labeling-bound)
- Expand to all ~10–50 pilot SKUs across more shelves; trajectory to
  ~300–500 img/SKU via copy-paste augmentation.
- Self-bootstrap re-labeling loop (use our own first model).
- Surface AUTO detections in the markup UI → reviewer marks CONFIRMED → feeds the
  next training run (schema already supports CONFIRMED).
- **Pre-train dataset validation** (closes audit gap): min boxes/image, bbox
  bounds, label collisions, per-class balance + counts, COCO preview/download.
- Annotation-coverage dashboard (which SKUs have examples, boxes/SKU, next targets).

### Phase 3 — Training automation + ops · **~1.5–2 weeks**
- A **reproducible training pipeline**: trigger a training job (spot GPU) from the
  app → run RF-DETR fine-tune → emit metrics → mark run TRAINING→READY (auto, with
  metrics) → operator DEPLOY. This replaces the Roboflow-UI manual step AND closes
  the "no training trigger" CRITICAL gap by owning the trainer.
- Roboflow metrics ingestion gap → becomes "trainer writes
  `MtmModelTrainingRun.metrics`" (mAP/precision/recall) so quality is reviewable
  before DEPLOY.
- Model-version **rollback** + history (revert activeModel to a prior version).
- Post-deploy performance tracking (sample field photos, new-vs-prev facing-count
  accuracy, regression flag).

### Phase 4 — DEFER until a trigger fires
- **Two-stage detector + embedding classifier** (the real effie/Trax end-state):
  a generic "product facing" detector + crop→embedding nearest-neighbor against a
  SKU packshot gallery, so **new SKUs become a data op (add packshots), not a
  retrain**. Build only when: (a) multi-client, (b) frequent SKU churn, or (c) the
  single-stage per-client model becomes a maintenance burden. **Out of scope for
  the pilot.**

---

## 6. Gaps to close (from the audit) — mapped to phases

| Gap | Severity | Phase |
|---|---|---|
| No training trigger / completion signal (Roboflow had none) | CRITICAL | P3 (we own the trainer → no longer Roboflow-dependent) |
| `MtmModelTrainingRun.metrics` never populated | high | P3 |
| **Rename Roboflow-named schema+contract → provider-neutral** (`roboflowProject`/`roboflowVersion` → `modelRef`; `ActiveModel`/`AnalysisInput.activeModel` descriptor; `transition-run.ts` READY field). A real migration, not free. | high | **P1** |
| No pre-upload dataset validation | high | P2 |
| COCO preview/download absent (needed to feed a local trainer) | high | **P0** (small) |
| Silent inference fallback (no alert/circuit-breaker) | high | P1 |
| **Golden auto-detect needs PER-(label × shelf-block) detections** — global by-label aggregation (`src/lib/shelf-analysis/providers/object-detector.ts:96-126`) is too coarse (collapses a SKU across shelves → breaks multi-shelf placement / per-slot facings / low-confidence flag, all shipped 2026-06-19); raw per-facing is too fine (over-segments a multi-facing block). Group per-facing into per-shelf blocks (a new `aggregate:'block'` mode — unbuilt). Field-scan path unchanged. Plumbing, not a model change. | high | **P1** |
| Per-org model isolation (env-global today) | high (compliance) | P1 — self-host removes the shared-hosted-project risk entirely |
| Annotation feedback loop (CONFIRMED → next train) | medium | P2 |
| Model rollback / version history | medium | P3 |
| Per-image upload-error detail in UI | low | P2 |
| Annotation coverage dashboard | medium | P2 |
| Post-deploy performance tracking | medium | P3 |

---

## 7. Infra decisions still OPEN (need user input before Phase 1)

1. **Where does the inference service run?** The current MTM box (Hetzner shared
   `46.224.171.53`) has **no GPU**. Options:
   - **CPU inference on the existing box** (small RF-DETR/YOLO11n) — viable at
     pilot photo volume, zero new infra, slower per image. *Recommended for the
     pilot.*
   - A **dedicated GPU server** (e.g. Hetzner GPU / a cloud GPU VM) — needed only
     if latency/volume grows.
   - ⚠️ **Multi-tenant note:** the CPU-on-existing-box option puts the inference
     service on the **shared** Hetzner box serving all tenants. Per-org weights
     isolation must then hold at the **inference-service layer** (load only the
     caller-org's model per request), not just via the `activeModel` pointer —
     otherwise the "data residency / isolation" selling point of self-host leaks.
2. **Where do training jobs run?** Recommend **cloud spot GPU on-demand** (rent a
   T4/L4 for the ~1–2 hr retrain, ~$1–2/run, tear down). No always-on GPU.
3. **Model/weights storage** — disk on the inference box vs object storage (S3).
   Pilot: disk is fine.
4. **Who does the annotation labor?** This is the schedule driver — internal time.

---

## 8. Costs & risks (honest)

**Cost (self-host):**
- One-time **engineering**: ~3–4 weeks (Phases 0–3) *because the data pipeline
  exists*; the new bits are the trainer script, the inference service, and the
  `object-detector` provider.
- One-time **annotation labor**: a 300–600-image seed set = multi-day-to-two-week
  effort for a small team (internal time). **This is the real cost.**
- **Recurring**: ≈ **$0 per inference** (CPU on the existing box) or a few
  $/month if a small GPU VM; training ≈ $1–2 per spot-GPU retrain run. No vendor
  per-call billing. Full data residency.

**Risks:**
1. **Annotation labor is the #1 schedule risk.** Dense identical facings are the
   worst case for auto-label; humans must split merged boxes. Underestimating this
   is how it slips.
2. **Accuracy ceiling is real** — ~0.70–0.80 mAP@0.5, ~0.35–0.45 mAP@[.5:.95].
   Set Mars' expectation to "tight-enough boxes + good downstream metrics", the
   effie/Trax bar — not perfection.
3. **RF-DETR is a hard requirement, not a preference.** YOLO+NMS will merge
   adjacent identical Pepsi facings → wrong counts.
4. **Self-host ops burden**: we own training reproducibility, the inference
   service uptime, and model deployment. More moving parts than hosted.
5. **GPU for training** must be available on demand (spot can be preempted —
   checkpoint + retry).
6. **First-model cold start**: until a decent model is trained, auto-detect stays
   on Claude (approximate). Manual box-drawing remains the fallback for the golden
   reference in the meantime.

---

## 9. References (Perplexity-verified 2026-06-17)

- RF-DETR (Apache-2.0, NMS-free, dense/occluded): https://blog.roboflow.com/rf-detr/ ·
  https://rfdetr.roboflow.com · https://github.com/roboflow/rf-detr ·
  https://rfdetr.roboflow.com/develop/learn/benchmarks/
- Dense shelf detection (SKU-110K, single "product" class):
  https://docs.ultralytics.com/datasets/detect/sku-110k
- YOLO11 (fallback): https://docs.ultralytics.com/ (Ultralytics)
- Two-stage retail recognition (detector + embedding) — NVIDIA RetailObjectDetection,
  Trax/effie pattern (deferred Phase 4).

---

## 10. Immediate next steps (engineering, when user says go)

1. Enable `mtm_model_training` module for the **mars** org (feature flag) — brings
   back the "Model Training" UI.
2. Golden `auto-detect` route provider selection is DONE (commit `827d0c64`: detector
   when `MTM_DETECTOR_URL` + `activeModel`, else Claude). What remains is the
   per-(label × shelf-block) granularity for golden authoring — see the Phase-1 callout.
3. Add a **COCO download/preview** action to the model-training UI (feeds the local
   trainer) — small, unblocks Phase 0.
4. Stand up the **Phase-0 throwaway trainer + minimal inference endpoint** and the
   **eval view** (Claude vs detector) for the GO/NO-GO.

> Decision log: self-host + RF-DETR + plan-first chosen by user 2026-06-17. GPU/
> annotation-labor decisions (§7) still open — confirm before Phase 1.
