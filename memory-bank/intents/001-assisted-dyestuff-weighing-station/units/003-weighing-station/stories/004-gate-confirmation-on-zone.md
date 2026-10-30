---
id: 004-gate-confirmation-on-zone
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
status: draft
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: false
---

# Story: 004-gate-confirmation-on-zone

## User Story

**As a** dyehouse operator
**I want** to be able to confirm a weighing only when it is inside tolerance
**So that** an out-of-tolerance weighing can never reach production by accident

## Acceptance Criteria

- [ ] **Given** the zone is `UNDER`, **When** the operator attempts to confirm, **Then** the confirmation is refused and no `WeighingRecord` is written (BRD FR-10, `C-07`, BRD AC-04).
- [ ] **Given** the zone is `NEAR`, **When** the operator attempts to confirm, **Then** the confirmation is refused and no `WeighingRecord` is written (BRD FR-10, `C-07`, BRD AC-04).
- [ ] **Given** the zone is `OVER`, **When** the operator attempts to confirm, **Then** the confirmation is refused and no `WeighingRecord` is written, unless an authorised override is in force (BRD FR-10, BRD FR-13, `C-07`).
- [ ] **Given** the zone is `OK`, **When** the operator confirms, **Then** a `WeighingRecord` is written carrying the operator, scale, lot, container, timestamp, target, actual quantity and the zone at confirmation (`OK`) (BRD FR-10, BRD FR-18, BRD FR-13, BRD FR-25, AC-07).
- [ ] **Given** a confirmation has been written, **When** the record is inspected, **Then** it cannot be edited or deleted — a correction is a **new** record referencing the original (BRD DR-02, `C-12`).

## Technical Notes

- **Confirmation is impossible unless the zone is `OK`.** There is no other path to a `WeighingRecord` (invariant 3 of the unit brief). The gate is enforced in the **domain/service layer**, not only by disabling a button in the UI — a disabled button is presentation, not a control (BRD FR-10, `C-07`).
- The service rejects a confirmation whose current zone is not `OK`, returning a reason that distinguishes `UNDER`, `NEAR` and `OVER` so the UI can show the right next step.
- The `OVER` exception is **not** implemented here. It arrives as a valid authorisation issued through story 007 — a supervisor-authenticated, reasoned, scoped, expiring override. This story consumes that authorisation; it does not create it.
- On confirmation the record snapshots the target and tolerance values **as they were at weighing time**, so a later revision in OrgaTEX cannot alter the historical record (BRD §9.2 WEIGHING_RECORD note, BRD BR-14).
- The confirmed record is **append-only**: `WeighingRecord` rows are never updated or deleted (BRD DR-02, `C-12`). Corrections are new rows carrying a reference to the original.
- Retention for weighing records is ≥ 5 years (BRD DR-01).
- All quantities are fixed-point decimal (4 dp in storage) (BRD NFR-16, `C-11`).
- An in-progress component may be abandoned and restarted; abandoning does **not** write a record and does not mark the component `DONE` (BRD FR-10, BRD FR-19).

## Dependencies

### Requires
- 003-evaluate-tolerance-zone (the zone that gates confirmation)
- 002-consume-live-weight-stream (the current reading that will be recorded)

### Enables
- 008-advance-to-next-component (a confirmed record drives progression)
- 009-complete-batch-and-summarise (the last confirmation completes the batch)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The zone changes to `OVER` between the operator seeing `OK` and pressing confirm | The confirmation is refused; the gate reads the **current** zone at confirmation time, not the zone last displayed |
| The scale disconnects immediately before confirmation | Confirmation is blocked while disconnected (BRD IR-13) |
| The confirmation request is replayed (duplicate submit) | The second attempt does not write a second record; confirmation is idempotent per component in a session |
| Power loss immediately after the confirmation response | The confirmed weighing survives immediate power loss (NFR-3, BRD NFR-05) |
| A correction is required after confirmation | A new record is written referencing the original; the original is untouched (BRD DR-02, `C-12`) |
| The operator abandons an in-progress component | No record is written; the component returns to `PENDING`; the weight resets to zero (BRD FR-10, BRD FR-19) |

## Out of Scope

- Creating a supervisor override → story 007.
- Component progression after confirmation → story 008.
- The weigh-view's button states and status line → `007-weighingms-ui`.
- Audit-trail export and reporting → `006-ticket-printing` / `BRD FR-21` infrastructure.
