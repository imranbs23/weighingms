---
stage: design
bolt: 013-003-weighing-station
created: 2026-11-06T02:50:00Z
---

## Technical Design: 003-weighing-station (bolt 013)

### Architecture Pattern

**Hexagonal (ports and adapters), with the seam owned by the consumer** — the
same shape as units `001` and `002`.

This bolt adds **one port** and **one repository**:

| Port | What it is | Bound to |
|---|---|---|
| `ScaleSelectionPort` | The automatic scale-selection rule | Unit `004`'s `ScaleRegistry` |
| `WeighingSessionRepository` | The session's durable state | This unit's SQLite table |

### Layer Structure

```text
┌──────────────────────────────────────────────────────────────────┐
│ Presentation                                                     │
│   SessionController      POST /api/session/select                │
│                          GET  /api/session                       │
│                          GET  /api/session/weight                │
│   (Zod schemas on the boundary)                                   │
├──────────────────────────────────────────────────────────────────┤
│ Application                                                      │
│   SelectComponent         bind the scale, reset the weight        │
│   ConsumeWeightStream     accept or discard a reading            │
├──────────────────────────────────────────────────────────────────┤
│ Domain                                                           │
│   WeighingSession         THE AGGREGATE — the state machine      │
│   SessionState            the seven states                       │
│   ComponentProgress       one component's progression             │
│   StillToWeigh            max(0, target − current)               │
│   ScaleBinder             binds the rule's answer to the session  │
│   WeightReader            the accept-or-discard rules            │
│   WeighingSessionRepository  THE PORT                            │
│   ScaleSelectionPort         THE PORT (unit 004's rule)          │
├──────────────────────────────────────────────────────────────────┤
│ Infrastructure                                                   │
│   CompositionRoot              binds every port in ONE place       │
│   SessionDatabase              the table and migration            │
│   SqliteWeighingSessionRepository   the durable session           │
└──────────────────────────────────────────────────────────────────┘
```

### API Design

#### `POST /api/session/select` — select a component and bind its scale

| Status | Meaning | Body |
|---|---|---|
| **200** | The component is active and the session is `WEIGHING` | `{ session: {...} }` |
| **400** | The body is not a selection | `{ error: "VALIDATION_ERROR" }` |
| **401** | No operator session | `{ error: "UNAUTHENTICATED" }` |
| **404** | The recipe holds no such component | `{ error: "COMPONENT_NOT_FOUND" }` |
| **409** | The component is `DONE` — terminal | `{ error: "COMPONENT_ALREADY_DONE" }` |
| **409** | **No device can weigh this target** | `{ error: "NO_DEVICE_CAN_WEIGH", target, maximumCapacity, demandedClass }` |
| **409** | The chosen scale may not weigh — expired calibration, or disconnected | `{ error: "SCALE_UNAVAILABLE", reason }` |

**The body is `{ componentId }`.** There is **no `scaleId` field** — the
operator never chooses the scale (BRD BR-05), and a client-supplied scale
would be a client-supplied tolerance boundary in the same way the tare was
(ADR-035).

**And the "no device" outcome carries its reason as DATA** — the target,
the maximum available capacity, and the demanded class. That is ADR-018's
union, passed through: *"a successful answer to a well-formed question,
not a silent absence."*

#### `GET /api/session` — the session's current state

`200` with the session, or `200` with `session: null` when no session has
been started — **never a `404`**. "No session yet" is a state, and it is
the UI's first render.

#### `GET /api/session/weight` — the current weight and the still-to-weigh

`200` with the reading's **data** — the current weight, whether it is
stable, the still-to-weigh quantity, and the component it belongs to.

**And the weight is the STATION's, not a client's.** The session is the
source of truth; a client cannot post a weight.

#### Authentication

**An operator session is required** (ADR-020). A **supervisor is not** —
selecting a component and reading the weight are not privileged actions.
Manual scale reselection **is** a privileged action, and it belongs to
bolt `016`.

### Data Model

#### `weighing_sessions` — the session's durable state

