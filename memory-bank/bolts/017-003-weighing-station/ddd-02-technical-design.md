---
stage: design
bolt: 017-003-weighing-station
created: 2026-11-06T03:55:00Z
---

## Technical Design: 003-weighing-station (bolt 017)

### Architecture Pattern

**Hexagonal (ports and adapters), with the seam owned by the consumer** — the
same shape as the previous bolts.

This bolt adds **no new port**. It adds one **use case** and extends the
session's aggregate — because the progression is a **domain transition over
the session**, not a new seam.

### Layer Structure

```text
┌──────────────────────────────────────────────────────────────────┐
│ Presentation                                                     │
│   (no new endpoint — the confirmation endpoint calls the gate)    │
├──────────────────────────────────────────────────────────────────┤
│ Application                                                      │
│   ConfirmComponent      ONE transition: record, then advance      │
├──────────────────────────────────────────────────────────────────┤
│ Domain                                                           │
│   WeighingSession (extended)                                      │
│     confirm(componentId, record)  → ProgressionOutcome           │
│   ProgressionOutcome      ADVANCED | COMPLETED | NO_NEXT          │
├──────────────────────────────────────────────────────────────────┤
│ Infrastructure                                                   │
│   (no new table — the session's own row carries the states)      │
└──────────────────────────────────────────────────────────────────┘
```

### The ONE transition

**This is the design.** The story's first technical note:

> *"Progression is a domain transition, not a UI navigation. The confirmed
> component's `DONE` state and the next component's activation happen in one
> atomic transition with the record write, so a crash cannot leave two
> `ACTIVE` components or a `DONE` component with no record."*

**And the ordering is what makes it safe.** The record is written **first**:

```text
1. write the record          ← durable before the response (NFR-05)
2. mark the component DONE   ← and advance to the next
```

**A crash between them leaves the component `ACTIVE` and unwritten** — so
the operator **re-confirms**, and the duplicate check refuses the second
record rather than writing two. The session is never inconsistent: there is
never a `DONE` component with no record, and never two `ACTIVE`
components.

**The reverse order would be unsafe** — advancing first and writing the
record second would leave the next component `ACTIVE` with no record for
the last.

### Where the transition lives

**On the aggregate**, not in the use case. `WeighingSession.confirm(...)`
is a method that enforces the invariants, and the use case is the
orchestration around it: read the recipe's order, write the record, call
the transition, save the session.

**Why on the aggregate.** The invariants are the session's — *"exactly one
component is `ACTIVE` at a time"*, *"the confirmed component's `DONE` state
and the next component's activation happen in one atomic transition"*. A
transition that lives outside the aggregate can be called without the
aggregate's invariants being checked, and then the invariants are a
convention rather than a rule.

### The recipe's order, read-only

The progression needs the **next** component in recipe order, and the order
is the MES's — *"it is read-only and is never modified by WeighingMS"*
(C-01).

**So the progression reads the working copy** (unit `002`'s) and never
writes to it. The session holds the *states*; the recipe holds the *order*.

### The outcomes

| Outcome | When | What happens next |
|---|---|---|
| `ADVANCED` | There is a next `PENDING` component | The session moves to it |
| `COMPLETED` | The last component was confirmed | The session is `COMPLETE` — bolt `018`'s summary |
| `NO_NEXT` | There is no next `PENDING` component and the batch is not finished | — |

**And `COMPLETED` is distinct from `NO_NEXT`.** The story: *"the last
component in the recipe is confirmed → no component becomes `ACTIVE`; the
session moves to `COMPLETE`."* So the confirmation of the last component
**completes** — it does not leave the session ambiguously waiting.

### The duplicate check

**The record is unique per component per session.** And the check is
**atomic** — the same shape as ADR-006's ledger, and ADR-034's identity.

So the confirmation's write is guarded by a `UNIQUE` constraint on
`(session_id, component_id)` — **not** by a check-then-write, which is racy
under concurrency. The story names it: *"two confirmations for the same
component arrive concurrently → only one record is written; the second is
refused as a duplicate."*

**And the duplicate is refused, not ignored.** A second confirmation is a
**conflict** — the component is already `DONE` — and the caller is told.

### The endpoints

**No new endpoint.** The confirmation endpoint already exists (bolt `014`),
and it is what drives the progression. This bolt changes **what it does
after** the gate accepts — it advances the session.

| Status | Meaning | Body |
|---|---|---|
| **201** | The weighing was confirmed and the session advanced | `{ record, advancedTo? }` |
| **409** | The component was already confirmed | `{ error: "ALREADY_CONFIRMED" }` |

### Data Model

**No new table.** The session's own row carries the component states — it
already does, as `components_json` (bolt `013`).

**One change to the record's table:** a `UNIQUE` constraint on
`(session_id, component_id)`, so the duplicate refusal is **atomic** rather
than racy.

### Security Design

| Concern | Approach |
|---|---|
| **Session** | Required (ADR-020). The confirmation is an operator's act. |
| **A client-supplied component** | The confirmation names the component — and it must be the session's **active** component. A client cannot confirm a component the session is not working on. |
| **A client-supplied zone or quantity** | There is **no** field for either (bolt `014`). The gate reads the domain's zone and the device's reading. |
| **A client-supplied next component** | There is **no** field for it. The progression follows the **recipe's** order, and the recipe is read-only. |
| **The duplicate** | Refused by the `UNIQUE` constraint — atomically, not by a check. |
| **Immutability** | The record is append-only, with the triggers. |

### NFR Implementation

| Requirement | Design approach |
|---|---|
| **BRD NFR-05 — a confirmed weighing survives immediate power loss** | The record is written **first**, and `synchronous = FULL` makes it durable before the response. |
| **NFR-06 / invariant 7 — the session is resumable** | The component states and the active component are persisted with the session. |
| **BRD FR-14 — progression is by recipe order** | The order is the MES's, read from the working copy, never modified. |
| **BRD NFR-16** | Every quantity is a decimal string. |

### Testing Plan

| Suite | What it proves |
|---|---|
| **Unit — the transition** | The confirmed component becomes `DONE`; the next `PENDING` in recipe order becomes `ACTIVE`; exactly one is `ACTIVE`; the last component's confirmation is `COMPLETED`; `DONE` is terminal. |
| **Unit — the selection** | A `PENDING` component out of sequence is accepted and the previous `ACTIVE` returns to `PENDING`; selecting the `ACTIVE` component again is accepted and resets the weight. |
| **Integration — the confirmation** | The `201` carries the record and the component it advanced to; a duplicate is a `409`; the session's state afterwards is right. |
| **Persistence** | The `UNIQUE` constraint refuses a second record for the same component — **atomically**. |
| **Security** | No session → `401`; the client cannot choose the next component; the diagnostics never leak. |

### Open points carried forward

1. **The batch completion summary** — bolt `018`. The `COMPLETED` outcome
   is where it begins.
2. **The batch's status write-back to OrgaTEX** — bolt `018`, on batch
   completion (BRD FR-16). **Not** here.
3. **The correction workflow** — the record model supports it; the workflow
   does not exist, and the story puts it out of this unit's scope.
