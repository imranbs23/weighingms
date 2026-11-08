---
id: 023-006-ticket-printing
unit: 006-ticket-printing
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 006-report-on-tolerance-failures-and-overrides
created: 2026-10-30T09:00:00Z
started: 2026-11-06T17:00:00Z
completed: 2026-11-06T12:07:22Z
current_stage: null
stages_completed:
  - name: model
    completed: 2026-11-06T17:20:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-11-06T17:40:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-11-06T18:00:00Z
    artifact: adr-046-the-report-reads-and-mutates-nothing.md
  - name: implement
    completed: 2026-11-06T18:20:00Z
    artifact: source code
requires_bolts:
  - 021-006-ticket-printing
  - 022-006-ticket-printing
enables_bolts: []
requires_units: []
blocks: false
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

- [x] **1. model**: Domain Model - Complete → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis (optional) - Complete → adr-046
- [x] **4. implement**: Implement - Complete → source code
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
