---
stage: model
bolt: 017-003-weighing-station
created: 2026-11-06T03:35:00Z
---

## Static Model: 003-weighing-station (bolt 017)

### Entities

- **ComponentProgress** (the record): one component's state within a session,
  persisted — `sessionId`, `componentId`, `sequence`, `state`, `updatedAt`.

  It is the **live state**, and it is **mutable** — like the session it
  belongs to (ADR-036). It is not a record of a completed act.

### Value Objects

| Value object | Shape | Rules |
|---|---|---|
| **ProgressionOutcome** | `ADVANCED` \| `COMPLETED` \| `NO_NEXT` | What a confirmation did to the component list. A **closed set of three**, and `COMPLETED` is distinct from `ADVANCED` — the last component's confirmation ends the batch, and that is **bolt `018`'s** work, not a silent "advanced to nothing". |

### The progression is ONE transition, not two

**This is the story's first technical note, and it is the whole design:**

> *"Progression is a domain transition, not a UI navigation. The confirmed
> component's `DONE` state and the next component's activation happen in one
> atomic transition with the record write, so a crash cannot leave two
> `ACTIVE` components or a `DONE` component with no record."*

**And the failure it names is precise.** Consider the two obvious
implementations:

```ts
// WRONG — two writes, and a crash between them leaves the session
// inconsistent.
await records.save(record);
await sessions.save(markDone(componentId));   // ← a crash HERE leaves a
await sessions.save(activateNext());           //   DONE component with no
                                               //   record, and no ACTIVE
```

```ts
// WRONG — the reverse order.
await sessions.save(activateNext());
await records.save(record);   // ← a crash HERE leaves the next component
                              //   ACTIVE with no record for the last
```

**So the transition is ONE operation, and it is ordered so that the
invariants hold at every point.** The rule:

