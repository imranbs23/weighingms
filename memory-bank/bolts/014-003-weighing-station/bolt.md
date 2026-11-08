---
id: 014-003-weighing-station
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 003-evaluate-tolerance-zone
  - 004-gate-confirmation-on-zone
created: 2026-10-30T09:00:00Z
started: 2026-11-06T04:00:00Z
completed: 2026-11-05T20:11:21Z
current_stage: null
stages_completed:
  - name: model
    completed: 2026-11-06T04:20:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-11-06T04:40:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-11-06T05:05:00Z
    artifact: adr-037-the-zone-boundaries-and-the-fixed-point-threshold.md
  - name: implement
    completed: 2026-11-06T05:30:00Z
    artifact: source code
requires_bolts:
  - 013-003-weighing-station
enables_bolts:
  - 015-003-weighing-station
  - 017-003-weighing-station
requires_units: []
blocks: false
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

- [x] **1. model**: Domain Model - Complete → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis (optional) - Complete → adr-037
- [x] **4. implement**: Implement - Complete → source code
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
