---
unit: 004-scale-integration
bolt: 004-004-scale-integration
stage: model
status: complete
updated: 2026-10-31T01:05:00Z
---

# Static Model - Scale Integration (Bolt 004: Tare and Scale Selection)

## Bounded Context

**The same bounded context as bolt `003` — Scale Integration.** This bolt
does not open a new context; it adds two capabilities to the one that
already exists.

It continues to own the **device**, not the weighing. It answers two
further questions for every other unit:

> **What is the device's zero reference, and which device should this
> component be weighed on?**

### What this bolt adds

1. The **tare** — the device's current zero reference, how it was
   established, and how the reading stream reflects it.
2. The **scale-selection rule** — which device a component is weighed on,
   decided by rule, with no operator input.

### What this bolt does not own

- The **container's identity and its master tare value** → unit
  `002-recipe-material-management`. This bolt takes a tare *value* and
  does not care how it was obtained (`Q-10`).
- **Resetting the dispense session** on a re-tare → unit
  `003-weighing-station`. This bolt provides the tare operation and the
  device-side state; that unit owns the session.
- **Recording the container on the weighing record** → unit `003`.
- **Supervisor-authorised manual reselection** → unit `003` / `006`. This
  bolt provides the automatic rule; a manual override is a privileged
  action with its own audit trail.
- **The indicator's tare-command wire format** → unconfirmed (`Q-03`);
  owned by the adapter implementation, and nothing above the adapter may
  assume one.

### The rule that shapes this bolt

Bolt `003` established the context's governing rule:

> **"No reading" and "a reading of zero" must never be confused.**

This bolt adds the rule that follows from it:

> **A tare is a device's zero reference, and it is applied to the reading
> the device produces — never to the reading a consumer happens to be
> holding.**

The distinction matters because the tare is applied *once*, at the device,
and it *persists* into every subsequent reading. A consumer that
subtracted the tare from its own copy of the reading would have to know
whether the device had already done it — and would be wrong whenever a
second consumer attached mid-session. So the tare is applied **at the
device boundary**, and every reading the device emits already reflects
it.

### The risk this bolt carries

`Q-04` — *what is the scale-selection threshold, and what happens near the
boundary?* — is unanswered and owned by FCI production (`A-06` binds this
story until it is).

The rule is therefore written so that the threshold is **configuration,
not code** (BRD NFR-14). The boundary behaviour the story does pin down
— a target of exactly 3 kg is *within* the precision scale's capacity —
is derived from the capacity constraint itself, not from an invented
threshold. When FCI answers, the configuration changes; the rule does
not.

---

## Invariants

Each invariant is expressed below as a **type-level constraint** or a
**single chokepoint**, continuing the numbering of bolt `003` (S-1…S-10)
and adding this bolt's own.

- **S-11 — The tare is applied at the device, exactly once.** A reading
  the device emits already reflects the tare in force. Expressed by
  `TareAwareAdapter` being the only route to a reading, and by the
  tare-aware reading being the **only** kind the stream may carry.
- **S-12 — A tare is never assumed to be zero.** A device with no tare in
  force has **no tare state** — which is distinct from a tare of exactly
  zero. Expressed by a discriminated union whose "no tare" branch has no
  value field.
- **S-13 — A tare may only be applied to a device that can be weighed
  on.** The tare operation consults the same gate the weighing does
  (S-7), so a tare cannot be applied to a disconnected device or an
  out-of-calibration one.
- **S-14 — A refused tare leaves the previous tare in force.** A failure
  never clears the zero reference. A device whose tare was silently
  dropped would report a container's full weight as the dispensed
  quantity.
- **S-15 — The tare is held in memory and is never persisted.** A stale
  tare read back after a restart would be a **wrong number**, not an
  inconvenience.
- **S-16 — The selection is a DECISION, not a connection switch.** Both
  devices may be connected concurrently (BRD IR-14); selecting one does
  not disconnect the other.
- **S-17 — The selection is made BY RULE and requires no operator
  input.** The operator is never asked which scale to use (FR-7, BR-05,
  AC-02).
