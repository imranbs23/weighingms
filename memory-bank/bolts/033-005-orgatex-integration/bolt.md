---
id: 033-005-orgatex-integration
unit: 005-orgatex-integration
intent: 001-assisted-dyestuff-weighing-station
type: simple-construction-bolt
status: complete
stories:
  - 003-post-consumption-idempotently
created: 2026-11-11T14:01:30Z
started: 2026-11-11T14:01:30Z
completed: 2026-11-11T14:17:06Z
current_stage: null
stages_completed:
  - name: plan
    completed: 2026-11-11T14:10:00Z
    artifact: implementation-plan.md
  - name: implement
    completed: 2026-11-11T14:30:00Z
    artifact: implementation-walkthrough.md
  - name: test
    completed: 2026-11-11T14:40:00Z
    artifact: test-walkthrough.md
requires_bolts:
  - 006-005-orgatex-integration
enables_bolts: []
requires_units: []
blocks: false
complexity:
  avg_complexity: 1
  avg_uncertainty: 1
  max_dependencies: 1
  testing_scope: 1
---

# Bolt: 033-005-orgatex-integration

## Overview

Expose what the Dummy OrgaTEX has stored, so the write-back's result can be
shown. Appended during construction (`bolt-replan` → append) after the
workbook's Step 26 check found that the Dummy keeps posted consumption but
no endpoint reads it back ("Stored data: show the resulting consumption
record").

## Objective

`GET /api/batches/:batchId/consumption` on the Dummy OrgaTEX returns every
consumption posting it received for the batch, as received.

## Stories Included

- [x] **003-post-consumption-idempotently**: the Dummy MES's stored postings can be read back (training contract)

## Bolt Type

**Type**: simple-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/simple-construction-bolt.md`

## Stages

- [x] **1. plan**: Plan - Complete (APPROVE PLAN) → implementation-plan.md
- [x] **2. implement**: Implement - Complete (APPROVE IMPLEMENTATION) → source code + implementation-walkthrough.md
- [x] **3. test**: Test - Complete (approved: "finish Step 26") → test-walkthrough.md

## Dependencies

### Requires

- **006-005-orgatex-integration** — the consumption posting and the Dummy's store

## Success Criteria

- [x] The endpoint returns the batch's postings as received (lot, operator, time, idempotency key)
- [x] A batch with none returns an empty list, not an error
- [x] Duplicates are shown, not hidden
- [x] Tests passing

## Notes

Source: workbook Step 26. Dummy-only: the real OrgaTEX contract is not
claimed (A-01, Q-01).