| Column | Type | Notes |
|---|---|---|
| `session_id` | `TEXT PRIMARY KEY` | The session's identity |
| `batch_id` | `TEXT NOT NULL` | The batch being worked |
| `operator_id` | `TEXT NOT NULL` | Who is working it |
| `state` | `TEXT NOT NULL CHECK (state IN ('AWAITING_BATCH','AWAITING_COMPONENT','WEIGHING','COMPENSATING','ESCALATED','CONFIRMING','COMPLETE'))` | The closed set in the storage layer |
| `active_component_id` | `TEXT NULL` | The component being dispensed — exactly one at a time |
| `selected_scale_id` | `TEXT NULL` | The bound device |
| `current_weight` | `TEXT NULL` | The last accepted reading, as a **decimal string** |
| `weight_unit` | `TEXT NULL` | The unit it is in |
| `weight_stable` | `INTEGER NULL` | 0/1 — the settling distinction, **surfaced** |
| `weight_stale` | `INTEGER NOT NULL` | 1 when the scale has gone away and the weight is the last known one |
| `weight_sequence` | `INTEGER NULL` | The last accepted reading's sequence — the out-of-order guard |
| `started_at` | `TEXT NOT NULL` | When the session began |
| `updated_at` | `TEXT NOT NULL` | When it last changed |

**THE SESSION IS MUTABLE — AND THAT IS THE POINT.** It is the **live
state** of the work, and it changes as the operator works. It is not a
record of a completed act; the `WeighingRecord` is that, and it is
immutable (bolt `017`).

So this unit has **two** kinds of persistence, and the distinction is the
same one ADR-035 drew for the container: **the live state is maintained; the
record of a completed act is not.**

**And the weight is stored as TEXT, never REAL.** BRD NFR-16: a quantity
is never a float, and a `REAL` column would round it.

**The session is persisted so it can be RESUMED** (NFR-06, invariant 7) —
after a power cut or a shift change, the operator returns to the component
in progress. That is the whole reason this table exists.

### The scale-selection rule — reused, not re-implemented

Unit `004`'s `ScaleSelectionRule` is **already built**, and it already
answers the question the story asks:

- it returns a **discriminated union** — `SELECTED` or
  `NO_DEVICE_CAN_WEIGH` (ADR-018), so a caller cannot mistake the
  no-device case for a successful selection;
- it **converts into a common unit** before every comparison, because
  `WeightValue.compareTo` refuses to compare across units;
- its **threshold is configuration** (ADR-019), `null` until FCI answers
  `Q-04`, and the capacity constraint alone decides every case the story
  names.

**So this unit declares a port and binds the registry.** It does not
re-implement the rule, and it does not hard-code a threshold.

**And the gate is consulted.** Unit `004`'s `ScaleRegistry.canWeigh`
answers whether the chosen device may weigh — expired calibration,
disconnected, or unknown. So a scale with expired calibration is refused at
selection (BRD FR-12, BRD BR-24, AC-14), and the reason is passed through
unchanged.

### The reading path — accept or discard

The rules are short, and each is a **different fact**, so each is a
**separate rule** rather than one conditional with five branches:

| The reading | The rule |
|---|---|
| A lower `sequence` than the last accepted | **out of order** — discarded |
| For a scale that is not the selected scale | **wrong scale** — discarded |
| In a unit that does not match the component's | **wrong unit** — discarded |
| While the session is not `WEIGHING` | **not weighing** — discarded |
| Otherwise | **accepted**, and `stable` is **surfaced** |

**And a discarded reading changes NOTHING** — the current weight is
**retained**, not zeroed. A rejected reading must not make the operator's
readout say "0 g" when the scale is actually reading 40 g.

**The unit comparison is EXACT.** `WeightValue.compareTo` refuses to
compare across units rather than converting behind the caller's back — and
that refusal is the right behaviour here: a reading in the wrong unit is
**invalid**, not convertible.

### The disconnect — within 2 s

BRD IR-13 requires the weighing to be blocked within 2 s of a
disconnection. Unit `004` already detects it: the watchdog trips on the
device's silence, and the registry's link state goes down.

**So this unit reads the link state, and it does not implement a second
watchdog.** A second watchdog would be a second answer to a question unit
`004` already answers — the duplication ADR-028 refused for the MES seam.

When the link goes down:

- the session's state leaves `WEIGHING` — weighing is blocked;
- the **last known weight is retained for display and marked stale** — the
  operator can still see what the scale last said, and the UI can mark it
  as old;
