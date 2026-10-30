---
id: 007-005-orgatex-integration
unit: 005-orgatex-integration
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: planned
stories:
  - 004-report-link-state
  - 005-queue-writes-offline-and-sync-on-recovery
created: 2026-10-30T09:00:00Z
started: null
completed: null
current_stage: null
stages_completed: []

# Bolt Dependencies (for execution ordering)
requires_bolts:
  - 006-005-orgatex-integration
enables_bolts:
  - 028-007-weighingms-ui
requires_units: []
blocks: false

# Complexity Assessment (aggregate of included stories)
complexity:
  avg_complexity: 3
  avg_uncertainty: 2
  max_dependencies: 2
  testing_scope: 2
---

# Bolt: 007-005-orgatex-integration

## Overview

Own the link state and the deferred synchronisation queue, so that the station keeps weighing while OrgaTEX is unreachable and nothing is silently discarded.

## Objective

Own the link state and the deferred synchronisation queue, so that the station keeps weighing while OrgaTEX is unreachable and nothing is silently discarded.

## Stories Included

- [ ] **004-report-link-state**: Report link state - Priority: must
- [ ] **005-queue-writes-offline-and-sync-on-recovery**: Queue writes offline and sync on recovery - Priority: must

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

- ddd-01-domain-model.md — LinkState and SyncQueueEntry
- ddd-02-technical-design.md — the state machine, the retry policy and the pending semantics
- src/005-orgatex-integration/domain — the link-state model
- src/005-orgatex-integration/infrastructure — the durable sync queue and the retry worker

## Dependencies

### Requires

- **006-005-orgatex-integration** — Post actual consumption idempotently, using a locally generated and tracked idempotency key, so that a retry after a lost response cannot double-count a dye batch.

### Unit Dependencies (cross-unit)

- None

### Enables

- 028-007-weighingms-ui

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

The queue is durable across a restart (NFR-05); the snapshots are not. A snapshot can always be re-fetched — an unlanded consumption posting cannot.