1. The record is written **first** — a confirmed weighing is durable
   **before** the response is returned (BRD NFR-05: *"a confirmed weighing
   survives immediate power loss"*).
2. The component states advance **in the same operation**, so a crash
   between the two leaves the component `ACTIVE` and unwritten — which
   means the operator **re-confirms**, and the duplicate check refuses the
   second record rather than writing two.

**And that is why the idempotence check exists.** The story names it: *"two
confirmations for the same component arrive concurrently → only one record
is written; the second is refused as a duplicate."*

### The order is the RECIPE's, and it is read-only

**Invariant 4:** *"confirming advances to the first `PENDING` component in
recipe order."* And the recipe order comes from the recipe loaded at
session start — *"it is read-only and is never modified by WeighingMS"*
(C-01).

**So the progression reads the recipe's order and does not write to it.**
The session holds the component states; the recipe holds the order.

### The rules, and where each is enforced

| Rule | Enforced by | This bolt? |
|---|---|---|
| 1. Exactly one component is `ACTIVE` | the transition | ✅ |
| 2. `DONE` is terminal | the selection (bolt `013`) | ✅ (already) |
| 3. Confirmation is impossible unless the zone is `OK` | the gate (bolt `014`) | ✅ (already) |
| 4. Confirming advances to the first `PENDING` in recipe order | the transition | ✅ |
| 5. A confirmed `WeighingRecord` is immutable | the record's table (bolt `014`) | ✅ (already) |
| 6. Selecting a component resets the weight to zero | the selection (bolt `013`) | ✅ (already) |
| 7. The session is resumable at the component in progress | the session's persistence (bolt `013`) | ✅ (already) |

**So this bolt adds the transition itself** — the piece that turns
invariant 4 from a statement into a rule, and that makes invariants 1, 4 and
5 hold **together** rather than separately.

### The progression's three outcomes

| Outcome | When | What the caller does |
|---|---|---|
| `ADVANCED` | There is a next `PENDING` component | The session moves to it |
| `COMPLETED` | The last component was confirmed | **Bolt `018`'s** work — the batch summary |
| `NO_NEXT` | There is no next component **and** the batch is not finished | — |

**And `COMPLETED` is distinct from `NO_NEXT`.** The story: *"the last
component in the recipe is confirmed → no component becomes `ACTIVE`; the
session moves to `COMPLETE`."* So the confirmation of the last component
**completes** — it does not leave the session in an ambiguous state.

### What the progression does NOT do

**It does not write the batch's weighing status to OrgaTEX.** The story is
explicit: *"the batch weighing status write-back to OrgaTEX is **not**
performed on component progression — it happens on batch completion (story
009, BRD FR-16)."*

So the progression is a **local** transition. The MES hears about it once,
at the end.

### Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **WeighingSession** (extended) | the state, the component states | 1. Exactly one component is `ACTIVE` at a time. 2. `DONE` is terminal. 3. The progression advances to the first `PENDING` in **recipe order**. 4. The record is written **before** the states advance. 5. A component cannot be confirmed twice. |

### Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **ComponentConfirmed** | A weighing was confirmed | `componentId`, `recordId`, `actualQuantity`, `zoneAtConfirm` |
| **ComponentAdvanced** | The session moved to the next component | `fromComponentId`, `toComponentId` |
| **BatchWeighingComplete** | The last component was confirmed | `batchId`, `confirmedCount` |

### Domain Services

- **ProgressionService**: the transition. It confirms the component, advances
  to the next, and reports which of the three outcomes happened.

  **It is one operation, and the record write is inside it.** That is the
  whole design, and it is why a crash cannot leave the session
  inconsistent.

### Repository Interfaces

| Repository | Entity | Methods | Persisted? |
|---|---|---|---|
| **WeighingSessionRepository** (extended) | `WeighingSession` | `save`, `current` | **Yes** — the session and its component states |
| **WeighingRecordRepository** (bolt `014`) | `WeighingRecord` | `save`, `latestFor` | **Yes** — append-only |

### Ubiquitous Language

- **Progression** — the transition that advances the session after a
  confirmation.
- **Recipe order** — the sequence the MES gave. Read-only.
- **Next** — the first `PENDING` component in recipe order.
- **Duplicate confirmation** — a second confirmation for a component that is
  already `DONE`. Refused.
- **Abandoned** — a dispense the operator walked away from. The component
  returns to `PENDING` and no record is written.

---

## Constraints carried into the Technical Design

1. **The transition is ONE operation**, and the record write is **inside**
   it — the component's `DONE` state and the next component's activation
   cannot be separated.
2. **The record is written FIRST**, so a confirmed weighing is durable
   before the response is returned (BRD NFR-05).
3. **The progression follows the RECIPE's order**, and never modifies it
   (C-01).
4. **A duplicate confirmation is REFUSED** — one component, one record.
5. **The last component's confirmation COMPLETES** — a distinct outcome,
   not a silent "advanced to nothing".
6. **The batch's status is NOT written to OrgaTEX here** — that is bolt
   `018`'s, on batch completion (BRD FR-16).
7. **Selecting a `PENDING` component out of sequence is ACCEPTED**, and the
   previously `ACTIVE` component returns to `PENDING` with **no** record
   written for it.
8. **The session is resumable** — the component states and the active
   component are persisted with it.

---

## The edge cases, answered

| Scenario | Where it is answered |
|----------|----------------------|
| The last component is confirmed | `COMPLETED` — no component becomes `ACTIVE`; the session moves to `COMPLETE` (bolt `018`) |
| The operator selects a `PENDING` component out of sequence | Accepted; the weight resets to zero; the previously `ACTIVE` component returns to `PENDING` and **no record** is written for it |
| The operator selects the currently `ACTIVE` component again | Accepted — it is not `DONE` — and the weight resets to zero; the dispense is **abandoned and restarted** (BRD FR-19) |
| A `DONE` component is selected | **Rejected** — `DONE` is terminal (C-08) |
| Power loss immediately after confirmation, before the response | The record is **durable** — it was written first — and on resume the component is `DONE` and the next is `ACTIVE` (BRD NFR-05) |
| The recipe contains a component with a target of zero | Handled by the zone engine's zero-target rule; the progression is unaffected |
| Two confirmations for the same component arrive concurrently | Only **one** record is written; the second is refused as a duplicate |

---

## Open points carried forward

- **The batch completion summary** — bolt `018`. The `COMPLETED` outcome is
  where it begins.
- **The correction workflow** — *"Corrections are new records referencing the
  original; the correction workflow is out of this unit's scope."* The record
  model supports it (`correctsRecordId`); the workflow does not exist.
- **The weighing record's `lot` and `container`** — the record carries them
  (bolt `014`), and the progression reads them from the effective captures
  unit `002` holds.
