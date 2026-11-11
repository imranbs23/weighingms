---
step: 15
captured: 2026-11-11
backfill: true
source: memory-bank/bolts/001-008-operator-identity/ddd-01-domain-model.md, ddd-02-technical-design.md
---

# Step 15 — Execute the Bolt Plan Stage

> **Backfilled evidence.** Bolt `001-008-operator-identity` is a DDD
> construction bolt, so its planning stages are **Model** and **Design**
> (then ADR, Implement, Test). Their artefacts are the plan; this page
> answers the workbook's five questions from them, regenerated on 2026-11-11.

## 1. What will change?

- A new bounded context, Operator Identity: who is this, what may they do, have they proved it.
- Entities Operator, Credential, IdentitySession; a local IdentityProvider behind a seam (Q-08 undecided).
- Credentials stored only as a memory-hard hash (Argon2id); session tokens opaque, stored as digests.
- Signing in grants no supervisor privilege (that is bolt 002).

*Source: ddd-01-domain-model.md § Bounded Context*

## 2. Which files will be created / modified?

- src/008-operator-identity/domain/ — entities, value objects, services, ports (no runtime deps)
- src/008-operator-identity/application/use-cases/ — sign-in, sign-out, get-current-operator
- src/008-operator-identity/infrastructure/ — SQLite repositories, Argon2 hasher, token generator
- src/008-operator-identity/presentation/ — identity controller, require-operator middleware, Zod schemas
- src/api/ — the Express app the controller mounts on

*Source: ddd-02-technical-design.md § Layer Structure*

## 3. Which requirements and stories?

- Story 001-sign-in-at-terminal (10 acceptance criteria).
- FR-18 (the operator on every weighing), FR-21 (no privilege from sign-in).
- BRD FR-25, FR-34, FR-35, AC-07, NFR-12 (credential security).

*Source: stories/001-sign-in-at-terminal.md; ddd-01 § Story Coverage*

## 4. Which APIs are involved?

- POST /api/identity/sign-in — { operatorId, secret } → token, sessionId, operator, expiresAt
- POST /api/identity/sign-out — ends the session, idempotent
- GET /api/identity/current — the current operator, or 401
- GET /api/identity/session — the session facts, or 401
- No Dummy OrgaTEX / scale / printer API: identity is local.

*Source: ddd-02-technical-design.md § API Design*

## 5. How will this be tested?

- Unit tests (Vitest) on the domain: session expiry at the boundary, the closed role set, the opaque token.
- API integration tests (supertest) for each endpoint, including 401 without a session.
- A constant-work timing test: an unknown operator and a wrong secret take the same time class.
- A check that no plaintext secret reaches the store or a log.

*Source: ddd-02-technical-design.md § Security Design, § External Dependencies; run in Stage 5 (ddd-03-test-report.md)*

## The checkpoint

- Stage **model** completed 2026-10-30T10:30:00Z → `ddd-01-domain-model.md`
- Stage **design** completed 2026-10-30T11:30:00Z → `ddd-02-technical-design.md`

The plan artefacts were committed together with the implementation, in
`47f5883·2026-10-30 18:38:13 +0600·Build the operator identity unit (bolt 001, stages 1-4)`, so git holds no separate "planned, not yet built"
snapshot of this bolt. The stages and their human approvals are recorded
in the bolt file and the unit's construction log.
