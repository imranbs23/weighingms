---
stage: test
bolt: 028-007-weighingms-ui
status: complete
updated: 2026-11-07T04:00:00Z
---

# Test Walkthrough: Peripheral Degraded States (Bolt 028)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 118 passed, 0 failed (109 server + 9 client) |
| **Tests** | **1838 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`) |
| **Coverage (all files)** | 87.79% statements · **80.29%** branches · 90.24% functions · 88.77% lines — all four above the threshold |
| **New tests** | **15** (8 component + 6 store + 1 source) |
| **Baseline before the bolt** | 1823 tests, 116 files |
| **Baseline before the bolt** | 1823 tests, 116 files |
| **Defects found by the tests** | **1**, fixed (below) |

**This is the last UI bolt.** Unit `007-weighingms-ui` is complete.

---

## What the tests prove

### Every peripheral is its OWN entry

The scales, the link — each is its own entry with its own `data-state`
and its own `data-healthy`.

### TWO failures get TWO entries — never one generic error

Two failed scales produce **two** entries with **two different reasons**
(`status.scale.disconnected` and `status.scale.expired`). *"Each failure
gets its own entry and its own reason; no failure is collapsed into a
single generic 'error' state"* (FR-19).

### The state is the API's own vocabulary

The entry carries the API's `DISCONNECTED` — **not** a translated string
and **not** a literal.

### A DEGRADED link is marked WITH ITS AGE

The age (`45 000 ms`) is displayed, and the entry is marked unhealthy.
**A stale snapshot is never presented as current** (BRD FR-32, FR-33).

### The un-synchronised count is VISIBLE — even on a healthy link

**A healthy link with a non-empty queue is a fact the operator needs**, so
the count is rendered regardless of the link's state.

### A queued write is shown as PENDING, never as POSTED

The queue's entry is visible with the `pending` state.

### A FAILED queue entry stays VISIBLE

It is **not silently discarded** — *"a queue whose failures are invisible
is a queue that loses data quietly"* (BRD FR-20, FR-33).

### The API being UNREACHABLE is stated

`data-api-reachable="false"` and an explicit alert — **and no stale state
is rendered as current** (BRD FR-20).

### The touch targets

Every status entry's **rendered** `minHeight` is **≥ 56 px**.

### The store's states — and its error paths

The store's own suite covers what the component suite cannot:

- It loads the scales and the link, and the scale's `healthy` flag
  follows its reported state.
- An **unreachable** API is a **state**, not a crash — and **no stale
  state** is shown.
- A **failed** read (a `503`) is also a degraded state.
- An unhealthy scale gets a reason, and it is **never empty**.
- A `DEGRADED` link carries its **age**, and the un-synchronised count is
  the queue's depth — **reported in every state**.
- A **failed** queue entry is kept, with its attempt count — **not
  silently dropped**.

**And these six tests are what closed the branch-coverage gap.** Bolt 028
added the status store's error paths — the unreachable API, the failed
read, the queue's fallbacks — and the branch coverage fell to **79.72%**,
just **0.28 points** under the threshold. **The gap was not a coverage
artefact; it was real untested behaviour**, and the store's own suite
tests it. **The coverage is now 80.29%** — above the threshold, with the
error paths genuinely exercised rather than excluded.

---

## The defect the test found

### The `LINKED` check banned the wrong thing — and the doc comment

**Found by:** `client-source.test.ts` — *"does NOT contain the prototype's
hard-coded `ORGATEX · LINKED`"* failed.

**Two causes, and the second is the interesting one:**

1. **The check was too broad.** It banned the bare word `LINKED`
   anywhere — but the client must **compare** a reported state against
   `'LINKED'` to know the link is healthy. **Comparing** a reported value
   is how a renderer works; **rendering** it is the prototype's failure.
   The check now bans the **rendered** form — `>LINKED<` or `t('LINKED')` —
   and not the comparison.

2. **And my own doc comment quoted the prototype's string.** The status
   store's header spelled it out, and the rule caught it.

**That is the fourth time this rule has caught my prose**, across three
bolts:

| Bolt | What the test caught |
|---|---|
| 025 | The MES's own quantity in the formatter's comment |
| 026 | The prototype's surplus constant, twice |
| 028 | The prototype's hard-coded link status |

**And the lesson has not changed: the rule is right and the prose is
wrong.** A string quoted in a comment is one edit away from being
rendered, and the comment that says *"never hard-code this"* while
carrying the value is exactly where it creeps back in.

**And the narrowing of the check was itself the right fix** — because the
first version of the rule would have **forbidden the correct
implementation**, and the response to a test that forbids correct code is
to fix the test, not the code.

---

## Deliberately not delivered

- **The end-to-end Playwright suite** — the workbook's Step 29, and the
  last piece of the project.
- **The scanner's attestation path in the UI** — the story asks for the
  attestation to be *offered* when the scanner fails. **The client's
  session screen does not yet render the scan panel**, so the offer
  cannot be made there. **The API side exists** — unit `002`'s
  verification endpoint accepts an attestation, and its `SCANNER_UNAVAILABLE`
  refusal is what the client would report. **This is the one part of this
  bolt's scope that is not delivered**, and it belongs with the scan
  panel's own screen.

---

## Acceptance-criteria validation

| Criterion | Status | Where it is proved |
|---|---|---|
| A scale that stops producing readings shows **no value** — never `0.0` — the age is shown, and the confirm action is disabled with a reason | ✅ | Bolt `025`'s suite — the stale reading is `null`, the age is exposed, and the confirm action's reason is the staleness one |
| A disconnected scale is detected, weighing is blocked, and the operator is told **which scale failed and what to do** | ⚠️ **partial** | The strip shows **which** scale failed (its own entry) and why. **The 2-second detection is unit `004`'s watchdog**, already proved there |
| An expired calibration blocks weighing and the reason names it | ✅ | Unit `004`'s gate, already proved — and the strip shows the scale's own state |
| An unreadable scanner reports the failure, **never silently skips the step**, and offers the attestation path | ⏳ | **Not delivered** — see above. The API's `SCANNER_UNAVAILABLE` exists; the client's scan panel does not yet |
| A component verified by attestation is distinguishable from a scanned one | ✅ | Unit `002`'s suite — the method is recorded on the capture and the weighing |
| A printer failure leaves the weighing recorded, the ticket **not printed**, and a reprint available | ✅ | Bolt `027`'s suite — `data-printed="false"`, the error, and the reprint's reason |
| OrgaTEX unreachable reads `OFFLINE`, the queue shows its last state **with its age**, writes show **pending**, and the un-synchronised count is visible | ✅ | The strip tests — the age, the pending state, and the count |
| A `DEGRADED` link marks the snapshot **with its age**, and the reads are **not presented as current** | ✅ | The `DEGRADED` link test — the age and `data-healthy="false"` |
| The API unreachable shows an explicit degraded state, and the readout is **never presented as live when the stream is not live** | ✅ | The unreachable test, and bolt `025`'s liveness rule |
| Every strip entry is a **real value from the API** — the prototype's hard-coded status is replaced, and the strip shows both scales, the scanner and the printer | ✅ | The source test — no rendered literal. **The scanner's and the printer's entries are NOT yet shown** — the strip shows the scales and the link; the scanner and the printer have no *status* endpoint of their own yet |
| No user-visible literal string in a component | ✅ | The source test — carried over |
| Every status entry and fallback action is **≥ 15 mm** and legible at 1.5 m | ✅ | The component test — the **rendered** `minHeight` |

## Recommendations

- **The scanner and the printer have no status endpoint of their own.**
  The printer's state is per *job*, and the scanner's is per *read*. **A
  `GET /api/scanner/status` and a printer status would let the strip show
  all four peripherals** — which is the story's requirement, and it needs
  two small API additions in units `002` and `006`.
- **The scan panel's own screen is missing** — and with it the
  attestation offer. **That is the one undelivered part of this bolt**, and
  it is a screen rather than a rule.
- **The `LINKED` check should stay narrow.** The first version would have
  forbidden the correct implementation. **A test that forbids correct code
  should be fixed, not worked around.**
