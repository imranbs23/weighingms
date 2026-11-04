---
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
phase: inception
status: stories-defined
created: 2026-10-30T04:05:00Z
updated: 2026-10-30T04:05:00Z
---

# Unit Brief: Weighing Station

## Purpose

The guided weighing itself — read the scale, judge it against tolerance, and
let the operator confirm it.

This unit is **the product**. Everything else in WeighingMS exists to feed it
or to record what it produced. It owns the weighing session and the state
machine that governs it, and it is deliberately **not** a screen.

## Scope

### In Scope

- The **weighing session** and its state machine: which batch, which
  component, which zone, what has been dispensed, whether it can be
  confirmed.
- **Automatic scale selection** — the correct scale for each component,
  chosen without operator input.
- Consuming the live weight stream and presenting the current weight.
- **The tolerance zone engine** — evaluating every reading against the
  active component's target and tolerance, producing one of four zones.
- **Confirmation gating** — confirmation is impossible unless the zone is
  `ok`.
- **Over-dose detection, overshoot and surplus calculation.**
- **Surplus compensation** — the recalculation of remaining components.
- **Non-compensable over-dose escalation.**
- **Component progression** — advancing to the next component on confirmation.
- The **batch completion summary.**
- **Operator identification and traceability** at the point of weighing.

### Out of Scope

- Where the weight came from → `004-scale-integration`.
- Where the recipe came from → `005-orgatex-integration`.
- The batch queue → `001-batch-management`.
- Material identity, lots and tare → `002-recipe-material-management`.
- The ticket, the audit trail, configuration and reporting →
  `006-ticket-printing`.
- Rendering → `007-weighingms-ui`.

---

## Assigned Requirements

| FR | Requirement | Priority |
|----|-------------|----------|
| FR-7 | Automatic scale selection | Must |
| FR-8 | Live weight stream and guided dispensing | Must |
| FR-9 | Tolerance zones and status signalling | Must |
| FR-10 | Confirmation gating | Must |
| FR-11 | Over-dose detection, overshoot and surplus calculation | Must |
| FR-12 | Surplus compensation | Must |
| FR-13 | Non-compensable over-dose escalation | Must |
| FR-14 | Component progression | Must |
| FR-15 | Batch completion summary | Must |
| FR-18 | Operator identification and traceability | Must |

**Eleven of twenty-three functional requirements.** This is the largest unit
and it is expected to be — see §Notes.

---

## Domain Concepts

### Key Entities

| Entity | Description | Attributes |
|--------|-------------|------------|
| `WeighingSession` | The operator's work on one batch | `id`, `batchId`, `operatorId`, `startedAt`, `state`, `activeComponentId` |
| `SessionState` | Where the session is | `AWAITING_BATCH` \| `AWAITING_COMPONENT` \| `WEIGHING` \| `CONFIRMING` \| `COMPENSATING` \| `ESCALATED` \| `COMPLETE` |
| `ComponentProgress` | One component's journey through the session | `componentId`, `state` (`PENDING` \| `ACTIVE` \| `DONE`), `targetQuantity`, `unit`, `tolerance`, `scaleClass`, `actualQuantity`? |
| `ToleranceZone` | Where a reading sits relative to target | `UNDER` \| `NEAR` \| `OK` \| `OVER` |
| `WeightReading` | A single reading from the scale | `value`, `unit`, `stable`, `sequence`, `receivedAt` |
| `SurplusProposal` | A recalculation of the remaining components | `surplusAmount`, `surplusPercent`, `recalculatedComponents[]`, `factor` |
| `WeighingRecord` | The durable fact of one confirmed weighing | `id`, `sessionId`, `componentId`, `targetQuantity`, `actualQuantity`, `unit`, `zoneAtConfirm`, `operatorId`, `scaleId`, `lotNumber`, `containerId`, `timestamp` |

### Key Operations

| Operation | Description | Inputs | Outputs |
|-----------|-------------|--------|---------|
| `startSession` | Open a session for a selected batch | `batchId`, `operatorId` | `WeighingSession` with the recipe loaded |
| `selectComponent` | Make a not-yet-done component active | `componentId` | Updated session; weight reset to zero |
| `evaluateZone` | Classify a reading against the active component | `WeightReading`, `ComponentProgress` | `ToleranceZone` |
| `confirmComponent` | Accept the current weight and advance | `sessionId` | `WeighingRecord`, next component, or session completion |
| `detectOvershoot` | Identify an over-dose beyond tolerance | `WeightReading`, `ComponentProgress` | overshoot amount |
| `proposeCompensation` | Recalculate the remaining components | `surplusAmount`, remaining components | `SurplusProposal` |
| `escalate` | Raise a non-compensable over-dose to a supervisor | reason, actor | escalation record |
| `completeSession` | Finish the batch | `sessionId` | completion summary |
| `resumeSession` | Restore an interrupted session | `sessionId` | session state at the component in progress |

