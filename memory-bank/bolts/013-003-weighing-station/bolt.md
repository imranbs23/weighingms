---
id: 013-003-weighing-station
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 001-select-scale-automatically
  - 002-consume-live-weight-stream
created: 2026-10-30T09:00:00Z
started: 2026-11-06T02:20:00Z
completed: 2026-11-05T19:41:29Z
current_stage: null
stages_completed:
  - name: model
    completed: 2026-11-06T02:35:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-11-06T02:50:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-11-06T03:05:00Z
    artifact: adr-036-the-session-is-the-live-state-and-it-is-persisted.md
  - name: implement
    completed: 2026-11-06T03:20:00Z
    artifact: source code
requires_bolts:
  - 012-002-recipe-material-management
  - 004-004-scale-integration
  - 009-001-batch-management
enables_bolts:
  - 014-003-weighing-station
  - 025-007-weighingms-ui
requires_units:
  - 001-batch-management
  - 002-recipe-material-management
  - 004-scale-integration
blocks: false
complexity:
  avg_complexity: 3
  avg_uncertainty: 2
  max_dependencies: 3
  testing_scope: 3
---

# Bolt: 013-003-weighing-station

## Overview

Open the weighing session: select the scale automatically from the component’s requirements and consume the live weight stream into the session state.

## Objective

Open the weighing session: select the scale automatically from the component’s requirements and consume the live weight stream into the session state.

## Stories Included

- [ ] **001-select-scale-automatically**: Select scale automatically - Priority: must
- [ ] **002-consume-live-weight-stream**: Consume live weight stream - Priority: must

## Bolt Type

**Type**: ddd-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/ddd-construction-bolt.md`

## Stages

- [x] **1. model**: Domain Model - Complete → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis (optional) - Complete → adr-036
- [x] **4. implement**: Implement - Complete → source code
- [ ] **5. test**: Test - Pending → ddd-03-test-report.md

## Expected Outputs

- ddd-01-domain-model.md — WeighingSession, the session state machine and the WeightReading
- ddd-02-technical-design.md — the session API and the SSE subscription contract
- src/003-weighing-station/domain — the session model
- src/003-weighing-station/application — the session open and stream-consume use cases
- src/003-weighing-station/presentation — the session and snapshot endpoints

## Dependencies

### Requires

- **012-002-recipe-material-management** — Assign the container to the component and apply its tare, from the container master or by weighing the empty container.
- **004-004-scale-integration** — Apply the container tare and select the scale by capacity, so the reading the operator sees is the dyestuff and not the container.
- **009-001-batch-management** — Filter the queue by status and turn "the operator picked a batch" into a recorded selection carrying the method by which it was made.

### Unit Dependencies (cross-unit)

- **001-batch-management**: must be complete before this bolt can start.
- **002-recipe-material-management**: must be complete before this bolt can start.
- **004-scale-integration**: must be complete before this bolt can start.

### Enables

- 014-003-weighing-station
- 025-007-weighingms-ui

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

The session snapshot is the ONE source of truth the UI reads. Everything the client shows is derived server-side, which is why the client never computes a zone.
