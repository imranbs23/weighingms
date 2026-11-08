---
stage: test
bolt: 012-002-recipe-material-management
status: complete
updated: 2026-11-06T02:10:00Z
---

# Test Report: Recipe & Material Management (Bolt 012: container and tare)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 72 passed, 0 failed |
| **Tests** | **1402 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`) |
| **Coverage (all files)** | 90.95% statements · 85.25% branches · 93.34% functions · 91.87% lines |
| **Coverage threshold** | 80% on all four — **met** |
| **New tests** | **54** (15 unit + 17 persistence + 11 integration + 11 security) |
| **Baseline before the bolt** | 1348 tests, 68 files |
| **Defects found by the tests** | **1**, fixed (below) |

---

## What the tests prove

### The two routes, and the source is DERIVED

| The master holds | The route | The source |
|---|---|---|
| a tare | the master's value is applied | `CONTAINER_MASTER` |
| no tare | the **empty container is weighed** | `WEIGHED_EMPTY_CONTAINER` |

**And the source is never supplied by the client.** The security suite
sends `tareSource: 'WEIGHED_EMPTY_CONTAINER'` against a container whose
master holds a tare — and the answer is `CONTAINER_MASTER`. The source says
**where the value came from**, and only the station knows that.

### A re-tare MEASURES — evidence beats a claim

The story's edge case: *"the container master holds a tare but the operator
re-tares → the measured tare replaces the master tare and the displayed
source changes from `MASTER` to `MEASURED`."*

The test asserts it end to end: the first assignment is
`CONTAINER_MASTER`, the re-tare is `WEIGHED_EMPTY_CONTAINER`, and **two rows
exist** — the re-tare is a new assignment, not an update.

### The tare VALUE is the station's, never the client's

The security suite sends `tareValue: '0.0000'` and `tareWeight: '0.0000'`
against a container whose master holds 214 g — and the answer is
`214.0000`. A client-chosen tare would be a **client-chosen tolerance
boundary** (ADR-035).

### A measured tare of ZERO is valid, not missing

`0.0000 g` is applied and displayed as `0.0000 g` — never treated as
absent. The distinction unit `004` already carries (S-12) is inherited:
*"no tare in force" is the ABSENCE of a tare state, not a tare whose value
happens to be zero.*

### A REFUSED tare writes NOTHING

The tare is applied **first**, and the assignment is recorded only after
the device accepted it. So a refused tare leaves **no row**, and the
previous assignment stands — the same refusal rule unit `004` applies to
the device's own tare (S-14).

And a device that produced **no reading** is `SCALE_UNAVAILABLE`, never a
zero tare — absent is not zero (S-1).

### Two tables, two mutability rules, both asserted

| Table | The test |
|---|---|
| `container_assignments` | the trigger **refuses** an `UPDATE` and a `DELETE` |
| `containers` | the master's tare **can be** changed, and **can be cleared** to null |

That contrast is the ADR-035 distinction made executable: **reference data
is maintained; the record of an act is not.**

### The container is NOT de-duplicated

The same container assigned to two components is **two rows**. Whether one
physical container may serve several components is **Q-10**, and the station
neither forbids nor assumes it.

### The closed sets are in the storage layer

A third `assignment_method`, a third `tare_source` and a third
`container_type` are all **refused by the database** — so they cannot be
written even by a path that bypasses the domain.

---

## The one defect the tests found

### The stub's `latestFor` ignored the component id

**Found by:** `tests/unit/container-assignment.test.ts` — *"the same
container for two components is NOT de-duplicated"*.

**Symptom.** The test failed with one row instead of two, and the
diagnosis was not what it looked like: the second assignment was
**refused** because the use case asked *"has this component already been
assigned?"* and the stub answered *"yes"* — it returned the **newest row
overall** rather than the newest row **for that component**.

**Root cause.** The stub's `latestFor` ignored its argument. That is a
stub that **lies**, and a lying stub does not merely fail a test — it
makes the test pass for the **wrong reason**. Here it made a correct
implementation look broken.

**The fix.** The stub now filters by the component id, exactly as the real
repository does:

```typescript
for (let index = this.saved.length - 1; index >= 0; index -= 1) {
  const candidate = this.saved[index];
  if (candidate?.componentId.value === componentId.value) {
    return candidate;
  }
}
```

**And the more important half.** The test was then **right** for the right
reason: two components, two assignments, two rows.

This is worth recording because it is a category of defect that never
appears in production code — the stub was the bug. A test double that does
not honour its contract can make a correct implementation look wrong *and*
a wrong implementation look right, and the second is the dangerous one.

---

## Deliberately not delivered

- **The dispense reset on a re-tare.** The story requires it — *"the
  dispense is reset"* — and the **dispense is unit `003`'s session**. This
  bolt establishes the tare and records the assignment; **unit `003` owns
  the reset**, and both units' designs say so explicitly so neither reaches
  into the other's.
- **Whether one container may serve several components.** Q-10, and not
  this story's decision.
- **The container identification convention** (Q-10, CQ-08). The id is
  opaque and the convention is FCI's; the model accommodates a scan, a
  keyed entry, or a barcode on the container.
- **The container's own master UI.** The master is seeded and updatable
  through the repository; a screen for it is unit `007`'s or unit `006`'s.

---

## Acceptance-criteria validation

| Criterion | Status | Where it is proved |
|---|---|---|
| A container is associated with the component and its id is displayed | ✅ | `container-api.test.ts` — the `201` and the id |
| A master tare is applied, with the source `MASTER` | ✅ | `container-api.test.ts` — `CONTAINER_MASTER` and `214.0000` |
| A container with no master tare is weighed empty, with the source `MEASURED` | ✅ | `container-api.test.ts` — `WEIGHED_EMPTY_CONTAINER` |
| A re-tare resets the dispense and re-establishes the tare | ⚠️ **partial** | The tare is re-established and the source changes — the **dispense reset is unit `003`'s** |
| The weighing record carries the container and the applied tare with its source | ✅ | The assignment is the durable record unit `003` reads (BRD FR-25) |
| A component with no container cannot begin dispensing | ✅ by construction | `RecipeComponent.canProceed` — and unit `003` owns the gate |
| The tare is displayed with its unit, and the stored value keeps four places | ✅ | The stored value is a decimal string with its own unit; the **display** precision is unit `007`'s |

## Recommendations

- **Unit 003** owns the dispenser gate and the **dispense reset**. It must
  read the effective assignment through `GET /api/container/:componentId`
  — and it must treat a `409` (the scale refused) and a `503` (the scale
  produced nothing) as **different** refusals.
- **A re-tare is a new assignment.** Unit `003` must not expect an update
  to the old row — the newest row is the effective one (ADR-035).
- **The tare's unit is carried, not converted.** Unit `003` owns the
  cross-unit arithmetic, and it must convert at a fixed-point rate.
