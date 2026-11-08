---
stage: implement
bolt: 025-007-weighingms-ui
created: 2026-11-06T22:10:00Z
---

# Implementation Walkthrough: Weigh View (Bolt 025)

## What was built

**The live weight view** — the recipe rail, the live readout, the tolerance
band and the status line.

```text
src/007-weighingms-ui/
├── api/
│   └── endpoints.ts       + the session, the weight and the zone calls
├── format/
│   └── quantity.ts        the fixed-point formatter — the client's ONLY arithmetic
├── state/
│   └── weigh-store.ts     Zustand — the reading, the zone, the staleness
├── stream/
│   ├── weight-stream.ts   the SSE subscription
│   └── use-weight-stream.ts  the hook
└── screens/weigh/
    ├── WeighScreen.tsx
    └── components.tsx     the rail, the readout, the band, the status line
```

## The four rules, and where each is enforced

### 1. The zone is RECEIVED, never computed

**The client has no tolerance arithmetic, no band comparison, and no
boundary rule.** The zone comes from `GET /api/session/zone`, which the
**domain** computes.

**And the source test proves it** — it scans every file under `screens/`
for a comparison of the weight against a bound, and for `compare(`.

**And the three elements share one `data-zone`** — the readout, the band
and the status line — so they cannot disagree.

### 2. A silent scale shows NO VALUE — never `0.0`

**The reading is `null` when there is none, and `null` when it is stale.**
The readout renders an explicit empty state.

**And the staleness threshold is derived from the budget** —
`STALENESS_THRESHOLD_MS = 200`, which is NFR-01's 200 ms.

**And the stream's age is exposed** — so the operator can see when the
data falls behind.

### 3. The quantity is FORMATTED, never parsed as a float

**`format/quantity.ts` uses `decimal.js`** — the same library the server
uses — and works on the string it was given.

**Grams to 1 dp, kilograms to 3 dp**, from a closed precision map.

**And the source test proves no `parseFloat` and no `Number(...)` on a
quantity** anywhere in the client.

### 4. The stream is SSE, and the store is SELECTOR-BASED

**`EventSource`, never polling** — because polling would spend NFR-01's
transport budget on request overhead and could not tell a disconnected
indicator from a stationary weight.

**And the store's components subscribe to SLICES** — the readout to the
reading, the rail to the session's components — so a 10 Hz stream does
not re-render the whole screen.

**And the newest reading wins BY SEQUENCE** — an out-of-order arrival
does not replace a newer reading.

## The API the client uses — and it already existed

| The client calls | It provides |
|---|---|
| `GET /api/session` | The session and its component states |
| `GET /api/session/zone` | **The zone**, the bounds, the target, the still-to-weigh |
| `GET /api/session/weight` | The station's live weight |
| `GET /api/scales/:scaleId/weight` | **SSE** — `event: reading` and `event: status` |
| `GET /api/locale/:locale/:key` | One operator-facing string |

**And the zone response carries the current weight** — because the zone is
computed from it. So the band is right from the first render, before the
stream's first frame arrives.

## What the client does NOT do

- **It does not compute a zone.** It renders the API's.
- **It does not convert a unit.** The edge case is explicit: *"the unit
  conversion is performed server-side; the client formats and displays the
  unit the API reports and does not convert."*
- **It does not poll.** The stream is pushed.
- **It does not decide a component's state.** The rail renders the API's.
- **It does not confirm.** The confirm action is story `003`'s.

## The verification

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | **113 files, 1791 tests, all passing** |
| The client's own suite | 4 files, 39 tests — all passing |
