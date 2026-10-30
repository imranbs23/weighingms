---
id: 009-001-batch-management
unit: 001-batch-management
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: planned
stories:
  - 002-filter-batch-queue-by-status
  - 003-select-batch-and-record-identity
created: 2026-10-30T09:00:00Z
started: null
completed: null
current_stage: null
stages_completed: []

# Bolt Dependencies (for execution ordering)
requires_bolts:
  - 008-001-batch-management
enables_bolts:
  - 013-003-weighing-station
  - 024-007-weighingms-ui
requires_units: []
blocks: false

# Complexity Assessment (aggregate of included stories)
complexity:
  avg_complexity: 2
  avg_uncertainty: 1
  max_dependencies: 2
  testing_scope: 2
---

# Bolt: 009-001-batch-management

## Overview

Filter the queue by status and turn "the operator picked a batch" into a recorded selection carrying the method by which it was made.

## Objective

Filter the queue by status and turn "the operator picked a batch" into a recorded selection carrying the method by which it was made.

## Stories Included

- [ ] **002-filter-batch-queue-by-status**: Filter batch queue by status - Priority: must
- [ ] **003-select-batch-and-record-identity**: Select batch and record identity - Priority: must

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

- ddd-01-domain-model.md — BatchFilter and BatchSelection
- ddd-02-technical-design.md — the filter model and the selection record
- src/001-batch-management/domain — the filter and selection rules
- src/001-batch-management/presentation — the filter and selection endpoints

## Dependencies

### Requires

- **008-001-batch-management** — Read the released batch queue through the OrgaTEX adapter and expose it as a station-owned projection with its receipt time.

### Unit Dependencies (cross-unit)

- None

### Enables

- 013-003-weighing-station
- 024-007-weighingms-ui

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

The selection method — scan or touch — is recorded, because B-6 requires the fallback to be distinguishable later.
