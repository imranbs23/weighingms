---
id: 021-006-ticket-printing
unit: 006-ticket-printing
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: planned
stories:
  - 004-record-and-export-audit-trail
created: 2026-10-30T09:00:00Z
started: null
completed: null
current_stage: null
stages_completed: []

# Bolt Dependencies (for execution ordering)
requires_bolts:
  - 002-008-operator-identity
  - 016-003-weighing-station
enables_bolts:
  - 023-006-ticket-printing
requires_units:
  - 003-weighing-station
  - 008-operator-identity
blocks: false

# Complexity Assessment (aggregate of included stories)
complexity:
  avg_complexity: 2
  avg_uncertainty: 1
  max_dependencies: 2
  testing_scope: 2
---

# Bolt: 021-006-ticket-printing

## Overview

Own the append-only, immutable, exportable audit trail for privileged actions, retained ≥ 5 years.

## Objective

Own the append-only, immutable, exportable audit trail for privileged actions, retained ≥ 5 years.

## Stories Included

- [ ] **004-record-and-export-audit-trail**: Record and export audit trail - Priority: must

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

- ddd-01-domain-model.md — AuditEntry and the append-only invariant
- ddd-02-technical-design.md — the append-only schema and the export format
- src/006-ticket-printing/domain — the audit entry model
- src/006-ticket-printing/infrastructure — the append-only store and the exporter
- src/006-ticket-printing/presentation — the audit query and export endpoints

## Dependencies

### Requires

- **002-008-operator-identity** — Implement the supervisor authorisation model: a different person, a fresh authentication at the point of action, a mandatory reason, and a scoped, expiring, single-use authorisation.
- **016-003-weighing-station** — Escalate a non-compensable over-dose to a supervisor and consume a valid authorisation from the identity unit, recording the authoriser and the reason.

### Unit Dependencies (cross-unit)

- **003-weighing-station**: must be complete before this bolt can start.
- **008-operator-identity**: must be complete before this bolt can start.

### Enables

- 023-006-ticket-printing

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

The audit trail is a domain concept, not a log file: it is append-only, attributed and reasoned, and retained and exportable. The reason is NOT optional — BRD AC-06 turns on the authorisation being justified.
