---
id: 001-select-scale-automatically
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
status: draft
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: false
---

# Story: 001-select-scale-automatically

## User Story

**As a** dyehouse operator
**I want** the correct scale to be selected for me when a component becomes active
**So that** I never have to decide which scale to use and never weigh on the wrong one

## Acceptance Criteria

- [ ] **Given** a component is active with a target quantity of `0.5000 kg`, **When** the component is selected, **Then** the scale-selection rule resolves the required scale class from the target quantity and the session binds to that scale, with no operator input (FR-7, BRD FR-07, BRD BR-05, AC-02).
- [ ] **Given** the scale has been selected automatically, **When** the operator views the weigh view, **Then** the selected scale is identified by its class and capacity, and the selection cannot be changed by the operator acting alone (FR-7, BRD FR-07, AC-02).
- [ ] **Given** the selected scale's calibration has expired, **When** the scale is selected for a component, **Then** weighing on that scale is prevented and the reason is reported (FR-7, BRD FR-12, BRD FR-24, AC-14).
- [ ] **Given** no available scale satisfies the selection rule for the component's target quantity, **When** the component is selected, **Then** the session does not enter the `WEIGHING` state and a visible reason is given (FR-7, BRD FR-07).
- [ ] **Given** the operator has selected a component that is not `DONE`, **When** the selection succeeds, **Then** the weight is reset to zero and the session state moves to `WEIGHING` on the selected scale (BRD FR-14, NFR-06).

## Technical Notes

- Scale selection is a **rule evaluated by the domain**, not a UI concern: the target quantity and the scale-selection threshold from unit `002-recipe-material-management` determine the required scale class. The threshold itself is still open (`Q-04`), so the rule must be configuration-driven, not hard-coded (BRD NFR-14).
- The operator **never chooses** the scale. Manual reselection is a privileged action that belongs to the escalation/override path (story 007) and to `BRD FR-21`; it is explicitly out of scope here.
- `selectComponent` resets the weight to zero (invariant 6 of the unit brief). A component already `DONE` is terminal and can never be re-selected (invariant 2, `C-08`).
- The selected scale's identity (`scaleId`, `scaleClass`) is snapshotted onto the weighing record when the weighing is confirmed, so a later reselection or calibration change cannot alter the historical record (BRD FR-25, BRD BR-14).
- All quantities are fixed-point decimal (4 dp in storage); no float appears in the selection rule or its thresholds (BRD NFR-16).
- Scale status arrives over our own internal interface from unit `004-scale-integration`. No external scale API contract is invented here.

## Dependencies

### Requires
- None (first story of the unit; the session aggregate is established here)

### Enables
- 002-consume-live-weight-stream (binds the weight stream to the selected scale)
- 003-evaluate-tolerance-zone (evaluates against the active component's target and tolerance)
- 008-advance-to-next-component (component selection drives progression)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Target exactly at the scale-selection threshold | Boundary is resolved deterministically by the configured rule; the rule's tie-break is a single defined function, not per-call-site logic |
| Target quantity exceeds every available scale's capacity | No scale selected; the component cannot be weighed and a reason is shown |
| Selected scale is disconnected at the moment of selection | Weighing is blocked; scale disconnection is detected within 2 s (BRD IR-13) |
| Calibration expires mid-session | Weighing on that scale is prevented; no weighing is recorded against it |
| Component already `DONE` is selected again | Selection is rejected — `DONE` is terminal (invariant 2, `C-08`) |

## Out of Scope

- Where the scale data comes from → `004-scale-integration` (status, tare, streaming).
- The scale-selection threshold value itself → open question `Q-04`, owned by FCI production.
- Supervisor-authorised manual scale reselection → `BRD FR-21` privileged actions; the override mechanics are in story 007.
- Rendering the scale panel → `007-weighingms-ui`.
