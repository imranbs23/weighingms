---
id: 001-008-operator-identity
unit: 008-operator-identity
intent: 001-assisted-dyestuff-weighing-station
type: ddd-construction-bolt
status: complete
stories:
  - 001-sign-in-at-terminal
created: 2026-10-30T09:00:00Z
started: 2026-10-30T10:00:00Z
completed: 2026-10-30T13:20:26Z
current_stage: null
stages_completed:
  - name: model
    completed: 2026-10-30T10:30:00Z
    artifact: ddd-01-domain-model.md
  - name: design
    completed: 2026-10-30T11:30:00Z
    artifact: ddd-02-technical-design.md
  - name: adr
    completed: 2026-10-30T12:10:00Z
    artifact: adr-001-argon2id-via-node-builtin-crypto.md, adr-002-store-session-tokens-as-digests.md
  - name: implement
    completed: 2026-10-30T13:30:00Z
    artifact: src/008-operator-identity/, src/api/
  - name: test
    completed: 2026-10-30T14:30:00Z
    artifact: ddd-03-test-report.md
requires_bolts: []
enables_bolts:
  - 002-008-operator-identity
requires_units: []
blocks: false
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

- [x] **1. model**: Domain Model - Complete → ddd-01-domain-model.md
- [x] **2. design**: Technical Design - Complete → ddd-02-technical-design.md
- [x] **3. adr**: ADR Analysis (optional) - Complete → adr-001, adr-002
- [x] **4. implement**: Implement - Complete → src/008-operator-identity/, src/api/
- [x] **5. test**: Test - Complete → ddd-03-test-report.md

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

- [x] All stories implemented — `001-sign-in-at-terminal`
- [x] All acceptance criteria met — 10/10, verified in `ddd-03-test-report.md`
- [x] Tests passing — 224/224; coverage 96.25% statements / 90.05% branches / 98.58% functions / 96.75% lines (threshold 80%)
- [ ] Code reviewed and approved — awaiting the Stage 5 human checkpoint

## Notes

The identity SOURCE is undecided (Q-08). This bolt ships a LOCAL provider behind the IdentityProvider seam; if FCI supplies a directory, only this provider is replaced and every other unit keeps its contract.
