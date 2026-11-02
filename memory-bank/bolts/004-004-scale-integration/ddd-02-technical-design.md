---
unit: 004-scale-integration
bolt: 004-004-scale-integration
stage: design
status: complete
updated: 2026-10-31T02:15:00Z
---

# Technical Design - Scale Integration (Bolt 004: Tare and Scale Selection)

## Architecture Pattern

**Unchanged from bolt `003`: Hexagonal (Ports and Adapters), with the
domain in the middle and every external dependency behind a port.**

This bolt does **not** introduce a new pattern, a new layer, or a new
context. It adds two capabilities to the existing unit, and the
architecture is deliberately the one already proven — because the cost of
a second architectural style inside one bounded context is paid by every
reader afterwards, and there is nothing here that needs one.

The specific inheritance from bolt `003`:

- The **domain layer** stays free of Express, SQLite, `node:sqlite`,
  timers and the environment. Every rule in this bolt is a **pure
  function** or a **single chokepoint**.
- The **ports** are the seams. Bolt `003` established `ScaleAdapter`; this
  bolt **extends** that one port rather than adding a second one, because a
  tare and a reading come from the same device and splitting them across
  two ports would let them disagree about which device they belong to.
- The **registry** remains the hub — the only thing that mutates a device.
- The **no-floating-point** rule is enforced by the type system, exactly as
  bolt `003` established it.

### What is added, and where

| Capability | Layer | New artefact | Extends |
|---|---|---|---|
| Tare | Domain | `TareState`, `TareSource`, `TareMechanism`, `TareApplication` | `ScaleDevice` aggregate |
| Tare | Domain | `TarePolicy` (pure) | — |
| Scale selection | Domain | `ScaleSelection`, `ScaleSelectionOutcome`, `ScaleSelectionReason`, `ScaleClass`, `ComponentId` | — |
| Scale selection | Domain | `ScaleSelectionRule` (pure) | — |
| Unit conversion | Domain | `WeightUnitConverter` (pure) | — |
| Tare + selection | Ports | `ScaleAdapter` gains `applyTare`; readings become tare-aware | `ScaleAdapter` |
| Tare | Infrastructure | `DummyScaleAdapter` applies the tare | — |
| Both | Presentation | 3 endpoints | `ScaleController` |

**No new tables. No new repositories. No new database file.** Both
capabilities are in-memory, and bolt `003`'s ADR-009 established the
reasoning: a stale tare read back after a restart is a **wrong number**,
not an inconvenience.

---

## Layer Structure

```text
┌──────────────────────────────────────────────────────────┐
│  Presentation                                           │
│    scale-controller.ts      — tare, selection endpoints  │
│    weight-stream-controller.ts  — unchanged (bolt 003)   │
├──────────────────────────────────────────────────────────┤
│  Application                                            │
│    (none — the unit has no use-case layer; the domain   │
│     services ARE the use cases, matching bolt 003)       │
├──────────────────────────────────────────────────────────┤
│  Domain                                                 │
│    services/scale-selection-rule.ts   — PURE             │
│    services/tare-policy.ts            — PURE             │
│    services/weight-unit-converter.ts  — PURE             │
│    services/scale-registry.ts         — extended         │
│    entities/scale-device.ts           — extended         │
│    entities/tare-state.ts             — NEW              │
│    entities/scale-selection.ts        — NEW              │
│    value-objects/{tare-source,tare-mechanism,           │
│      scale-class,component-id}.ts      — NEW              │
│    ports/scale-adapter.ts             — extended         │
├──────────────────────────────────────────────────────────┤
│  Infrastructure                                         │
│    adapters/dummy-scale-adapter.ts    — extended         │
│    composition-root.ts                — extended         │
│    persistence/*                      — UNCHANGED        │
└──────────────────────────────────────────────────────────┘
```

**Why there is still no application layer.** Bolt `003` had none, and its
`ScaleRegistry` already plays that role: it is the orchestrator that
coordinates the domain services, the ports and the clock. Adding a
use-case layer now would introduce a third place where a reading or a
tare could be applied — which is precisely what the registry exists to
prevent.

---

## API Design

