---
stage: design
bolt: 014-003-weighing-station
created: 2026-11-06T04:40:00Z
---

## Technical Design: 003-weighing-station (bolt 014)

### Architecture Pattern

**Hexagonal (ports and adapters), with the seam owned by the consumer** — the
same shape as the previous bolts.

This bolt adds **one value object** (the zone), **one service** (the
evaluator), **one gate** (the confirmation), and **one repository** (the
weighing record).

**And it adds NO new port over the outside world.** The target and the
tolerance come from unit `002`'s working copy; the weight comes from the
session; the override, when there is one, comes from bolt `016`'s
authorisation service.

### Layer Structure

```text
┌──────────────────────────────────────────────────────────────────┐
│ Presentation                                                     │
│   ConfirmationController   POST /api/session/confirm             │
│                          GET  /api/session/zone                 │
│   (Zod schemas on the boundary)                                   │
├──────────────────────────────────────────────────────────────────┤
│ Application                                                      │
│   EvaluateZone            the reading → the zone                 │
│   ConfirmWeighing         the gate and the record                │
├──────────────────────────────────────────────────────────────────┤
│ Domain                                                           │
│   ToleranceZone           OVER | OK | NEAR | UNDER               │
│   ZoneBounds              the three derived bounds                │
│   StillToWeigh            max(0, target − current)               │
│   ToleranceZoneEvaluator  the pure computation                   │
│   ConfirmationGate        the gate                               │
│   WeighingRecord          the immutable record                   │
│   WeighingRecordRepository  THE PORT                             │
├──────────────────────────────────────────────────────────────────┤
│ Infrastructure                                                   │
│   CompositionRoot              binds the port in ONE place        │
│   SessionDatabase              the weighing-record table         │
│   SqliteWeighingRecordRepository   append-only                   │
└──────────────────────────────────────────────────────────────────┘
```

### API Design

#### `GET /api/session/zone` — the current zone

`200` with the zone, the bounds and the still-to-weigh, or `200` with
`zone: null` when there is no active component or no reading yet.

**The zone is COMPUTED BY THE DOMAIN and returned here.** No consumer — in
particular no screen — computes it independently (FR-9, BRD FR-16, BRD
FR-17). The same computed zone feeds the status line, the live-weight cell
and the progress bar, so they cannot disagree.

#### `POST /api/session/confirm` — confirm the weighing

| Status | Meaning | Body |
|---|---|---|
| **201** | The weighing was confirmed and the record written | `{ record: {...} }` |
| **400** | The body is not a confirmation | `{ error: "VALIDATION_ERROR" }` |
| **401** | No operator session | `{ error: "UNAUTHENTICATED" }` |
| **409** | The zone is not `OK` | `{ error: "CONFIRMATION_REFUSED", zone, reason }` |
| **409** | The scale has gone away | `{ error: "SCALE_UNAVAILABLE" }` |
| **404** | The recipe holds no such component | `{ error: "COMPONENT_NOT_FOUND" }` |

**The reason distinguishes `UNDER`, `NEAR` and `OVER`**, so the UI can show
the right next step — and the story requires it: *"returning a reason that
distinguishes `UNDER`, `NEAR` and `OVER`."*

**And the gate reads the CURRENT zone**, not the zone the operator last
saw. A reading that arrived between the operator seeing `OK` and pressing
confirm changes the answer.

**The body is `{ componentId }`.** There is no `zone` field — the zone is
the domain's, and a client that could assert `OK` could confirm anything.

#### Authentication

**An operator session is required** (ADR-020). A **supervisor is not** — a
confirmation is not a privileged action. The `OVER` exception needs a
supervisor authorisation, but that authorisation is **issued elsewhere**
(bolt `016`) and **consumed** here.

### Data Model

#### `weighing_records` — append-only

