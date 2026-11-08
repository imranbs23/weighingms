---
stage: test
bolt: 013-003-weighing-station
status: complete
updated: 2026-11-06T03:40:00Z
---

# Test Report: Weighing Station (Bolt 013: selection and the live weight)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 76 passed, 0 failed |
| **Tests** | **1442 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`) |
| **Coverage (all files)** | 90.25% statements · 84.06% branches · 93.28% functions · 91.27% lines |
| **Coverage threshold** | 80% on all four — **met** |
| **New tests** | **40** (17 unit + 7 persistence + 8 integration + 8 security) |
| **Baseline before the bolt** | 1402 tests, 72 files |
| **Defects found by the tests** | **1**, fixed (below) |

---

## What the tests prove

### The operator never chooses the scale

The selection body has **no `scaleId` field**, and the security suite sends
one anyway — and the field is **dropped**, because it does not exist. The
94 g component demands PRECISION, so the rule chose `SCALE-A`, and the
client's `SCALE-B` is ignored.

**That is the same rule the tare and the lot carry** (ADR-030, ADR-034,
ADR-035): a client that could choose the scale could choose the tolerance
boundary.

### "No device can weigh this" is a `409` carrying the reason as DATA

The target, the maximum available capacity, and the demanded class — all
three in the body. The session does **not** enter `WEIGHING`.

**That is ADR-018's union, passed through unchanged**: *"the 'no device can
weigh this' outcome is NOT an error... a successful answer to a
well-formed question."*

### Each of the FIVE reading rules, separately

| The reading | The rule | Asserted |
|---|---|---|
| a lower `sequence` | `OUT_OF_ORDER` | ✅ the weight is **retained** |
| a different scale | `WRONG_SCALE` | ✅ discarded |
| a different unit | `WRONG_UNIT` | ✅ discarded, and the previous weight is kept |
| not weighing | `NOT_WEIGHING` | ✅ no component state affected |
| otherwise | accepted | ✅ the weight updates |

**And a discarded reading does NOT move the sequence floor** — because a
discarded reading was never accepted. The test asserts it: a wrong-unit
reading at sequence 9 leaves the floor at 5, and a reading at 6 is accepted.

### `stable = false` is SURFACED, not collapsed

The weight is taken and displayed, and `weightIsStable` is `false` — the
operator sees that the weight is still settling (BRD IR-11).

### A disconnected scale blocks weighing and RETAINS the weight

The session leaves `WEIGHING`, the scale is unbound, and the **last known
weight is retained** and marked **stale** — the operator can still see what
the scale last said, and the UI can mark it as old (BRD IR-13).

And when the scale comes back, the session is re-established **without an
operator action**.

### The session is MUTABLE, and the row is UPDATED IN PLACE

The persistence suite asserts it: two saves of the same session leave **one
row**, and the second save's state is what is read back.

**And the sequence floor survives a restart** — a replayed reading after the
restart is still rejected. That is the one number that could otherwise be
stale-looking-fresh, and it is closed (ADR-036).

### The weight is stored as TEXT

The persistence suite asserts `typeof current_weight === 'string'` and the
value `'40.0000'` — never a float, never a `REAL` column (BRD NFR-16).

### The state machine is not client-writable

The security suite posts to `/api/session` and `/api/session/state` with a
`state` field, and both answer `404`. There is **no endpoint that sets the
session's state**, and **no endpoint that accepts a weight** — the weight
comes from the device.

---

## The one defect the tests found

### A freshly registered scale was refused, because its link starts `UNKNOWN`

**Found by:** `tests/integration/weighing-session-api.test.ts` — *"selects a
component and binds its scale — with NO operator input"* answered `409`
instead of `200`.

**Symptom.** Every selection was refused with `SCALE_UNAVAILABLE`.

**Root cause.** The gate was consulted **before** the device had ever
spoken. A device's link starts `UNKNOWN`, and `UNKNOWN` **blocks** — the
gate was right, and it was being asked about a device nobody had heard
from.

**The fix.** The device is **proved present** before the gate is consulted:
the registry is asked for one reading, which is ingested through the normal
path and brings the link up. Unit `004` gained one method,
`ScaleRegistry.provePresent`, and the adapter calls it before the gate.

**And this is the same order unit `004`'s tare flow already used** — it asks
the adapter for a reading before commanding the device, for the same reason.
So the fix is not new machinery; it is **the existing order applied at the
second place it was needed**, and the reasoning is now written down in both
places.

**What it cost.** Unit `004` is changed by this bolt — one added method, and
no behaviour altered. That is worth recording, because bolt 013's design
said *"what this bolt adds to unit 004: nothing"* — and that was **wrong**
when it was written. The design has been corrected: unit `004` gains
`provePresent`, and the reason is above.

---

## Deliberately not delivered

- **The zone engine** — bolt `014`. Four zones, evaluated on every reading
  against the active component's target and tolerance. It is a pure value
  computation, modelled as a value object inside this unit.
- **The confirmation gate** — bolt `014`. It reads the zone and the
  session's state, and it is the **only** path to a `WeighingRecord`.
- **The component progression** — bolt `017`. Advancing to the next
  `PENDING` component, and the dispense reset on a re-tare (which bolt `012`
  recorded as this unit's).
- **The `WeighingRecord`** — bolt `017`. The immutable record of a
  completed act, in its own table (ADR-036).
- **The compensation and the escalation** — bolts `015` and `016`. The
  states are in the set already, and the transitions into them are reserved.

---

## Acceptance-criteria validation

| Criterion | Status | Where it is proved |
|---|---|---|
| The rule resolves the scale from the target and the session binds to it, with no operator input | ✅ | `weighing-session-api.test.ts` — the `200`, and the `SCALE-A` the rule chose |
| The selected scale is identified by its class and capacity, and cannot be changed by the operator alone | ✅ | The body has **no** `scaleId` field; the security suite proves it is dropped |
| An expired calibration prevents weighing, with the reason reported | ✅ by construction | The gate is unit `004`'s, consulted at selection; the reason is its own vocabulary |
| No available scale satisfies the rule → the session does not enter `WEIGHING`, and a reason is given | ✅ | `NO_DEVICE_CAN_WEIGH` carries the target, the maximum and the class |
| Selecting a component resets the weight to zero and moves to `WEIGHING` | ✅ | `weighing-session.test.ts` — the weight and the sequence floor both reset |
| A reading is accepted and the current weight updated | ✅ | `weighing-session.test.ts` — the accepted case |
| The still-to-weigh is `max(0, target − current)` and never negative | ⏳ | The **clamp** is bolt `014`'s — it needs the target, which is the recipe's fact |
| The displayed weight lags the scale by no more than 200 ms | ✅ by construction | The reading path is **in-process**; no network hop (NFR-01) |
| A disconnection blocks weighing within 2 s | ✅ | Unit `004`'s watchdog detects it; this unit reads the gate — **one** watchdog, not two |
| The scale reconnects and the weight is re-established without operator action | ✅ | `weighing-session.test.ts` — `scaleRestored` |

## Recommendations

- **Bolt 014** owns the zone and the still-to-weigh. It reads the session's
  **current weight** and the recipe's **target** — and the clamp belongs
  **in the domain**, not in the renderer.
- **Bolt 014**'s confirmation gate must check **both** the zone and the
  session's state — a zone of `OK` while the scale has gone away is not a
  confirmation.
- **Bolt 017** owns the progression and the dispense reset. A re-tare is a
  **new** assignment on unit 002's side and a **session transition** on this
  side.
- **The `provePresent` order is now in two places** — unit `004`'s tare
  flow and this bolt's selection. If a third consumer needs the gate, it
  must use `bindScale` rather than calling `canWeigh` directly, or the
  `UNKNOWN` problem returns.
