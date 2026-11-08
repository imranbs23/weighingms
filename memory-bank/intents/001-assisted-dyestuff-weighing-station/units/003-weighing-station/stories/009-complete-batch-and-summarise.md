---
id: 009-complete-batch-and-summarise
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: true
---

# Story: 009-complete-batch-and-summarise

## User Story

**As a** dyehouse operator
**I want** a clear summary of the batch once the last component is weighed
**So that** I know the batch is finished, what was dispensed, and whether it was good

## Acceptance Criteria

- [ ] **Given** the last component in the recipe is confirmed, **When** the confirmation completes, **Then** the session moves to the `COMPLETE` state and no component remains `PENDING` (BRD FR-15, invariant 4).
- [ ] **Given** a batch is complete, **When** the summary is produced, **Then** it shows the batch identifier, the components weighed as a count of the total, the elapsed time and the operator (BRD FR-15, BRD FR-26, BRD FR-29).
- [ ] **Given** a batch is complete, **When** the summary is produced, **Then** it states whether all components were within tolerance — `YES` only when every confirmed weighing was in the `OK` zone — and it shows the total dispensed, summing grams and kilograms correctly (BRD FR-15, BRD FR-26).
- [ ] **Given** a batch is complete, **When** the summary is produced, **Then** it shows the OrgaTEX write-back result and its confirmation time, and states that the container is released for transport with the target machine (BRD FR-15, BRD FR-26, BRD AC-08).
- [ ] **Given** a batch is complete, **When** the summary is produced, **Then** the total dispensed is computed in fixed-point decimal with units converted and summed correctly — grams and kilograms are added as one quantity, never by concatenating display strings (BRD FR-15, BRD NFR-16, `C-11`).

## Technical Notes

- The summary is produced by the **domain**, not assembled by the UI from display strings. The total dispensed is computed from the stored fixed-point quantities, converting units before summing.
- "All within tolerance: YES" is true only when **every** confirmed weighing's `zoneAtConfirm` is `OK`. A component confirmed under a supervisor override (story 007) was **not** within tolerance, and the summary must say `NO`. This is what makes the summary a usable quality signal (BRD FR-15, BRD FR-11).
- The OrgaTEX write-back (actual consumption per component plus the batch weighing status advanced to `WEIGHED`) is performed on completion and is **idempotent** — a retry after an ambiguous failure must not double-post (BRD IR-08, `C-14`). The summary shows the write-back result and its confirmation time, including a failure state when the write-back has not been confirmed (BRD IR-09, A-03, `Q-02`).
- All OrgaTEX interaction is confined to a single adapter component (BRD IR-07, `C-13`); this story consumes the adapter's result and does not define an OrgaTEX contract.
- Weighing continues when OrgaTEX is unreachable; unsynchronised records are queued and transmitted on reconnection, and the summary reflects that the write-back is pending (BRD FR-30, BRD FR-31, BRD NFR-03, `Q-02`). A pending write-back does not un-complete the batch.
- The summary states that the container is released for transport and names the target machine. The **ticket** that accompanies the container is produced by `BRD FR-17` and is out of this unit's scope; this story produces the summary content only (BRD FR-27).
- All quantities are fixed-point decimal (4 dp in storage; 1 dp for grams, 3 dp for kilograms on display) (BRD NFR-16, `C-11`).
- The elapsed time is measured from the session's `startedAt` to the completion moment.
- Weighing records, compensations and overrides are retained ≥ 5 years (BRD DR-01); the summary reads from those immutable records and never mutates them (BRD DR-02, `C-12`).

## Dependencies

### Requires
- 008-advance-to-next-component (reaching the last component triggers completion)
- 004-gate-confirmation-on-zone (the confirmed records the summary reads)

### Enables
- None (terminal story of the unit)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| A component was confirmed under a supervisor override | "All within tolerance" is `NO`; the summary still completes the batch |
| OrgaTEX is unreachable at completion | The batch completes; the write-back is queued and the summary shows the write-back as pending, not confirmed (BRD FR-30, BRD IR-09) |
| The write-back is retried after an ambiguous failure | The posting is idempotent; the consumption is not double-posted (BRD IR-08, `C-14`) |
| The recipe mixes grams and kilograms | The total dispensed sums correctly after unit conversion — e.g. `500.0 g` + `24.000 kg` = `24.500 kg` |
| The session was interrupted and resumed | The elapsed time reflects the whole session, including the interruption; it is not silently reset |
| A component was abandoned and re-weighed before completion | Only the confirmed record counts towards the total and the component count; the abandoned attempt contributes nothing |
| The scale disconnects at the moment of the final confirmation | The confirmation is blocked while disconnected; the batch does not complete on a stale reading (BRD IR-13) |

## Out of Scope

- Ticket generation and reprint → `BRD FR-17`, `006-ticket-printing`.
- The OrgaTEX adapter's protocol and contract → `005-orgatex-integration`.
- Offline synchronisation mechanics → `BRD FR-20`.
- Rendering the summary → `007-weighingms-ui`.
- Operational reporting over batches and overrides → `BRD FR-23`.
