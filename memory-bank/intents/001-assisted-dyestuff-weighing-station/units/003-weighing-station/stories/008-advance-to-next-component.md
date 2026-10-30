---
id: 008-advance-to-next-component
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
status: draft
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: false
---

# Story: 008-advance-to-next-component

## User Story

**As a** dyehouse operator
**I want** the station to move on to the next component automatically once I confirm
**So that** I never have to choose what comes next and never skip or repeat a component

## Acceptance Criteria

- [ ] **Given** a component has been confirmed, **When** the confirmation completes, **Then** the next `PENDING` component in **recipe order** becomes `ACTIVE` and the weigh view moves to it — progression is by recipe order, not by operator choice (BRD FR-14, BRD FR-06).
- [ ] **Given** a component has been confirmed, **When** the progression occurs, **Then** the confirmed component's state becomes `DONE` and **exactly one** component is `ACTIVE` at a time (BRD FR-14, invariant 1).
- [ ] **Given** a component is `DONE`, **When** a selection of that component is attempted, **Then** the selection is rejected — `DONE` is terminal and cannot be re-selected or re-weighed (BRD FR-14, `C-08`, BRD FR-02, invariant 2).
- [ ] **Given** a `PENDING` component that is not the next in recipe order, **When** the operator selects it, **Then** the selection is accepted, that component becomes `ACTIVE`, and the weight resets to zero (BRD FR-14, BRD FR-19, invariant 6).
- [ ] **Given** the session is interrupted and resumed, **When** the session is restored, **Then** it resumes at the component in progress with its state intact (NFR-3, BRD NFR-06, invariant 7).

## Technical Notes

- Progression is a **domain transition**, not a UI navigation. The confirmed component's `DONE` state and the next component's activation happen in one atomic transition with the record write, so a crash cannot leave two `ACTIVE` components or a `DONE` component with no record.
- **Invariant 1: exactly one component is `ACTIVE` at a time.** The transition enforces it.
- **Invariant 2: `DONE` is terminal.** A completed component can never be re-selected or re-weighed. Re-weighing is done by writing a **new** record that references the original, never by editing the old one (BRD DR-02, `C-12`).
- **Invariant 4: confirming advances to the first `PENDING` component in recipe order.** The recipe order comes from the recipe loaded at session start (unit `005-orgatex-integration` / `002-recipe-material-management`); it is read-only and is never modified by WeighingMS (C-01).
- **Invariant 6: selecting a component resets the weight to zero.** The weight is reset on selection, not on confirmation, so a re-selection never shows a stale weight from a previous component.
- **Invariant 7: the session is resumable at the component in progress.** The session row and the per-component progress rows are persisted, so a power loss or terminal restart restores the exact component and state (BRD NFR-05, BRD NFR-06). A confirmed weighing survives immediate power loss — the record write is durable before the response is returned.
- The confirmed record is **immutable**: no update, no delete. Corrections are new records referencing the original (BRD DR-02, `C-12`).
- Component progress is persisted as one row per component per session, session-scoped.
- All quantities are fixed-point decimal (BRD NFR-16, `C-11`).
- The batch weighing status write-back to OrgaTEX is **not** performed on component progression — it happens on batch completion (story 009, `BRD FR-16`).

## Dependencies

### Requires
- 004-gate-confirmation-on-zone (a confirmed weighing drives progression)
- 001-select-scale-automatically (component selection and the weight reset)

### Enables
- 009-complete-batch-and-summarise (progression determines when the last component is reached)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The last component in the recipe is confirmed | No component becomes `ACTIVE`; the session moves to `COMPLETE` (story 009) |
| The operator selects a `PENDING` component out of sequence | Accepted; the weight resets to zero; the previously `ACTIVE` component returns to `PENDING` and no record is written for it |
| The operator selects the currently `ACTIVE` component again | The selection is accepted (it is not `DONE`) and the weight resets to zero; the dispense is abandoned and restarted (BRD FR-19) |
| A `DONE` component is selected | Rejected — `DONE` is terminal (invariant 2, `C-08`) |
| Power loss immediately after confirmation, before the response | The record is durable; on resume the component is `DONE` and the next component is `ACTIVE` (BRD NFR-05) |
| The recipe contains a component with a target of zero | Handled by the zone engine's zero-target rule; progression is unaffected |
| Two confirmations for the same component arrive concurrently | Only one record is written; the second is refused as a duplicate |

## Out of Scope

- Loading the recipe and its order → `005-orgatex-integration` / `002-recipe-material-management`.
- The batch completion summary → story 009.
- The rail rendering of component states → `007-weighingms-ui`.
- Corrections as new referencing records → the record model is in story 004; the correction *workflow* is out of this unit's scope.
