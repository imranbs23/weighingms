---
id: 005-detect-overdose-and-calculate-surplus
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: true
---

# Story: 005-detect-overdose-and-calculate-surplus

## User Story

**As a** dyehouse operator
**I want** the system to tell me exactly how much I have over-weighed
**So that** I know the size of the problem before deciding what to do about it

## Acceptance Criteria

- [ ] **Given** a target of `94.0000 g` and a tolerance of `0.5000 g`, **When** the reading is `96.4000 g`, **Then** an over-dose is detected and the surplus above the tolerance maximum is `1.9000 g` (BRD FR-11, BRD FR-20).
- [ ] **Given** an over-dose has been detected, **When** the surplus is presented, **Then** it is given as an absolute quantity and as a percentage of the target — `1.9000 g` surplus on a `94.0000 g` target is `+2.02%` (BRD FR-11, BRD FR-20).
- [ ] **Given** a reading of `96.4000 g` against a target of `94.0000 g`, **When** the surplus is calculated, **Then** the surplus is the amount above the **target** (`+2.4000 g`), matching the status line's "SURPLUS +n" wording (BRD FR-11).
- [ ] **Given** the zone is not `OVER`, **When** the surplus is computed, **Then** no surplus is produced and the over-dose response is not offered (BRD FR-11, BRD FR-20).
- [ ] **Given** the over-dose is detected, **When** the response is determined, **Then** the session moves to the `COMPENSATING` state and a compensability decision is made against the compensation rule (BRD FR-11, BRD FR-12).

## Technical Notes

- Over-dose detection is the `OVER` zone condition — `value > target + tolerance` — computed by the zone engine (story 003). This story detects and quantifies it; it does **not** recompute the zone.
- Two distinct quantities are involved and must not be conflated:
  - **Overshoot** = `value − (target + tolerance)` — how far past the tolerance maximum the reading is.
  - **Surplus** = `value − target` — the excess over the target, which is what the status line states ("OVER TOLERANCE — SURPLUS +2.4 g") and what the prototype's surplus panel shows ("+2.4 g (+2.6%)") (BRD FR-11).
  The prototype's worked example is `target + tolerance × 4.8` landing at a surplus of `+2.4 g` on a `94.0 g` target; the dummy scale reproduces that simulation.
- The surplus percentage is `surplus ÷ target × 100`, computed in fixed-point decimal with a defined rounding at the storage precision (4 dp). It is a display quantity; the compensation arithmetic uses the absolute surplus only.
- The surplus panel is visible **only** in the `OVER` zone. That visibility rule belongs to `007-weighingms-ui`; the domain exposes the surplus and the zone, and the renderer decides what to show (BRD FR-11).
- All quantities are fixed-point decimal (4 dp in storage; 1 dp for grams, 3 dp for kilograms on display) (BRD NFR-16, `C-11`).
- The detected surplus and the over-dose condition are the inputs to the compensability decision, which is implemented in story 006 under assumption `A-08` — the BRD's own highest-likelihood misunderstanding (BRD R-03, `Q-06`). The detection logic here must not presuppose a particular answer to `Q-06`; it produces the facts, and the compensation rule consumes them.

## Dependencies

### Requires
- 003-evaluate-tolerance-zone (the `OVER` zone that identifies the over-dose)

### Enables
- 006-apply-surplus-compensation (consumes the surplus to build the proportional proposal)
- 007-escalate-non-compensable-overdose (consumes the surplus and the compensability decision)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Reading exactly `target + tolerance` | Not an over-dose; the zone is `OK` and no surplus is produced |
| Reading one unit above `target + tolerance` | Over-dose detected; overshoot is `0.0001` (at storage precision) |
| Target is zero | The surplus percentage is undefined; the percentage is omitted and only the absolute surplus is reported |
| The zone moves from `OVER` back to `OK` before the operator acts | The surplus is withdrawn; the over-dose response is no longer offered, because the zone is recomputed on every reading |
| Reading is in a different unit from the component target | Rejected before surplus calculation; the previous valid state is retained |
| Multiple readings arrive in the `OVER` zone | The surplus reflects the latest accepted reading; it is not accumulated across readings |

## Out of Scope

- The proportional recalculation of remaining components → story 006.
- Supervisor escalation → story 007.
- The surplus panel's visual treatment → `007-weighingms-ui`.
- The dummy scale's overshoot simulation endpoint → `004-scale-integration`.
