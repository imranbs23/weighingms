---
id: 008-001-batch-management
unit: 001-batch-management
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 001-retrieve-released-batch-queue
created: 2026-10-30T09:00:00Z
started: 2026-11-04T15:30:00Z
completed: 2026-11-04T15:44:42Z
current_stage: null
stages_completed:
  - name: model
    completed: 2026-11-04T15:30:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-11-04T15:45:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-11-04T16:00:00Z
    artifact: adr-028-the-stations-own-queue-endpoint.md
  - name: implement
    completed: 2026-11-04T16:20:00Z
    artifact: src/001-batch-management
requires_bolts:
  - 005-005-orgatex-integration
enables_bolts:
  - 009-001-batch-management
requires_units:
  - 005-orgatex-integration
blocks: false
complexity:
  avg_complexity: 2
  avg_uncertainty: 1
  max_dependencies: 2
  testing_scope: 2
---

# Bolt: 008-001-batch-management

## Overview

Read the released batch queue through the OrgaTEX adapter and expose it as a station-owned projection with its receipt time.

## Objective

Read the released batch queue through the OrgaTEX adapter and expose it as a station-owned projection with its receipt time.

## Stories Included

- [ ] **001-retrieve-released-batch-queue**: Retrieve released batch queue - Priority: must

## Bolt Type

**Type**: ddd-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/ddd-construction-bolt.md`

## Stages

- [x] **1. model**: Domain Model - Complete → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis (optional) - Complete → adr-028-the-stations-own-queue-endpoint.md
- [x] **4. implement**: Implement - Complete → source code
- [x] **5. test**: Test - Complete → ddd-03-test-report.md

## Expected Outputs

- ddd-01-domain-model.md — the station's queue projection and its provenance
- ddd-02-technical-design.md — the projection, the port and the endpoint
- ddd-03-test-report.md — the test results, the coverage and the defect the tests found
- src/001-batch-management/domain — the queue model
- src/001-batch-management/application — the queue read use case
- src/001-batch-management/presentation — the queue endpoint

## Dependencies

### Requires

- **005-005-orgatex-integration** — Build the OrgaTEX adapter seam and the Dummy OrgaTEX MES behind it: the released batch queue and the batch recipe, read through one adapter that no other unit may bypass.

### Unit Dependencies (cross-unit)

- **005-orgatex-integration**: must be complete before this bolt can start.

### Enables

- 009-001-batch-management

## Success Criteria

- [x] All stories implemented
- [x] All acceptance criteria met
- [x] Tests passing
- [ ] Code reviewed and approved

## Notes

The queue is read through the adapter, never from the MES directly (IR-07).
