# AGENTS.md - LeadShelf operating rules

This repository is the starting context for `leadshelf`, a standalone shelf,
planogram, store-layout, mobile execution, and shelf analytics product.

## First Read

Before writing code, read these files in order:

1. `README.md`
2. `START_NEW_SESSION_PROMPT.md`
3. `docs/01-product-scope.md`
4. `docs/02-architecture.md`
5. `docs/03-roadmap-backlog.md`
6. `docs/04-implementation-instructions.md`
7. `docs/05-decisions-risks.md`
8. `docs/06-meeting-notes-from-leafio-demo.md`
9. `docs/07-data-model-draft.md`

## Product Boundary

LeadShelf is not LeadDrive CRM. Do not copy CRM modules into this product.

Allowed reference from `leaddrive-v2`:

- MTM/shelf-AI ideas;
- SKU catalog, equipment, shelf, photo proof, and planogram concepts;
- useful implementation patterns after review.

Do not bring over:

- deals, CRM pipelines, marketing, contracts, finance, loyalty, omnichannel,
  AI Advisor, generic CRM dashboards, or unrelated tenant workflows.

## Working Rule

The first implementation step must be a short technical plan with:

- stack choice;
- repo structure;
- first data models;
- first MVP flow;
- explicit exclusions.

Only create code after that direction is confirmed.

## Truthfulness Rule

Never present newly written code as a direct transfer from another project.
If a feature is rebuilt from scratch, adapted from an idea, partially ported,
not verified, or visually different from the reference product, say that
explicitly. Separate facts from assumptions and clearly label work as
"implemented", "draft", "not transferred", "not tested", or "blocked".

## MVP Order

Build in this order:

1. catalog;
2. equipment library;
3. planogram editor;
4. publish task to store;
5. mobile photo proof;
6. analytics.

3D and AI/computer vision are later layers and must not block the MVP.
