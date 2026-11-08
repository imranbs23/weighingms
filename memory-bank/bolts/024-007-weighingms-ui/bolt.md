---
id: 024-007-weighingms-ui
unit: 007-weighingms-ui
intent: 001-assisted-dyestuff-weighing-station
type: simple-construction-bolt
status: complete
stories:
  - 001-select-batch-from-queue
created: 2026-10-30T09:00:00Z
started: 2026-11-06T19:10:00Z
completed: 2026-11-06T13:07:33Z
current_stage: null
stages_completed:
  - name: plan
    completed: 2026-11-06T19:30:00Z
    artifact: implementation-plan.md
  - name: implement
    completed: 2026-11-06T20:45:00Z
    artifact: implementation-walkthrough.md
  - name: test
    completed: 2026-11-06T21:00:00Z
    artifact: test-walkthrough.md
requires_bolts:
  - 009-001-batch-management
  - 022-006-ticket-printing
enables_bolts:
  - 025-007-weighingms-ui
requires_units:
  - 001-batch-management
  - 006-ticket-printing
blocks: false
complexity:
  avg_complexity: 2
  avg_uncertainty: 1
  max_dependencies: 2
  testing_scope: 2
---

# Bolt: 024-007-weighingms-ui

## Overview

Build the app shell, the persistent chrome and the Select-batch view, with batch selection by scan and by touch.

## Objective

Build the app shell, the persistent chrome and the Select-batch view, with batch selection by scan and by touch.

## Stories Included

- [ ] **001-select-batch-from-queue**: Select batch from queue - Priority: must

## Bolt Type

**Type**: simple-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/simple-construction-bolt.md`

## Stages

- [x] **1. plan**: Plan - Complete → implementation-plan.md
- [x] **2. implement**: Implement - Complete → source code + implementation-walkthrough.md
- [x] **3. test**: Test - Complete → test-walkthrough.md

## Expected Outputs

- implementation-plan.md — the shell, the chrome and the queue view
- src/007-weighingms-ui — the app shell, the topbar crumb, the status strip and the queue view
- implementation-walkthrough.md

## Dependencies

### Requires

- **009-001-batch-management** — Filter the queue by status and turn "the operator picked a batch" into a recorded selection carrying the method by which it was made.
- **022-006-ticket-printing** — Provide a configuration store and runtime-loaded locale bundles, so that scale thresholds, tolerance overrides, the label template and the language change without a redeployment.

### Unit Dependencies (cross-unit)

- **001-batch-management**: must be complete before this bolt can start.
- **006-ticket-printing**: must be complete before this bolt can start.

### Enables

- 025-007-weighingms-ui

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

No hard-coded data in the client: no batch, no recipe, no component, no weight, no lot. The only literals permitted are the design tokens.
