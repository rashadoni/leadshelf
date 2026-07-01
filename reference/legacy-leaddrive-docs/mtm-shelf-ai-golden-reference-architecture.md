# Shelf-AI — Golden-Reference Compliance Architecture

**Status:** design / pilot proposal · 2026-06-15
**Goal:** "AI automatically understands what's on the shelf and whether it should be there" — with **near-zero manual labeling** and **no separate SKU catalog**, by anchoring on a *golden reference photo* instead of a hand-labeled dataset.

> Grounded in 3 Perplexity literature checks (SKU-110K, Products-10K, Asseco/Infilect/ParallelDots production systems, PMC real-time planogram paper) + Codex peer review. Verdict: a general VLM alone is **not** a reliable per-SKU counter; the industry-standard core is **class-agnostic detection + reference-image embedding matching**. The golden-photo approach is a valid, low-setup instantiation of that.

---

## 0. Why (problem recap)

Current pipeline uses **Claude Vision (VLM) as the primary detector**, called without `temperature` → non-deterministic; plus a **fuzzy word-overlap SKU matcher**. Symptom: the *same* shelf yields *different* compliance scores run-to-run (75% → 50% with one substitute swapped). Root cause is **upstream perception**, not the (deterministic) compliance math.

Two false dichotomies to kill:
- "Accurate AI ⇒ endless manual shelf-labeling" — **false**. The modern form needs at most **one reference image per product** (or just the golden shelf photo), not labeled shelf datasets.
- "Just compare two photos, no SKUs" — **half-true**. Whole-image similarity is only a *coarse anomaly detector* ("something differs"); to say *what* and *where* differs (the actionable value) you still need region-level detection + registration + embedding match. The "SKU" simply becomes a **per-slot reference crop**.

---

## 1. The pipeline

### Setup — once per shelf/planogram (defines the standard)
1. Merchandiser stocks the shelf **correctly** and photographs it → **golden reference** (`MtmPlanogram.referenceImageUrl`, already exists).
2. A **class-agnostic product detector** cuts the golden photo into N product crops = **slots**.
3. Each crop → **visual embedding** (vector).
4. Persist per slot: `{ index, bbox, embedding, refCropUrl, optional skuId/label }`. This is simultaneously the **layout** and the **reference appearance gallery** — no packshot catalog needed.

### Field scan — every visit (compares to the standard)
1. Agent photographs the shelf (existing mobile Planogram flow).
2. **Registration:** align the field photo to the golden plane (homography) so "slot (i)" maps to the right field region.
3. **Detect:** same class-agnostic detector finds product boxes in the field photo.
4. **Embed:** each field box → embedding.
5. **Match:** for each reference slot, find the nearest field product by **position + embedding cosine similarity**.

### Per-slot verdict
| Condition | Verdict |
|---|---|
| Slot matched, embedding ≥ threshold | ✅ compliant |
| Slot has no field product nearby | ⛔ **missing / OOS** |
| Field product present but embedding far from the slot's reference | 🔄 **wrong product / competitor** |
| Field product with no reference slot | ➕ **extra / unexpected** |

→ a **NEW slot-roll-up adapter** converts per-slot verdicts into the `DetectedSku[]` / `ExpectedSku[]` shape the scorer expects, then the **existing** `computeCompliance` / `computeOos` (`src/lib/shelf-analysis/metrics.ts`) score it and the result is stored on `MtmShelfAnalysis`. The adapter is NOT free reuse: the current math aggregates by `skuId` (`metrics.ts:69,107`), but golden slots can be **label-less** (`skuId` undefined → synthesize a stable per-slot id) and the **same SKU can occupy multiple slots** (multi-facing → must aggregate facings back, not double-count). Output is actionable: *"Slot 3: expected [Pepsi-0.5 ref], found a different product."*

---

## 2. Components — reuse vs build

| Component | Approach | Off-the-shelf? | Maps to |
|---|---|---|---|
| Class-agnostic detector | YOLO/RT-DETR pretrained on **SKU-110K** ("product" class only — no per-SKU training) OR Roboflow hosted inference | ✅ pretrained weights / hosted | new provider behind `ShelfAnalysisProvider`; reuse `providers/roboflow.ts` plumbing |
| Visual embedding | CLIP image encoder / DINOv2 / a retail metric-learning model | ✅ pretrained | new `src/lib/shelf-analysis/embedding.ts` |
| Registration (homography) | OpenCV ORB/SIFT feature match → homography; or shelf-edge/price-tag fiducials | ✅ classic CV | new lib (Python side) |
| Nearest-neighbor | per-shelf gallery is tiny (N slots) → **brute-force cosine in app**; no vector DB at pilot scale | ✅ trivial | app code |
| Compliance scoring | **existing** `computeCompliance` / `computeOos` — fed by a **new slot→`ExpectedSku` roll-up adapter** | ⚠️ scorer reused; adapter is new | `metrics.ts` unchanged + new `slot-rollup.ts` |
| Reference-capture / correction UI | reuse the annotator's **canvas mechanics** (draw/move/resize); golden-slot capture is a **separate mode** | ⚠️ canvas reused, persist-path forked | `shelf-annotator.tsx:25-54` is `skuId`+`photoId`-bound; golden mode needs label-less slots, embedding+refCrop storage, `MtmPlanogram` target |
| Supervisor review + human verdict | **existing** `/mtm/planogram-checks` + `MtmPlanogramCheck` | ✅ reuse = the human-review fallback | unchanged |

