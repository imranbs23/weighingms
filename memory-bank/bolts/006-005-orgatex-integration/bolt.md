---
id: 006-005-orgatex-integration
unit: 005-orgatex-integration
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 003-post-consumption-idempotently
created: 2026-10-30T09:00:00Z
started: 2026-11-02T20:05:00Z
completed: 2026-11-02T22:40:00Z
current_stage: complete
stages_completed:
  - name: model
    completed: 2026-11-02T20:35:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-11-02T21:10:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-11-02T21:50:00Z
    artifact: adr-023-the-ledgers-primary-key-is-the-idempotency-guarantee.md
  - name: implement
    completed: 2026-11-02T22:20:00Z
    artifact: src/005-orgatex-integration
  - name: test
    completed: 2026-11-02T22:40:00Z
    artifact: ddd-03-test-report.md

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
- ddd-03-test-report.md — what the suite proves, and what it cannot
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

- [x] All stories implemented
- [x] All acceptance criteria met
- [x] Tests passing (860 across 36 files; 146 new)
- [ ] Code reviewed and approved

## Notes

The key is generated and tracked LOCALLY and carried on the request, because the BRD does not specify its shape and the MES contract is unconfirmed (Q-02). If the real contract has no key field, a local deduplication table gives the same observable behaviour.

**The four decisions this bolt made.** ADR-023 makes the ledger's PRIMARY KEY the idempotency guarantee — the constraint *is* the guard, so there is no read-then-write window. ADR-024 makes the posting's content immutable; only the outcome moves, once, from `QUEUED`. ADR-025 makes the **local** ledger the guarantee, assuming the worst case that the MES does not deduplicate. ADR-026 makes the rejection disposition a configuration value, so answering CQ-06 is a config change and not a code change.

**The three decisions the implementation had to make.** There is **no `UNKNOWN` posting state** — it is an *attempt* outcome, because the posting's state only ever advances on a definitive answer from the MES. The key is derived from the weighing's identity, not the component's, so a second weighing of the same component is a distinct posting rather than a lost consumption. The two guards are at **different paths** — the send path reads the ledger, the enqueue path reads the postings.

**Two defects the tests found.** A concurrent duplicate that lost the *postings* insert propagated a raw database error instead of being reported as a duplicate — and a resolved-`ACCEPTED` row was reported as a **rejection**, which is a visible wrong number on a real order's consumption record. And the key's length check was dead code, because the shape pattern already rejected anything longer.
