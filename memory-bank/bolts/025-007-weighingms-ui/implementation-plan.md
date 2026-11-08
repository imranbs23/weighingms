---
stage: plan
bolt: 025-007-weighingms-ui
created: 2026-11-06T21:40:00Z
---

# Implementation Plan: Weigh View (Bolt 025)

## What this bolt is

**The live weight view** — the recipe rail, the live readout, the tolerance
band, and the status line.

**This is a `simple-construction-bolt`**, so the shape is **plan → implement
→ test**. There is no domain model and no ADR, because **the client owns no
functional requirement** — the story says it plainly:

> *"**This unit owns no functional requirement.** Every FR it exercises is
> consumed through the API; the client is a renderer, not a rule engine."*

## The facts I checked before planning

**Both were needed, and neither was guessable from the story:**

| The client needs | What actually exists |
|---|---|
| The live weight | `GET /api/scales/:scaleId/weight` — **SSE**, `event: reading` / `event: status`, with a `: heartbeat` comment every 15 s |
| The session's live weight | `GET /api/session/weight` — the **station's** weight, with the still-to-weigh |
| The zone | `GET /api/session/zone` — **computed by the domain** and returned |
| The recipe rail | `GET /api/session` — the component states |
| The strings | `GET /api/locale/:locale/:key` |

**And the reading's SSE frame is `event: reading`** with
`{ scaleId, value, unit, stable, sequence, receivedAt, tare }` — where the
value is a **JSON STRING** (ADR-008).

## The four decisions

### 1. The zone is RECEIVED, never computed

**The story is emphatic, and it is the client's most important rule:**

> *"the status line text and the readout colour are those the API reports
> for that zone, and **the client performs no zone computation of its
> own**"* (FR-9, BRD FR-10).

> *"**Two classifications of the same reading in two places is the failure
> mode this avoids**, and it is also why the confirm button's disabled
> state can be trusted."*

**So the client has no tolerance arithmetic, no band comparison, and no
boundary rule.** It renders the zone the API reports.

**And the client applies no boundary rule of its own** — the edge case is
explicit: *"the weight sits exactly on the tolerance boundary → the zone
shown is the one the API reports."*

**And the three elements share one `data-zone` attribute** — the
indicator, the live-weight cell and the status line — so the zone is
**visibly consistent** across them (FR-9).

### 2. A silent scale shows NO VALUE — never `0.0`

**This is the client-side half of B-1, and it is the sharpest rule in the
story:**

> *"**A silent scale shows no value — never `0.0`.** This is the
> client-side half of 'no failure may produce a silently wrong number'
> (B-1). The readout renders an explicit empty state, and the confirm
> action is disabled with a stated reason. **A `0.0` fallback would be
> indistinguishable from a genuinely empty scale and would be the most
> dangerous thing the client could render.**"*

**So the readout's empty state is DISTINCT from a zero reading.** The
client renders the value only when it has one, and shows the **stream's
age** otherwise — so the operator can see when the data falls behind.

**And the staleness is the client concern** — because only the client knows
how long it has been since the last frame.

### 3. The weight is FORMATTED, never parsed as a float

> *"Decimals: 1 dp for grams, 3 dp for kilograms, per the prototype's
> `dp()` rule. Quantities are **formatted**, never parsed as a float — the
> client receives fixed-point decimal values"* (NFR-2, BRD NFR-16).

**So the client needs a formatter** — and it must be **exact**. The
server sends `"94.2400"` as a string; the client must render `94.2` (grams,
1 dp) and `24.010` (kilograms, 3 dp) **without** going through a float.

**Which means the client needs `decimal.js`** — the same library the
server uses. It is already a dependency.

**And the unit is the API's** — the edge case is explicit: *"the unit
conversion is performed server-side; the client formats and displays the
unit the API reports and does not convert."*

### 4. The stream is SSE, and the store is SELECTOR-BASED

**The tech stack's own note:**

> *"SSE + Zustand implement NFR-01 together: server push removes polling
> overhead from the latency budget, and **selector-based subscriptions keep
> a 10 Hz stream from re-rendering the whole screen**."*

**So the store holds the reading, and the components subscribe to the
SLICES they render** — the readout subscribes to the value, the status line
to the zone, and the rail to the component states. A 10 Hz stream must not
re-render the recipe rail.

**And the lag is MEASURABLE.** The story: *"the displayed value lags the
scale by no more than 200 ms"* (NFR-1, AC-03) — and *"the client renders
the newest reading it has **and exposes its age**, so the operator can see
when the stream falls behind."*

**And the newest reading is by SEQUENCE, not by arrival** — the edge case:
*"readings arrive out of order → the client renders the newest reading by
its sequence or timestamp, **not the last one received**."*

## The architecture

```text
src/007-weighingms-ui/
├── api/
│   └── endpoints.ts            + the session, the weight and the zone calls
├── stream/
│   ├── weight-stream.ts        the SSE subscription — and its reconnect
│   └── use-weight-stream.ts     the hook
├── state/
│   ├── weigh-store.ts          Zustand — the reading, the zone, the staleness
│   └── rail-store.ts           Zustand — the session's component states
├── format/
│   └── quantity.ts             the fixed-point formatter — 1 dp / 3 dp
└── screens/weigh/
    ├── WeighScreen.tsx
    ├── RecipeRail.tsx
    ├── LiveReadout.tsx
    ├── ToleranceBand.tsx
    └── StatusLine.tsx
```

## The tests

| Suite | What it proves |
|---|---|
| **Unit — the formatter** | Grams to **1 dp**, kilograms to **3 dp**, from a fixed-point string — and **never** through a float. `94.2400` g → `94.2`; `24.0100` kg → `24.010`. |
| **Unit — the staleness** | The readout shows **no value** past the threshold — and **never** `0.0`. |
| **Unit — the newest reading** | An out-of-order arrival does **not** replace a newer reading. |
| **Component — the weigh view** | The rail shows each component's state; the readout shows the weight, the still-to-weigh and the target; the band and the capacity are shown; the three elements share `data-zone`. |
| **Component — the silent scale** | The readout shows **no value**, and the age is shown. |
| **Component — the source** | No operator-facing literal; no zone computation in the client — **the source contains no comparison of the weight against a band.** |
| **Component — the lag** | The rendered reading is the newest one, and its age is **exposed**. |

## What this bolt does NOT do

- **The confirm action** — story `003`. The button's *disabled state* is
  driven by the zone the API reports, which is this bolt; pressing it is
  the next bolt.
- **The peripheral degraded states** — story `005`.
- **The end-to-end Playwright suite** — the last UI bolt.
