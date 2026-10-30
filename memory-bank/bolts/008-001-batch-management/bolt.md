---
id: 008-001-batch-management
unit: 001-batch-management
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: planned
stories:
  - 001-retrieve-released-batch-queue
created: 2026-10-30T09:00:00Z
started: null
completed: null
current_stage: null
stages_completed: []

# Bolt Dependencies (for execution ordering)
requires_bolts:
  - 005-005-orgatex-integration
enables_bolts:
  - 009-001-batch-management
requires_units:
  - 005-orgatex-integration
blocks: false

# Complexity Assessment (aggregate of included stories)
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

- [ ] **1. model**: Domain Model - Pending → ddd-01-domain-model.md
- [ ] **2. design**: Technical Design - Pending → ddd-02-technical-design.md
- [ ] **3. adr**: ADR Analysis (optional) - Pending → adr-{n}-{slug}.md
- [ ] **4. implement**: Implement - Pending → source code
- [ ] **5. test**: Test - Pending → ddd-03-test-report.md

## Expected Outputs

- ddd-01-domain-model.md — BatchQueue and the selection state
- ddd-02-technical-design.md — the queue projection and its freshness
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

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

The queue is read through the adapter, never from the MES directly (IR-07).
