---
id: 015-003-weighing-station
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: planned
stories:
  - 005-detect-overdose-and-calculate-surplus
  - 006-apply-surplus-compensation
created: 2026-10-30T09:00:00Z
started: null
completed: null
current_stage: null
stages_completed: []

# Bolt Dependencies (for execution ordering)
requires_bolts:
  - 014-003-weighing-station
enables_bolts:
  - 016-003-weighing-station
requires_units: []
blocks: false

# Complexity Assessment (aggregate of included stories)
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

- [ ] **1. model**: Domain Model - Pending → ddd-01-domain-model.md
- [ ] **2. design**: Technical Design - Pending → ddd-02-technical-design.md
- [ ] **3. adr**: ADR Analysis (optional) - Pending → adr-{n}-{slug}.md
- [ ] **4. implement**: Implement - Pending → source code
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
