---
id: 017-003-weighing-station
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: planned
stories:
  - 008-advance-to-next-component
created: 2026-10-30T09:00:00Z
started: null
completed: null
current_stage: null
stages_completed: []

# Bolt Dependencies (for execution ordering)
requires_bolts:
  - 014-003-weighing-station
enables_bolts:
  - 018-003-weighing-station
requires_units: []
blocks: false

# Complexity Assessment (aggregate of included stories)
complexity:
  avg_complexity: 2
  avg_uncertainty: 1
  max_dependencies: 1
  testing_scope: 2
---

# Bolt: 017-003-weighing-station

## Overview

Advance the session to the first pending component in recipe order after a confirmation, and keep the confirmed component terminal.

## Objective

Advance the session to the first pending component in recipe order after a confirmation, and keep the confirmed component terminal.

## Stories Included

- [ ] **008-advance-to-next-component**: Advance to next component - Priority: must

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

- ddd-01-domain-model.md — the component lifecycle states
- ddd-02-technical-design.md — the progression rule
- src/003-weighing-station/domain — the progression rules
- src/003-weighing-station/application — the advance use case

## Dependencies

### Requires

- **014-003-weighing-station** — Evaluate the tolerance zone and gate confirmation on it: the zone is computed once, in one place, and confirmation is possible only while the weight is inside tolerance.

### Unit Dependencies (cross-unit)

- None

### Enables

- 018-003-weighing-station

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

Progression follows recipe order, not operator preference — matching the prototype’s behaviour and the BRD’s own rule.