| Column | Type | Notes |
|---|---|---|
| `record_id` | `TEXT NOT NULL PRIMARY KEY` | The record's identity |
| `session_id` | `TEXT NOT NULL` | The session it belongs to |
| `component_id` | `TEXT NOT NULL` | The recipe slot |
| `actual_quantity` | `TEXT NOT NULL` | The weighed value — a **decimal string** |
| `unit` | `TEXT NOT NULL` | Its unit |
| `target_at_weighing` | `TEXT NOT NULL` | **Snapshotted** — the target as it was |
| `tolerance_at_weighing` | `TEXT NOT NULL` | **Snapshotted** — the band as it was |
| `zone_at_confirm` | `TEXT NOT NULL CHECK (zone_at_confirm IN ('OVER','OK','NEAR','UNDER'))` | The zone at the moment of confirmation |
| `scale_id` | `TEXT NOT NULL` | The device |
| `scale_class` | `TEXT NOT NULL` | The device's class, **snapshotted** — a later reselection cannot alter it |
| `lot_number` | `TEXT NULL` | The lot, when one was captured |
| `container_id` | `TEXT NULL` | The container, when one was assigned |
| `operator_id` | `TEXT NOT NULL` | Who confirmed it |
| `weighed_at` | `TEXT NOT NULL` | When |
| `recorded_at` | `TEXT NOT NULL` | When the row was written |
| `corrects_record_id` | `TEXT NULL` | The original, when this is a **correction** |

**THE TARGET AND THE TOLERANCE ARE SNAPSHOTTED.** A later revision in
OrgaTEX must not alter a historical record (BRD FR-25, BRD BR-14). So the
record carries the values **as they were at weighing time**, not a
reference to a live recipe.

**AND THE SCALE'S CLASS IS SNAPSHOTTED TOO.** A later reselection or a
calibration change cannot rewrite what the weighing was measured on.

