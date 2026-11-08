---
id: 015-003-weighing-station
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 005-detect-overdose-and-calculate-surplus
  - 006-apply-surplus-compensation
created: 2026-10-30T09:00:00Z
started: 2026-11-06T06:15:00Z
completed: 2026-11-05T20:41:19Z
current_stage: null
stages_completed:
  - name: model
    completed: 2026-11-06T06:35:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-11-06T06:55:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-11-06T07:15:00Z
    artifact: adr-038-the-compensation-factor-is-computed-and-stored.md
  - name: implement
    completed: 2026-11-06T07:35:00Z
    artifact: source code
requires_bolts:
  - 014-003-weighing-station
enables_bolts:
  - 016-003-weighing-station
requires_units: []
blocks: false
complexity:
  avg_complexity: 3
  avg_uncertainty: 3
  max_dependencies: 1
  testing_scope: 2
---

# Bolt: 015-003-weighing-station

## Overview

Detect the over-dose, calculate the surplus, and where it is compensable, recalculate the remaining targets proportionally and present them for acceptance.

## Objective

Detect the over-dose, calculate the surplus, and where it is compensable, recalculate the remaining targets proportionally and present them for acceptance.

## Stories Included

- [ ] **005-detect-overdose-and-calculate-surplus**: Detect overdose and calculate surplus - Priority: must
- [ ] **006-apply-surplus-compensation**: Apply surplus compensation - Priority: must

## Bolt Type

**Type**: ddd-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/ddd-construction-bolt.md`

## Stages

- [x] **1. model**: Domain Model - Complete → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis (optional) - Complete → adr-038
- [x] **4. implement**: Implement - Complete → source code
- [ ] **5. test**: Test - Pending → ddd-03-test-report.md

## Expected Outputs

- ddd-01-domain-model.md — Surplus and the CompensationProposal
- ddd-02-technical-design.md — the compensability rule and the proportional recalculation
- src/003-weighing-station/domain — the surplus and compensation rules
- src/003-weighing-station/application — the surplus and compensation use cases

## Dependencies

### Requires

- **014-003-weighing-station** — Evaluate the tolerance zone and gate confirmation on it: the zone is computed once, in one place, and confirmation is possible only while the weight is inside tolerance.

### Unit Dependencies (cross-unit)

- None

### Enables

- 016-003-weighing-station

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

A-08 / Q-06 bind this bolt. The compensability rule is ASSUMED, not specified by the BRD; if compensation turns out to mean only displaying the excess, this branch is deleted rather than rewritten. The proportional factor is surplus ÷ total remaining target — never a hard-coded constant.
