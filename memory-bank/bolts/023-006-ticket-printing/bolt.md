---
id: 023-006-ticket-printing
unit: 006-ticket-printing
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: planned
stories:
  - 006-report-on-tolerance-failures-and-overrides
created: 2026-10-30T09:00:00Z
started: null
completed: null
current_stage: null
stages_completed: []

# Bolt Dependencies (for execution ordering)
requires_bolts:
  - 021-006-ticket-printing
  - 022-006-ticket-printing
enables_bolts: []
requires_units: []
blocks: false

# Complexity Assessment (aggregate of included stories)
complexity:
  avg_complexity: 2
  avg_uncertainty: 3
  max_dependencies: 2
  testing_scope: 2
---

# Bolt: 023-006-ticket-printing

## Overview

Produce the operational report over tolerance failures, overrides and configuration changes — the record management asks questions of.

## Objective

Produce the operational report over tolerance failures, overrides and configuration changes — the record management asks questions of.

## Stories Included

- [ ] **006-report-on-tolerance-failures-and-overrides**: Report on tolerance failures and overrides - Priority: should

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

- ddd-01-domain-model.md — the report query model
- ddd-02-technical-design.md — the report scope and the export artefact
- src/006-ticket-printing/application — the report use cases
- src/006-ticket-printing/presentation — the report endpoint

## Dependencies

### Requires

- **021-006-ticket-printing** — Own the append-only, immutable, exportable audit trail for privileged actions, retained ≥ 5 years.
- **022-006-ticket-printing** — Provide a configuration store and runtime-loaded locale bundles, so that scale thresholds, tolerance overrides, the label template and the language change without a redeployment.

### Unit Dependencies (cross-unit)

- None

### Enables

- None

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

CQ-07 — whether the dyehouse wants a dashboard or a BI export is undecided. The report is built as a retrievable artefact over data the station already holds, so either answer works without new outbound flow.
