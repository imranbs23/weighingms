---
id: 005-005-orgatex-integration
unit: 005-orgatex-integration
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 001-read-released-batch-queue
  - 002-read-batch-recipe
created: 2026-10-30T09:00:00Z
started: 2026-11-02T18:05:00Z
completed: 2026-11-02T19:45:00Z
current_stage: complete
stages_completed:
  - name: model
    completed: 2026-11-02T18:20:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-11-02T18:45:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-11-02T19:05:00Z
    artifact: adr-020-the-orgatex-reads-require-an-operator-session.md
  - name: implement
    completed: 2026-11-02T19:25:00Z
    artifact: src/005-orgatex-integration
  - name: test
    completed: 2026-11-02T19:45:00Z
    artifact: ddd-03-test-report.md

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

- [x] **1. model**: Domain Model - Complete → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis (optional) - Complete → adr-020-the-orgatex-reads-require-an-operator-session.md
- [x] **4. implement**: Implement - Complete → source code
- [x] **5. test**: Test - Complete → ddd-03-test-report.md

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

- [x] All stories implemented
- [x] All acceptance criteria met
- [x] Tests passing (712 across 32 files; 114 new)
- [ ] Code reviewed and approved

## Notes

A-01 and A-02 are the assumptions that could invalidate the premise: if the MES exposes no API, this bolt’s IMPLEMENTATION is replaced while every other unit keeps its contract. That is the whole purpose of the IR-07 seam.

**The three decisions this bolt made.** ADR-020 requires an operator session for the MES reads, narrowing ADR-013 to devices that are physically present at the station. ADR-021 keeps the snapshots in a bounded in-memory cache and persists nothing. ADR-022 records that the adapter is in-process and that its transport is therefore NOT exercised by this bolt's tests — a gap that must be carried forward until a real adapter exists.

**The three decisions the implementation had to make.** The eligibility reason is a code rather than prose (NFR-11). `WEIGHING` is ineligible as `BEING_WEIGHED_ELSEWHERE` rather than as `NOT_RELEASED`, because a batch being weighed elsewhere WAS released and the operator needs to know which. The composition root knows nothing of Express.

**One defect the tests found.** `parseInt` accepted a partially-typed freshness window — `'12.5.6'` became `12` — which would have silently killed the `DEGRADED` fallback. Fixed with `Number` and an integer check.
