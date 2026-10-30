---
id: 028-007-weighingms-ui
unit: 007-weighingms-ui
intent: 001-assisted-dyestuff-weighing-station
type: simple-construction-bolt
status: planned
stories:
  - 005-show-peripheral-degraded-states
created: 2026-10-30T09:00:00Z
started: null
completed: null
current_stage: null
stages_completed: []

# Bolt Dependencies (for execution ordering)
requires_bolts:
  - 027-007-weighingms-ui
  - 007-005-orgatex-integration
  - 003-004-scale-integration
enables_bolts: []
requires_units:
  - 004-scale-integration
  - 005-orgatex-integration
blocks: false

# Complexity Assessment (aggregate of included stories)
complexity:
  avg_complexity: 2
  avg_uncertainty: 1
  max_dependencies: 3
  testing_scope: 3
---

# Bolt: 028-007-weighingms-ui

## Overview

Build the degraded states, the status strip and the locale bundle wiring, so that every peripheral failure is visible and specific.

## Objective

Build the degraded states, the status strip and the locale bundle wiring, so that every peripheral failure is visible and specific.

## Stories Included

- [ ] **005-show-peripheral-degraded-states**: Show peripheral degraded states - Priority: must

## Bolt Type

**Type**: simple-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/simple-construction-bolt.md`

## Stages

- [ ] **1. plan**: Plan - Pending → implementation-plan.md
- [ ] **2. implement**: Implement - Pending → source code + implementation-walkthrough.md
- [ ] **3. test**: Test - Pending → test-walkthrough.md

## Expected Outputs

- implementation-plan.md — the status strip, the degraded states and the locale wiring
- src/007-weighingms-ui — the status strip, the degraded-state views and the locale bundle client
- implementation-walkthrough.md

## Dependencies

### Requires

- **027-007-weighingms-ui** — Build the completion view, the ticket preview and the print controls, including the not-printed state a failed print produces.
- **007-005-orgatex-integration** — Own the link state and the deferred synchronisation queue, so that the station keeps weighing while OrgaTEX is unreachable and nothing is silently discarded.
- **003-004-scale-integration** — Own the scale device seam: a continuous live-weight stream at ≥ 10 Hz and disconnect detection within 2 s that blocks weighing rather than letting a stale reading pass for a live one.

### Unit Dependencies (cross-unit)

- **004-scale-integration**: must be complete before this bolt can start.
- **005-orgatex-integration**: must be complete before this bolt can start.

### Enables

- None

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

No failure at any boundary may produce a silently wrong number. The hard-coded ORGATEX · LINKED of the prototype becomes a real state.