- **S-18 — The capacity constraint wins over the scale-class demand.** A
  4 kg target on a class that demands the 3 kg precision scale goes to
  the floor scale, and the selection's **reason records the conflict** —
  because a 4 kg load cannot be weighed on a 3 kg scale.
- **S-19 — No device is selected when no device can weigh the target.**
  The outcome is an explicit "no device can weigh this", carrying the
  target and the maximum available capacity. Nothing is guessed.
- **S-20 — The threshold is configuration, not code.** Changing FCI's
  answer to `Q-04` is a configuration change, not a code change
  (BRD NFR-14).

---

## Domain Entities

| Entity | Properties | Business Rules |
|--------|------------|----------------|
| **TareState** | `scaleId` (`ScaleId`), `tareValue` (`WeightValue`), `appliedAt` (`Instant`), `source` (`TareSource`), `appliedBy` (`TareMechanism`) | The device's **current zero reference**. What the device subtracts from its gross reading. Immutable once created — a re-tare **replaces** the state rather than mutating it, so the state that was in force is never silently rewritten (S-14). Holds the value, its unit, the time it was applied, where the value came from, and **whether the indicator or the software applied it** (BRD IR-12). |
| **ScaleSelection** | `scaleId` (`ScaleId`), `componentId` (`ComponentId`), `selectedAt` (`Instant`), `reason` (`SelectionReason`), `scaleClass` (`ScaleClass`), `capacity` (`WeightValue`) | Which device a component is weighed on. Carries the **scale id, the component id, the time of selection and the reason** — all four are required by the story. Also carries the class and capacity for display (FR-7). A decision, not a connection switch (S-16). |

---

## Value Objects

| Value Object | Properties | Constraints |
|--------------|------------|-------------|
| **TareSource** | `kind`: `CONTAINER_MASTER` \| `WEIGHED_EMPTY_CONTAINER` | Where the tare *value* came from. The container master holds a known tare; a weigh-and-tare establishes it by measuring the empty container. The story requires the source to be recorded, and the two are different facts: a master tare is a claim, a weighed tare is a measurement. |
| **TareMechanism** | `kind`: `INDICATOR` \| `SOFTWARE` | **Where the tare was APPLIED.** Where the indicator supports a tare command the command is issued to the device; where it does not, the tare is subtracted in software (BRD IR-12, BRD FR-19). Both paths produce the **same** `TareState` shape, so a consumer above this unit never learns which was used — except through this field, which the story explicitly requires the source to state. |
| **ComponentId** | `value` (string) | The component being weighed. Opaque; this unit does not know what a component *is* — that is unit `002`'s. It is carried so the selection can be attributed (S-17). |
| **ScaleClass** | `kind`: `PRECISION` \| `FLOOR` | The class of scale a component **demands**. Distinct from the device's own class, though the two are usually the same. The story's edge case — "the scale class demands precision but the target is 4 kg" — is exactly the case where they diverge. |
| **SelectionReason** | `kind`: `CAPACITY_AND_CLASS` \| `CAPACITY_ONLY` \| `CLASS_CONFLICT_RESOLVED_BY_CAPACITY` \| `TARGET_ZERO` | **Why** this device was selected. A closed set, so the reason is *data* rather than prose assembled at the call site. `CLASS_CONFLICT_RESOLVED_BY_CAPACITY` is the one that records S-18: the class demanded one device and the capacity allowed another. |
| **ScaleSelectionOutcome** | discriminated union: `{ kind: 'SELECTED', selection: ScaleSelection }` \| `{ kind: 'NO_DEVICE_CAN_WEIGH', target: WeightValue, maximumCapacity: WeightValue, class: ScaleClass }` | **The expression of S-19.** The `NO_DEVICE_CAN_WEIGH` branch carries the target and the maximum available capacity — the two facts the story requires — and selects **no** device. A caller cannot read a `scaleId` without first proving one was selected. |
| **TareApplication** | discriminated union: `{ kind: 'APPLIED', state: TareState }` \| `{ kind: 'REFUSED', reason: WeighingBlockReason }` | **The expression of S-13 and S-14.** A refusal names its reason and carries **no** new state — so the previous tare cannot be lost by handling a refusal incorrectly. The reasons are the **same** `WeighingBlockReason` set the weighing gate uses, so the vocabulary is one vocabulary. |
| **ScaleSelectionRule** | `threshold` (`WeightValue` \| `null`), `devices` (ordered `ScaleDevice[]`) | The **configuration** (S-20). The threshold is the quantity at or below which a class-demanding component goes to the precision scale. It is `null` until FCI answers `Q-04`, and the rule works without it — the capacity constraint alone decides. |

