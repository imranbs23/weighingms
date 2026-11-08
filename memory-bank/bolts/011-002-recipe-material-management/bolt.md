---
id: 011-002-recipe-material-management
unit: 002-recipe-material-management
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 002-verify-dyestuff-identity-by-scan-or-attestation
  - 003-capture-and-validate-dyestuff-lot
created: 2026-10-30T09:00:00Z
started: 2026-11-05T23:30:00Z
completed: 2026-11-05T18:49:31Z
current_stage: null
stages_completed:
  - name: model
    completed: 2026-11-05T23:50:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-11-06T00:10:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-11-06T00:40:00Z
    artifact: adr-033-one-scanner-two-ports-one-instance.md
  - name: implement
    completed: 2026-11-06T00:30:00Z
    artifact: source code
requires_bolts:
  - 010-002-recipe-material-management
enables_bolts:
  - 012-002-recipe-material-management
requires_units: []
blocks: false
complexity:
  avg_complexity: 2
  avg_uncertainty: 2
  max_dependencies: 2
  testing_scope: 2
---

# Bolt: 011-002-recipe-material-management

## Overview

Verify that the dyestuff presented matches the recipe component, by barcode scan where possible and by recorded attestation where not, and capture and validate the lot being consumed.

## Objective

Verify that the dyestuff presented matches the recipe component, by barcode scan where possible and by recorded attestation where not, and capture and validate the lot being consumed.

## Stories Included

- [ ] **002-verify-dyestuff-identity-by-scan-or-attestation**: Verify dyestuff identity by scan or attestation - Priority: must
- [ ] **003-capture-and-validate-dyestuff-lot**: Capture and validate dyestuff lot - Priority: must

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

- ddd-01-domain-model.md — DyestuffIdentity, IdentityVerificationMethod and LotCapture
- ddd-02-technical-design.md — the scan/attestation contract and the fallback record
- src/002-recipe-material-management/domain — the identity and lot rules
- src/002-recipe-material-management/presentation — the scan, attest and lot endpoints

## Dependencies

### Requires

- **010-002-recipe-material-management** — Load a batch’s recipe through the OrgaTEX adapter — components, targets, units, tolerances and scale classes — and expose it as the single cross-unit call owned by this unit.

### Unit Dependencies (cross-unit)

- None

### Enables

- 012-002-recipe-material-management

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

B-6 — the scanner failure path must fall back to attestation and RECORD the fallback, so an unattested weighing is distinguishable in the audit trail. It never silently skips.