All quantities are **decimal strings** on every boundary (ADR-008). A JSON
number is rejected at the boundary, not silently accepted and rounded.

| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| `/api/scales/:scaleId/tare` | GET | — | `{ scaleId, tare: { value, unit, appliedAt, source, appliedBy } \| null }` |
| `/api/scales/:scaleId/tare` | POST | `{ tareValue: string, unit: string, source: "CONTAINER_MASTER" \| "WEIGHED_EMPTY_CONTAINER" }` | `202` `{ tare: { value, unit, appliedAt, source, appliedBy } }` |
| `/api/scales/select` | POST | `{ componentId: string, target: string, unit: string, demandedClass: "PRECISION" \| "FLOOR" }` | `200` `{ selected: true, scaleId, componentId, selectedAt, reason, scaleClass, capacity, unit }` or `{ selected: false, target, maximumCapacity, unit, demandedClass }` |

### The three endpoints, in detail

**`GET /api/scales/:scaleId/tare`** — the tare in force, or `null`.

The `null` is meaningful: "no tare is in force" is a different fact from
"a tare of exactly zero" (S-12). The response shape mirrors the domain's
discriminated union rather than flattening it.

**`POST /api/scales/:scaleId/tare`** — apply a tare.

- **202** — accepted. The tare is applied and the device's state reflects
  it from the next reading onward.
- **409** — refused. The body names the reason and **states that the
  previous tare remains in force** (S-14). A refusal must never leave the
  caller guessing whether the zero reference moved.
- **401** — no operator session. The tare **changes device state**, so it
  is session-guarded under ADR-013.
- **404** — unknown scale.
- **400** — malformed body.

**`POST /api/scales/select`** — the automatic selection rule.

- **200** — with **either** outcome. The selection succeeded, or no device
  can weigh this target. **Neither is an error** — a target of 40 kg on a
  32 kg floor scale is a legitimate answer to a legitimate question, and
  returning 4xx would make the caller treat a normal business outcome as
  a failure.
- **400** — malformed body.
- **401** — no operator session.

### Why the selection endpoint is session-guarded but the tare is too

Both change state, and ADR-013 established the rule: **the write
endpoints that change device state are session-guarded; the read
endpoints are not.** The selection is a *decision about the station's
state*, and the tare *moves the device's zero reference*. Both are
writes.

Neither requires a **supervisor**: a tare and an automatic selection
authorise nothing. A supervisor-authorised *manual reselection* is a
different operation entirely and belongs to unit `003` / `006` (FR-08,
FR-35) — it is explicitly out of this bolt's scope.

---

## Data Persistence

| Table | Columns | Relationships |
|-------|---------|---------------|
| — | — | — |

**NO NEW TABLES, AND NO CHANGES TO THE EXISTING TWO.**

This is the design, not an omission:

| What | Where it lives | Why |
|---|---|---|
| `TareState` | **In memory, per device** | A stale tare read back after a restart would be a **wrong number** — the operator would see a quantity that excludes a container's weight the device is no longer zeroed against (S-15). |
| `ScaleSelection` | **Nowhere — it is a decision unit `003` consumes** | It becomes durable when unit `003` snapshots it onto the **weighing record**, which is where a selection belongs. A selection table in the scale unit would be a second source of truth for the same fact. |
| The device registry | SQLite `scale_devices` | Unchanged. The tare is **not** a column — it is deliberately not persisted. |

The `scale_devices` table therefore keeps exactly its bolt `003` columns:
`id`, `label`, `class`, `capacity`, `resolution`, `unit`,
`calibration_state`, `calibration_expires_at`. **No migration is
required for this bolt.**

---

## Security Design

