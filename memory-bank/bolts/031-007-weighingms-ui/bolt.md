---
id: 031-007-weighingms-ui
unit: 007-weighingms-ui
intent: 001-assisted-dyestuff-weighing-station
type: simple-construction-bolt
status: complete
stories:
  - 002-watch-live-weight-and-tolerance-zone
  - 003-confirm-weighing-and-advance
created: 2026-11-11T12:03:07Z
started: 2026-11-11T12:03:07Z
completed: 2026-11-11T12:40:03Z
current_stage: null
stages_completed:
  - name: plan
    completed: 2026-11-11T12:20:00Z
    artifact: implementation-plan.md
  - name: implement
    completed: 2026-11-11T12:40:00Z
    artifact: implementation-walkthrough.md
  - name: test
    completed: 2026-11-11T13:10:00Z
    artifact: test-walkthrough.md
requires_bolts:
  - 011-002-recipe-material-management
  - 012-002-recipe-material-management
  - 030-003-weighing-station
enables_bolts: []
requires_units:
  - 002-recipe-material-management
  - 003-weighing-station
blocks: false
complexity:
  avg_complexity: 2
  avg_uncertainty: 2
  max_dependencies: 3
  testing_scope: 3
---

# Bolt: 031-007-weighingms-ui

## Overview

Capture the lot and the container in the weigh view, show lot, container and
tare in the component header, and carry the lot and container onto the
weighing record and the ticket. Appended during construction (`bolt-replan`
→ append) after the workbook's Step 20 check found Lot, Container and Tare
missing from the weigh view (`evidence/STEP-20-weigh-screen.md`).

## Objective

For each component the operator can scan or key the lot and the container;
the header reads like the prototype's ("DYE-4471 · Lot 2026-0387 · Container
C-12 · Tare 214 g"); and the confirmed record, the completion detail and the
ticket carry the lot and the container instead of "No reading".

## Stories Included

- [x] **002-watch-live-weight-and-tolerance-zone**: the header shows the component's lot, container and tare
- [x] **003-confirm-weighing-and-advance**: the lot and container are captured before confirming and recorded with the weighing

Unit 002's stories `003-capture-and-validate-dyestuff-lot` and
`004-assign-container-and-apply-tare` are already built (bolts 011–012);
this bolt uses their endpoints and does not change them.

## Bolt Type

**Type**: simple-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/simple-construction-bolt.md`

## Stages

- [x] **1. plan**: Plan - Complete (APPROVE PLAN, option A: prompted, optional) → implementation-plan.md
- [x] **2. implement**: Implement - Complete (APPROVE IMPLEMENTATION) → source code + implementation-walkthrough.md
- [x] **3. test**: Test - Complete (APPROVE TESTS) → test-walkthrough.md

## Expected Outputs

- implementation-plan.md
- src/007-weighingms-ui — the capture panel and the header
- unit 003 composition — the record reads the session's lot and container
- implementation-walkthrough.md, test-walkthrough.md

## Dependencies

### Requires

- **011-002-recipe-material-management** — lot capture (`POST /api/material-lot`)
- **012-002-recipe-material-management** — container assignment and tare (`POST /api/container`)
- **030-003-weighing-station** — the current weigh view and gate

## Success Criteria

- [x] The header shows lot, container and tare once captured
- [x] The confirmed record carries the lot and container captured in this session
- [x] The ticket's lines carry them, and the completion detail shows them (the paper preview lists material, target and actual only, like the prototype's)
- [x] A capture from an earlier session is never shown or recorded
- [x] Tests passing; Steps 24, 29 and 30 still pass

## Notes

Source: `evidence/STEP-20-weigh-screen.md`.