### The tolerance zone engine

This is the pivot of the whole product. Four zones, evaluated on **every
reading**, against the **active** component's target and tolerance:

| Zone | Condition | Reading colour | Status line | Confirmation |
|---|---|---|---|---|
| `OVER` | `value > target + tolerance` | `--over` | OVER TOLERANCE — SURPLUS +n | disabled |
| `OK` | `target − tolerance ≤ value ≤ target + tolerance` | `--ok` | WITHIN TOLERANCE — PRESS OK TO CONFIRM | **enabled** |
| `NEAR` | `target × 0.9 ≤ value < target − tolerance` | `--warn` | DISPENSE — n REMAINING | disabled |
| `UNDER` | `value < target × 0.9` | `--hmi-ink` | DISPENSE — n REMAINING | disabled |

**This is a pure value computation.** It has no state, no persistence, no
external contract, and no failure mode of its own — so it is modelled as a
**value object inside this unit**, with an exhaustive boundary test suite,
rather than extracted into a separate unit. See §Notes for why.

### The session state machine

```
        select batch
             │
             ▼
    ┌─────────────────┐
    │ AWAITING_BATCH  │
    └────────┬────────┘
             │ recipe loaded, first component active
             ▼
    ┌─────────────────┐   re-tare / select another component
    │   AWAITING_     │◄────────────────────────────┐
    │   COMPONENT     │                             │
    └────────┬────────┘                             │
             │ scale selected, weight streaming      │
             ▼                                      │
    ┌─────────────────┐                             │
    │    WEIGHING     │─────────────────────────────┘
    └───┬─────────┬───┘
        │         │
   zone=ok│       │zone=over
        │         ▼
        │   ┌───────────────┐  compensable  ┌───────────────┐
        │   │  COMPENSATING │──────────────►│  ESCALATED    │
        │   └───────────────┘               │ (supervisor)  │
        │                                   └───────────────┘
        ▼
    ┌─────────────────┐
    │   CONFIRMING    │──► writes WeighingRecord, advances component
    └────────┬────────┘
             │ no pending component remains
             ▼
    ┌─────────────────┐
    │    COMPLETE     │──► batch completion summary
    └─────────────────┘
```

**Invariants of the machine.**

1. **Exactly one component is `ACTIVE` at a time.**
2. **`DONE` is terminal.** A completed component cannot be re-selected or
   re-weighed (BRD DR-02, C-08).
3. **Confirmation is impossible unless the zone is `OK`.** There is no other
   path to a `WeighingRecord` (FR-10, C-07).
4. **Confirming advances to the first `PENDING` component in recipe order.**
5. **A confirmed `WeighingRecord` is immutable.** A correction is a **new**
   record that references the original (BRD DR-02, C-12).
6. **Selecting a component resets the weight to zero.**
7. **A session is resumable at the component in progress** after an
   interruption (NFR-06).

### Compensation and escalation

**The compensation rule is the highest-risk rule in the build.** Assumption
A-08 states that "surplus compensation" means proportionally recalculating
the remaining components to preserve the shade ratio — and it is marked
**High** risk because the BRD itself flags it as the most likely
misunderstanding in the document (R-03). Q-06 asks FCI directly.

The prototype's proposal scales the remaining components by a factor of
**1.026** — derived from its own surplus example (+2.4 g on 94.0 g = +2.6%).
**That constant is the prototype's illustration, not a rule.** The correct
factor is `surplus / totalRemainingTarget` — proportional, so the shade ratio
is preserved. The prototype's hard-coded 1.026 happens to match its own
example, but a constant would be wrong for any other surplus.

| Situation | Behaviour |
|---|---|
| Zone is `OVER`, and the remaining components can absorb the surplus | Present the proportional recalculation as a **proposal**. The operator accepts it; the remaining targets change. |
| Zone is `OVER`, and the surplus **cannot** be absorbed | **Escalate.** A supervisor authorises the override with a reason, which is audited. |
| Zone is `OVER`, and no supervisor authorises | The weighing is not confirmed. The batch is held. |

**Rule 2 (workbook): no invented requirements.** The rule is implemented as
*stated in the BRD's assumption*, and the implementation records which rule
it applied. When FCI answers Q-06, the rule changes in one place — and if the
answer is "surplus compensation just means displaying the excess", the
compensation path is deleted rather than rewritten.

### Operator traceability

