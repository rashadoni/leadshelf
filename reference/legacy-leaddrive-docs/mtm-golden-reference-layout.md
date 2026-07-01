# Golden-Reference Editor — layout contract

Protected-UI reference for `src/components/mtm/golden-reference-editor.tsx` (the
"Golden Reference" section on `/mtm/planograms/[id]`). Read before changing layout —
do NOT remove/relocate these regions without explicit user confirmation.

## Sections (top → bottom), when a reference photo is set

1. **Header row** — title "Golden Reference" + slot count + **Save golden reference**.
2. **Status banner** — deterministic-embedding active (green) vs provisional Claude (amber).
3. **Drift / sync banner** — appears when the golden products differ from the planogram's
   expected-SKU list (offers "Sync SKU list from golden").
4. **Toolbar row** — Replace ideal-shelf photo · Auto-detect slots · Sync SKU list from golden · Remove golden reference.
5. **Canvas — full width, single column** (`space-y-3`):
   - **Photo** — a plain full-width `<img>` (`relative inline-block w-full`) with an absolute
     `surfaceRef` overlay (draw/draft) and an absolute boxes layer. Slot boxes are positioned
     in **percent of the image**; the mouse math reads `getBoundingClientRect()`. NO zoom/pan
     (removed 2026-06-17). Click/drag adds a box, drag moves it, corners resize.
   - **Caption** — usage hint under the photo.
   - **Active-slot editor** — directly BELOW the photo (`mt-3 max-w-xl` card), shown when a
     slot is active: label input, SKU-link search, quick-create-SKU-from-label form, Unlink.
6. **Slots strip** — full width, below the active-slot editor: horizontal **chips** (color dot
   · index · label · trash), header "Slots (N)" + "Clear all slots". Click a chip → that slot
   becomes active (its editor opens under the photo).

## History
- 2026-06-17 (early): moved the slot LIST below the photo; widened canvas to 3/4
  (`grid-cols-4`); added zoom + pan. **Superseded same day.**
- 2026-06-17 (`3692cf1d`): user asked to remove zoom ("скользит") and make the photo
  full-width. Reverted to a single-column full-width photo (no zoom/pan, `zoom-pan.ts`
  deleted); active-slot editor moved from a right rail to a card directly under the photo;
  slot chips remain below. Also tightened the Claude-Vision bbox prompt for tighter
  per-product boxes. Nothing removed from the editor's functionality.
