---
id: 001-008-operator-identity
unit: 008-operator-identity
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: planned
stories:
  - 001-sign-in-at-terminal
created: 2026-10-30T09:00:00Z
started: null
completed: null
current_stage: null
stages_completed: []

# Bolt Dependencies (for execution ordering)
requires_bolts: []
enables_bolts:
  - 002-008-operator-identity
requires_units: []
blocks: false

# Complexity Assessment (aggregate of included stories)
complexity:
  avg_complexity: 2
  avg_uncertainty: 2
  max_dependencies: 1
  testing_scope: 2
---

# Bolt: 001-008-operator-identity

## Overview

Establish the identity domain: the Operator, the Credential and the IdentitySession, with a local IdentityProvider behind a seam, hashed credentials and opaque session tokens.

## Objective

Establish the identity domain: the Operator, the Credential and the IdentitySession, with a local IdentityProvider behind a seam, hashed credentials and opaque session tokens.

## Stories Included

- [ ] **001-sign-in-at-terminal**: Sign in at terminal - Priority: must

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

- ddd-01-domain-model.md — Operator, Credential, IdentitySession, IdentityProvider
- ddd-02-technical-design.md — the local provider, the KDF choice and the session-token contract
- src/008-operator-identity/domain — the identity model
- src/008-operator-identity/infrastructure — SQLite operator and credential store
- src/008-operator-identity/presentation — sign-in / sign-out / current-operator endpoints

## Dependencies

### Requires

- None (first bolt)

### Unit Dependencies (cross-unit)

- None

### Enables

- 002-008-operator-identity

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Notes

The identity SOURCE is undecided (Q-08). This bolt ships a LOCAL provider behind the IdentityProvider seam; if FCI supplies a directory, only this provider is replaced and every other unit keeps its contract.
