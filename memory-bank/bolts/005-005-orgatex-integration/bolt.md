---
id: 005-005-orgatex-integration
unit: 005-orgatex-integration
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: planned
stories:
  - 001-read-released-batch-queue
  - 002-read-batch-recipe
created: 2026-10-30T09:00:00Z
started: null
completed: null
current_stage: null
stages_completed: []

# Bolt Dependencies (for execution ordering)
requires_bolts: []
enables_bolts:
  - 006-005-orgatex-integration
  - 008-001-batch-management
  - 010-002-recipe-material-management
requires_units: []
blocks: false

# Complexity Assessment (aggregate of included stories)
complexity:
  avg_complexity: 2
  avg_uncertainty: 3
  max_dependencies: 3
  testing_scope: 2
---

# Bolt: 005-005-orgatex-integration

## Overview

Build the OrgaTEX adapter seam and the Dummy OrgaTEX MES behind it: the released batch queue and the batch recipe, read through one adapter that no other unit may bypass.

## Objective

Build the OrgaTEX adapter seam and the Dummy OrgaTEX MES behind it: the released batch queue and the batch recipe, read through one adapter that no other unit may bypass.

## Stories Included

- [ ] **001-read-released-batch-queue**: Read released batch queue - Priority: must
- [ ] **002-read-batch-recipe**: Read batch recipe - Priority: must

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

- ddd-01-domain-model.md — BatchQueueSnapshot, RecipeSnapshot and the adapter interface
- ddd-02-technical-design.md — the adapter contract and the training MES contract
- src/005-orgatex-integration/domain — the snapshot models
- src/005-orgatex-integration/infrastructure — the dummy OrgaTEX MES and the adapter
- src/005-orgatex-integration/presentation — the queue and recipe read endpoints

## Dependencies

### Requires

- None (first bolt)

### Unit Dependencies (cross-unit)

- None

### Enables

- 006-005-orgatex-integration
- 008-001-batch-management
- 010-002-recipe-material-management

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

A-01 and A-02 are the assumptions that could invalidate the premise: if the MES exposes no API, this bolt’s IMPLEMENTATION is replaced while every other unit keeps its contract. That is the whole purpose of the IR-07 seam.