---

## Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **ScaleDevice** *(extended)* | `TareState` \| `null`, plus everything bolt `003` established | S-11, S-12, S-13, S-14, S-15. The tare is a member of the device aggregate because it is a property of **that device**: two devices may hold different tares, and a tare means nothing without the device it belongs to. The device remains the **only** place a reading enters the domain (S-3). |
| **ScaleSelection** | `ScaleSelectionReason`, `ScaleCapability` (snapshot) | S-16, S-17, S-19. The selection **snapshots** the device's class and capacity, so a later change to the device's configuration cannot alter a selection that has already been made — the same reasoning as the weighing record's snapshot in unit `003`. |

---

## Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **TareApplied** | A tare is successfully applied to a device | `scaleId`, `tareValue`, `unit`, `appliedAt`, `source`, `appliedBy` |
| **TareRefused** | A tare is refused — disconnected, over capacity, busy, out of calibration | `scaleId`, `reason`, `at` — *and the fact that the previous tare remains in force* |
| **ScaleSelected** | The rule selects a device for a component | `scaleId`, `componentId`, `selectedAt`, `reason`, `scaleClass`, `capacity` |
| **ScaleSelectionRefused** | No available device can weigh the target | `componentId`, `target`, `maximumCapacity`, `class`, `at` — *an explicit outcome, not a silent absence* |

**A selection is not an event about the device.** Selecting a device does
not change the device — it does not disconnect the other one, and it does
not change the device's status. The event is about the **decision**, and
its payload is the decision's record. That is why the event carries the
selection's own fields rather than a device delta.

---

## Domain Services

| Service | Operations | Dependencies |
|---------|------------|--------------|
| **TarePolicy** | `evaluate(device, gate) → TareVerdict` | `ScaleDevice`, `ScaleHealthPolicy`, `WeighingBlockReason`. **Pure.** Decides whether a tare may be applied: it consults the **same gate** the weighing does, so a disconnected or out-of-calibration device refuses the tare for the same reason it refuses the weighing (S-13). It does not compute anything — the *value* is arithmetic, and that belongs to the adapter. |
| **ScaleSelectionRule** | `select(target, demandedClass, devices) → ScaleSelectionOutcome` | `WeightValue`, `ScaleClass`, `ScaleCapability`. **Pure.** The rule. S-17, S-18, S-19, S-20. |
| **TareAwareAdapter** *(port)* | `openStream(scaleId) → AsyncIterable<TareAwareReading>`, `applyTare(scaleId, tareValue) → TareMechanism` | The **extended seam**. Bolt `003`'s `ScaleAdapter` gained one operation — `applyTare` — and the reading it yields now carries the tare already applied. This is the ONE place a tare command reaches an indicator, and the one place a software tare is subtracted. |
| **WeightUnitConverter** | `convert(value, toUnit) → WeightValue` | `WeightValue`, `decimal.js`. **Pure.** Converts a tare expressed in kilograms into the device's unit before it is applied, with **no floating point** (BRD NFR-16). The story's edge case: "the tare value is in kilograms and the device reports grams". |

### The selection rule, in full

`ScaleSelectionRule.select` is pure and works in this order:

1. **Convert** the target into the unit the capacities are expressed in.
   A 24 kg target and a 32000 g capacity are the same comparison, and the
   conversion is exact (BRD NFR-16).
2. **Find the candidates** — the devices whose capacity is **at least** the
   target. The boundary is **inclusive**: a target of exactly 3 kg is
   within the precision scale's capacity; a target of exactly 32 kg is
   within the floor scale's capacity.
