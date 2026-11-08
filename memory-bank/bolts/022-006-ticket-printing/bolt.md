---
id: 022-006-ticket-printing
unit: 006-ticket-printing
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 005-change-configuration-and-language
created: 2026-10-30T09:00:00Z
started: 2026-11-06T14:30:00Z
completed: 2026-11-06T11:37:49Z
current_stage: null
stages_completed:
  - name: model
    completed: 2026-11-06T14:50:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-11-06T15:10:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-11-06T15:30:00Z
    artifact: adr-045-the-configuration-is-versioned.md
  - name: implement
    completed: 2026-11-06T16:00:00Z
    artifact: source code
requires_bolts:
  - 019-006-ticket-printing
enables_bolts:
  - 023-006-ticket-printing
  - 024-007-weighingms-ui
requires_units: []
blocks: false
complexity:
  avg_complexity: 2
  avg_uncertainty: 2
  max_dependencies: 1
  testing_scope: 2
---

# Bolt: 022-006-ticket-printing

## Overview

Provide a configuration store and runtime-loaded locale bundles, so that scale thresholds, tolerance overrides, the label template and the language change without a redeployment.

## Objective

Provide a configuration store and runtime-loaded locale bundles, so that scale thresholds, tolerance overrides, the label template and the language change without a redeployment.

## Stories Included

- [ ] **005-change-configuration-and-language**: Change configuration and language - Priority: must

## Bolt Type

**Type**: ddd-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/ddd-construction-bolt.md`

## Stages

- [x] **1. model**: Domain Model - Complete → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis (optional) - Complete → adr-045
- [x] **4. implement**: Implement - Complete → source code
- [ ] **5. test**: Test - Pending → ddd-03-test-report.md

## Expected Outputs

- ddd-01-domain-model.md — ConfigurationEntry and LocaleBundle
- ddd-02-technical-design.md — the versioning, the override visibility rule and the locale loading
- src/006-ticket-printing/domain — the configuration model
- src/006-ticket-printing/infrastructure — the configuration store and the locale resources
- src/006-ticket-printing/presentation — the configuration and locale endpoints

## Dependencies

### Requires

- **019-006-ticket-printing** — Render the weighing ticket from a session’s records and print it, tracking the print job as a separate outcome from the weighing itself.

### Unit Dependencies (cross-unit)

- None

### Enables

- 023-006-ticket-printing
- 024-007-weighingms-ui

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

A configuration change is itself audited, and a setting that overrides a recipe value records what it overrode and why — because a tolerance override is a way to make an out-of-tolerance weight acceptable.
