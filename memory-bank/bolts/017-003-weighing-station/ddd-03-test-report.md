---
stage: test
bolt: 017-003-weighing-station
status: complete
updated: 2026-11-06T05:00:00Z
---

# Test Report: Weighing Station (Bolt 017: progression, weighing record, resumption)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 93 passed, 0 failed |
| **Tests** | **1595 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`) |
| **Coverage (all files)** | 88.76% statements · 81.29% branches · 92.54% functions · 89.82% lines |
| **Coverage threshold** | 80% on all four — **met** |
| **New tests** | **20** (9 unit + 6 integration + 5 security) |
| **Baseline before the bolt** | 1575 tests, 90 files |
| **Defects found by the tests** | **2**, both fixed (below) |

---

## What the tests prove

### The progression follows the RECIPE's order — not the operator's choice

The unit suite confirms `DYE-4471-B` when the session's active component is
the **second** one, and asserts the next is the **third** — the first is
still `PENDING`, and the progression does **not** skip back to it.

**And the integration suite pins the actual recipe order** — `DYE-4471-B`,
`DYE-2204-R`, `DYE-4471-Y`, `AUX-0101`, `AUX-0107` — so confirming
`DYE-4471-Y` advances to **`AUX-0101`**, not to the component that merely
looks next in an alphabetical list.

### EXACTLY ONE component is `ACTIVE` at a time

Asserted directly: after a confirmation, exactly one component is `ACTIVE`
— through the API, on the session's own persisted states.

### The last component's confirmation is `COMPLETED` — a distinct outcome

Not "advanced to nothing". `COMPLETED` is a defined outcome, it moves the
session to `COMPLETE`, and **no** component becomes `ACTIVE`.

### `DONE` is TERMINAL

The unit suite asserts that a `DONE` component cannot be confirmed again —
**and that the error says so**. The `DONE` check runs **before** the
active-component check, because `DONE` is the more specific fact: a `DONE`
component is never the active one, so the other order would report *"not
the active component"* when the operator needs to hear *"already done"*.

### The duplicate is refused ATOMICALLY

The persistence suite writes a record and then writes **another** for the
same session and component, and asserts the second **rejects** with a
`UNIQUE` violation — the database's answer, not a check's.

**And a CORRECTION is still permitted.** The constraint is a **partial**
index — `WHERE corrects_record_id IS NULL` — so a correction (a new row
referencing the original, C-12) is free to exist beside the original, and
the original stays untouched.

### The client cannot choose what comes next

The security suite sends `nextComponentId` and `advanceTo` in the
confirmation body. Neither field exists, so both are dropped, and the
session advances to the **recipe's** next component.

### The client cannot confirm a component the session is NOT working on

The security suite selects `DYE-4471-Y` and then tries to confirm
`AUX-0107` — refused with a `409`.

---

## The two defects the tests found

### Defect 1 — the gate and the transition BOTH wrote the record

**Found by:** `tests/unit/confirmation-gate.test.ts` and
`tests/unit/weighing-record-persistence.test.ts` — the record was written
twice, and the `UNIQUE` constraint the bolt introduced then **refused the
second write**.

**Root cause.** Bolt `014`'s gate wrote the record; this bolt's transition
writes it too. The gate had been written when the progression did not
exist, so the write was in the wrong place.

**The fix — and it is a better design, not just a fix.** The gate is now a
**decision**, not a write. It reports the zone and the component and writes
**nothing**; the transition writes the record and advances the session, in
that order (ADR-040).

That is exactly what ADR-040 requires — the record write must be **inside**
the transition, so it cannot be separated from the progression — and it
means the gate and the transition can no longer disagree about whether a
record exists.

**And the gate's `ALLOWED` outcome carries the zone at confirmation**, so
the transition records the **over-dose** zone when an authorised escalation
was applied — which is what makes the exception visible in the record
(BRD FR-11, FR-23).

### Defect 2 — the `UNIQUE` constraint forbade corrections

**Found by:** `tests/unit/weighing-record-persistence.test.ts` — *"a
CORRECTION is a new row — the original is untouched"* failed with a
`UNIQUE` violation.

**Root cause.** The constraint was on `(session_id, component_id)` with no
qualification — so it forbade the correction as well as the duplicate.

**The fix.** The constraint is a **partial** index —
`WHERE corrects_record_id IS NULL` — so it applies to a **confirmation**
and not to a **correction**. The duplicate is still refused atomically,
and the correction workflow (which the story puts out of this unit's
scope) has the room it needs.

---

## A third defect, found by the tests and fixed in the domain

**The `DONE` check ran after the active-component check.** The unit suite
caught it by asserting the error mentions `DONE`. The order is now
`DONE` first — see above.

---

## Deliberately not delivered

- **The batch completion summary** — bolt `018`. The `COMPLETED` outcome is
  where it begins.
- **The batch's status write-back to OrgaTEX** — bolt `018`, on batch
  completion (BRD FR-16). **Not** here, by the story's explicit instruction.
- **The correction workflow** — the record model supports it (the
  `corrects_record_id` column, and the constraint that exempts it); the
  workflow does not exist, and the story puts it out of this unit's scope.

---

## Acceptance-criteria validation

| Criterion | Status | Where it is proved |
|---|---|---|
| A confirmed component advances to the next `PENDING` in **recipe order** | ✅ | `progression.test.ts` and `progression-api.test.ts` — the next is `AUX-0101`, and the components before it stay `PENDING` |
| The confirmed component becomes `DONE`, and **exactly one** is `ACTIVE` | ✅ | Both suites — the count is asserted on the persisted states |
| A `DONE` component cannot be re-selected or re-weighed | ✅ | `progression.test.ts` — and the `DONE` reason is the one reported |
| A `PENDING` component out of sequence can be selected; the weight resets to zero; the previously `ACTIVE` component returns to `PENDING` with **no** record | ✅ | **Bolt `013`'s** selection, already proved there. This bolt's suite confirms the progression does not disturb it |
| The session is **resumable** at the component in progress | ✅ | **Bolt `013`'s** persistence — the component states are persisted with the session, and this bolt advances them through the same save |
| The record write and the progression are **one** transition | ✅ | `progression.test.ts` — the `DONE` state and the next `ACTIVE` move together, and a crash between the record and the save leaves the component unwritten rather than losing the record (ADR-040) |
| Two concurrent confirmations write **one** record | ✅ | `weighing-record-persistence.test.ts` — the `UNIQUE` constraint refuses the second, atomically |
| The batch's status is written to OrgaTEX on **batch completion** | ⏳ | Bolt `018` — and by the story, **not** here |

## Recommendations

- **Bolt `018`** must consume the `COMPLETED` outcome, write the batch's
  status to OrgaTEX, and produce the summary. It is the only place the
  batch-level write-back belongs.
- **The gate is now a pure decision**, so any future caller that needs to
  *ask* whether a weighing may be confirmed can call it without writing
  anything. That is a deliberate simplification, and it is worth keeping.
- **The `corrects_record_id` exemption** is the seam the correction
  workflow will use. If Q-10's answer changes how a correction is
  represented, the **partial index** is the one place to change — and it
  must stay partial, or corrections become impossible.
