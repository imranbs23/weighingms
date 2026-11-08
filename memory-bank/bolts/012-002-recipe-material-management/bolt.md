---
id: 012-002-recipe-material-management
unit: 002-recipe-material-management
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 004-assign-container-and-apply-tare
created: 2026-10-30T09:00:00Z
started: 2026-11-06T00:55:00Z
completed: 2026-11-05T19:14:31Z
current_stage: null
stages_completed:
  - name: model
    completed: 2026-11-06T01:05:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-11-06T01:15:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-11-06T01:30:00Z
    artifact: adr-035-the-container-assignment-is-a-relation.md
  - name: implement
    completed: 2026-11-06T01:55:00Z
    artifact: source code
requires_bolts:
  - 011-002-recipe-material-management
  - 004-004-scale-integration
enables_bolts:
  - 013-003-weighing-station
requires_units:
  - 004-scale-integration
blocks: false
complexity:
  avg_complexity: 2
  avg_uncertainty: 2
  max_dependencies: 2
  testing_scope: 2
---

# Bolt: 012-002-recipe-material-management

## Overview

Assign the container to the component and apply its tare, from the container master or by weighing the empty container.

## Objective

Assign the container to the component and apply its tare, from the container master or by weighing the empty container.

## Stories Included

- [ ] **004-assign-container-and-apply-tare**: Assign container and apply tare - Priority: must

## Bolt Type

**Type**: ddd-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/ddd-construction-bolt.md`

## Stages

- [x] **1. model**: Domain Model - Complete → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis (optional) - Complete → adr-035
- [x] **4. implement**: Implement - Complete → source code
- [ ] **5. test**: Test - Pending → ddd-03-test-report.md

## Expected Outputs

- ddd-01-domain-model.md — Container and the TareSource
- ddd-02-technical-design.md — the container assignment and the tare sources
- src/002-recipe-material-management/domain — the container and tare rules
- src/002-recipe-material-management/presentation — the container and tare endpoints

## Dependencies

### Requires

- **011-002-recipe-material-management** — Verify that the dyestuff presented matches the recipe component, by barcode scan where possible and by recorded attestation where not, and capture and validate the lot being consumed.
- **004-004-scale-integration** — Apply the container tare and select the scale by capacity, so the reading the operator sees is the dyestuff and not the container.

### Unit Dependencies (cross-unit)

- **004-scale-integration**: must be complete before this bolt can start.

### Enables

- 013-003-weighing-station

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

This bolt depends on the scale bolt because weighing the empty container is one of the two tare sources.
