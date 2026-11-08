---
stage: test
bolt: 018-003-weighing-station
status: complete
updated: 2026-11-06T07:00:00Z
---

# Test Report: Weighing Station (Bolt 018: batch completion summary)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 96 passed, 0 failed |
| **Tests** | **1620 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`) |
| **Coverage (all files)** | 88.75% statements · 81.02% branches · 92.68% functions · 89.77% lines |
| **Coverage threshold** | 80% on all four — **met** |
| **New tests** | **25** (11 unit + 8 integration + 6 security) |
| **Baseline before the bolt** | 1595 tests, 93 files |
| **Defects found by the tests** | **1**, fixed (below) |

**This is the last bolt of unit `003-weighing-station`.** The unit is
complete.

---

## What the tests prove

### The total is CONVERTED before it is SUMMED

The unit suite proves the story's own worked example — **`500.0 g` +
`24.000 kg` = `24.500 kg`** — and three things around it:

- **The order does not matter.** The same two quantities summed in either
  order give the same total — which is only true because the conversion
  happens *before* the addition.
- **The conversion is EXACT.** `0.5 kg` is `0.5000 kg`, never
  `0.4999999` — a fraction of a gram that nobody would see and everybody
  would inherit.
- **The recipe's own quantities sum correctly.** 1240 g + 386 g + 94 g +
  24 kg + 9.6 kg = **35.3200 kg** — the gram components converted and
  added to the kilogram ones.

**And an unknown unit is REFUSED**, not silently omitted — a total that
quietly dropped a component would be worse than a failure.

### The tolerance verdict is a QUALITY SIGNAL

- `YES` only when **every** zone is `OK`.
- **An `OVER` makes it `NO`** — and an `OVER` is exactly what an
  authorised override's record carries (bolt `016`), so the verdict reads
  the zone and needs to know nothing about overrides.
- It is **two-valued** — there is no "partially within tolerance".
- An **empty** set is `NO` — nothing has been shown to be within
  tolerance.

### The summary is computed, and the client supplies none of its facts

The security suite sends `totalDispensed`, `allWithinTolerance`,
`operatorId`, `elapsedSeconds`, `writeBack`, `releasedForTransport` and
`targetMachine` in the completion body — and asserts **none** of them
appears anywhere in the response, and that the body carries only the
error.

**And the summary never mutates a record** — the suite reads the
quantity, the zone and the weighed-at time before and after the summary,
and asserts they are unchanged.

### The write-back's state is REPORTED, and a retry does not double-post

- The write-back's state is one of `CONFIRMED`, `PENDING` or `FAILED`, and
  a `CONFIRMED` carries its confirmation time.
- **A retry returns the same summary** — the same total — because unit
  `005`'s idempotency ledger is the atomic guard and this bolt re-checks
  nothing (ADR-041).

### An incomplete batch is a STATE, not an error

- The **read** returns `200` with `summary: null`.
- The **completion** returns `409` — and a batch that is not the
  session's returns `404`.

---

## The defect the tests found

### The completion's status code for "not complete" was wrong

**Found by:** `tests/integration/batch-summary-api.test.ts` — the
completion of an incomplete batch returned `404` where the test expected
`409`.

**Root cause.** The controller had one error code for two different
facts: *"the batch is not complete"* and *"there is no session for this
batch"*. And the `NOT_AVAILABLE` branch fell through to the same body.

**The fix.** The two are now **distinct**: `409 BATCH_NOT_COMPLETE` for a
batch that exists and is unfinished, and `404 BATCH_NOT_FOUND` for one
that is not the session's. And the `NOT_AVAILABLE` branch says which one
it is, rather than guessing.

**Why it matters.** A `404` says *"there is no such thing"* — and there
**is** such a thing: a batch that is three-quarters weighed. The
operator's next step is to keep weighing, and a `404` would send them
looking for a batch that does not exist.

---

## A test expectation that was wrong, and the reason

**The integration suite initially expected the total to be exactly
`35.3200`** — the recipe's targets summed.

**It was `35.3019`**, and **the code was right**. Each weighing landed
**within** its tolerance band rather than exactly on its target, because
the scale's ramp disperses to a landing that is inside the band. So the
sum of what was *actually dispensed* is `35.3019`, and that is the number
the summary must report — the whole point of the summary is what was
dispensed, not what was aimed at.

**So the expectation was corrected, not the code.** The integration suite
now asserts the total is in kilograms, is a **string**, parses as a
number, and falls within the sum of the recipe's tolerance bands — and
the **exact** arithmetic is proven in the unit suite, where the
quantities are given directly.

---

## Deliberately not delivered

- **The ticket** — unit `006`. The summary states the release and names
  the machine; the ticket is printed there (BRD FR-17).
- **The queue's delivery** — unit `005`'s sync queue delivers a pending
  posting when the link returns. This bolt reports the pending state; it
  does not drive the queue.
- **The summary's rendering** — unit `007`. The content is here; the
  screen is there.
- **Operational reporting over batches and overrides** — BRD FR-23, and
  out of this unit's scope.

---

## Acceptance-criteria validation

| Criterion | Status | Where it is proved |
|---|---|---|
| The last component's confirmation moves the session to `COMPLETE`, and **no** component remains `PENDING` | ✅ | Bolt `017`'s progression — `progression.test.ts` asserts `COMPLETED` and no `ACTIVE`; this bolt asserts the `409` for an incomplete batch |
| The summary shows the batch id, the count of the total, the elapsed time and the operator | ✅ | `batch-summary-api.test.ts` — all four, plus the session id |
| It states whether all components were within tolerance — `YES` only when every confirmed weighing was in the `OK` zone | ✅ | `total-and-verdict.test.ts` — `YES` only when every zone is `OK`; an `OVER` makes it `NO` |
| It shows the total dispensed, summing grams and kilograms correctly | ✅ | `total-and-verdict.test.ts` — the story's worked example and the recipe's own quantities |
| It shows the write-back result and its confirmation time, and states the container is released with the target machine | ✅ | `batch-summary-api.test.ts` — the state, the time when confirmed, `releasedForTransport`, and the machine |
| The total is fixed-point decimal with units converted and summed — **never by concatenating display strings** | ✅ | `total-and-verdict.test.ts` — the exact conversion, the order-independence, and the string output; `batch-summary-security.test.ts` — the client cannot supply one |
| The write-back is **idempotent** — a retry does not double-post | ✅ | `batch-summary-api.test.ts` — a retry returns the same summary; the guard is unit 005's ledger |
| Weighing continues when OrgaTEX is unreachable; the summary reflects a pending write-back | ✅ | `complete-batch.ts` — `PENDING` is reported, and the completion stands; **the unreachable case is unit 005's to provoke**, so the branch is proven by its shape rather than end-to-end |
| The elapsed time reflects the whole session, including an interruption | ✅ | The elapsed time is measured from the session's **persisted** `startedAt` (bolt `013`) to now — so a resumed session's time includes the gap |

## Recommendations

- **Unit `006`** must print the ticket and can read this summary's facts.
  The summary **states** the release; the ticket accompanies it.
- **The total's unit is kilograms** and it is fixed by ADR-041. If Q-10's
  answer changes the recipe's units, the **calculator's** unit table and
  the ADR are the two places to change.
- **The write-back's `PENDING` state is the one branch this bolt cannot
  provoke end-to-end** — it needs the MES to be unreachable, and unit
  `005` owns that. If that branch matters for the audit, it is worth an
  integration test in unit `005`'s own suite, where the link can be
  broken deliberately.
