# LeadShelf planogram editor — UX and E2E audit

Date: 2026-08-20. Audit branch: `codex/planogram-ux-e2e-audit`.

## Scope and evidence

The audit covers the 2D planogram editor flow: product search, shelf selection,
placement creation, facing rendering, numeric editing, drag-and-drop, and removal.

Evidence used:

- owner-provided production screenshot;
- current `origin/main` implementation and placement API contracts;
- physical placement rules in `@leadshelf/core`;
- demo seed data and current browser-test setup.

This document does not claim a completed production-browser run. The new E2E
scenario is implemented and discovered by Playwright, but executing it locally
requires the seeded database/standalone test environment used by CI.

## Confirmed findings

### PE-UX-01 — P0 — facings were visually stretched

The editor rendered one product image across the complete
`facingsX × facingsY` rectangle. Only vertical divider lines were drawn, so a
four-facing placement looked like one abnormally wide package and stacked
facings had no horizontal separation.

Resolution: the canvas now uses a per-package SVG pattern. One cell preserves
the oriented physical front-face dimensions, and the browser repeats that cell
on both axes. The outer placement still represents total occupied dimensions.

### PE-UX-02 — P0 — numeric fields sent partial values

Position and facing inputs issued a PATCH on every `onChange`. Entering `100`
could therefore send `1`, `10`, and `100`, while the first request disabled the
control and made ordinary editing unreliable.

Resolution: numeric values are now local drafts and commit once on blur or
Enter. Escape restores the saved value; rejected server changes also restore it.

### PE-UX-03 — P1 — invalid drag looked valid until server rejection

While dragging, the client did not run the same physical check used by the
server. A placement could visually move over another SKU and then jump back only
after pointer-up.

Resolution: drag preview now uses `validatePlacementOnShelf`, marks invalid
destinations red, and does not send a PATCH for an invalid drop. Valid drag is
marked blue and remains subject to authoritative server validation.

### PE-UX-04 — P1 — stale catalog search could replace current results

Every keystroke started a search without guarding response order. A slow older
response could overwrite a newer query.

Resolution: only the latest request may update the picker, and an explicit
localized loading state is shown.

### PE-UX-05 — P1 — duplicate placement controls on desktop

Two separate property panels were rendered for the selected placement. They
duplicated position/facing/move/remove actions and could drift apart.

Resolution: a single complete property panel remains and is visually ordered
first/sticky in the desktop side column.

## Regression coverage

Unit coverage:

- canvas scale is constrained by both available width and maximum height;
- one face keeps its physical size while X/Y facings enlarge only total bounds;
- rotation and soft-pack X compression affect cell geometry correctly;
- the existing 17 core capacity/collision tests remain green.

Browser E2E coverage (Chromium, Firefox, WebKit in CI):

1. sign in to the demo tenant;
2. open the seeded OTC planogram and create/reuse its editable draft;
3. assert total SVG bounds equal per-face bounds multiplied by X/Y facings;
4. select shelf 1, search `OTC-001`, and add it;
5. type position `100` and assert exactly one position PATCH;
6. drag the placement to a valid new physical position and verify persisted X;
7. remove the test placement and verify cleanup.

Stable `data-testid`/geometry attributes were added specifically so these tests
verify behavior and physical relationships instead of fragile localized text or
pixel screenshots alone.

## Remaining acceptance work

- Run the new Playwright test against the seeded standalone environment/CI.
- Capture desktop and tablet screenshots after that run and compare the product
  proportions visually with real catalog images.
- Add a dedicated browser case for an invalid collision drag once CI confirms
  pointer behavior is identical across all three engines.
- Perform a touch-device pass before calling the editor tablet-ready; pointer
  events and `touch-action` are present, but this audit does not claim a real
  tablet acceptance run.
