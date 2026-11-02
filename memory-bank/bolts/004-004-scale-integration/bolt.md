---
id: 004-004-scale-integration
unit: 004-scale-integration
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 003-tare-scale-against-container
  - 004-select-scale-by-capacity
created: 2026-10-30T09:00:00Z
started: 2026-10-31T01:05:00Z
completed: 2026-11-02T10:35:00Z
current_stage: complete
stages_completed:
  - name: model
    completed: 2026-10-31T01:05:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-10-31T02:15:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-10-31T03:50:00Z
    artifact: adr-014-the-tare-is-applied-at-the-device.md, adr-015-the-tare-is-never-persisted.md, adr-016-the-net-reading-floors-at-zero.md, adr-017-capacity-constraint-wins-over-class-demand.md, adr-018-no-device-can-weigh-this-is-a-successful-outcome.md, adr-019-the-selection-threshold-is-configuration.md
  - name: implement
    completed: 2026-11-02T10:17:00Z
    artifact: src/004-scale-integration/domain, src/004-scale-integration/infrastructure, src/004-scale-integration/presentation
  - name: test
    completed: 2026-11-02T10:35:00Z
    artifact: ddd-03-test-report.md

# Bolt Dependencies (for execution ordering)
requires_bolts:
  - 003-004-scale-integration
enables_bolts:
  - 012-002-recipe-material-management
  - 013-003-weighing-station
requires_units: []
blocks: false

# Complexity Assessment (aggregate of included stories)
complexity:
  avg_complexity: 2
  avg_uncertainty: 2
  max_dependencies: 2
  testing_scope: 2
---

# Bolt: 004-004-scale-integration

## Overview

Apply the container tare and select the scale by capacity, so the reading the operator sees is the dyestuff and not the container.

## Objective

Apply the container tare and select the scale by capacity, so the reading the operator sees is the dyestuff and not the container.

## Stories Included

- [ ] **003-tare-scale-against-container**: Tare scale against container - Priority: must
- [ ] **004-select-scale-by-capacity**: Select scale by capacity - Priority: must

## Bolt Type

**Type**: ddd-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/ddd-construction-bolt.md`

## Stages

- [x] **1. model**: Domain Model - Complete → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis (optional) - Complete → adr-014…adr-019
- [x] **4. implement**: Implement - Complete → src/004-scale-integration/
- [x] **5. test**: Test - Complete → ddd-03-test-report.md

## Expected Outputs

- ddd-01-domain-model.md — Tare and ScaleSelection
- ddd-02-technical-design.md — the tare sources and the capacity rule
- ddd-03-test-report.md — what the suite proves, and what it cannot
- src/004-scale-integration/domain — tare and scale-selection rules
- src/004-scale-integration/infrastructure — the dummy adapter, the config and the composition root
- src/004-scale-integration/presentation — the tare and selection endpoints

## Dependencies

### Requires

- **003-004-scale-integration** — Own the scale device seam: a continuous live-weight stream at ≥ 10 Hz and disconnect detection within 2 s that blocks weighing rather than letting a stale reading pass for a live one.

### Unit Dependencies (cross-unit)

- None

### Enables

- 012-002-recipe-material-management
- 013-003-weighing-station

## Success Criteria

- [x] All stories implemented — `003-tare-scale-against-container`, `004-select-scale-by-capacity`
- [x] All acceptance criteria met — 11/11, verified in `ddd-03-test-report.md`
- [x] Tests passing — 598/598 across 27 files; coverage 90.26% statements / 81.96% branches / 92.53% functions / 91.37% lines (threshold 80%)
- [ ] Code reviewed and approved — awaiting the Stage 5 human checkpoint

## Notes

CQ-04 — whether the 3 kg and 32 kg scales are one re-zeroed indicator or two devices is undecided. The capacity rule is written against a set of scales, so either answer fits.