A confirmed weighing records the operator, the scale, the lot, the container,
the timestamp and the zone at confirmation. The operator's identity comes
from unit 008; this unit **attaches it to the record** (FR-18).

---

## Story Summary

| Metric | Count |
|--------|-------|
| Total Stories | 9 |
| Must Have | 9 |
| Should Have | 0 |
| Could Have | 0 |

### Stories

| Story ID | Title | Priority | Status |
|----------|-------|----------|--------|
| 001 | Start a weighing session for the selected batch | Must | Planned |
| 002 | Select the scale automatically for a component | Must | Planned |
| 003 | See the live weight as it streams from the scale | Must | Planned |
| 004 | See the tolerance zone for the current weight | Must | Planned |
| 005 | Confirm a weighing only when it is within tolerance | Must | Planned |
| 006 | Handle an over-dose with a surplus compensation proposal | Must | Planned |
| 007 | Escalate a non-compensable over-dose for supervisor authorisation | Must | Planned |
| 008 | Advance automatically to the next component on confirmation | Must | Planned |
| 009 | Complete the batch and produce the completion summary | Must | Planned |

---

## Dependencies

### Depends On

| Unit | Reason |
|------|--------|
| `004-scale-integration` | The live weight stream, the scale status and the tare. |
| `002-recipe-material-management` | Targets, units, tolerances, scale classes, tares, lots. |
| `001-batch-management` | The selected batch. |
| `005-orgatex-integration` | Batch weighing status (written on progression and completion). |
| `008-operator-identity` | The operator identity attached to the record. |

### Depended By

| Unit | Reason |
|------|--------|
| `006-ticket-printing` | What was weighed, and the ticket's component table. |
| `007-weighingms-ui` | Renders the session — the live readout, the zone, the rail, the actions. |

### External Dependencies

| System | Purpose | Risk |
|--------|---------|------|
| Scale indicators | The weight being judged | **Severe** — A-05, Q-03. B-5: if only a stabilised value exists, guided weighing as drawn is not buildable. |
| OrgaTEX MES | Batch status; consumption posted by unit 005 | **Severe** — A-01, A-02 |

---

## Technical Context

### Suggested Technology

TypeScript strict · Express 4 · Zod for validation · SQLite via
better-sqlite3, **append-only** for weighing records · fixed-point decimal
throughout · SSE from unit 004 consumed server-side and relayed to the UI.

### Integration Points

| Integration | Type | Protocol |
|-------------|------|----------|
| `004-scale-integration` | API (internal) | SSE (weight) + REST (status, tare) |
| `002-recipe-material-management` | API (internal) | REST/JSON |
| `001-batch-management` | API (internal) | REST/JSON |
| `005-orgatex-integration` | API (internal) | REST/JSON |
| `007-weighingms-ui` | API (internal) | REST/JSON + SSE (session state) |

### Data Storage

| Data | Type | Volume | Retention |
|------|------|--------|-----------|
| Weighing session | SQL | One row per session | Session-scoped, resumable |
| Component progress | SQL | One row per component per session | Session-scoped |
| Weighing records | SQL, **append-only** | One row per confirmed component | ≥ 5 years (DR-01) |
| Surplus proposals | SQL | One row per over-dose | ≥ 5 years (DR-01) |

**Weighing records are never updated or deleted.** A correction is a new
record referencing the original (BRD DR-02).

---

## Constraints

- **No floating point for quantities**, in API payloads, in storage, or in
  the UI (BRD NFR-16). Fixed-point decimal, 4 dp in storage; 1 dp for grams
  and 3 dp for kilograms on display.
- **Confirmation is impossible outside the `OK` zone** (FR-10, C-07).
- **A confirmed record is immutable**; a correction is a new record
  referencing the original (BRD DR-02, C-12).
- **Only a supervisor, authenticated, can authorise an over-dose that is
  recorded outside tolerance** (FR-13, FR-21, NFR-12). No credential sharing.
- **Exactly one component is active at a time**, and `DONE` is terminal.
- **The session is resumable** at the component in progress (NFR-06).
- Displayed weight must lag the scale by ≤ 200 ms (NFR-01).
- The scale is selected **automatically**; the operator does not choose
  (FR-7, AC-02).
- Weighing is prevented on an out-of-calibration scale (AC-14).

---

## Success Criteria

### Functional

- [ ] A session opens for a selected batch with the recipe loaded.
- [ ] The correct scale is selected for each component without operator input.
- [ ] The live weight is evaluated on every reading and produces the correct
      zone.
- [ ] Confirmation is enabled only in the `OK` zone.
- [ ] An over-dose produces either a proportional compensation proposal or an
      escalation.
