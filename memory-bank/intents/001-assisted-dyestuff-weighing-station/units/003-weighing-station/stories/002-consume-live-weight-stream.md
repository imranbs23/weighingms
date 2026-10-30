---
id: 002-consume-live-weight-stream
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
status: draft
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: false
---

# Story: 002-consume-live-weight-stream

## User Story

**As a** dyehouse operator
**I want** the current weight on the scale shown live while I dispense
**So that** I can stop dispensing at the right moment instead of guessing by eye

## Acceptance Criteria

- [ ] **Given** the session is in the `WEIGHING` state with a scale selected, **When** a weight reading arrives, **Then** the reading is accepted and the current weight is updated, at a rate of not less than 10 readings per second (FR-8, BRD IR-10, BRD FR-13).
- [ ] **Given** the current weight is `40.0000 g` and the active component's target is `94.0000 g`, **When** the readout is presented, **Then** the still-to-weigh quantity is `54.0000 g` — computed as `max(0, target − current)` (FR-8, BRD FR-14).
- [ ] **Given** the current weight is `120.0000 g` and the target is `94.0000 g`, **When** the still-to-weigh quantity is computed, **Then** it is `0.0000 g`, never negative (FR-8, BRD FR-14).
- [ ] **Given** the scale is streaming, **When** the weight changes on the scale, **Then** the displayed weight lags the scale by no more than 200 ms (FR-8, BRD NFR-01, NFR-1, AC-03).
- [ ] **Given** the scale disconnects, **When** the disconnection is detected, **Then** weighing is blocked within 2 s of the disconnection and confirmation is unavailable while disconnected (FR-8, BRD IR-13).

## Technical Notes

- The weight stream arrives over our **own internal interface** from unit `004-scale-integration` (SSE relayed server-side). This unit defines **no external scale API contract**; the dummy scale's training contract belongs to the integration unit.
- Each reading is a `WeightReading`: `value`, `unit`, `stable`, `sequence`, `receivedAt`. The `sequence` field exists to drop out-of-order readings; the `stable` flag distinguishes settling from settled and is surfaced, not collapsed (BRD IR-11).
- Every quantity on this path is fixed-point decimal (4 dp in storage; 1 dp for grams, 3 dp for kilograms on display). No float appears in the payload, in the arithmetic, or in the UI (BRD NFR-16, `C-11`).
- The still-to-weigh quantity is `max(0, target − current)` in fixed-point arithmetic; the clamp is applied in the domain, not in the renderer (FR-8).
- The ≤ 200 ms lag requirement is the reason the reading path does **not** traverse a network hop to a separate zone-computation service (see the unit brief's §Notes). The zone is evaluated in-process on each reading (story 003).
- Readings for a scale that is no longer the selected scale are discarded, so a late reading cannot corrupt the active component's state.
- On component selection the weight resets to zero (invariant 6); the stream's current value is re-established against the new active component.

## Dependencies

### Requires
- 001-select-scale-automatically (binds the stream to the selected scale)

### Enables
- 003-evaluate-tolerance-zone (the reading is the input to the zone engine)
- 004-gate-confirmation-on-zone (gating depends on the current reading)
- 005-detect-overdose-and-calculate-surplus (over-dose detection reads the live value)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| A reading arrives with a lower `sequence` than the last accepted one | Discarded as out of order; the current weight is unchanged |
| Reading arrives while the session is not in `WEIGHING` | Discarded; no component state is affected |
| Scale disconnects mid-dispense | Weighing blocked within 2 s; confirmation unavailable; the last known weight is retained for display and marked stale |
| Scale reconnects | The stream resumes; the current weight is re-established without an operator action |
| Weight reading carries a unit that does not match the component's unit | Rejected as invalid; the previous valid weight is retained and the condition is reported |
| Reading arrives with `stable = false` (still settling) | Accepted and displayed, with the settling distinction surfaced to the operator (BRD IR-11) |

## Out of Scope

- The scale protocol, connection handling and tare → `004-scale-integration`.
- The tolerance zone derived from the reading → story 003.
- The status line text and the progress-bar rendering → `007-weighingms-ui`.
