---
stage: model
bolt: 030-003-weighing-station
created: 2026-11-11T08:00:00Z
---

## Static Model: 003-weighing-station (bolt 030)

### The decision this models

The workbook's Step 24, decided by the project owner (option C):

> An over-tolerance component is never confirmed automatically, and no recipe
> is recalculated. Recovery is **re-tare and re-weigh**, or a **supervisor
> override** that confirms the weight as poured: authenticated, reasoned,
> single-use, scoped to the component, recorded and marked.

Brief FR-18: *"Permit confirmation only while the weight is inside
tolerance, **or after authorised override**."* Bolt 016 built the override,
but nothing let it lead to a confirmation, so FR-18's second half was
missing.

### Entities

- **Escalation** (bolt 016, changed). The over-dose awaiting a supervisor.
  **It is raised for EVERY over-dose**, not only a non-compensable one. Its
  states are unchanged: `ESCALATED → AUTHORISED | REFUSED | EXPIRED`.
- **OverrideRecord** (bolt 016, unchanged). The recorded authorisation:
  `authorisationId`, `supervisorId`, `operatorId`, `reason`, `componentId`,
  `sessionId`, `surplusAmount`, `authorisedAt`. Immutable (BRD DR-02).
- **WeighingRecord** (bolt 017, unchanged in shape). An overridden
  confirmation is an ordinary record with `zoneAtConfirm = OVER` and the
  **actual** quantity as poured. **The quantity is never adjusted to the
  target.** The `OVER` zone together with the override record for the same
  session and component *is* the "OVERRIDDEN" marking.

### Value objects

| Value object | Shape | Rule |
|---|---|---|
| **AuthorisationScope** (bolt 016) | `sessionId` + `componentId` | The override authorises that component in that session, and nothing else |
| **ConfirmationBasis** (new, conceptual) | `IN_TOLERANCE` \| `OVERRIDDEN` | Why a confirmation was allowed. Derived, never asserted by a client |

### The confirmation gate (story 004, changed)

| Zone | Before | After |
|---|---|---|
| `OK` | allowed | allowed, basis `IN_TOLERANCE` |
| `UNDER`, `NEAR` | refused | refused, unchanged |
| `OVER` | **refused, always** | **refused, unless** the escalation for this component is `AUTHORISED`; then allowed, basis `OVERRIDDEN` |

### Invariants

1. **No automatic confirmation of OVER.** Only an `AUTHORISED` escalation
   for the *active* component in the *current* session opens the gate.
2. **The override is single-use.** One authorisation, one confirmation:
   unit 008's consumption record is the guarantee (ADR-006). A second
   over-dose of the same component, after a re-tare and re-pour, needs a
   new authorisation.
3. **The supervisor is not the operator.** The authorisation needs the
   supervisor's own fresh credentials and the `SUPERVISOR` role (unit 008,
   ADR-003, ADR-004).
4. **A reason is required** (FR-24), stored in clear text (ADR-005).
5. **The recorded quantity is the poured quantity.** An override accepts a
   weight; it never invents one.
6. **No recipe is recalculated.** The remaining components keep their MES
   targets.
7. **Re-tare and re-weigh stays available** at every point before the
   confirmation (FR-19, FR-23). A re-tare that brings the weight back into
   tolerance makes a pending escalation moot: the ordinary `OK` path
   applies.

### Domain events (existing, now on the main path)

`ESCALATION_RAISED` → `ESCALATION_AUTHORISED` (with the override record) →
`COMPONENT_CONFIRMED` (zone `OVER`). A refusal leaves the component
unconfirmed.

### What is withdrawn

The **surplus compensation proposal** (story 006, bolt 015) is no longer
offered to the operator. The surplus and its percentage are still shown,
**for information**. The capability and its tests stay in the code base,
unused, until FCI answers Q25/Q26 (A-08).

### Out of scope

- Any change to the tolerance bands or the zone evaluation.
- A supervisor console. The supervisor authenticates at the operator's
  terminal, at the point of the action, as the brief requires.
