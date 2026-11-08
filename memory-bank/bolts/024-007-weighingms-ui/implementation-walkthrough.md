---
stage: implement
bolt: 024-007-weighingms-ui
created: 2026-11-06T20:45:00Z
---

# Implementation Walkthrough: Batch Queue Screen (Bolt 024)

## What was built

**The first client code in the product.** Unit `007-weighingms-ui` did not
exist; this bolt creates it.

```text
src/007-weighingms-ui/
├── app/
│   ├── App.tsx                    the screen — a renderer, no state
│   └── main.tsx                   the entry point
├── api/
│   ├── client.ts                  the ONE fetch wrapper
│   └── endpoints.ts               the typed endpoint calls
├── i18n/
│   └── useStrings.ts              the locale resolver
├── state/
│   └── queue-store.ts             Zustand — the queue's three states
├── screens/batch-queue/
│   ├── BatchQueueScreen.tsx
│   ├── QueueRow.tsx
│   └── tokens.ts                 the DESIGN TOKENS
├── styles/tokens.css              the design token set
└── index.html
```

**And the supporting configuration:** `vite.config.ts`,
`tsconfig.client.json`, the two Vitest projects, and the `jsdom` setup
file.

## The four decisions, and where each lives

### 1. The client is a RENDERER — no data, no rules

**Every value arrives over the API** (BRD IR-07, workbook Rule 5). The
`api/endpoints.ts` file declares the **wire shapes** — and it holds **no
values**. The types are `readonly` and every field is populated by the
server.

**And the source-inspection test proves it**, by reading every source file
and asserting that **none** of the MES's own values appears.

### 2. No operator-facing literal in a component

**Every string is a locale key**, resolved by `useStrings`. The key is
fetched at runtime from the locale bundle — so a language is changeable
without a redeployment (BRD FR-22, NFR-11).

**And the fallback is the key itself.** The translator never returns
`undefined` — a component that rendered `undefined` would show the word
"undefined" to an operator.

### 3. The three states are EXPLICIT

**`QueueState` is a discriminated union of four** — `LOADING`, `LOADED`,
`EMPTY`, `DEGRADED` — and **EMPTY is not DEGRADED**.

**That is the story's BRD FR-20 requirement, made structural.** The
server goes out of its way to distinguish them (a `200` with `batches: []`
versus a `503` with **no** `batches` key), and the store holds the
distinction rather than collapsing it.

**And the client never renders "whatever is under `batches`"** — the
component tests assert that the empty state and the degraded state are
**mutually absent** from each other.

### 4. The touch target is a TOKEN, and the test MEASURES it

`TOUCH_TARGET_MM = 15` — **in millimetres, so the requirement is legible
in the source** — converted to pixels at 96 dpi, and **rounded up**,
because the requirement is a floor.

**And the CSS carries it too**, so a button that forgets the inline style
still meets the requirement.

## The API surface the client uses — and it already existed

**Nothing new was needed on the server.**

| The client calls | It provides |
|---|---|
| `GET /api/batch-queue` | The rows, the receipt time, the source, the freshness, the statuses |
| `POST /api/selection` | The selection — with `batchId` (touch) or `code` (scan) |
| `GET /api/locale/:locale/:key` | One operator-facing string |

**And the two selection methods go through the SAME endpoint and the SAME
action** — only the body's shape differs, and the server **derives** the
method from it (ADR-030). **So the client never sends a method**, and the
component test asserts the body contains no `method` field.

## What the client does NOT do

- **It does not fetch a recipe.** The recipe is unit `002`'s, and the
  weigh screen (bolt `025`) is what loads it.
- **It does not decide anything.** The batch's eligibility, the selection's
  permissibility and the rejection's reason are all the **server's**.
- **It does not subscribe to the weight stream.** That is bolt `025`'s.

## The configuration changes, and why each was needed

| Change | Why |
|---|---|
| `vite.config.ts` | The SPA's build — a separate process on a separate port, per the tech stack's topology |
| `tsconfig.client.json` | The client alone — DOM libs, JSX, `vite/client` types |
| The root `tsconfig.json` now includes `.tsx` | **The client was never typechecked before this** — the whole unit would have shipped unchecked |
| Two Vitest **projects** | The component tests need a DOM; the server tests must stay in `node` (SQLite and Express) |
| `tests/support/ui-setup.ts` | The DOM matchers, and a cleanup that is a no-op outside a DOM |
| `package.json`: `dev:ui`, `build:ui`, `typecheck:client` | The client's commands |

## The verification

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npx tsc --noEmit -p tsconfig.client.json` | clean |
| `npm test` | **111 files, 1767 tests, all passing** |
| `npm run test:coverage` | 88.16% / 80.08% / 91.65% / 89.19% — above the 80% threshold |
| `npm run build:ui` | 39 modules, 229.68 kB (72.02 kB gzipped) |

**And the two Vitest projects do not overlap** — 109 server files and 2
client files, with an empty intersection. That was verified explicitly,
because the first configuration ran every test twice.
