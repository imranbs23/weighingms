---
id: 030-003-weighing-station
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 004-gate-confirmation-on-zone
  - 007-escalate-non-compensable-overdose
created: 2026-11-11T07:58:07Z
started: 2026-11-11T07:58:07Z
completed: 2026-11-11T09:11:30Z
current_stage: null
stages_completed:
  - name: model
    completed: 2026-11-11T07:59:49Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-11-11T08:55:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-11-11T09:10:00Z
    artifact: adr-047-over-is-confirmed-only-through-a-supervisor-override.md
  - name: implement
    completed: 2026-11-11T09:50:00Z
    artifact: source code
  - name: test
    completed: 2026-11-11T09:15:00Z
    artifact: ddd-03-test-report.md
requires_bolts:
  - 016-003-weighing-station
  - 029-007-weighingms-ui
enables_bolts: []
requires_units:
  - 007-weighingms-ui
  - 008-operator-identity
blocks: false
complexity:
  avg_complexity: 2
  avg_uncertainty: 1
  max_dependencies: 3
  testing_scope: 3
---

# Bolt: 030-003-weighing-station

## Overview

Implement the overshoot rule the project owner decided at the workbook's
Step 24 checkpoint (option C, supervisor-gated). Appended during
construction (`bolt-replan` → append).

## Objective

An over-tolerance component is never confirmed automatically and no recipe
is recalculated. The operator either re-tares and re-weighs, or a supervisor
authenticates at the terminal, gives a reason, and authorises confirming the
weight as poured: single-use, scoped to that component, recorded, and
marked OVERRIDDEN.

## Stories Included

- [x] **004-gate-confirmation-on-zone**: the gate admits OVER only with a consumed, authorised override (BRD FR-18)
- [x] **007-escalate-non-compensable-overdose**: the escalation is offered for EVERY over-dose, not only a non-compensable one (BRD FR-23, FR-24)

Story `006-apply-surplus-compensation` is **not** in scope: under the
decision its proposal is withdrawn from the operator UI until FCI answers
Q25/Q26. Its code stays, unused.

## Bolt Type

**Type**: ddd-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/ddd-construction-bolt.md`

## Stages

- [x] **1. model**: Domain Model - Complete (APPROVE MODEL) → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete (APPROVE DESIGN) → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis - Complete (APPROVE ADR) → adr-047-over-is-confirmed-only-through-a-supervisor-override.md
- [x] **4. implement**: Implement - Complete (APPROVE IMPLEMENTATION) → source code
- [x] **5. test**: Test - Complete (APPROVE TESTS) → ddd-03-test-report.md

## Dependencies

### Requires

- **016-003-weighing-station** — the escalation and the override record
- **029-007-weighingms-ui** — the weigh view and its panels

## Success Criteria

- [x] OVER cannot be confirmed without a consumed supervisor authorisation
- [x] With one, the weighing is recorded as poured, zone OVER, linked to its override record
- [x] The supervisor's own credentials are required, never the operator's
- [x] Re-tare and re-weigh remains available
- [x] The surplus proposal is no longer offered to the operator
- [x] Tests passing; Step 30's over-tolerance scenario still passes

## Notes

Source: `evidence/STEP-24-overshoot-decision.md`.
