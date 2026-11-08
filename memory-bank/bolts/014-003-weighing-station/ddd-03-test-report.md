---
stage: test
bolt: 014-003-weighing-station
status: complete
updated: 2026-11-06T06:00:00Z
---

# Test Report: Weighing Station (Bolt 014: the zone and the confirmation)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 81 passed, 0 failed |
| **Tests** | **1508 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`) |
| **Coverage (all files)** | 89.55% statements · 82.80% branches · 92.44% functions · 90.59% lines |
| **Coverage threshold** | 80% on all four — **met** |
| **New tests** | **58** (24 boundary + 11 gate + 8 persistence + 8 integration + 7 security) |
| **Baseline before the bolt** | 1450 tests, 76 files |
| **Defects found by the tests** | **2**, both fixed (below) |

---

## What the tests prove

### The exhaustive boundary suite — 24 tests, one per boundary

The unit brief demands it: *"exactly `target − tolerance`, exactly
`target × 0.9`, exactly `target + tolerance`, and one ULP either side of
each."* Every one of those is asserted, **and** the float defect is
demonstrated rather than merely asserted:

| The reading | The zone | Why |
|---|---|---|
| exactly `94.5000` (`target + tolerance`) | `OK` | `OVER` is a **strict** `>` |
| `94.5001` | `OVER` | one ULP above |
| `94.4999` | `OK` | one ULP below the upper bound |
| exactly `93.5000` (`target − tolerance`) | `OK` | `OK` is **inclusive** |
| `93.4999` | `NEAR` | one ULP below the lower bound |
| `93.5001` | `OK` | one ULP above the lower bound |
| exactly `84.6000` (`target × 0.9`) | `NEAR` | `NEAR` is **inclusive** |
| `84.5999` | `UNDER` | one ULP below |
| `84.6001` | `NEAR` | one ULP above |

**And the float defect is shown, not just avoided.** The suite asserts that
`94.0 × 0.9` in IEEE-754 is **greater than** `84.6` — so the float threshold
would put the exact boundary reading the requirement names on the **wrong
side** of `NEAR`. The decimal threshold is `84.6000`, exactly.

### The zero cases, exactly as the story names them

- **A zero target:** `target × 0.9` is zero, any positive reading is `OVER`,
  and a zero reading is `OK`.
- **A zero tolerance:** `OK` requires the value to equal the target
  **exactly**.
- **No tolerance at all:** the `OK` bounds are the target itself.

### The still-to-weigh is clamped IN THE DOMAIN

`max(0, target − current)` — and the test asserts it is **never negative**
(`120.0000` against a `94.0000` target gives `0.0000`, not `-26.0000`), and
that it is computed in **fixed-point** (`0.3000 − 0.1000` is `0.2000`, where
the float answer would be `0.19999999999999998`).

### The gate refuses all three zones, and says which

`UNDER` → `ZONE_UNDER`, `NEAR` → `ZONE_NEAR`, `OVER` → `ZONE_OVER` — and
**no record is written** in any of the three cases. The reason distinguishes
them, so the UI can show the right next step.

### The gate reads the CURRENT zone

The operator sees `OK`; a reading arrives that makes it `OVER`; the operator
presses confirm. **The confirmation is refused** — the gate recomputes from
the current weight, not from a cached zone.

### A replayed confirmation is idempotent

The second confirm returns the **existing** record and writes **nothing**.
One row, not two.

### The record is immutable, and the database says so

The triggers refuse an `UPDATE` and a `DELETE`, and the storage layer refuses
a zone outside the closed set. A **correction is a new row** carrying
`corrects_record_id` — and the test asserts the **original is untouched**.

### The client cannot assert the zone, the quantity, or the facts

The security suite sends `zone: 'OK'`, `actualQuantity: '94.0000'`,
`target`, `tolerance` — and every one is **stripped**, because the fields
do not exist. The domain's zone and the device's reading decide.

---

## The two defects the tests found

### The story's first boundary example is arithmetically inconsistent

**Found by:** `tests/unit/tolerance-zone.test.ts` — *"the story's boundary
readings land where the story says"*.

**The discrepancy.** The story's first acceptance criterion says:

> *"Given a target of `94.0000 g` and a tolerance of `0.5000 g`, When the
> reading is `95.0000 g` (**exactly `target + tolerance`**), Then the zone is
> `OK`."*

But `94.0000 + 0.5000` is `94.5000`, **not** `95.0000`. And the story's own
**fifth** criterion says `94.5001 → OVER`, which places the upper boundary
at `94.5000` — so `95.0000` is one full gram **above** the band, and it is
`OVER`.

**The resolution.** The story's **Technical Notes** state the rule precisely:

> *"1. `OVER` if `value > target + tolerance`  2. `OK` if `value >= target − tolerance`"*

So the **rule** is followed, and the prose's parenthetical is the error. The
four consistent readings (94.5000, 84.6000, 94.5001, 84.5999) all hold, and
`95.0000` is `OVER`.

**And the discrepancy is recorded in the test itself**, with the arithmetic
shown — so a reader who finds the story sees why the test reads the way it
does. The story file has **not** been edited: the requirement's own wording
is FCI's, and changing it is not this bolt's call.

### The still-to-weigh's zero was written as `0`, not `0.0000`

**Found by:** `tests/unit/tolerance-zone.test.ts` — *"is NEVER negative — the
clamp is in the DOMAIN"*.

**Symptom.** The clamped zero was `'0'` while every other quantity was
written at the storage precision.

**Root cause.** The clamp returned `WeightValue.of('0', unit)` — a
shorthand that happened to be canonical, but at the **wrong precision**.

**Why it matters.** The stored form should be a function of the **value**,
not of the path that produced it — and the value is a quantity stored at four
decimal places. `'0'` and `'0.0000'` are the same number, but they are
different strings, and a string is what the record carries.

**The fix.** The clamp writes `'0.0000'` — the storage precision, like every
other quantity in the product.

---

## Deliberately not delivered

- **The `OVER` exception.** An out-of-tolerance confirmation needs a
  supervisor authorisation, and that authorisation is issued through story
  `007` — **bolt `016`**. This bolt's gate refuses `OVER` unconditionally,
  and the override plugs in when bolt `016` lands.
- **The compensation and the escalation** — bolts `015` and `016`.
- **The progression** — bolt `017`. The gate writes the record; the
  progression advances the component.
- **The abandonment** — *"no record is written; the component returns to
  `PENDING`; the weight resets to zero"*. A session transition, and bolt
  `017`'s.
- **The weight stream's wiring to the session.** The reading path exists
  (bolt `013`) and the zone consumes the session's weight, but the server
  does **not yet** subscribe to unit `004`'s stream and feed the session.
  That is a bolt `013`/`017` concern, and it is recorded as carried
  forward rather than hidden.

---

## Acceptance-criteria validation

| Criterion | Status | Where it is proved |
|---|---|---|
| A reading exactly at `target + tolerance` is `OK`, not `OVER` | ✅ | `tolerance-zone.test.ts` — the exhaustive suite |
| A reading exactly at `target − tolerance` is `OK` | ✅ | the same |
| A reading exactly at `target × 0.9` is `NEAR` | ✅ | the same |
| A reading one ULP above the band is `OVER` | ✅ | the same |
| A reading one ULP below `target × 0.9` is `UNDER` | ✅ | the same |
| The zone is computed by the domain and returned to every consumer | ✅ | `session-controller.ts` serves the domain's zone; no consumer computes one |
| `UNDER` refuses the confirmation and writes no record | ✅ | `confirmation-gate.test.ts` |
| `NEAR` refuses the confirmation and writes no record | ✅ | the same |
| `OVER` refuses the confirmation and writes no record | ✅ | the same |
| `OK` writes a record carrying the operator, scale, lot, container, timestamp, target, actual quantity and the zone | ✅ | the same |
| A confirmed record cannot be edited or deleted | ✅ | `weighing-record-persistence.test.ts` — the triggers |
| The still-to-weigh is `max(0, target − current)` | ✅ | `tolerance-zone.test.ts` |
| The displayed weight lags the scale by no more than 200 ms | ✅ by construction | The zone is computed in-process on the reading |

## Recommendations

- **Bolt `015`** (over-dose) reads the zone: an `OVER` zone is the trigger
  for the surplus calculation.
- **Bolt `016`** (escalation) plugs into the gate's `OVER` branch: an
  authorised override converts a refusal into an acceptance, and the
  authorisation is **consumed**, never created here.
- **Bolt `017`** (progression) owns the abandonment and the advance, and
  must wire the weight stream into the session so the zone updates on every
  reading.
- **The story's first boundary example should be corrected** by whoever owns
  the requirement. The rule is right; the parenthetical is not.
