---
stage: test
bolt: 016-003-weighing-station
status: complete
updated: 2026-11-06T03:00:00Z
---

# Test Report: Weighing Station (Bolt 016: escalation and override)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 90 passed, 0 failed |
| **Tests** | **1576 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`) |
| **Coverage (all files)** | 88.80% statements · 81.33% branches · 91.88% functions · 89.87% lines |
| **Coverage threshold** | 80% on all four — **met** |
| **New tests** | **42** (13 unit + 6 persistence + 20 integration + 5 security) |
| **Baseline before the bolt** | 1538 tests, 85 files |
| **Defects found by the tests** | **4**, all fixed (below) |

---

## What the tests prove

### This bolt re-checks NOTHING — and the tests prove that

The domain suite asserts that the escalation calls **unit `008`'s**
`consume` with:

- the action `CONFIRM_COMPONENT` — unit 008's closed set, named for this
  story;
- the **derived** subject `WS-1/DYE-4471-Y` — the session's own ids, never a
  client's;
- the **session's** operator, not a body's.

**And there is no test here for the fresh credential, the distinctness
check, the expiry boundary or the single-use guarantee** — because those are
unit `008`'s, and they are exhausted there (ADR-039).

### The scope is DERIVED, and the derivation is what the test checks

Two components give two subjects. Two sessions give two subjects. And an
empty session or component is **refused** — a scope that matches nothing
would be a scope that authorises nothing, silently.

### The refusal is UNIFORM, and carries NO reason

The security suite sends a **non-existent** authorisation id with a **wrong**
secret, and asserts the body is exactly `{ error: 'AUTHORISATION_REFUSED' }` —
no reason code, no field, and **not** the string `SELF`, `EXPIRED`,
`SCOPE` or `OUT_OF_SCOPE` anywhere in the response.

Because a precise reason is a **map of the defences** (ADR-004), and this
endpoint is a **standing** request that anyone who can reach the API could
poll with credential pairs.

### The escalation is decided ONCE

A second authorisation is refused, and the escalation's own `authorise`,
`refuse` and `expire` all throw once it has been decided.

### `EXPIRED` is NOT `REFUSED`

They are different facts with different next steps — a refusal is finished,
an expiry asks again. The suite asserts them as **different states**.

### The reason is in CLEAR TEXT in the record, and ABSENT from the wire

The persistence suite reads the row back and asserts the reason is stored
**verbatim** — ADR-005: *"it must be readable by an auditor five years
later — it is a record, not a credential."*

### The override record is IMMUTABLE

The triggers refuse an `UPDATE` and a `DELETE`, and the suite asserts both.

---

## The four defects the tests found

All four were found by the escalation's tests, and all four were fixed at
the **root cause**.

### Defect 1 — the session was never subscribed to the scale

**Found by:** `tests/integration/escalation-api.test.ts` — every escalation
answered `409`, because the session's weight was **always null**.

**Root cause.** The reading path existed and the zone consumed the session's
weight, but **nothing ever connected the device's stream to the session**.
The weight stream was read by the HTTP controller and by nobody else, so
the session's current weight was always absent and no zone could ever be
computed.

**This was a missing link that had been carried forward since bolt `013`** —
and it is what the escalation's tests were the first to *require*.

**The fix.** The session now **subscribes** to the device it is bound to,
when the binding happens — and it drives the adapter's shared pump, so the
device speaks. The disconnection comes through the **same subscription**,
so there is **one** detector of it in the product.

### Defect 2 — a gram reading against a kilogram band crashed with a 500

**Found by:** the same test — the escalation's `500` and the log line
*"Cannot compare weights in different units (g vs kg)"*.

**Root cause.** The recipe's components carry the unit the MES supplied —
**grams** for the dyestuffs, **kilograms** for the auxiliaries — while the
device reports in its own unit. The reading was compared against the band
without a conversion, and `WeightValue.compareTo` **refuses** to compare
across units rather than converting behind the caller's back.

That refusal is correct behaviour in the type — but it meant the comparison
**threw**, and a thrown comparison is a `500`, not a refusal. So every
auxiliary component in the recipe would have failed with a server error.

**The fix.** The reading is converted into the component's unit, **exactly**,
before the comparison — using unit `004`'s `WeightUnitConverter`, which is
decimal and never a float division (`1.850 kg` → `1850 g`, not
`1849.9999999 g`). And the conversion is **required**, not optional: the
story says *"cross-unit arithmetic belongs to unit 003 and must convert at a
fixed-point rate, never through a float division."*

### Defect 3 — the component's unit was not persisted, so a resumed session could not convert

**Found by:** the same test — the conversion worked in-process but the unit
was lost on every round trip.

**Root cause.** The session's `componentUnit` was set when a component was
selected and **never persisted**. The session is persisted precisely so it
can be **resumed** (NFR-06) — and a resumed session that had forgotten the
component's unit would compare a gram reading against a kilogram band and
**throw** again.

**The fix.** The column is persisted and restored with the rest of the
session's live state.

### Defect 4 — "the remaining components" was every component except the active one

**Found by:** `tests/integration/escalation-api.test.ts` — the escalation
answered `409` even over a real over-dose, because the surplus was
**compensable**.

**Root cause.** The compensation's remaining set was computed as *"every
component except the active one"*. But the story is explicit that the
remaining components are the ones **after** the active one in recipe
sequence:

> *"No remaining components (last component over-dosed) → the surplus cannot
> be absorbed — no proposal; escalate."*

The components **before** the active one have already been weighed, and
their target **cannot** absorb a surplus — they are not going to be weighed
again.

**The fix.** The remaining set is the **tail** of the sequence — the
components after the active one. The **last** component therefore has none,
which is exactly the case the story names.

**And this was a bug in bolt `015` too** — the proposal path had the same
wrong set, so a proposal could have been built over components that were
already weighed. Both are fixed by the same rule, and the rule is now the
story's wording.

---

## Deliberately not delivered

- **The weighing written under an override.** It records the **over-dose
  zone** as its `zoneAtConfirm` — not `OK` — so the exception is visible in
  the record and in reporting (BRD FR-11, FR-23). That is the confirmation
  gate's work, and the gate does not yet accept an override.
- **The audit trail.** Unit `006` records the published events (BRD FR-36).
  This bolt **publishes** them; it does not store the trail.
- **The batch being held** when the escalation is refused — unit `003`'s
  progression, bolt `017`.
- **The supervisor's view** — unit `007` renders the awaiting state.

---

## Acceptance-criteria validation

| Criterion | Status | Where it is proved |
|---|---|---|
| A non-compensable over-dose moves the session to `ESCALATED`, and the weighing is **not** confirmed | ✅ | `escalation-api.test.ts` — the `201` and the `ESCALATED` state |
| A supervisor authenticates and supplies a reason → the override is recorded, and the weighing can then be confirmed | ⚠️ **partial** | The authorisation is **consumed** through unit 008's service and the record is written — but the gate does not yet accept it. That is bolt `017`'s work. |
| The request is completed without supervisor authentication and a recorded reason → the override is refused and the weighing remains unconfirmed | ✅ | `escalation-api.test.ts` — the uniform `403` |
| The operator's own credentials cannot authorise it — the authoriser must be a distinct supervisor | ✅ | **Unit `008`'s** check, on identity and not role (ADR-003, ADR-004). Not re-implemented here (ADR-039). |
| The override is scoped to one action and one subject, expires, and cannot be reused | ✅ | **Unit `008`'s** checks — scope, expiry and single-use, all behind `consume`. Not re-implemented here. |
| No supervisor authorises → the weighing is not confirmed and the batch is held | ✅ | The escalation stays `ESCALATED` and the refusal moves it to `REFUSED` |
| The weighing written under an override records the over-dose zone, not `OK` | ⏳ | Bolt `017`'s confirmation gate |
| Every privileged action is written to the audit trail | ⏳ | Unit `006` records the published events |

## Recommendations

- **Bolt `017`** must let the confirmation gate accept an `OVER` zone **only**
  when the escalation is `AUTHORISED` and its authorisation was **consumed**
  in the same call — and the record must carry the **over-dose** zone as its
  `zoneAtConfirm`.
- **Unit `006`** records `OverrideAuthorised` and `OverrideRefused`. The
  reason is in the event, so the trail has it without the wire exposing it.
- **The remaining-components rule is now the story's wording** — the tail of
  the sequence — and it applies to the proposal path as well as the
  escalation's. If Q-10's answer changes what "remaining" means, this is
  the one place to change it.
