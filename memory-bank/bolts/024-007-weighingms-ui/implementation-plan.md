---
stage: plan
bolt: 024-007-weighingms-ui
created: 2026-11-06T19:30:00Z
---

# Implementation Plan: Batch Queue Screen (Bolt 024)

## What this bolt is

**The FIRST client code in the product.** Unit `007-weighingms-ui` does not
exist yet, and this bolt creates it — the SPA foundation, the queue screen,
and the tests that prove the client's hard constraints.

**And this is a `simple-construction-bolt`**, so the shape is
**plan → implement → test**. There is no domain model and no ADR, because
the story says it plainly:

> *"**This unit owns no functional requirement.** Every FR it exercises is
> consumed through the API; the client is a renderer, not a rule engine."*

**So there is nothing to model and nothing to decide.** The decisions the
backend bolts made — the queue's shape, the selection's method, the
rejection's reason code — are all already made, and the client's job is to
**render them and nothing more**.

## The story's hard constraints — and they are TESTABLE

The story's acceptance criteria are unusually specific about **what the
client source must NOT contain**. That is the design's centre, and it is
what this bolt's tests prove:

| Constraint | How it is proved |
|---|---|
| **No batch, recipe, component, weight or lot is defined in the client** | A test reads the client source and finds no fixture data |
| **`ORGATEX · LINKED` is not a literal** | A test searches the client source for the string |
| **No user-visible literal string is written in a component** | A test searches the client source for literal text |
| **Touch targets ≥ 15 mm** | A component test measures the rendered target |
| **Legible at 1.5 m** | A component test measures the rendered text |

**These are source-inspection tests, and they are the whole point of this
bolt.** The client is the one place where hard-coded data would be most
tempting — and where it would be most invisible.

## The client's architecture

```text
src/007-weighingms-ui/
├── app/
│   ├── App.tsx                    the screen router
│   └── main.tsx                   the entry point
├── api/
│   ├── client.ts                  the ONE fetch wrapper
│   └── endpoints.ts               the typed endpoint calls
├── i18n/
│   ├── bundle.ts                  the locale loader
│   └── useStrings.ts              the hook
├── state/
│   └── queue-store.ts             Zustand — the queue's state
├── screens/
│   └── batch-queue/
│       ├── BatchQueueScreen.tsx
│       ├── QueueRow.tsx
│       ├── QueueToolbar.tsx
│       └── tokens.ts              the DESIGN TOKENS (the only hard-coded values)
└── styles/
    └── tokens.css                 the design token set
```

### THE FOUR RULES, AND HOW EACH IS ENFORCED

**1. No data in the client.** Every batch, recipe, component, weight and
lot arrives over the API. The client's types describe the wire shape, and
they hold **no values**.

**2. No operator-facing literal in a component.** Every string is a **locale
key**, resolved through `useStrings`. The keys are fetched at runtime from
the locale bundle — so a language is changeable without a redeployment
(BRD FR-22, NFR-11).

**3. The link state is the API's.** The status strip reads the real
peripheral and link state. The prototype's hard-coded `ORGATEX · LINKED` is
**deliberately not carried over**.

**4. The touch target is ≥ 15 mm.** Measured in CSS — and the test measures
the **rendered** target.

### The API calls — and they already exist

**Nothing new is needed on the server.** The story's two dependencies are
both live:

| The client needs | The API provides |
|---|---|
| The queue | `GET /api/batch-queue` — the rows, the receipt time, the source, the freshness, the statuses |
| The selection | `POST /api/selection` — with `batchId` (touch) or `code` (scan) |
| The strings | `GET /api/locale/:locale/:key` — bolt 022's endpoint |

**And the two selection methods go through the SAME action** — the story:
*"Selection by scan and by touch both go through the same selection action
and are recorded with their method (FR-2)."* And the **method is derived**
by the server from the request's shape (ADR-030) — so the client does not
send it.

### The degraded states — and they are DISTINGUISHABLE

The story's edge cases are the design's real content:

| Situation | What the client shows |
|---|---|
| The API is unreachable | A **degraded** state with a stated reason — **not** a stale or empty-looking success (BRD FR-20) |
| The queue is empty | An explicit **empty** state, with the receipt time still displayed |
| A filtered queue yields no rows | The empty state, and the filter is **visibly still applied** |
| A batch is no longer released | The row is **not selectable**, and the reason is shown |
| The locale fetch fails | The **configured fallback** language is used; the queue still renders |

**And the API already distinguishes the first two.** The queue controller's
own comment:

> *"an empty queue is a **200** with `batches: []` and a receipt time; an
> unreachable MES is a **503** whose body has **no `batches` key at all** —
> not an empty array. A client that renders whatever is under `batches` is
> therefore forced to look at the status code to know it is in the error
> state."*

**So the client's degraded state is the API's `503`, and the empty state is
the API's `200` with no rows.** Two different renders of two different
responses — and a client that rendered "whatever is under `batches`" would
conflate them.

## The tests

| Suite | What it proves |
|---|---|
| **Component — the queue** | Every row shows the seven columns and the receipt time; the empty state; the degraded state; the filter; the selection by touch and by scan; the refusal's reason; the unreleased row is not selectable. |
| **Component — the touch target** | The rendered target is **≥ 15 mm**; the label is legible at 1.5 m. |
| **Source inspection** | **No** batch/recipe/component/weight/lot fixture in the client; **no** `ORGATEX · LINKED`; **no** operator-facing literal in a component. |

**And the source-inspection tests are the ones that make this bolt worth
doing.** They are the executable form of the story's hard constraints, and
they will fail the moment somebody pastes a batch id into a component.

## What this bolt does NOT do

- **The other four UI bolts' screens** — the weigh view, the confirmation
  view, the audit view, the settings view. Bolts `025`–`028`.
- **The end-to-end Playwright suite** — the workbook requires one, and it
  covers the complete workflow. It belongs with the last UI bolt.
- **The real printer, scanner and scale in the browser** — those are the
  peripherals, and the API already stands in for them.