**The VLM (Claude) is demoted to a helper:** OCR of labels, naming an unknown product in natural language, explaining a deviation — its real strengths — not the counter.

---

## 3. Data model changes

- **Reuse** `MtmPlanogram.referenceImageUrl` (golden photo) + `expectedSkus` Json (positions).
- **New** `MtmPlanogramSlot` (the reference gallery):
  `{ id, planogramId, index, bbox Json, embedding (float[] as Json at pilot, or pgvector later), refCropUrl, skuId? , label? }`
- **New** per-slot results (extend `MtmShelfAnalysis` or a child table): `{ slotIndex, verdict, matchedConfidence, fieldBbox? }`.
- pgvector only if scaling past pilot; at pilot, embeddings are short float arrays compared in app.

---

## 4. Where the ML runs (honest infra note)

Detector + embedding + homography are **Python/ML** (ultralytics/torch/OpenCV), not Node. Options:
- (a) small **FastAPI microservice** the worker calls (recommended for control);
- (b) **Roboflow hosted inference** for the detector + a hosted embedding API (fastest to pilot, the `training/` + `providers/roboflow.ts` infra already speaks Roboflow);
- (c) run inside the existing worker host.

✅ **Consumer already exists — extend it, don't build a new worker.** The **Variant-C cron-backstop is LIVE in prod** (flag `MTM_SHELF_BACKSTOP_ENABLED=1` ON since 2026-06-15; Postgres-cron drainer, no Redis — see `project_mtm_shelf_backstop_live.md`). It already re-runs Claude on parked shelf-scans. The golden-reference pipeline plugs into that same drainer as a new provider/stage — no separate worker process to stand up. (The earlier "[P1] worker has no prod consumer" finding is **stale**: the cron-backstop closed that gap.)

---

## 5. Phasing (pilot-first for Mars)

**Phase 1 — pilot, ~zero labeling (smallest shippable):**
golden photo per shelf → class-agnostic detector (Roboflow hosted or SKU-110K YOLO) → CLIP embeddings → brute-force per-slot match → per-slot report. Registration v0 = assume roughly front-facing, coarse grid align; route low-confidence to the **existing** human verdict. Already beats the current VLM instability, needs **no SKU catalog**.

**Phase 2 — robust:** homography + shelf-edge registration; 2-3 golden angles per shelf; confidence thresholds + human-review queue; explicit "unknown/competitor" state; `temperature:0` + tightened matcher on the VLM fallback.

**Phase 3 — scale:** central gallery (reuse slot crops across stores), pgvector index, optional fine-tuned detector, cross-store analytics + historical comparability.

---

## 6. Honest limits & fallbacks (carry-through from the research)

- **Lighting/angle/device variance** is the real enemy → registration is the hard part; pilot mitigates with capture guidance ("stand front-on, fill the frame") + human review on low confidence.
- **~80-95%, not 100%** → a human-review path is **mandatory**; the existing manual `MtmPlanogramCheck` verdict IS that path — keep it.
- **Packaging/layout change** → re-shoot the golden photo (cheap, per-slot updatable).
- **Per-store layout** → new golden photo per planogram variant (scales linearly); a central catalog generalizes better — the Phase-3 reason vendors converge there.
- **Embedding domain-gap (the #2 hard part, alongside registration).** The golden photo is a controlled, well-lit, front-on capture; field photos are phone shots under glare/angle/blur. The cosine between CLIP embeddings of the *same* SKU across those two domains can drop **below threshold → false "wrong product."** The Phase-1 spike must measure **intra-SKU cross-domain cosine** directly (same SKU, golden vs field) — not just per-slot precision — and set the threshold from that distribution. Mitigations if it's bad: domain-augmented / retail-fine-tuned embedding, multi-view golden captures, or a learned (not raw) similarity head.
- **Cold-start: no golden photo yet.** `MtmPlanogram.referenceImageUrl` is `String?` and most rows are empty today, so there is **no reference gallery until one is captured**. Needs (a) an explicit fallback to the current Claude provider when `referenceImageUrl` is null, and (b) a rollout step: capture golden photos for the N active planograms before enabling the new pipeline per shelf.
- **Multi-facing same-SKU slots.** The same product across 2-3 adjacent facings becomes 2-3 separate reference slots; the roll-up adapter (§1) must aggregate them back to one `ExpectedSku{skuId, expectedFacings}` — mishandling double-counts or under-counts compliance (the same class of bug `metrics.ts:69,107` already fixed for detection duplicates).

---

## 7. What stays from the current code

The compliance **scorer** (`computeCompliance`/`computeOos` — fed by the new roll-up adapter, §1), `MtmShelfAnalysis` / `MtmPlanogram` / `MtmPlanogramCheck`, the supervisor page, the manual verdict (= human fallback), and the annotator's **canvas mechanics** (golden-slot capture is a separate mode, §2). The Claude provider stays as the **cold-start + low-confidence fallback** — set `temperature:0` on it in the meantime (the A+B containment fix).

---

## 8. Immediate next step

**Phase-1 spike:** behind the existing `ShelfAnalysisProvider` interface, wire a class-agnostic detector + CLIP embedding; define ONE golden reference for a real Mars shelf via the annotator; run a field photo; produce a per-slot diff. **Measure accuracy on ~10 real shelves** before committing to the full build — those numbers (run-to-run variance, per-slot precision) decide Phase-2 scope and whether a fine-tuned detector is ever needed.
