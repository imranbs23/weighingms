---
id: 002-008-operator-identity
unit: 008-operator-identity
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: planned
stories:
  - 002-authorise-privileged-action-as-supervisor
created: 2026-10-30T09:00:00Z
started: null
completed: null
current_stage: null
stages_completed: []

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

- [ ] **1. model**: Domain Model - Pending → ddd-01-domain-model.md
- [ ] **2. design**: Technical Design - Pending → ddd-02-technical-design.md
- [ ] **3. adr**: ADR Analysis (optional) - Pending → adr-{n}-{slug}.md
- [ ] **4. implement**: Implement - Pending → source code
- [ ] **5. test**: Test - Pending → ddd-03-test-report.md

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

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

This is the only unit where a defect is a compliance breach rather than a usability bug, so the checks live behind ONE interface and are exhausted exhaustively by tests rather than re-implemented at each call site.
