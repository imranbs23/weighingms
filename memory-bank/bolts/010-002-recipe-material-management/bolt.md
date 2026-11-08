---
id: 010-002-recipe-material-management
unit: 002-recipe-material-management
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 001-retrieve-recipe-and-component-list
created: 2026-10-30T09:00:00Z
started: 2026-11-05T16:00:00Z
completed: 2026-11-05T17:42:29Z
current_stage: null
stages_completed:
  - name: model
    completed: 2026-11-05T16:20:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-11-05T16:50:00Z
    artifact: ddd-02-technical-design.md
requires_bolts:
  - 005-005-orgatex-integration
enables_bolts:
  - 011-002-recipe-material-management
requires_units:
  - 005-orgatex-integration
blocks: false
complexity:
  avg_complexity: 2
  avg_uncertainty: 2
  max_dependencies: 2
  testing_scope: 2
---

# Bolt: 010-002-recipe-material-management

## Overview

Load a batch’s recipe through the OrgaTEX adapter — components, targets, units, tolerances and scale classes — and expose it as the single cross-unit call owned by this unit.

## Objective

Load a batch’s recipe through the OrgaTEX adapter — components, targets, units, tolerances and scale classes — and expose it as the single cross-unit call owned by this unit.

## Stories Included

- [ ] **001-retrieve-recipe-and-component-list**: Retrieve recipe and component list - Priority: must

## Bolt Type

**Type**: ddd-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/ddd-construction-bolt.md`

## Stages

- [x] **1. model**: Domain Model - Complete → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis (optional) - Complete → adr-031, adr-032
- [ ] **4. implement**: Implement - Pending → source code
- [ ] **5. test**: Test - Pending → ddd-03-test-report.md

## Expected Outputs

- ddd-01-domain-model.md — Recipe, RecipeComponent and the quantity value object
- ddd-02-technical-design.md — the recipe contract and the fixed-point decimal rule
- ddd-03-test-report.md — the test results, the coverage and the defects the tests found
- src/002-recipe-material-management/domain — the recipe model
- src/002-recipe-material-management/application — the recipe read use case
- src/002-recipe-material-management/presentation — the recipe endpoint

## Dependencies

### Requires

- **005-005-orgatex-integration** — Build the OrgaTEX adapter seam and the Dummy OrgaTEX MES behind it: the released batch queue and the batch recipe, read through one adapter that no other unit may bypass.

### Unit Dependencies (cross-unit)

- **005-orgatex-integration**: must be complete before this bolt can start.

### Enables

- 011-002-recipe-material-management

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

This is the unit that owns the recipe load, which is how the narrow 001 ↔ 002 cycle in units.md is resolved — by ownership, not by splitting the data.
