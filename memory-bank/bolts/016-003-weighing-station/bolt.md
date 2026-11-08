---
id: 016-003-weighing-station
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 007-escalate-non-compensable-overdose
created: 2026-10-30T09:00:00Z
started: 2026-11-06T08:10:00Z
completed: 2026-11-06T06:04:17Z
current_stage: null
stages_completed:
  - name: model
    completed: 2026-11-06T08:30:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-11-06T08:50:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-11-06T09:05:00Z
    artifact: adr-039-this-bolt-implements-no-authorisation-mechanism.md
  - name: implement
    completed: 2026-11-06T09:40:00Z
    artifact: source code
requires_bolts:
  - 015-003-weighing-station
  - 002-008-operator-identity
enables_bolts:
  - 021-006-ticket-printing
  - 026-007-weighingms-ui
requires_units:
  - 008-operator-identity
blocks: false
complexity:
  avg_complexity: 3
  avg_uncertainty: 1
  max_dependencies: 3
  testing_scope: 3
---

# Bolt: 016-003-weighing-station

## Overview

Escalate a non-compensable over-dose to a supervisor and consume a valid authorisation from the identity unit, recording the authoriser and the reason.

## Objective

Escalate a non-compensable over-dose to a supervisor and consume a valid authorisation from the identity unit, recording the authoriser and the reason.

## Stories Included

- [ ] **007-escalate-non-compensable-overdose**: Escalate non compensable overdose - Priority: must

## Bolt Type

**Type**: ddd-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/ddd-construction-bolt.md`

## Stages

- [x] **1. model**: Domain Model - Complete → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis (optional) - Complete → adr-039
- [x] **4. implement**: Implement - Complete → source code
- [ ] **5. test**: Test - Pending → ddd-03-test-report.md

## Expected Outputs

- ddd-01-domain-model.md — the Escalation aggregate and its states
- ddd-02-technical-design.md — the authorisation consumption contract
- src/003-weighing-station/domain — the escalation rules
- src/003-weighing-station/presentation — the escalation and override endpoints

## Dependencies

### Requires

- **015-003-weighing-station** — Detect the over-dose, calculate the surplus, and where it is compensable, recalculate the remaining targets proportionally and present them for acceptance.
- **002-008-operator-identity** — Implement the supervisor authorisation model: a different person, a fresh authentication at the point of action, a mandatory reason, and a scoped, expiring, single-use authorisation.

### Unit Dependencies (cross-unit)

- **008-operator-identity**: must be complete before this bolt can start.

### Enables

- 021-006-ticket-printing
- 026-007-weighingms-ui

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

The weighing written under an override records the zone in force at confirmation — the over-dose zone, not OK — so the exception stays visible in the record and in reporting.
