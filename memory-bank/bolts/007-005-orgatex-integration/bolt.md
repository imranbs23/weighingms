---
id: 007-005-orgatex-integration
unit: 005-orgatex-integration
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 004-report-link-state
  - 005-queue-writes-offline-and-sync-on-recovery
created: 2026-10-30T09:00:00Z
started: 2026-11-03T13:00:00Z
completed: 2026-11-04T19:15:00Z
current_stage: complete
stages_completed:
  - name: model
    completed: 2026-11-03T13:20:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-11-03T17:30:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-11-03T18:30:00Z
    artifact: adr-027-the-link-state-and-the-durable-sync-queue.md
  - name: implement
    completed: 2026-11-04T18:00:00Z
    artifact: src/005-orgatex-integration
  - name: test
    completed: 2026-11-04T19:15:00Z
    artifact: ddd-03-test-report.md

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

## Stories Included

- [x] **004-report-link-state**: Report link state - Priority: must
- [x] **005-queue-writes-offline-and-sync-on-recovery**: Queue writes offline and sync on recovery - Priority: must

## Bolt Type

**Type**: ddd-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/ddd-construction-bolt.md`

## Stages

- [x] **1. model**: Domain Model - Complete → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis (optional) - Complete → adr-027-the-link-state-and-the-durable-sync-queue.md
- [x] **4. implement**: Implement - Complete → source code
- [x] **5. test**: Test - Complete → ddd-03-test-report.md

## Expected Outputs

- ddd-01-domain-model.md — LinkState and SyncQueueEntry
- ddd-02-technical-design.md — the state machine, the retry policy and the pending semantics
- ddd-03-test-report.md — the test results, the coverage and the defects the tests found
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

- [x] All stories implemented
- [x] All acceptance criteria met
- [x] Tests passing (1094 across 53 files; 234 new)
- [ ] Code reviewed and approved

## Notes

The queue is durable across a restart (NFR-05); the snapshots are not. A snapshot can always be re-fetched — an unlanded consumption posting cannot.

The Stage 5 tests found and fixed four defects, all recorded in
`ddd-03-test-report.md`: the read path swallowed its failed contacts
(so a read-only station reported `LINKED` to a dead MES), a rejected
freshness deadline became an unhandled rejection (which Node terminates
the process on), the test harness closed its database before
disposing the unit's timers, and the queue's delivery path
(`redeliver`) had no test at all.