3. **If there are no candidates** → `NO_DEVICE_CAN_WEIGH`, carrying the
   target and the **maximum available capacity** (S-19).
4. **If there is exactly one candidate** → select it. The reason is
   `CAPACITY_ONLY` unless the class agrees, in which case it is
   `CAPACITY_AND_CLASS`.
5. **If there are several candidates** → prefer the one whose class
   matches the demanded class. If the demanded class matches **none** of
   them, the class constraint is unsatisfiable and the **capacity
   constraint wins** — the smallest-capacity candidate is selected and
   the reason is `CLASS_CONFLICT_RESOLVED_BY_CAPACITY` (S-18).
6. **A target of exactly zero** is not "no device". The smallest-capability
   device that satisfies the class is selected, and the reason is
   `TARGET_ZERO`.

### Why the capacity constraint wins the conflict

The story's edge case: *"The scale class demands precision but the target
is 4 kg. The two constraints conflict. The capacity constraint wins — the
floor scale is selected and the selection's reason records the conflict,
because a 4 kg load cannot be weighed on a 3 kg scale."*

This is not an invention. The alternative — refusing the selection
because the class could not be satisfied — would mean a 4 kg dyestuff
could never be weighed at all, which is worse than weighing it on a
coarser scale. And silently choosing the floor scale would lose the fact
that the class was not met, so the reason records it.

---

## Repository Interfaces

| Repository | Entity | Methods |
|------------|--------|---------|
| **ScaleDeviceRepository** | `ScaleDevice` | `get(scaleId)`, `list()`, `save(device)` — *unchanged from bolt `003`.* The tare is **not** persisted (S-15), so this repository's schema does not change. |
| **TareRepository** | — | **Does not exist.** The tare is in memory, per device (S-15). A stale tare read back after a restart would be a **wrong number**: the operator would see a quantity that excluded a container's weight the device is no longer zeroed against. |
| **ScaleSelectionRepository** | — | **Does not exist.** A selection is a **decision consumed by unit `003`**, not a record this unit keeps. Unit `003` snapshots the selected device onto the weighing record, which is where a selection becomes durable — and that record belongs to the weighing, not to the device. |

**Both absent repositories are decisions, not omissions.** They are the
same reasoning as bolt `003`'s absent reading repository (ADR-009): the
absence of a place to write something down is what makes the rule
structural.

---

## Ubiquitous Language

| Term | Definition |
|------|------------|
| **Tare** | The device's zero reference — the weight it subtracts from its gross reading. Distinct from the container, which is unit `002`'s. |
| **Tare source** | Where the tare *value* came from: the container master, or weighing the empty container. |
| **Tare mechanism** | Where the tare was *applied*: the indicator, or the software. A different fact from the source. |
| **Re-tare** | Applying a tare to a device that already has one. It **replaces** the previous tare; it never adds to it. |
| **Gross reading** | What the device reports before the tare. |
| **Net reading** | What the device reports after the tare — the quantity the consumer sees. |
| **Scale class** | The kind of scale a component demands: precision or floor. A property of the *component's requirement*, not of the device — though the two usually agree. |
| **Capacity** | The largest load a device can weigh. The constraint the selection rule is built on. |
| **Selection** | The decision of which device a component is weighed on. A decision, not a connection switch. |
| **No device can weigh this** | The explicit outcome when the target exceeds every available capacity. Carries the target and the maximum capacity. Not a silent absence, and not a guess. |
| **Threshold** | The quantity at or below which a class-demanding component goes to the precision scale. **Unconfirmed** (`Q-04`) — configuration, not code. |

---

## Story Coverage

### Story `003-tare-scale-against-container`

