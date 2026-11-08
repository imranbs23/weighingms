---
id: 020-006-ticket-printing
unit: 006-ticket-printing
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 003-reprint-ticket-with-reason
created: 2026-10-30T09:00:00Z
started: 2026-11-06T09:40:00Z
completed: 2026-11-06T08:57:29Z
current_stage: null
stages_completed:
  - name: model
    completed: 2026-11-06T10:00:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-11-06T10:20:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-11-06T10:40:00Z
    artifact: adr-043-the-reprint-marking-is-derived.md
  - name: implement
    completed: 2026-11-06T11:10:00Z
    artifact: source code
requires_bolts:
  - 019-006-ticket-printing
enables_bolts: []
requires_units: []
blocks: false
complexity:
  avg_complexity: 2
  avg_uncertainty: 1
  max_dependencies: 1
  testing_scope: 2
---

# Bolt: 020-006-ticket-printing

## Overview

Permit a reprint that is marked as a reprint, carries a reason, and is distinguishable from a first print in both the stored record and the output.

## Objective

Permit a reprint that is marked as a reprint, carries a reason, and is distinguishable from a first print in both the stored record and the output.

## Stories Included

- [ ] **003-reprint-ticket-with-reason**: Reprint ticket with reason - Priority: must

## Bolt Type

**Type**: ddd-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/ddd-construction-bolt.md`

## Stages

- [x] **1. model**: Domain Model - Complete → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis (optional) - Complete → adr-043
- [x] **4. implement**: Implement - Complete → source code
- [ ] **5. test**: Test - Pending → ddd-03-test-report.md

## Expected Outputs

- ddd-01-domain-model.md — the reprint marking and its reason
- ddd-02-technical-design.md — the reprint contract
- src/006-ticket-printing/domain — the reprint rules
- src/006-ticket-printing/presentation — the reprint endpoint

## Dependencies

### Requires

- **019-006-ticket-printing** — Render the weighing ticket from a session’s records and print it, tracking the print job as a separate outcome from the weighing itself.

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

A reprint is a privileged action: it changes what the paper says, so it is audited with actor, reason and time.