**`BEFORE UPDATE` and `BEFORE DELETE` triggers that `RAISE(ABORT, ...)`.**
A record describes something that physically happened, and BRD DR-02 forbids
revising it. The repository has no update path, and the database makes that
true against everyone (ADR-034's rule, applied to the record).

**`corrects_record_id` is the correction's link.** The original is
untouched — the correction is a **new row** (C-12).

### The zone engine — pure, and computed once per component

`ToleranceZoneEvaluator` is a **pure function**:

```text
evaluate(value, target, tolerance) → zone
```

It has no state, no persistence, no external contract and no failure mode
of its own — which is exactly why it is a **value object inside this unit**
and not a separate unit. Extracting it would put a network hop between the
scale and the confirmation button, and NFR-01 budgets 200 ms for the whole
path.

**The bounds are computed ONCE, when the component is selected.** `ZoneBounds`
holds:

- `nearThreshold` = `target × 0.9`
- `okLower` = `target − tolerance`
- `okUpper` = `target + tolerance`

and the evaluation compares the value against **those three numbers**. So
every reading is compared against the same bounds — not against a fresh
multiplication that might round differently on a different call.

**`target × 0.9` is computed with `decimal.js`**, half-up, at the storage
precision. `94.0000 × 0.9 = 84.6000` exactly — and in IEEE-754 it is
`84.60000000000001`, which would put the boundary reading on the wrong side
of the `NEAR` bound.

**The evaluation order is the story's**, and the first matching rule wins:

```text
OVER   if  value >  okUpper
OK     if  value >= okLower
NEAR   if  value >= nearThreshold
UNDER  otherwise
```

### The confirmation gate

The gate is a **domain service**, and it is the **only** path to a
`WeighingRecord` (invariant 3).

Its order is:

1. **Is there an active component?** — no → refuse.
2. **Is there a current weight?** — no → refuse.
3. **Is the scale still weighing?** — no → refuse (BRD IR-13).
4. **Is the current zone `OK`?** — no → refuse, with the zone and the
   reason.
5. **Has this component already been confirmed in this session?** — yes →
   **idempotent**: return the existing record, write nothing.
6. **Otherwise**: write the record.

**Step 5 is the idempotence**, and the story requires it: *"the confirmation
request is replayed (duplicate submit) → the second attempt does not write a
second record; confirmation is idempotent per component in a session."*

**And the gate reads the CURRENT zone**, recomputed from the current weight
against the active component's bounds — not a zone cached from the last
reading. A reading that arrived between the operator seeing `OK` and
pressing confirm changes the answer.

### Security Design

| Concern | Approach |
|---|---|
| **Session** | Required (ADR-020). The operator comes from `req.currentOperator` — never from the body. |
| **A client-supplied zone** | There is **no** `zone` field in the confirmation body. A client that could assert `OK` could confirm anything. |
| **A client-supplied quantity** | There is **no** `actualQuantity` field. The actual quantity is the **session's** current weight — the device's reading. |
| **A client-supplied target or tolerance** | There is **no** field for either. They are the **recipe's** facts (unit `002`), read through the working copy. |
| **The override** | The `OVER` exception requires an authorisation issued elsewhere (bolt `016`), and this bolt **consumes** it — it does not create one. A client cannot assert one. |
| **Immutability** | Append-only, with the triggers. |
| **Diagnostics leaking** | The refusal body carries the **zone** and a **reason code** — no prose. |

### NFR Implementation

| Requirement | Design approach |
|---|---|
| **NFR-16 / C-11 — fixed-point, never float** | The zone's arithmetic is `decimal.js`, half-up, at the storage precision. The stored quantities are **strings**. |
| **NFR-1 / AC-03 — ≤ 200 ms lag** | The zone is computed **in-process**, on each reading. No network hop. |
| **BRD FR-25 / BR-14 — the history is immutable** | The target, the tolerance and the scale's class are **snapshotted** onto the record. |
| **BRD DR-02 / C-12 — no revision** | Append-only, with the triggers; a correction is a **new row**. |
| **BRD DR-01 — retained ≥ 5 years** | No pruning path. |
| **BRD AC-04 — out-of-tolerance weighings never reach production** | The gate is in the **domain**, not in a disabled button. |

### Integration Plan

**Bound in the composition root, and nowhere else:**

```text
src/api/server.ts
  └── buildWeighingStationModule({
        workingCopy: recipes.workingCopy,   // unit 002's
        selection: new ScaleSelectionAdapter(scales.registry),
        sessions: ...,
        records: new SqliteWeighingRecordRepository(...),
        overrides: <bolt 016's authorisation service>,   // later
      })
```

**What this bolt adds to unit `002`: nothing.** It reads the target and the
tolerance through the working copy.

**What this bolt adds to unit `004`: nothing.** The weight is the session's,
which came from the device.

**What this bolt adds to the API surface:** two paths,
`/api/session/zone` and `/api/session/confirm`.

### Testing Plan

| Suite | What it proves |
|---|---|
| **Unit — the evaluator** | The **exhaustive boundary suite**: every bound exactly, and one ULP either side of each. |
| **Unit — the zero cases** | A zero target and a zero tolerance, exactly as the story names them. |
| **Unit — the gate** | `UNDER`, `NEAR` and `OVER` are all refused; `OK` is accepted; the reason distinguishes the three; the current zone is read, not a cached one; a replay is idempotent. |
| **Unit — the still-to-weigh** | `max(0, target − current)`, and never negative. |
| **Integration — the endpoints** | The zone is `200`; the confirmation is `201`; the refusal is a `409` carrying the zone; a `401` without a session. |
| **Persistence** | The record round-trips; the triggers abort an update and a delete; the closed-set `CHECK` refuses a fifth zone; the correction link is nullable. |
| **Security** | No session → `401`; no client-supplied zone, quantity, target or tolerance; the diagnostics never leak. |

### Open points carried forward

1. **The `OVER` exception** — bolt `016`. This bolt's gate refuses `OVER`
   unconditionally; the override path plugs in when bolt `016` lands.
2. **The progression** — bolt `017`. The gate writes the record; the
   progression advances the component.
3. **The abandonment** — the story's edge case: *"the operator abandons an
   in-progress component → no record is written; the component returns to
   `PENDING`; the weight resets to zero."* That is a session transition,
   and it is bolt `017`'s.
