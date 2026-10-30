---
id: 026-007-weighingms-ui
unit: 007-weighingms-ui
intent: 001-assisted-dyestuff-weighing-station
type: simple-construction-bolt
status: planned
stories:
  - 003-confirm-weighing-and-advance
created: 2026-10-30T09:00:00Z
started: null
completed: null
current_stage: null
stages_completed: []

# Bolt Dependencies (for execution ordering)
requires_bolts:
  - 025-007-weighingms-ui
  - 016-003-weighing-station
enables_bolts:
  - 027-007-weighingms-ui
requires_units:
  - 003-weighing-station
blocks: false

# Complexity Assessment (aggregate of included stories)
complexity:
  avg_complexity: 3
  avg_uncertainty: 1
  max_dependencies: 2
  testing_scope: 3
---

# Bolt: 026-007-weighingms-ui

## Overview

Build the action row, the confirmation, the progression, the surplus panel and the escalation prompt.

## Objective

Build the action row, the confirmation, the progression, the surplus panel and the escalation prompt.

## Stories Included

- [ ] **003-confirm-weighing-and-advance**: Confirm weighing and advance - Priority: must

## Bolt Type

**Type**: simple-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/simple-construction-bolt.md`

## Stages

- [ ] **1. plan**: Plan - Pending → implementation-plan.md
- [ ] **2. implement**: Implement - Pending → source code + implementation-walkthrough.md
- [ ] **3. test**: Test - Pending → test-walkthrough.md

## Expected Outputs

- implementation-plan.md — the action row and the two panels
- src/007-weighingms-ui — the action row, the confirm flow, the surplus panel and the escalation panel
- implementation-walkthrough.md

## Dependencies

### Requires

- **025-007-weighingms-ui** — Build the Weigh view — the recipe rail, the live readout, the tolerance band and the status line — driven entirely by the session snapshot.
- **016-003-weighing-station** — Escalate a non-compensable over-dose to a supervisor and consume a valid authorisation from the identity unit, recording the authoriser and the reason.

### Unit Dependencies (cross-unit)

- **003-weighing-station**: must be complete before this bolt can start.

### Enables

- 027-007-weighingms-ui

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

A disabled action states its reason. A silently dead button on a gloved terminal is a support call.
