---
id: 009-001-batch-management
unit: 001-batch-management
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 002-filter-batch-queue-by-status
  - 003-select-batch-and-record-identity
created: 2026-10-30T09:00:00Z
started: 2026-11-05T14:20:00Z
completed: 2026-11-05T09:13:30Z
current_stage: null
stages_completed:
  - name: model
    completed: 2026-11-05T14:20:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-11-05T14:45:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-11-05T15:05:00Z
    artifact: adr-029-the-selection-record-is-append-only.md
  - name: implement
    completed: 2026-11-05T15:10:00Z
    artifact: source code
requires_bolts:
  - 008-001-batch-management
enables_bolts:
  - 013-003-weighing-station
  - 024-007-weighingms-ui
requires_units: []
blocks: false
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

- [x] **1. model**: Domain Model - Complete → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis (optional) - Complete → adr-029, adr-030
- [x] **4. implement**: Implement - Complete → source code
- [x] **5. test**: Test - Complete → ddd-03-test-report.md

## Expected Outputs

- ddd-01-domain-model.md — the filter, the selection, the refusal reasons and the append-only record
- ddd-02-technical-design.md — the filter's endpoint contract and the selection's write path
- ddd-03-test-report.md — the test results, the coverage and the defects the tests found
- src/001-batch-management/domain — the filter, the selection and the refusal reasons
- src/001-batch-management/application — the filter and selection use cases
- src/001-batch-management/presentation — the filter's query parameter and the selection's write endpoint
- src/001-batch-management/infrastructure — the selection repository and the scanner's dummy

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