| # | Acceptance criterion | Covered by |
|---|----------------------|-----------|
| 1 | The device's `TareState` records the tare value, its unit, the time it was applied, and its source | `TareState` — all four fields; `TareSource` |
| 2 | The next reading reflects the tare — the dispensed quantity excludes the container's weight | `TareAwareAdapter` (S-11); the tare-aware reading is the only kind the stream carries |
| 3 | Where the indicator has no tare command, the tare is applied in software and the recorded `source` states so | `TareMechanism.SOFTWARE`; BRD IR-12, BRD FR-19 |
| 4 | A re-tare replaces the previous tare and resets the dispense | `ScaleDevice.applyTare` replaces the state; the **dispense reset belongs to unit `003`** — this bolt provides the operation and the device-side state |
| 5 | The applied value, its unit and its source are available for display | `TareState` — readable from the device's status view |

### Story `004-select-scale-by-capacity`

| # | Acceptance criterion | Covered by |
|---|----------------------|-----------|
| 1 | A device is selected automatically and no operator input is requested | `ScaleSelectionRule` (S-17); FR-7, BRD BR-05, AC-02 |
| 2 | A target within the precision scale's 3 kg, class demanding precision → the 3 kg precision scale | `ScaleSelectionRule` — step 4; the inclusive capacity boundary |
| 3 | A target exceeding the precision capacity but within the floor scale's 32 kg → the 32 kg floor scale | `ScaleSelectionRule` — step 4 |
| 4 | A target exceeding the floor scale's capacity → an explicit "no device can weigh this", carrying the target and the maximum capacity; no device selected and no value guessed | `ScaleSelectionOutcome.NO_DEVICE_CAN_WEIGH` (S-19) |
| 5 | The selection records the scale id, the component id, the time of selection and the reason | `ScaleSelection` — all four fields |
| 6 | The scale's class and its maximum capacity are available for display | `ScaleSelection.scaleClass`, `ScaleSelection.capacity` — snapshotted |

---

## Open interpretations

Two readings in the source material are ambiguous. Both are resolved here
**explicitly** rather than silently, and both are raised at the Stage 1
checkpoint.

### I-3 — Does a re-tare reset the dispense?

The story says: *"the previous tare is replaced by the new one, **and the
dispense is reset**."*

But the story's own technical notes say: *"The reset of the dispense
session itself belongs to unit `003`; this unit provides the tare
operation and the device-side state."*

Those two statements are in the same document, and they are consistent
only if the reset is **orchestrated across the boundary** rather than
performed inside it.

**Reading adopted:** this bolt's `applyTare` **replaces the device's
tare state** and returns it. It does **not** reset the dispense session,
because the dispense session belongs to unit `003` and this unit has no
access to it. The orchestration — "re-tare means tare-then-reset" — is
performed by the caller that owns both, which is unit `003`'s weighing
station.

**Consequence if reversed:** this unit would have to know about the
weighing session, which would invert the dependency between two units
that are deliberately independent.

### I-4 — Is the threshold a third constraint, or is the capacity enough?

`Q-04` asks FCI production for "the scale-selection threshold, and what
happens near the boundary", and `A-06` says "scale selection is rule-based
on target quantity, with a defined threshold". The prototype shows the
*result* ("3 kg precision") and never the rule.

The story's own acceptance criteria, however, are fully determined by the
**capacity** constraint: a target within 3 kg and class-demanding
precision → the precision scale; beyond 3 kg → the floor scale. That is
exactly what the capacity rule produces, and the story pins the boundary
(it "is within the precision scale's capacity").

**Reading adopted:** the **capacity constraint is the rule**, and the
threshold is a **configuration parameter** of the rule that is currently
**unset**. The rule works fully without it — the capacity constraint
alone decides every case the story names. When FCI answers `Q-04`, the
threshold is configured; if it turns out to be a quantity *other* than
the capacity, the rule already has the slot for it.

**Consequence if reversed:** if FCI's rule turns out to be something the
capacity constraint cannot express — a threshold on the *total batch*
rather than the *component*, for instance — the rule's shape changes.
That is why the rule is written against a **set of devices** and a
**configuration**, not against two hard-coded scales.

### A note on the selection's scope

The story says the selection *"is consumed by unit 003, which acts on it.
This story provides the decision inputs and the outcome; it does not run a
weighing."* This bolt therefore **does not** bind the session to the
selected device, and does not reset the weight — those are unit `003`'s.
What this bolt provides is the **decision** and its **record**.