- confirmation is unavailable (bolt `014`'s gate reads the state).

### Security Design

| Concern | Approach |
|---|---|
| **Session** | Required (ADR-020). |
| **A client-supplied scale** | There is **no** `scaleId` field in the selection body. The operator never chooses the scale. |
| **A client-supplied weight** | There is **no** endpoint that accepts a weight. The weight comes from the device. |
| **A client-supplied state** | There is **no** endpoint that sets the session's state. The state machine is the domain's. |
| **Out-of-order readings** | The sequence guard is in the domain, and the last accepted sequence is **persisted** — so a replayed reading after a restart is still rejected. |
| **Unbounded identifiers** | `ComponentId` and `BatchId` bound at 64 characters. |
| **Diagnostics leaking** | The refusal bodies carry **codes** and data. The `NO_DEVICE_CAN_WEIGH` body carries the target and the maximum capacity — both **facts**, not prose. |

### NFR Implementation

| Requirement | Design approach |
|---|---|
| **NFR-1 / AC-03 — the weight lags the scale by ≤ 200 ms** | The reading path is **in-process** — the session's own state, updated on each reading. No network hop, no separate zone service. |
| **BRD IR-10 — ≥ 10 readings per second** | Unit `004`'s stream already samples at ≤ 100 ms, and the session consumes it in-process. |
| **BRD IR-13 — disconnection detected within 2 s** | Unit `004`'s watchdog, read by this unit. **One** watchdog, not two. |
| **NFR-06 — the session is resumable** | The session is persisted, with the active component and the last accepted sequence. |
| **BRD NFR-16 — fixed-point, never float** | Every quantity is a decimal **string**, in the payload and in the column. |
| **NFR-14 — the threshold is configuration** | The rule's threshold is `null` until FCI answers `Q-04`. |

### Integration Plan

**Bound in the composition root, and nowhere else:**

```text
src/api/server.ts
  └── buildWeighingStationModule({
        selection: scales.registry,        // unit 004's rule
        sessions: new SqliteWeighingSessionRepository(...),
        recipe: the working copy,           // unit 002's
      })
```

**What this bolt adds to unit `004`: nothing.** Its rule and its watchdog
are already there.

**What this bolt adds to unit `002`: nothing.** It reads the working copy
through the module's own port — the same working copy the identity, the
lot and the container were recorded against.

**What this bolt adds to the API surface:** three paths under
`/api/session`.

### Testing Plan

| Suite | What it proves |
|---|---|
| **Unit — the state machine** | The seven states and their transitions; `DONE` is terminal; selecting resets the weight; exactly one component is active. |
| **Unit — the reading rules** | Each of the five rules, separately: out of order, wrong scale, wrong unit, not weighing, and the accepted case with `stable` surfaced. A discarded reading retains the previous weight. |
| **Unit — the still-to-weigh** | `max(0, target − current)`, in fixed-point, and never negative. |
| **Integration — the endpoints** | `200` with the session; the scale is bound with no operator input; the "no device" outcome is a `409` carrying the target and the maximum; a `DONE` component is refused; a `401` without a session. |
| **Integration — the stream** | A reading updates the weight; a stale one is rejected; a disconnected scale blocks weighing and retains the weight marked stale. |
| **Persistence** | The session round-trips; the closed-set `CHECK` refuses a ninth state; the last accepted sequence survives a restart. |
| **Security** | No session → `401`; no client-supplied scale; no client-supplied weight; the diagnostics never leak. |
| **Composition root** | Every port is bound to the one it was given, and the selection port is the **same** registry unit `004` owns. |

### Open points carried forward

1. **The zone engine** — bolt `014`. It is a pure value computation, and
   it is modelled as a value object **inside this unit**.
2. **The confirmation gate** — bolt `014`. It reads the zone and the
   session's state, and it is the **only** path to a `WeighingRecord`.
3. **The dispense reset on a re-tare** — bolt `012` recorded that it
   belongs to **this** unit. The session is where the dispense lives, so
   the reset is a session transition, and it is bolt `017`'s progression
   work.
4. **The selection threshold** (Q-04) — configuration, `null` until FCI
   answers, and the rule works without it (ADR-019).
