---
id: 025-007-weighingms-ui
unit: 007-weighingms-ui
intent: 001-assisted-dyestuff-weighing-station
type: simple-construction-bolt
status: complete
stories:
  - 002-watch-live-weight-and-tolerance-zone
created: 2026-10-30T09:00:00Z
started: 2026-11-06T21:20:00Z
completed: 2026-11-06T15:23:49Z
current_stage: null
stages_completed:
  - name: plan
    completed: 2026-11-06T21:40:00Z
    artifact: implementation-plan.md
  - name: implement
    completed: 2026-11-06T22:10:00Z
    artifact: implementation-walkthrough.md
  - name: test
    completed: 2026-11-06T22:40:00Z
    artifact: test-walkthrough.md
requires_bolts:
  - 024-007-weighingms-ui
  - 013-003-weighing-station
enables_bolts:
  - 026-007-weighingms-ui
requires_units:
  - 003-weighing-station
blocks: false
complexity:
  avg_complexity: 2
  avg_uncertainty: 1
  max_dependencies: 2
  testing_scope: 3
---

# Bolt: 025-007-weighingms-ui

## Overview

Build the Weigh view — the recipe rail, the live readout, the tolerance band and the status line — driven entirely by the session snapshot.

## Objective

Build the Weigh view — the recipe rail, the live readout, the tolerance band and the status line — driven entirely by the session snapshot.

## Stories Included

- [ ] **002-watch-live-weight-and-tolerance-zone**: Watch live weight and tolerance zone - Priority: must

## Bolt Type

**Type**: simple-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/simple-construction-bolt.md`

## Stages

- [x] **1. plan**: Plan - Complete → implementation-plan.md
- [x] **2. implement**: Implement - Complete → source code + implementation-walkthrough.md
- [x] **3. test**: Test - Complete → test-walkthrough.md

## Expected Outputs

- implementation-plan.md — the weigh view and its data contract
- src/007-weighingms-ui — the weigh view, the recipe rail, the readout, the band and the status line
- implementation-walkthrough.md

## Dependencies

### Requires

- **024-007-weighingms-ui** — Build the app shell, the persistent chrome and the Select-batch view, with batch selection by scan and by touch.
- **013-003-weighing-station** — Open the weighing session: select the scale automatically from the component’s requirements and consume the live weight stream into the session state.

### Unit Dependencies (cross-unit)

- **003-weighing-station**: must be complete before this bolt can start.

### Enables

- 026-007-weighingms-ui

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

The zone is RECEIVED, never computed by the client. The disabled state of the confirm button is the visual half of FR-10.
