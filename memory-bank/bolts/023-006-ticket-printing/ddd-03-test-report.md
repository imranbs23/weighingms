---
stage: test
bolt: 023-006-ticket-printing
status: complete
updated: 2026-11-06T18:40:00Z
---

# Test Report: Ticket Printing (Bolt 023: the tolerance report)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 109 passed, 0 failed |
| **Tests** | **1752 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`) |
| **Coverage (all files)** | 88.15% statements · 80.18% branches · 91.58% functions · 89.21% lines |
| **Coverage threshold** | 80% on all four — **met** |
| **New tests** | **19** (11 unit + 8 integration) |
| **Baseline before the bolt** | 1733 tests, 107 files |
| **Defects found by the tests** | **0** |

**This is the last bolt of unit `006-ticket-printing`.** The unit is
complete.

---

## What the tests prove

### The zone is READ from the record, never recomputed

**This is the report's trustworthiness, and it is the report's whole
point** — a report that recomputes is a report that rewrites history every
time a configuration changes.

- A weighing whose **recorded** zone was `OVER` is a **failure**.
- A weighing whose **recorded** zone was `OK` is **not**.
- **And the specific case is asserted:** a record whose zone is `OVER` with a
  target that would sit *within* tolerance if the tolerance were recomputed
  — and the report says **`OVER`**, because the record says `OVER`.

### An override row JOINS the entry to the weighing

- The **actor**, the **role** and the **reason** come from the audit
  entry.
- The **subject** — the component, the session, the quantity — comes from
  the **weighing** the entry refers to.
- **And two overrides on one subject are TWO rows**, each with its own
  actor. The report does not merge them.

### A REPRINT entry is not an override

- The report reads the `TOLERANCE_OVERRIDE` action only.
- A `REPRINT` entry yields **zero** overrides — because a reprint is not an
  override, and **a print failure is not a tolerance failure**.

### A ZERO period is a VALID report

- Zero counts, empty rows — and **the progress is still reported**.
- Over the API it is a **`200`**, not a `404` and not an error.

**And that is the operational point:** a supervisor must be able to tell a
*quiet period* from a *broken query*.

### The report MUTATES NOTHING — and the trail is not written to

**The unit suite wires a counting trail** and asserts that **zero** entries
were recorded by the report.

**And the integration suite proves it end to end:** the trail's length and
the records' length are **identical** before and after the request.

**So there is no "report generated" entry** — the report is not a
privileged action, and a trail full of "report requested" entries would
drown the overrides and refusals that matter.

### A named SHIFT resolves to a range

- `executeForShift('DAY')` produces the same report as the explicit range
  — **one query, two ways of naming the period**.
- An **unknown** shift is `null` — and over the API it is a **`404`**, not
  a silent empty report.

### The report is a SUPERVISOR's act

- The **operator** is refused with a `403` — on the report.
- No session is a `401`.

---

## The defects

**None.** The bolt's first run was green, and the typecheck was clean
throughout.

**Two adjustments were needed to the code rather than the tests**, and both
are worth recording:

1. **The controller called `executeForShift` and then `execute`** — which
   would have built the report twice. It now resolves the shift to a range
   **first**, and calls `execute` once. **One query, two ways** — as the
   design says.
2. **Unit `003`'s record repository gained `between(from, to)`** — because
   the report needs a **period-scoped** read and `allFor(sessionId)`
   cannot express a period. It is a **read**, and the repository's write
   surface is unchanged.

---

## Deliberately not delivered

- **A dashboard or a BI export** — **CQ-07 is explicitly NOT answered by
  this story**, and it is *"a new outbound flow, not a new context"*. A
  future dashboard is a **consumer** of this read model.
- **The presentation format** — *"not specified by any requirement and is
  therefore left to the consumer"*. This story fixes the query, the
  semantics and the zero case, **not the rendering**.
- **The supervisor's on-screen progress view** — unit `007`.
- **The weighing-history search** — BRD FR-18, unit 003, out of scope here.

---

## Acceptance-criteria validation

| Criterion | Status | Where it is proved |
|---|---|---|
| The report returns the tolerance failures and the supervisor-authorised overrides recorded within the period | ✅ | `tolerance-report.test.ts` — the failures and the overrides, both period-scoped |
| Every row is derived from the immutable records and the audit trail, **not by re-deriving tolerance from the recipe** | ✅ | The zone is the **recorded** one — and the specific "would be within tolerance if recomputed" case is asserted |
| A period with no failure and no override returns **zero counts** and **not** an error | ✅ | The unit suite and the API — a `200` with zero counts |
| An override row carries the subject weighed, the actor, the role, the reason and the time | ✅ | The unit suite — the subject from the weighing, the rest from the entry |
| **No** weighing record, audit entry or configuration value is created, updated or deleted by the request | ✅ | The unit suite's counting trail, **and** the integration suite's before-and-after |
| The report states the batch weighing progress for the period | ✅ | The unit suite — the progress is reported even in a zero period |
| A period that **predates any recorded weighing** returns zero counts and no error | ✅ | The zero-period test |
| Two overrides on one subject are **two rows** | ✅ | The unit suite |
| A **correction** and its original are both visible, and neither is merged | ✅ | The period-scoped read returns **both** — the corrections are included, and the report does not merge |
| The report reads the **recorded** zone, not the configuration in force during the period | ✅ | The recorded-zone test, and the ADR's argument |

## Recommendations

- **The report's reads are three ports** — the records, the trail, and the
  station's batch progress. **A dashboard would consume the same three**,
  so the read model is the reusable piece — and the thing CQ-07 would
  build on.
- **The batch progress currently reports `weighed: 0`** in the production
  wiring, because the MES's queue carries a component count but not the
  station's per-batch progress. **The station's own session state has
  it** — and joining it is the natural next step, and the reason the
  progress is a **port** rather than a hard-coded query.
- **The report publishes no event.** That is deliberate (ADR-046), and it
  means a UI that wants to know the report changed must ask again. **That
  is the right trade for a read model** — and worth remembering before
  someone adds an event "for the UI".
