---
id: 014-003-weighing-station
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: planned
stories:
  - 003-evaluate-tolerance-zone
  - 004-gate-confirmation-on-zone
created: 2026-10-30T09:00:00Z
started: null
completed: null
current_stage: null
stages_completed: []

# Bolt Dependencies (for execution ordering)
requires_bolts:
  - 013-003-weighing-station
enables_bolts:
  - 015-003-weighing-station
  - 017-003-weighing-station
requires_units: []
blocks: false

# Complexity Assessment (aggregate of included stories)
complexity:
  avg_complexity: 3
  avg_uncertainty: 1
  max_dependencies: 1
  testing_scope: 2
---

# Bolt: 014-003-weighing-station

## Overview

Evaluate the tolerance zone and gate confirmation on it: the zone is computed once, in one place, and confirmation is possible only while the weight is inside tolerance.

## Objective

Evaluate the tolerance zone and gate confirmation on it: the zone is computed once, in one place, and confirmation is possible only while the weight is inside tolerance.

## Stories Included

- [ ] **003-evaluate-tolerance-zone**: Evaluate tolerance zone - Priority: must
- [ ] **004-gate-confirmation-on-zone**: Gate confirmation on zone - Priority: must

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

- ddd-01-domain-model.md — ToleranceZone and the zone boundary rules
- ddd-02-technical-design.md — the zone contract and the confirm gate
- src/003-weighing-station/domain — the zone evaluator and the confirm gate
- src/003-weighing-station/application — the zone and confirm use cases

## Dependencies

### Requires

- **013-003-weighing-station** — Open the weighing session: select the scale automatically from the component’s requirements and consume the live weight stream into the session state.

### Unit Dependencies (cross-unit)

- None

### Enables

- 015-003-weighing-station
- 017-003-weighing-station

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

The boundary rules are reproduced from the prototype exactly: the ok band is inclusive at both ends, over is strictly greater, and near begins at 90% of target. Two classifications of the same reading in two places is the failure mode this avoids.
