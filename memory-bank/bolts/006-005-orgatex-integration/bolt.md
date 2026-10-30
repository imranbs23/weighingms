---
id: 006-005-orgatex-integration
unit: 005-orgatex-integration
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: planned
stories:
  - 003-post-consumption-idempotently
created: 2026-10-30T09:00:00Z
started: null
completed: null
current_stage: null
stages_completed: []

# Bolt Dependencies (for execution ordering)
requires_bolts:
  - 005-005-orgatex-integration
enables_bolts:
  - 007-005-orgatex-integration
  - 018-003-weighing-station
requires_units: []
blocks: false

# Complexity Assessment (aggregate of included stories)
complexity:
  avg_complexity: 3
  avg_uncertainty: 2
  max_dependencies: 2
  testing_scope: 2
---

# Bolt: 006-005-orgatex-integration

## Overview

Post actual consumption idempotently, using a locally generated and tracked idempotency key, so that a retry after a lost response cannot double-count a dye batch.

## Objective

Post actual consumption idempotently, using a locally generated and tracked idempotency key, so that a retry after a lost response cannot double-count a dye batch.

## Stories Included

- [ ] **003-post-consumption-idempotently**: Post consumption idempotently - Priority: must

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

- ddd-01-domain-model.md — ConsumptionPosting and the idempotency key
- ddd-02-technical-design.md — the posting contract and the deduplication fallback
- src/005-orgatex-integration/domain — the posting model
- src/005-orgatex-integration/infrastructure — the idempotency ledger and the posting client

## Dependencies

### Requires

- **005-005-orgatex-integration** — Build the OrgaTEX adapter seam and the Dummy OrgaTEX MES behind it: the released batch queue and the batch recipe, read through one adapter that no other unit may bypass.

### Unit Dependencies (cross-unit)

- None

### Enables

- 007-005-orgatex-integration
- 018-003-weighing-station

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

The key is generated and tracked LOCALLY and carried on the request, because the BRD does not specify its shape and the MES contract is unconfirmed (Q-02). If the real contract has no key field, a local deduplication table gives the same observable behaviour.
