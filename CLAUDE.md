# CLAUDE.md - LeadShelf context

## Порядок доставки — `docs/DELIVERY-ARCHITECTURE.md`

Этот документ главнее всего остального в том, что касается пути изменения до
пользователей, и действует одинаково для Claude, Codex и любых будущих сессий.
Коротко: в `main` только через PR; каждый PR разбирает агент, который его не
писал (`agent-review` — единственная обязательная проверка, своё же ревью не
считается); выкладка — как построена в этом репозитории; перед мержем того, что
увидит пользователь, владельцу показывают короткий список человеческим языком и
ждут «давай».

You are working on `leadshelf`.

This repo is a planning and architecture package for a new standalone product.
It is not yet a production codebase.

Start by reading:

- `README.md`
- `START_NEW_SESSION_PROMPT.md`
- `docs/01-product-scope.md`
- `docs/02-architecture.md`
- `docs/03-roadmap-backlog.md`
- `docs/04-implementation-instructions.md`
- `docs/05-decisions-risks.md`
- `docs/06-meeting-notes-from-leafio-demo.md`
- `docs/07-data-model-draft.md`
- `docs/08-scope-expansion-mtm-full-port.md`

Core instruction:

Do not turn LeadShelf into LeadDrive CRM (no leads/deals/marketing/loyalty/
contracts/finance). Scope = full MTM module port: shelf/planogram/store-layout
PLUS field-force (routes, visits, live map, orders, alerts, agents) — see
`docs/08-scope-expansion-mtm-full-port.md`. Port behavior and proven algorithms
from `leaddrive-v2` MTM, not its architecture: LeadShelf-native schema/naming,
no `Mtm*` prefixes, planogram = physical model (mm/facings), not photo bbox.

Before creating code, summarize the intended architecture and ask for direction
confirmation.