- [ ] A non-compensable over-dose cannot be confirmed without an
      authenticated supervisor authorisation carrying a reason.
- [ ] Confirming advances to the first pending component in recipe order.
- [ ] Confirming the last component completes the batch with a summary.
- [ ] The confirmed record carries operator, scale, lot, container, timestamp
      and the zone at confirmation.

### Non-Functional

- [ ] Displayed weight lags the scale by ≤ 200 ms (NFR-01, AC-03).
- [ ] Scale disconnection is detected within 2 s and weighing is blocked
      (IR-13).
- [ ] A confirmed weighing survives immediate power loss (NFR-05).
- [ ] An interrupted session resumes at the component in progress (NFR-06).
- [ ] All quantities are fixed-point decimal; no float appears in any
      quantity path.

### Quality

- [ ] All acceptance criteria met.
- [ ] The zone engine has an exhaustive boundary test at each threshold,
      including exactly at `target − tolerance`, exactly at `target × 0.9`,
      and exactly at `target + tolerance`.
- [ ] The session state machine has a transition test for every edge in the
      diagram above, including the illegal ones.
- [ ] The compensation rule is tested against the proportional formula, not
      against the prototype's example constant.
- [ ] Code reviewed and approved.

---

## Bolt Suggestions

> Generated from the bolt plan in `memory-bank/bolts/` by
> `scripts/sync-bolt-suggestions.cjs`. The bolt ids are a **global**
> sequence across all units, not a per-unit one.

| Bolt | Type | Stories | Objective |
|------|------|---------|-----------|
| `013-003-weighing-station` | DDD | 001-select-scale-automatically, 002-consume-live-weight-stream | Open the weighing session: select the scale automatically from the component’s requirements and consume the… |
| `014-003-weighing-station` | DDD | 003-evaluate-tolerance-zone, 004-gate-confirmation-on-zone | Evaluate the tolerance zone and gate confirmation on it: the zone is computed once, in one place, and confi… |
| `015-003-weighing-station` | DDD | 005-detect-overdose-and-calculate-surplus, 006-apply-surplus-compensation | Detect the over-dose, calculate the surplus, and where it is compensable, recalculate the remaining targets… |
| `016-003-weighing-station` | DDD | 007-escalate-non-compensable-overdose | Escalate a non-compensable over-dose to a supervisor and consume a valid authorisation from the identity un… |
| `017-003-weighing-station` | DDD | 008-advance-to-next-component | Advance the session to the first pending component in recipe order after a confirmation, and keep the confi… |
| `018-003-weighing-station` | DDD | 009-complete-batch-and-summarise | Close the batch at the last component and produce the summary the ticket is rendered from, with the consump… |

---

## Notes

**Why this unit carries eleven FRs.** The alternative — splitting the session
state machine from the tolerance engine — was considered and **rejected for
two concrete reasons.**

First, the zone calculation is a **pure value computation** over two inputs
(target and tolerance) and one reading. It has no state, no persistence, no
external contract and no independent failure mode. Extracting it would create
a unit that cannot fail on its own and cannot be deployed on its own — the
worst kind of unit boundary. It is instead modelled as a `ToleranceZone`
value object *inside* this unit, with its own dedicated boundary test suite.
That gives the isolation the risk actually needs without inventing a
deployment boundary with no purpose.

Second, if it *were* a separate unit, this unit would depend on it for every
reading — putting a network hop between the scale and the confirmation
button, directly at odds with NFR-01's ≤ 200 ms lag requirement.

The same reasoning rejected a separate "session" unit: the rule *is* the state
transition, and splitting them would produce a shared mutable object across a
network boundary — the classic way to lose the immutability guarantee
(DR-02) that the product exists to provide.

**The largest risk in the build lives here.** FR-12's compensation rule rests
on assumption **A-08**, which the BRD itself flags as the most likely
misunderstanding in the document. The rule is implemented *as stated in the
assumption* — proportionally recalculating the remaining components — and the
implementation records which rule it applied, so that a different answer from
FCI (Q-06) changes one place rather than requiring a rewrite.

**"More than a screen" — the testable claim.** This unit carries eleven of
twenty-three FRs and the entire session state machine. The UI unit (`007`)
carries **none**. The session API is provable without a UI, and the test
suite drives it directly. If the Weighing Station were a screen, this unit
would not exist and `007` would carry FR-7 through FR-15.

**The prototype's `1.026` is not a rule.** It is the prototype's own worked
example (+2.4 g on 94.0 g = +2.6%). The implementation uses
`surplus / totalRemainingTarget`, which reduces to the same figure *for that
example* and is correct for every other one.
