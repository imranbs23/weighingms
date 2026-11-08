---
stage: test
bolt: 015-003-weighing-station
status: complete
updated: 2026-11-06T07:50:00Z
---

# Test Report: Weighing Station (Bolt 015: over-dose and compensation)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 85 passed, 0 failed |
| **Tests** | **1538 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`) |
| **Coverage (all files)** | 88.57% statements · 81.49% branches · 91.82% functions · 89.54% lines |
| **Coverage threshold** | 80% on all four — **met** |
| **New tests** | **30** (16 unit + 7 persistence + 7 integration + 8 security) |
| **Baseline before the bolt** | 1508 tests, 81 files |
| **Defects found by the tests** | **2**, both fixed (below) |

---

## What the tests prove

### The factor is DERIVED — and the story's two cases prove it

| Surplus | Remaining total | The factor |
|---|---|---|
| `2.4000 g` | `94.0000 g` | `0.025532` |
| `2.4000 g` | `188.0000 g` | `0.012766` |

**The same surplus, two totals, two different factors.** That is the proof
that the factor is a formula — and the proof that the prototype's constant
`1.026` is wrong. The test makes the consequence explicit:

> The prototype's constant would give `188.0 × 1.026 = 192.888 g` — a
> surplus of **`4.888 g` distributed when only `2.400 g` was over-dosed**.

And the proportional rule gives `96.4000 g` on the `94.0000 g` case — the
original plus **exactly** the surplus.

### The revised targets are the story's worked numbers

- `20.0000 g` → `20.5106 g` (`20.0000 × 1.025532`)
- `74.0000 g` → `75.8894 g` (`74.0000 × 1.025532`)

### The sum is PRESERVED

The revised targets sum to `96.4000 g` — the original remaining total plus
the surplus. **The surplus is fully and only distributed.**

### The ratio is PRESERVED

Each target grows by the same factor, to the precision of the **quantities**
(4 dp) — so the ratios agree to five decimal places, and the sixth differs
only because each revised target was rounded.

### The overshoot and the surplus are DIFFERENT quantities

The story's own worked numbers differ by exactly the tolerance, and the
tests assert both:

- the **overshoot** — `96.4000 − 94.5000 = 1.9000 g`
- the **surplus** — `96.4000 − 94.0000 = 2.4000 g`

**And the difference between them is exactly the tolerance.** The story's
first criterion calls the overshoot "the surplus"; the implementation
carries **both**, under their own names, and the API reports both.

### The percentage is omitted at a zero target

`surplus ÷ target × 100` has no answer when the target is zero — so it is
`null`, **not zero**. A `0%` surplus would be a division that silently
claimed an answer.

### The refusals

- **No remaining components** → not compensable; the surplus cannot be
  absorbed.
- **A zero surplus** → not compensable; there is nothing to distribute, so
  there is **no proposal**.
- **The zone is not `OVER`** → **no surplus at all**, and the over-dose
  response is not offered.

### The proposal is PRESENTED, not applied

The proposal is recorded with `PROPOSED`, and the operator's decision is a
**new row** sharing the `proposal_id` — so the history shows the proposal
was made **before** it was decided, and the original row is **untouched**.

And a proposal can be decided **once** — a second decision is refused.

### The factor is STORED

The proposal's row carries the applied `factor`, and the test asserts it
round-trips as `0.025532`. That is the evidence of which rule produced the
revision — and the only thing that survives if Q-06 is answered "just
display the excess" and the compensation path is deleted (ADR-038).

### The client supplies NEITHER the factor NOR the amounts

The security suite sends `factor`, `surplusAmount`, `revisedTarget` and
`recalculated` — and every one is **stripped**, because the fields do not
exist. The domain's computation decides.

---

## The two defects the tests found

### The factor was rounded to the quantity's precision — and the truncation showed up in the quantity

**Found by:** `tests/unit/surplus-and-compensation.test.ts` — *"is `0.025532`
for a surplus of 2.4000 on a remaining total of 94.0000"*.

**Symptom.** The factor came out `0.025500`, and the revised target
`20.5100` instead of `20.5106`. The sum was `96.3970` instead of
`96.4000` — and the story's own numbers did not reproduce.

**Root cause.** The factor was computed at the **storage precision for
quantities** (4 dp). But the factor is **not a quantity** — it is a
**ratio**, and it is the multiplier for every remaining target. A factor
truncated to 4 places scales a `74.0000 g` target by `0.0255` instead of
`0.025532`, and the error appears in the **quantity**, where it is least
visible.

**The fix.** The factor is computed at **6 decimal places** — the
precision the story's own worked numbers fix (`0.025532`, `0.012766`) —
while the **quantities** it produces are still written at 4.

**Why this is worth recording.** The defect was invisible in the ordinary
case: `20.0000 × 0.0255` and `20.0000 × 0.025532` are both "about
20.51 g", and a reviewer reading the code would see a sensible 4-place
rounding. The failure appeared only in the **sum** — which is the property
the requirement actually cares about.

### The effective proposal's ordering was by TIMESTAMP — and the two rows tie

**Found by:** `tests/unit/surplus-proposal-persistence.test.ts` — *"the
effective proposal is the NEWEST row — the decision"*.

**Symptom.** After the proposal and its decision were both written, the
effective proposal was still the `PROPOSED` one — and the rows came back in
the wrong order.

**Root cause.** The ordering was `recorded_at DESC`, and **both rows land
in the same millisecond** — the proposal and its decision are microseconds
apart. So the ordering was **arbitrary**, and "which row is the decision"
had no deterministic answer.

**Why it matters.** This is ADR-029's rule applied to a decision: the
"latest" lookup needs a **total** order, or two reads of the same state can
disagree. A timestamp is not a total order when the two events are
microseconds apart.

**The fix.** The table carries an explicit **insertion sequence**, and the
lookup orders by it — so the tie breaks in the order the acts **happened**.
(The table has a composite primary key, so there is no `rowid` to lean on.)

---

## Deliberately not delivered

- **The supervisor escalation** — bolt `016`. The `NOT_COMPENSABLE` branch
  ends there, and that is where the authorisation is consumed.
- **The weighing written under an override** records its `zoneAtConfirm` as
  the over-dose zone, not `OK` — bolt `016`'s.
- **The revised targets' effect on the session's component targets.** The
  revision lives on the **proposal**, and the session consults it. Bolt
  `017`'s progression reads it.
- **The weight stream's wiring into the session.** Carried forward from bolt
  `014` — the zone consumes the session's weight, but the server does not yet
  subscribe to unit `004`'s stream. Bolt `017`'s work.

---

## Acceptance-criteria validation

| Criterion | Status | Where it is proved |
|---|---|---|
| An over-dose is detected and the surplus above the tolerance maximum is `1.9000 g` | ✅ | `surplus-and-compensation.test.ts` — the overshoot |
| The surplus is given as an absolute quantity and as a percentage | ✅ | the same — `2.4000 g` and a percentage |
| The surplus is the amount above the **target** (`+2.4000 g`) | ✅ | the same — and the two quantities are proven **different** |
| The zone is not `OVER` → no surplus, and the over-dose response is not offered | ✅ | the same |
| The factor is `surplus ÷ totalRemainingTarget = 0.025532` | ✅ | the same — the story's first case |
| The factor is `0.012766` for the same surplus on a larger total | ✅ | the same — the story's second case, and the proof it is not a constant |
| The proposal shows each component's original and revised target | ✅ | `surplus-api.test.ts` |
| Accepting the proposal revises the targets and returns to `WEIGHING` | ⏳ | The **decision** is recorded here; the progression is bolt `017`'s |
| The remaining components cannot absorb the surplus → no proposal, and the session escalates | ✅ | `surplus-and-compensation.test.ts` — the three refusals |
| The proposal is persisted as one row per over-dose | ✅ | `surplus-proposal-persistence.test.ts` |
| The compensation is recorded with the authorising user and the reason | ✅ | the same — the decision row carries both |

## Recommendations

- **Bolt `016`** (escalation) consumes the `NOT_COMPENSABLE` branch, and the
  proposal's `status` is where its decision lands.
- **Bolt `017`** (progression) must read the **accepted** proposal's revised
  targets and apply them to the remaining components — and it must not
  recompute them, because the stored factor is the record of what was
  applied.
- **Q-06's answer changes one place** — `CompensationCalculator` — and the
  stored factors are what remain either way.
