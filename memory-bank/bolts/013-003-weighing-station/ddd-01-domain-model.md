---
stage: model
bolt: 013-003-weighing-station
created: 2026-11-06T02:35:00Z
---

## Static Model: 003-weighing-station (bolt 013)

### Entities

- **WeighingSession**: the state machine of one operator's work on one
  batch — `batchId`, `sessionId`, `state`, `activeComponentId?`,
  `selectedScaleId?`, `currentWeight?`, `weightUnit?`, `weightStable?`,
  `componentStates`.

  It is the **product's pivot**. The unit brief calls it *"the pivot of
  the whole product"*, and that is literally true: the session is the only
  thing that knows which component is being weighed, on which scale, and
  what the scale last said.

- **ComponentProgress**: one component's state within the session —
  `componentId`, `state` (`PENDING` \| `ACTIVE` \| `DONE`).

  It is **unit `002`'s** state, held here as the session's view of it. The
  two are not two copies: unit `002` owns the component's *facts* (target,
  tolerance, class), and this unit owns the *progression* through them.

### Value Objects

| Value object | Shape | Rules |
|---|---|---|
| **SessionState** | `AWAITING_BATCH` \| `AWAITING_COMPONENT` \| `WEIGHING` \| `COMPENSATING` \| `ESCALATED` \| `CONFIRMING` \| `COMPLETE` | The unit brief's state machine, exactly. A **closed set**, and the closure is the point: every state has a defined meaning, a defined next transition, and a defined set of legal actions. `COMPENSATING` and `ESCALATED` are in the set even though bolts `015`–`018` build them — the machine is described whole, and the transitions into them are already reserved. |
| **WeightReading** (unit `004`'s) | `value`, `unit`, `stable`, `sequence`, `receivedAt`, `tare?` | **Reused, not redefined.** Unit `004`'s `ScaleReading` is already exactly this — and it already carries the tare that produced it, so there is nothing left for a consumer to subtract (ADR-014). |
| **StillToWeigh** | a `WeightValue` | `max(0, target − current)`, computed in **fixed-point** arithmetic, and the clamp is applied **in the domain**, not in the renderer. |
| **ScaleId** (unit `004`'s) | a bounded identifier | **Reused, not redefined.** The device is unit `004`'s. |
| **ComponentId** (unit `002`'s) | a bounded identifier | **Reused, not redefined.** |

### Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **WeighingSession** | the state, the active component, the selected scale, the current weight, the component states | 1. **Exactly one** component is `ACTIVE` at a time. 2. **`DONE` is terminal** — a completed component cannot be re-selected or re-weighed (BRD DR-02, C-08). 3. **Selecting a component resets the weight to zero.** 4. The session is in `WEIGHING` **only** when a scale is selected and a component is active. 5. The current weight's unit is the **component's** unit, or the weight is absent. 6. A reading for a scale that is **not** the selected scale is discarded. 7. The state machine has **no other path** into `CONFIRMING`. |

### The seven invariants, and where each is enforced

The unit brief lists seven invariants of the session machine. This bolt
enforces **four** of them, because the other three belong to later bolts:

| # | Invariant | This bolt |
|---|---|---|
| 1 | Exactly one component is `ACTIVE` at a time | ✅ enforced |
| 2 | `DONE` is terminal | ✅ enforced |
| 3 | Confirmation is impossible unless the zone is `OK` | ⏳ bolt `014` |
| 4 | Confirming advances to the first `PENDING` component | ⏳ bolt `017` |
| 5 | A confirmed `WeighingRecord` is immutable | ⏳ bolt `017` |
| 6 | **Selecting a component resets the weight to zero** | ✅ enforced |
| 7 | A session is resumable at the component in progress | ⏳ bolt `017` |

**The boundaries are stated so that neither bolt reaches into the other's
state.** This bolt owns the selection and the stream; bolts `014`–`018` own
the zone, the confirmation, the compensation and the progression.

### Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **ComponentSelected** | A component became active and a scale was bound | `componentId`, `scaleId`, `at` |
| **ScaleBound** | The rule resolved a scale for the active component | `componentId`, `scaleId`, `scaleClass`, `capacity` |
| **NoScaleAvailable** | The rule could not resolve a scale | `componentId`, `target`, `maximumCapacity`, `demandedClass` — the reason is **data**, not prose |
| **WeightUpdated** | A reading was accepted | `value`, `unit`, `stable`, `at` |
| **WeightRejected** | A reading was discarded | `reason` — out of order, wrong scale, wrong unit, or not weighing |
| **ScaleLost** | The selected scale disconnected | `scaleId`, `at` |

### Domain Services

- **ScaleBinder**: binds the session to the scale the rule chose.

  It calls unit `004`'s `ScaleSelectionRule` — which is **already built**
  and already returns a discriminated union (`SELECTED` or
  `NO_DEVICE_CAN_WEIGH`, ADR-018) — and it **consults the weighing gate**
  for the chosen device, so a scale with expired calibration is refused
  (BRD FR-12, BRD BR-24, AC-14).

  **And the rule's threshold is CONFIGURATION** (BRD NFR-14). `Q-04` is
  unanswered, so the threshold is `null` until FCI answers it, and the rule
  works fully without it — the capacity constraint alone decides every case
  the story names. So this bolt does not hard-code a number.

- **WeightReader**: the reading path — accept, update, or discard.

  The rules are short and each is a **different fact**:

  | The reading | What happens |
  |---|---|
  | A lower `sequence` than the last accepted | **Discarded** — out of order |
  | For a scale that is not the selected scale | **Discarded** — a late reading cannot corrupt the active component |
  | In a unit that does not match the component's | **Discarded** — invalid; the previous valid weight is retained |
  | While the session is not `WEIGHING` | **Discarded** — no component state is affected |
  | `stable = false` | **Accepted and displayed**, with the settling distinction **surfaced** (BRD IR-11) |

### Repository Interfaces

| Repository | Entity | Methods | Persisted? |
|---|---|---|---|
| **ScaleSelectionPort** | — (a read) | `select(target, demandedClass): Promise<ScaleSelectionOutcome>` | **No.** It is a **port** over unit `004`'s rule. |
| **WeighingSessionRepository** | `WeighingSession` | `save(session)`, `current()` | **Yes** |

**The session IS persisted** — unlike the recipe, and for the same reason
ADR-034 gave: a session is the station's own state, it cannot be
re-derived, and it must survive a restart (NFR-06 — *"a session is
resumable at the component in progress after an interruption"*).

But the session is **mutable** — it changes as the operator works — and it
is **not** a record of a completed act. So it is the **reference** kind of
data: the current state of the work, updated in place.

**And the completed weighing is a DIFFERENT thing** — the `WeighingRecord`,
which is immutable (invariant 5) and belongs to bolt `017`. So this unit
has **two** kinds of persistence, and the distinction is the same one ADR-035
drew for the container: **the live state is maintained; the record of a
completed act is not.**

### Ubiquitous Language

- **Session** — one operator's work on one batch.
- **Active component** — the component being dispensed. Exactly one.
- **Selected scale** — the device the session is bound to.
- **Current weight** — the last accepted reading, net of the tare.
- **Still to weigh** — `max(0, target − current)`. Never negative.
- **Settling** — the device has spoken but the weight is not yet stable.
  Surfaced, not collapsed (BRD IR-11).
- **No device can weigh this** — the rule's explicit answer. A successful
  answer to a well-formed question, not an error (ADR-018).

---

## Constraints carried into the Technical Design

1. **The operator never chooses the scale.** The selection is a **rule**
   evaluated by the domain, and the threshold is **configuration** (BRD
   NFR-14). Manual reselection is a privileged action and belongs to
   bolt `016`/`017`.
2. **Every quantity is a fixed-point decimal.** No float appears in the
   payload, in the arithmetic, or in the UI (BRD NFR-16, C-11).
3. **The still-to-weigh clamp is in the DOMAIN**, not in the renderer.
4. **A reading for a scale that is not the selected scale is discarded** —
   a late reading cannot corrupt the active component's state.
5. **A reading with the wrong unit is rejected**, and the previous valid
   weight is **retained** — not zeroed.
6. **`stable = false` is surfaced, not collapsed.** The operator sees that
   the weight is still settling (BRD IR-11).
7. **A `DONE` component is terminal.** Selecting it is refused.
8. **Selecting a component resets the weight to zero.**
9. **A disconnected scale blocks weighing within 2 s** (BRD IR-13), and the
   last known weight is **retained for display and marked stale**.
10. **No prose crosses the boundary** — codes and data only.

---

## The edge cases, answered

| Scenario | Where it is answered |
|----------|----------------------|
| The target is exactly at the selection threshold | The rule's tie-break is **one defined function**, not per-call-site logic — unit `004`'s rule, reused as is |
| The target exceeds every available scale's capacity | `NO_DEVICE_CAN_WEIGH`, with the target and the maximum capacity; the session does **not** enter `WEIGHING` |
| The selected scale is disconnected at the moment of selection | Weighing is **blocked**; the scale's disconnection is detected within 2 s (BRD IR-13) |
| Calibration expires mid-session | Weighing on that scale is **prevented**; **no** weighing is recorded against it |
| A `DONE` component is selected again | **Refused** — `DONE` is terminal (C-08) |
| A reading arrives with a lower `sequence` | **Discarded** — out of order; the current weight is unchanged |
| A reading arrives while the session is not `WEIGHING` | **Discarded** — no component state is affected |
| The scale disconnects mid-dispense | Weighing **blocked** within 2 s; confirmation unavailable; the last known weight is **retained and marked stale** |
| The scale reconnects | The stream resumes; the current weight is re-established **without an operator action** |
| The reading carries a unit that does not match the component's | **Rejected as invalid**; the previous valid weight is retained and the condition is reported |
| The reading carries `stable = false` | **Accepted and displayed**, with the settling distinction surfaced (BRD IR-11) |

---

## Open points carried forward

- **The selection threshold** (Q-04). It is `null` until FCI answers, and
  the rule works without it — the capacity constraint alone decides every
  case the story names (ADR-019).
- **The zone engine.** Four zones, evaluated on every reading against the
  active component's target and tolerance. It is a **pure value
  computation** with no state, no persistence and no external contract, so
  it is modelled as a value object **inside this unit** — bolt `014`.
- **The session's resumption.** Invariant 7 — *"a session is resumable at
  the component in progress after an interruption"* — is bolt `017`'s, and
  it is the reason the session is persisted at all.
