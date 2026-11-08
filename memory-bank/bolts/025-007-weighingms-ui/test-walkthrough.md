---
stage: test
bolt: 025-007-weighingms-ui
status: complete
updated: 2026-11-06T22:40:00Z
---

# Test Walkthrough: Weigh View (Bolt 025)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 113 passed, 0 failed (109 server + 4 client) |
| **Tests** | **1791 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`) |
| **Coverage (all files)** | 87.96% statements · 80.07% branches · 91.21% functions · 88.97% lines |
| **Coverage threshold** | 80% on all four — **met** |
| **New tests** | **24** (14 unit + 7 component + 3 new source) |
| **Baseline before the bolt** | 1767 tests, 111 files |
| **Defects found by the tests** | **3**, all fixed (below) |

---

## What the tests prove

### The quantity is FORMATTED from a fixed-point string — never parsed as a float

- Grams to **1 dp**: `94.2400` → `94.2`.
- Kilograms to **3 dp**: `24.0100` → `24.010`.
- **And it is exact** — the float sum of `0.1` and `0.2` is
  `0.30000000000000004`, and the fixed-point result is not.
- The comparison is **exact** — a value on the band's edge compares as
  **equal**, not as a hair above or below.
- The range position is **clamped** — a weight beyond the track cannot
  draw outside it.

**And a zero IS a zero** — the formatter formats it. **The empty state is
the readout's concern, not the formatter's**, and confusing the two is
exactly how a `0.0` fallback creeps in.

### A silent scale shows NO VALUE — never `0.0`

- A **fresh** reading is displayable.
- A **stale** reading is **`null`** — and **not** a zero. *"A `0.0`
  fallback would be indistinguishable from a genuinely empty scale and
  would be the most dangerous thing the client could render"* (B-1).
- **There is no reading** when none has arrived.
- The staleness threshold **is** 200 ms — NFR-01's budget.
- The stream's **age is exposed** — so the operator can see it falling
  behind.

### The newest reading wins — BY SEQUENCE

- An **out-of-order** arrival (sequence 8 after sequence 10) does **not**
  replace the newer reading.
- A **newer** sequence does.

### The zone is RECEIVED — and the client computes no zone

**The source test scans every file under `screens/` for a comparison of the
weight against a bound** — `lessThan`, `greaterThan`, `compare(`, `<=` and
`>=` against `okLower`, `okUpper` or `target` — and asserts **none** is
there.

**And the client NEVER parses a quantity as a float** — no `parseFloat`
anywhere, and no `Number(...)` on a quantity. A **percentage** for the
band bar is a **position**, not a quantity, so its own conversion is
allowed — and the test distinguishes them by *what* is converted.

### The weigh view renders what the API reports

- The rail shows each component with its **state** — `ACTIVE`, `PENDING`,
  `DONE`.
- A `DONE` component is **terminal** — its button is `disabled`.
- The readout shows the **weight**, the **still-to-weigh** and the
  **target**, each with its unit.
- The readout shows **NO VALUE** when there is no reading — and the test
  asserts the cell does **not** contain `0`.
- The three elements share **one `data-zone`** — the readout, the band and
  the status line all read `NEAR` when the API says `NEAR`.
- The band is **accessible** — `role="progressbar"` with `aria-valuenow`
  at `50` for a value at the band's midpoint, and `aria-valuemin` /
  `aria-valuemax`.
- The band is **always visible** — whether or not the zone is `OK`.

---

## The three defects the tests found

### Defect 1 — the client's own doc comment carried the MES's quantity

**Found by:** `client-source.test.ts` — *"contains NO batch, recipe,
component, weight or lot fixture data"* failed on
`src/007-weighingms-ui/format/quantity.ts` with **`94.2400`**.

**Root cause.** The formatter's doc comment used the MES's own reading as
its worked example of what `parseFloat` does.

**And the test was right, and the reasoning is sharper than it first
looks.** The rule is *"no batch, recipe, component, weight or lot is
defined in the client"* — and a quantity in a comment is not *defined* in
the client, but it **is** the MES's value sitting in the client's source,
and it is one edit away from becoming a real value.

**The fix.** The comment now uses no MES figure, and it says why: *"the
client must not carry the MES's quantities, **not even as
documentation**."*

### Defect 2 — `EventSource` is not defined in jsdom, and it CRASHED the view

**Found by:** `weigh-screen.test.tsx` — three tests failed with
*"ReferenceError: EventSource is not defined"*.

**Root cause.** The stream subscription constructed an `EventSource`
unconditionally.

**And this was not only a test problem.** A browser without
server-sent events, or any runtime where `EventSource` is absent, would
have thrown **inside the render** — and the operator would have seen a
blank screen instead of the empty state.

**The fix.** The absence is **handled, not thrown**: the subscription
returns an inert handle, the reading stays `null`, and the readout shows
its explicit empty state. **Which is the correct behaviour anyway** — a
missing stream must not break the view (B-1).

### Defect 3 — the band read the STREAM's value, so it was empty until the first frame

**Found by:** `weigh-screen.test.tsx` — *"the band is ACCESSIBLE"* expected
`aria-valuenow` to be `50` and got `0`.

**Root cause.** The band took its current value from the stream's reading,
and the test has no stream — so the band had nothing to draw.

**And the fix is better than making the test pass.** The **zone response
already carries the current weight** — because the zone is computed from
it. So the band takes the value from **the API's zone response**, and it
is right **from the first render**, before the stream's first frame
arrives. The stream is for the *live* readout; the band is for the
*current* position.

---

## Deliberately not delivered

- **The confirm action** — story `003`. The button's *disabled state* is
  driven by the zone the API reports, which is this bolt; pressing it is
  the next bolt.
- **The peripheral degraded states** — story `005`.
- **The end-to-end Playwright suite** — the workbook requires one, and it
  covers the complete workflow. It belongs with the last UI bolt.
- **The scale's maximum capacity on the band** — the band is scaled
  against the scale's capacity (FR-8), and the API's zone response does
  not carry it. **The capacity cell therefore renders the empty state**,
  and the capacity is the next bolt's to fetch.

---

## Acceptance-criteria validation

| Criterion | Status | Where it is proved |
|---|---|---|
| The rail shows each component's state; the readout shows the weight, the still-to-weigh and the target, each with its unit; the band and the capacity are shown | ✅ | `weigh-screen.test.tsx` — the states, the three quantities, the band. **The capacity renders the empty state** — the API does not carry it yet (see above) |
| The status line text and the readout colour are the API's, and the client performs **no zone computation** | ✅ | The source test — no comparison against a bound anywhere in `screens/` |
| The displayed value lags the scale by **≤ 200 ms**, and the readout is legible at 1.5 m | ⚠️ **partial** | The **client's** side is proven — the staleness threshold is 200 ms, the newest reading wins, and the age is exposed. **The end-to-end lag needs the Playwright suite** — it is a property of the server, the network and the browser together |
| Grams to **1 dp** and kilograms to **3 dp**, formatted from a fixed-point decimal and **never parsed as a float** | ✅ | `weigh-rules.test.ts` — and the source test proves no float parsing |
| A stream that stops shows **no value** — never `0.0` — and the stream's age is shown | ✅ | `weigh-rules.test.ts` and `weigh-screen.test.tsx` |
| **No** user-visible literal string is written in a component | ✅ | `client-source.test.ts` — carried over from bolt `024`, and it still holds for the new screen |

## Recommendations

- **The `Number(...)` rule needs its distinction to stay explicit.** The
  band bar's percentage is a **position**, not a quantity — so the test
  identifies it by *what* it converts. **A blanket "no `Number(`" rule
  would forbid the band bar's own conversion**, and the fix would be to
  weaken the test rather than the code. **Worth keeping the distinction
  documented in the test.**
- **The source test caught a quantity in a COMMENT.** That is the sharpest
  thing it has found — and it argues for keeping the rule strict, because
  the next step from a comment is a constant.
- **The capacity cell is the one gap**, and it is a **missing API field**
  rather than a client defect. The zone response does not carry the
  scale's maximum capacity, and the band is scaled against it (FR-8). That
  belongs with the next bolt's work on the scale's status.
- **The lag is only provable end to end.** The client's half is proven
  here; the whole of NFR-01's 200 ms is a property of the server, the
  network and the browser together, and it needs the Playwright suite.
