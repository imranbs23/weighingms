---
id: 018-003-weighing-station
unit: 003-weighing-station
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: planned
stories:
  - 009-complete-batch-and-summarise
created: 2026-10-30T09:00:00Z
started: null
completed: null
current_stage: null
stages_completed: []

# Bolt Dependencies (for execution ordering)
requires_bolts:
  - 017-003-weighing-station
  - 006-005-orgatex-integration
enables_bolts:
  - 019-006-ticket-printing
requires_units:
  - 005-orgatex-integration
blocks: false

# Complexity Assessment (aggregate of included stories)
complexity:
  avg_complexity: 2
  avg_uncertainty: 2
  max_dependencies: 3
  testing_scope: 3
---

# Bolt: 018-003-weighing-station

## Overview

Close the batch at the last component and produce the summary the ticket is rendered from, with the consumption posting handed to the adapter.

## Objective

Close the batch at the last component and produce the summary the ticket is rendered from, with the consumption posting handed to the adapter.

## Stories Included

- [ ] **009-complete-batch-and-summarise**: Complete batch and summarise - Priority: must

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

- ddd-01-domain-model.md — BatchCompletion and the weighing record
- ddd-02-technical-design.md — the record schema and the completion contract
- src/003-weighing-station/domain — the record and completion rules
- src/003-weighing-station/application — the completion use case
- src/003-weighing-station/presentation — the completion endpoint

## Dependencies

### Requires

- **017-003-weighing-station** — Advance the session to the first pending component in recipe order after a confirmation, and keep the confirmed component terminal.
- **006-005-orgatex-integration** — Post actual consumption idempotently, using a locally generated and tracked idempotency key, so that a retry after a lost response cannot double-count a dye batch.

### Unit Dependencies (cross-unit)

- **005-orgatex-integration**: must be complete before this bolt can start.

### Enables

- 019-006-ticket-printing

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

The confirmed weighing record carries the full traceability set — target, actual, operator, scale, lot and timestamp — because that is what the ticket and the audit trail are rendered from.