| Concern | Approach |
|---------|----------|
| **Authentication** | The two write endpoints require an operator session (ADR-013). The bearer token is read from the `Authorization` header, never a query parameter. The session is resolved by the identity unit's existing `resolveCurrentOperator` middleware — this bolt adds no authentication of its own. |
| **Authorization** | An operator session is sufficient; a **supervisor is not required**, because a tare and an automatic selection authorise nothing. The supervisor-authorised *manual reselection* is out of scope (FR-08, FR-35 → unit `003`/`006`). |
| **Input validation** | Zod at every boundary. `tareValue` and `target` are decimal **strings**, validated as decimal strings and converted through `WeightValue`. A JSON number is rejected at the boundary. The `source` and `demandedClass` are closed enums. `componentId` is length-bounded. |
| **Unit injection** | The request body's `unit` is **not** trusted to match the device's. The tare is converted into the **device's own unit** before it is applied, and the conversion is exact (BRD NFR-16). A request claiming `unit: "kg"` against a gram-reporting device is converted, not obeyed. |
| **Data exposure** | The tare endpoint returns the tare value, unit, time, source and mechanism. It contains no credentials, no operator identities and no operator-supplied free text. The selection endpoint returns the decision and its reason. |
| **Denial of service** | The selection rule is **pure and bounded** — it runs over the registered devices (two). A caller cannot make it expensive. The tare endpoint applies one tare to one device. Neither endpoint can be used to grow the server's memory. |
| **Mass assignment** | The request body carries only `tareValue`, `unit` and `source` for a tare; only `componentId`, `target`, `unit` and `demandedClass` for a selection. `appliedAt` is **never** taken from the client — it is stamped by the server, because a client-supplied timestamp would let a caller forge the tare's history. |
| **Uniform refusal** | The refusal vocabulary here is the **device's state** vocabulary, not the identity unit's. As bolt `003` established: ADR-004 protects a secret (a supervisor's credential); a scale's state is visible at the station and the story requires the reason to be **named**. |

---

## NFR Implementation

| Requirement | Design Approach |
|-------------|-----------------|
| **NFR-02 / BRD NFR-16 — no floating point** | `WeightValue`'s constructor accepts a **string** and nothing else (bolt `003`, S-2). The new arithmetic — unit conversion, tare subtraction, capacity comparison — goes through `decimal.js`, and its output is a string fed back into `WeightValue`. The selection rule compares `WeightValue`s, which are compared as exact scaled integers. **No `number` enters any quantity path.** |
| **NFR-01 — ≤ 200 ms end-to-end lag** | Unaffected. The tare and the selection are **not on the hot path** — they happen once per component, not ten times a second. The reading stream's 100 ms sampling and push-based transport are unchanged. |
| **IR-10 — ≥ 10 readings per second** | Unaffected. The tare is applied **at the device**, so the adapter's sampling rate does not change. The tare is subtracted from each sample as it is produced, which is one exact decimal subtraction per sample — microseconds. |
| **BRD NFR-14 — configuration, not hard-coded values** | The selection rule is written against a **set of devices** and a **threshold that is configuration** (S-20). `Q-04` is unanswered, so the threshold is **unset** — and the rule works fully without it, because the capacity constraint alone decides every case the story names. When FCI answers, the configuration changes; the rule does not. |
| **NFR-03 — weighing continues during an outage** | A disconnected scale refuses a **tare** for the same reason it refuses a weighing, and says so. The **other** scale is unaffected: both devices may be connected concurrently (BRD IR-14, S-16), and selecting one does not touch the other. |
| **NFR-05 — survives power loss** | The tare is lost on restart, and that is **correct**: tare is a property of the current session. The device is re-zeroed by the operator's next tare. Nothing is corrupted; there is no half-written state, because there is no persisted tare. |
| **Scalability** | Two devices. The selection rule is O(devices) with two devices. The tare is O(1). The design does not preclude more devices — each has its own tare and its own capability — but nothing here is tuned for a scale farm. |
| **Observability** | `TareApplied`, `TareRefused`, `ScaleSelected` and `ScaleSelectionRefused` are domain events. A tare refusal and a "no device can weigh this" are the two events an operator would need to diagnose a stalled station, and both are emitted. |

---

## Error Handling

| Error type | Code | Response |
|------------|------|----------|
| **Unknown scale** | 404 | `{ "error": "SCALE_NOT_FOUND" }` — bolt `003`'s existing shape |
| **Malformed path or body** | 400 | `{ "error": "VALIDATION_ERROR", "fields": [...] }` — bolt `003`'s existing shape |
| **No operator session, on a write endpoint** | 401 | `{ "error": "UNAUTHENTICATED" }` — the identity unit's existing code |
| **Tare refused — device disconnected, busy, over capacity, or out of calibration** | **409** | `{ "error": "TARE_REFUSED", "reason": "SCALE_DISCONNECTED", "previousTareRetained": true }` — **the reason is named** (the story requires it), and the body states that the previous tare is still in force (S-14). |
| **No device can weigh the target** | **200** | `{ "selected": false, "target": "40000", "maximumCapacity": "32000", "unit": "g", "demandedClass": "FLOOR" }` — **not an error.** The story requires an *explicit outcome* carrying the target and the maximum capacity; a 4xx would make the caller treat a legitimate business outcome as a failure. |
| **Internal error** | 500 | `{ "error": "INTERNAL_ERROR" }` — the detail goes to the log, never to the client. Matches the identity unit's handler and bolt `003`'s handler. |

### Why 409 for a refused tare, but 200 for a refused selection

The two refusals are different in kind.

A **tare refusal** is an attempt to change device state that could not be
performed. The device's state is now in question: did the zero reference
move, or not? The body answers that explicitly (`previousTareRetained:
true`), because a caller that assumed the tare had been applied would
record a quantity against a device that is not zeroed against that
container.

A **selection refusal** changes **nothing**. No device was touched. The
answer to "which scale?" is "none of them, and here is why" — which is
the outcome the story defines, not a failure of the request.

---

## Internal Design

### The tare is applied at the device, once

The central design decision of this bolt.

```text
   POST /tare
       │
       ▼
  ScaleRegistry.applyTare
       │  1. the gate (ScaleHealthPolicy) says may this device be weighed on?
       │  2. TarePolicy evaluates the refusal
       │  3. adapter.applyTare(...)  ◀── the ONE place a tare reaches a device
       │  4. device.applyTare(state) ◀── the ONE place the tare state changes
       ▼
  DummyScaleAdapter applies the tare to its gross reading
       │
       ▼
  every subsequent reading already reflects the tare
```

**Why at the device and not in the consumer.** The tare is applied *once*
and *persists* into every subsequent reading. If a consumer subtracted it
from its own copy of the reading, it would have to know whether the device
had already done so — and it would be wrong whenever a second consumer
attached mid-session. Applying it at the device means **every** consumer
sees the same net reading, and none of them has to know whether the
indicator or the software did it.

The `TareMechanism` field records which, without any consumer needing to
act on it. That is exactly what BRD IR-12 asks for: the recorded source
states that the tare was applied in software.

### The tare-aware reading

`ScaleReading` gains one field: the tare that was in force when the
reading was produced. The reading's `value` is the **net** value — the
gross reading minus the tare.

This is a **breaking change to the reading's shape**, and it is the
correct one. Bolt `003`'s reading was the gross value because there was
no tare. Making the reading carry its tare means:

- A consumer can always answer "what was this reading net of?".
- The tare is visible in the evidence — the stream shows the tare that
  produced each reading, so a recording of the session is reconstructible.
- The tare cannot be applied twice by accident: the reading's value is
  already net, and there is nothing left to subtract.

### The software tare, and where the subtraction happens

The Dummy adapter has **no tare command** — it is a training device with
no protocol (`Q-03`). So the tare is applied **in software**, at the
adapter, which is the single place a software tare is subtracted.

```text
gross reading ──▶ subtract tare (decimal.js, exact) ──▶ net reading
```

The subtraction is **clamped at zero**. A gross reading below the tare
would otherwise produce a negative net weight, and a negative dispensed
quantity is not a thing. The clamp is a physical fact: you cannot dispense
a negative amount. The tare itself is unaffected — it is the *net reading*
that floors at zero.

### The selection rule, and the configuration it reads

```text
ScaleSelectionRule.select(target, demandedClass, devices)
  │
  ├─ 1. convert the target into the unit the capacities are expressed in
  │      (24 kg → 24000 g; exact, BRD NFR-16)
  │
  ├─ 2. candidates = devices whose capacity >= target
  │      (INCLUSIVE: exactly 3 kg fits the 3 kg scale)
  │
  ├─ 3. no candidates ──▶ NO_DEVICE_CAN_WEIGH
  │                       { target, maximumCapacity, demandedClass }
  │
  ├─ 4. exactly one candidate ──▶ SELECTED
  │      reason = CAPACITY_AND_CLASS if the class agrees, else CAPACITY_ONLY
  │
  ├─ 5. several candidates ──▶ prefer the one whose class matches
  │      no class match ──▶ capacity wins; the smallest-capacity candidate
  │                          is selected and the reason records the conflict
  │
  └─ 6. target == 0 ──▶ the smallest-capability device that satisfies
         the class; reason = TARGET_ZERO
```

**The rule reads a SET of devices, not two hard-coded scales.** That is
what lets `Q-04` be answered by configuration: the threshold slot exists
and is unset, and the devices come from the registry.

**Why the threshold is unset and the rule still works.** Every case the
story names is decided by the capacity constraint: a target within 3 kg
and class-demanding precision → the precision scale; beyond 3 kg → the
floor scale. The story pins the boundary itself ("is within the
precision scale's capacity"). So the capacity constraint *is* the rule as
specified, and the threshold is a configuration parameter that FCI may
later set to something the capacity constraint cannot express — at which
point the rule's shape is already right.

### Why the selection does not bind the session

The story says: *"The scale-selection decision is consumed by unit `003`,
which acts on it. This story provides the decision inputs and the outcome;
it does not run a weighing."*

So this bolt does **not** reset the weight, does **not** move the session
to `WEIGHING`, and does **not** bind the component to the device. Those
are unit `003`'s, and this unit has no access to them. What it provides is
the **decision** and its **record**.

This is the same boundary as I-3: the re-tare's dispense reset is
orchestrated by the caller that owns both — the weighing station — not
performed inside this unit.

### The selection is a decision, not a connection switch

Both devices may be connected concurrently (BRD IR-14). Selecting the
floor scale does **not** disconnect the precision scale, and it does not
change either device's status.

The `ScaleSelected` event therefore carries the **decision's own fields**,
not a device delta. This is why it is an event about a decision rather
than about the device — and it is why no `ScaleStatusChanged` event is
emitted when a selection happens.

---

## Deviations from the approved tech stack

Recorded explicitly, as bolt `003` did.

| # | Deviation | Reason |
|---|-----------|--------|
| 1 | **`decimal.js` is used for tare subtraction and unit conversion** — a second use beyond bolt `003`'s ramp | The tech stack names `decimal.js` for "fixed-point decimal arithmetic" and explicitly cites "tare subtraction" as one of the domain's exact decimal rules. This is the stack being followed, not departed from. |
| 2 | **No new persistence table for the tare or the selection** | The tech stack's "Data Storage" table for this unit says *"Tare state — In memory, per device — One per device — —"*. The design follows it exactly. The *selection* has no storage row because it is a decision unit `003` consumes and records on the weighing record. |
| 3 | **The selection endpoint returns 200 for "no device can weigh this"** | The tech stack does not specify error semantics for it. The story specifies an *explicit outcome*, and the bolt `003` precedent is that a device state is a question with an answer, not a failure. |
| 4 | **The tare refusal returns 409 with a named reason** | A refused write is conventionally 409. The naming of the reason is required by the story, and — as bolt `003` established — a device's state is not a secret, so ADR-004's uniform-refusal rule does not apply. |

**No deviation is introduced by the tech stack's own SSE example.** The
stack's example frame is `data: {"weight":93.42,...}` — a JSON number.
ADR-008 already recorded that this example is wrong and superseded it: the
value crosses the wire as a decimal **string**. Bolt `003` implemented that
and this bolt does the same for the tare value and the selection's
quantities.

---

## External Dependencies

| Service | Purpose | Integration |
|---------|---------|-------------|
| **Scale indicators** | The weight, and the tare command | Through the `ScaleAdapter` port. **Protocol unconfirmed (`Q-03`)** — the port is the whole contract. The training device has no tare command, so the tare is applied in software; a real adapter that supports one would issue the command and report `TareMechanism.INDICATOR`. |
| **Identity unit** | The operator session on the write endpoints | The existing `resolveCurrentOperator` middleware. No new call, no new contract. |
| **Unit `002-recipe-material-management`** | The container's tare value and the component's target and class | **Not called by this bolt.** The values arrive on the request body from the caller that owns them. This unit's interface takes a tare value and a target and does not care how they were obtained (`Q-10`). |
| **Unit `003-weighing-station`** | Consumes the selection; orchestrates the re-tare's dispense reset | **Not called by this bolt.** The selection is returned to the caller; the orchestration belongs to unit `003`. |

---

## Story Criterion Coverage

### Story `003-tare-scale-against-container`

| # | Acceptance criterion | Design | Test |
|---|----------------------|--------|------|
| 1 | The `TareState` records the value, its unit, the time it was applied, and its source | `TareState` entity — four fields; `TareSource` enum | `scale-tare.test.ts` — unit |
| 2 | The next reading reflects the tare — the dispensed quantity excludes the container's weight | The tare is applied at the adapter; the reading's value is **net**; the reading carries the tare that produced it (S-11) | `scale-tare.test.ts` — integration |
| 3 | Where the indicator has no tare command, the tare is applied in software and the recorded source states so | `TareMechanism.SOFTWARE`; the Dummy adapter has no tare command, so the tare is subtracted in software and the mechanism says so (BRD IR-12, BRD FR-19) | `scale-tare.test.ts` — unit |
| 4 | A re-tare replaces the previous tare and resets the dispense | `ScaleDevice.applyTare` **replaces** the state; the **dispense reset belongs to unit `003`** (I-3) — this bolt provides the operation and the device-side state | `scale-tare.test.ts` — unit |
| 5 | The applied value, its unit and its source are available for display | `GET /api/scales/:scaleId/tare` returns the whole `TareState` | `scale-tare-api.test.ts` — integration |

### Story `004-select-scale-by-capacity`

| # | Acceptance criterion | Design | Test |
|---|----------------------|--------|------|
| 1 | A device is selected automatically and no operator input is requested or required | `ScaleSelectionRule` — pure, no input, no prompting (S-17); FR-7, BRD BR-05, AC-02 | `scale-selection.test.ts` — unit |
| 2 | A target within the precision scale's 3 kg, class demanding precision → the 3 kg precision scale | Rule step 4; the inclusive capacity boundary; the class agrees → `CAPACITY_AND_CLASS` | `scale-selection.test.ts` — unit |
| 3 | A target exceeding the precision capacity but within the floor scale's 32 kg → the 32 kg floor scale | Rule step 4; only the floor scale is a candidate | `scale-selection.test.ts` — unit |
| 4 | A target exceeding the floor scale's capacity → an explicit "no device can weigh this" with the target and the maximum capacity; no device selected and no value guessed | Rule step 3 → `ScaleSelectionOutcome.NO_DEVICE_CAN_WEIGH` (S-19) | `scale-selection.test.ts` — unit |
| 5 | The selection records the scale id, the component id, the time of selection and the reason | `ScaleSelection` — all four fields | `scale-selection.test.ts` — unit |
| 6 | The scale's class and its maximum capacity are available for display | `ScaleSelection.scaleClass`, `ScaleSelection.capacity` — snapshotted onto the selection | `scale-selection-api.test.ts` — integration |

---

## Forward-Looking Notes

**For unit `003-weighing-station` (the consumer):**

- The selection is a **decision**, not a binding. Unit `003` binds the
  session to the selected device and resets the weight.
- The re-tare's dispense reset is **unit `003`'s** to orchestrate: apply the
  tare through this unit, then reset the session. This unit does not reach
  into the session (I-3).
- `ScaleSelection.capacity` is the **device's** capacity (3000 g, 32000 g).
  It is **not** the prototype's `max` field, which is the *component's*
  progress-bar maximum (125 g for a 94 g dyestuff). The two are different
  facts and the UI needs both.

**For the `Q-04` answer:** the threshold slot exists in
`ScaleSelectionRule` and is unset. Configuring it is a one-line change in
the composition root — no domain change.

**For `Q-03`:** a real adapter that supports a tare command would issue it
to the device and return `TareMechanism.INDICATOR`. The reading's shape
does not change: it is net either way.
