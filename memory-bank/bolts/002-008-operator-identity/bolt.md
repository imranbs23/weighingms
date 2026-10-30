---
id: 002-008-operator-identity
unit: 008-operator-identity
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: in-progress
stories:
  - 002-authorise-privileged-action-as-supervisor
created: 2026-10-30T09:00:00Z
started: 2026-10-30T15:15:00Z
completed: null
current_stage: implement
stages_completed:
  - model
  - design
  - adr

# Bolt Dependencies (for execution ordering)
requires_bolts:
  - 001-008-operator-identity
enables_bolts:
  - 016-003-weighing-station
  - 021-006-ticket-printing
requires_units: []
blocks: false

# Complexity Assessment (aggregate of included stories)
complexity:
  avg_complexity: 3
  avg_uncertainty: 1
  max_dependencies: 2
  testing_scope: 2
---

# Bolt: 002-008-operator-identity

## Overview

Implement the supervisor authorisation model: a different person, a fresh authentication at the point of action, a mandatory reason, and a scoped, expiring, single-use authorisation.

## Objective

Implement the supervisor authorisation model: a different person, a fresh authentication at the point of action, a mandatory reason, and a scoped, expiring, single-use authorisation.

## Stories Included

- [ ] **002-authorise-privileged-action-as-supervisor**: Authorise privileged action as supervisor - Priority: must

## Bolt Type

**Type**: ddd-construction-bolt
**Definition**: `.specsmd/aidlc/templates/construction/bolt-types/ddd-construction-bolt.md`

## Stages

- [x] **1. model**: Domain Model - Complete → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis (optional) - Complete → adr-003…adr-006
- [x] **4. implement**: Implement - Complete → src/008-operator-identity/, src/api/
- [x] **5. test**: Test - Complete → ddd-03-test-report.md

## Expected Outputs

- ddd-01-domain-model.md — SupervisorAuthorisation and its three invariants
- ddd-02-technical-design.md — the authorisation interface every call site uses
- src/008-operator-identity/domain — the authorisation model and refusal rules
- src/008-operator-identity/presentation — the supervisor authorisation endpoint

## Dependencies

### Requires

- **001-008-operator-identity** — Establish the identity domain: the Operator, the Credential and the IdentitySession, with a local IdentityProvider behind a seam, hashed credentials and opaque session tokens.

### Unit Dependencies (cross-unit)

- None

### Enables

- 016-003-weighing-station
- 021-006-ticket-printing

## Success Criteria

- [x] All stories implemented — `002-authorise-privileged-action-as-supervisor`
- [x] All acceptance criteria met — 9/9, verified in `ddd-03-test-report.md`
- [x] Tests passing — 340/340; coverage 93.89% statements / 89.64% branches / 95.37% functions / 94.09% lines (threshold 80%)
- [ ] Code reviewed and approved — awaiting the Stage 5 human checkpoint

## Notes

This is the only unit where a defect is a compliance breach rather than a usability bug, so the checks live behind ONE interface and are exhausted exhaustively by tests rather than re-implemented at each call site.

**Three defects were found by the Stage 5 test suite**, not by review. The
significant one: ADR-003 requires a consume request to carry the live
session of "the operator the authorisation was issued **for**", but the
entity never recorded who it was issued for — so only the weaker "distinct
from the supervisor" check could be applied, and an authorisation raised
for operator A could be applied by operator B. The fix added
`requestedOperatorId` to the entity, the event, the table and the
repository, plus `isIssuedFor()` on the read and consume paths.

Two others: `GET /authorisations/:id` disclosed a supervisor's
justification text to any other operator, and `POST /authorisations`
accepted an anonymous request. All three are recorded in
`ddd-03-test-report.md` with the evidence for each.

