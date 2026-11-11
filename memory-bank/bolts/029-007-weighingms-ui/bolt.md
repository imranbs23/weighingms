---
id: 029-007-weighingms-ui
unit: 007-weighingms-ui
intent: 001-assisted-dyestuff-weighing-station
type: simple-construction-bolt
status: complete
stories:
  - 001-select-batch-from-queue
  - 002-watch-live-weight-and-tolerance-zone
  - 003-confirm-weighing-and-advance
  - 004-review-and-print-ticket
  - 005-show-peripheral-degraded-states
created: 2026-11-10T14:41:17Z
started: 2026-11-10T14:41:17Z
completed: 2026-11-11T06:49:37Z
current_stage: null
stages_completed:
  - name: plan
    completed: 2026-11-10T14:46:50Z
    artifact: implementation-plan.md
  - name: implement
    completed: 2026-11-11T06:32:01Z
    artifact: implementation-walkthrough.md
  - name: test
    completed: 2026-11-11T06:49:37Z
    artifact: test-walkthrough.md
requires_bolts:
  - 028-007-weighingms-ui
enables_bolts: []
requires_units:
  - 001-batch-management
  - 002-recipe-material-management
  - 003-weighing-station
  - 004-scale-integration
  - 005-orgatex-integration
  - 006-ticket-printing
blocks: false
complexity:
  avg_complexity: 3
  avg_uncertainty: 2
  max_dependencies: 6
  testing_scope: 3
---

# Bolt: 029-007-weighingms-ui

## Overview

Wire the five operator views into one working workflow and bring the
terminal's presentation up to the supplied prototype. Appended during
construction (bolt-replan → append) after the workbook's Step 28 validation
found that the screens built by bolts 024–028 work in isolation but cannot
be driven end to end.

## Objective

An operator can sign in, select B-24187, weigh all five components on the
dummy scales, complete the batch (OrgaTEX write-back) and print the ticket
**through the UI alone**, on a terminal that looks like the prototype.

## Stories Included

- [x] **001-select-batch-from-queue**: selection opens the weigh view (B1)
- [x] **002-watch-live-weight-and-tolerance-zone**: the rail before a session, the band and capacity, the training dispense (B2, B3, V2)
- [x] **003-confirm-weighing-and-advance**: re-tare, quit, override, function keys, completion transition (B4, B5, V3)
- [x] **004-review-and-print-ticket**: complete the batch, next batch, barcode (B5, B6, V4)
- [x] **005-show-peripheral-degraded-states**: idle scales READY, scanner/printer/clock/locale (B7, V5)

## Bolt Type

**Type**: simple-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/simple-construction-bolt.md`

## Stages

- [x] **1. plan**: Plan - Complete (approved, barcode option 1) → implementation-plan.md
- [x] **2. implement**: Implement - Complete (approved) → source code + implementation-walkthrough.md
- [x] **3. test**: Test - Complete (approved) → test-walkthrough.md

## Expected Outputs

- implementation-plan.md
- src/007-weighingms-ui — the workflow wiring, the training controls and the terminal layout
- the minimum API additions the wiring needs (listed in the plan)
- implementation-walkthrough.md, test-walkthrough.md

## Dependencies

### Requires

- **028-007-weighingms-ui** — the last of the original UI bolts.

### Enables

- None — the workbook's Step 29 (Playwright end to end) depends on it.

## Success Criteria

- [x] All Step 28 blockers B1–B7 closed
- [x] Visual gaps V1–V5 closed or explicitly deferred with a reason
- [x] Tests passing
- [x] Step 28 re-validated against the running app

## Notes

Source of the scope: `evidence/STEP-28-ui-validation/validation.md`
(re-validation 2026-11-10).
