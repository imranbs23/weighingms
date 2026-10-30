---
unit: 008-operator-identity
intent: 001-assisted-dyestuff-weighing-station
phase: inception
status: draft
created: 2026-10-30T04:05:00Z
updated: 2026-10-30T04:05:00Z
---

# Unit Brief: Operator Identity

## Purpose

Establish *who* is at the terminal, and authorise the actions that need more
than an operator.

This unit is small, and it is the unit with the **tightest security
requirement in the build**. A defect here is not a usability bug — it is a
compliance breach. It answers "who is this, what may they do, and have they
proved it?" — and it answers those questions once, so that no other unit
has to.

## Scope

### In Scope

- **Operator sign-in** and sign-out at the terminal.
- **Identity**: the operator's identifier, display name, role and the
  attributes that appear on a weighing record.
- **Role determination** — `OPERATOR` and `SUPERVISOR` are the two roles
  the BRD's constraints name.
- **Supervisor authentication** for privileged actions — a separate
  authentication, with its own reason capture.
- **Session lifetime** and expiry.
- **Credential policy** — credentials are never shared between roles, and a
  supervisor's authorisation is never satisfied by an operator's session
  (NFR-12).
- The **identity stamp** attached to weighing records and audit entries.

### Out of Scope

- Deciding whether an over-dose is compensable → `003-weighing-station`.
- The audit trail itself → `006-ticket-printing`.
- Rendering the sign-in screen → `007-weighingms-ui`.
- Whether FCI has a directory to authenticate against → FCI (Q-08).

---

## Assigned Requirements

| FR | Requirement | Priority |
|----|-------------|----------|
| — | *(none of its own — it provides the identity that FR-18 requires)* | — |

**FR-18 (operator identification and traceability) is assigned to unit
003**, because the *weighing* must carry the operator. This unit provides
that identity. The split is recorded so the assignment stays unambiguous:
unit 003 owns the requirement, unit 008 owns the capability that satisfies
part of it.

---

## Domain Concepts

### Key Entities

| Entity | Description | Attributes |
|--------|-------------|------------|
| `Operator` | An identified person | `id`, `displayName`, `role`, `active` |
| `IdentitySession` | A signed-in operator at the terminal | `id`, `operatorId`, `role`, `authenticatedAt`, `expiresAt`, `method` |
| `SupervisorAuthorisation` | A supervisor's approval of a privileged action | `id`, `sessionId`, `supervisorId`, `action`, `subject`, `reason`, `authorisedAt`, `expiresAt` |
| `Credential` | A secret for one identity | `operatorId`, `secretHash`, `role`, `rotatedAt` |
| `IdentityProvider` | The source of identity | `kind` (`LOCAL` \| `DIRECTORY`), `available`, `description` |

### Key Operations

| Operation | Description | Inputs | Outputs |
|-----------|-------------|--------|---------|
| `signIn` | Establish an identity session | credential | `IdentitySession` |
| `signOut` | End the identity session | `sessionId` | ended session |
| `currentOperator` | Who is signed in | — | `Operator` or anonymous |
| `requireRole` | Assert a role for an action | `sessionId`, `role` | authorised / refused + reason |
| `authenticateSupervisor` | Obtain a supervisor's authorisation | credential, action, subject, reason | `SupervisorAuthorisation` |
| `validateAuthorisation` | Check an authorisation is current and for the right action | `authorisationId`, action, subject | valid / refused + reason |
| `expireSession` | End an expired session | — | expired sessions |

### The authorisation model

NFR-12 and BRD C-09 are the constraint this unit exists to satisfy:

> Only a supervisor, authenticated, can authorise an over-dose that is
> recorded outside tolerance. No credential sharing.

Three properties follow, and each is separately testable:

1. **A different person.** The supervisor must be a different identity from
   the operator. An operator cannot escalate to themselves.
2. **A fresh authentication.** The authorisation is a separate act from the
   operator's sign-in. The supervisor authenticates *at the point of the
   action*, with a credential, not by being "already signed in" elsewhere.
3. **A reason.** The authorisation carries a reason, which is written into
   the audit trail by unit 006. An authorisation without a reason is not a
   valid authorisation.

The authorisation is also **scoped**: it is valid for a specific action and a
specific subject, and it **expires**. It cannot be reused to authorise a
different over-dose.

**This is the only unit in the system where a defect is a compliance
breach rather than a usability bug**, and the design reflects that: the
checks live here, behind one interface, so they can be exhausted
exhaustively by tests rather than being re-implemented at each call site.

### Identity source is explicitly undecided

Q-08 asks whether FCI supplies a directory or the station manages identity
itself. The system context records this boundary as **undecided** — and
deliberately did **not** create a dummy for it, because operator identity is
a *local* concern of the station (sign-in, role, session), not an external
integration. Faking it as an external service would misdescribe the
boundary.

The unit is therefore built with an `IdentityProvider` seam and a
`LOCAL` implementation: identities stored locally with hashed credentials.
If the answer to Q-08 is "we have a directory", this unit's provider is
replaced and every other unit keeps its contract.

---

## Story Summary

| Metric | Count |
|--------|-------|
| Total Stories | 2 |
| Must Have | 2 |
| Should Have | 0 |
| Could Have | 0 |

### Stories

| Story ID | Title | Priority | Status |
|----------|-------|----------|--------|
| 001 | Sign in at the terminal and be identified on every weighing | Must | Planned |
| 002 | Authorise a privileged action as a supervisor, with a reason | Must | Planned |

---

## Dependencies

### Depends On

| Unit | Reason |
|------|--------|
| — | **None.** This is a leaf unit. |

### Depended By

| Unit | Reason |
|------|--------|
| `003-weighing-station` | The operator attached to the weighing record; the supervisor authorisation that permits an override. |
| `002-recipe-material-management` | The operator attributed to lot capture and identity verification. |
| `001-batch-management` | The operator attributed to the batch selection. |
| `006-ticket-printing` | The operator on the ticket and in the audit trail. |
| `007-weighingms-ui` | The sign-in screen and the supervisor prompt. |

### External Dependencies

| System | Purpose | Risk |
|--------|---------|------|
| Identity source | Identifying the operator | **Undecided** — Q-08. Not answered by a dummy, by design. |

---

## Technical Context

### Suggested Technology

TypeScript strict · Express 4 · Zod for validation · SQLite via
better-sqlite3 for operators and hashed credentials · **password hashing
with a memory-hard KDF** (the credential store is the unit's whole reason to
exist, so plaintext passwords are not an option) · an opaque session token
held by the client and sent on every request.

### Integration Points

| Integration | Type | Protocol |
|-------------|------|----------|
| `003-weighing-station` | API (internal) | REST/JSON |
| `002-recipe-material-management` | API (internal) | REST/JSON |
| `001-batch-management` | API (internal) | REST/JSON |
| `006-ticket-printing` | API (internal) | REST/JSON |
| `007-weighingms-ui` | API (internal) | REST/JSON |

### Data Storage

| Data | Type | Volume | Retention |
|------|------|--------|-----------|
| Operators | SQL | One row per operator | Indefinite |
| Credentials | SQL, **hashed only** | One row per operator | Indefinite |
| Identity sessions | SQL | One row per active session | Until expiry |
| Supervisor authorisations | SQL, **append-only** | One row per authorisation | ≥ 5 years (DR-01) |

**Credentials are stored hashed and never in plaintext**, and a session
token is opaque — it carries no information about the operator and cannot
be decoded to reveal one. Supervisor authorisations are retained on the
same terms as the audit entries they justify, because a retention policy
that kept the justification but deleted the authorisation would be
worthless.

---

## Constraints

- **Only an authenticated supervisor** may authorise an out-of-tolerance
  over-dose (NFR-12, C-09).
- **Credentials are never shared between roles**, and an operator cannot
  authorise their own escalation.
- A supervisor authorisation **must carry a reason** and is **scoped** to
  one action and one subject.
- Credentials are **never stored in plaintext** and never appear in logs.
- Sessions **expire**; an expired session authorises nothing.
- **Failed authentication does not disclose** whether the identity exists.
- The identity **source** is undecided (Q-08) and is reached only through
  the `IdentityProvider` seam.

---

## Success Criteria

### Functional

- [ ] An operator signs in, and the identity is attached to the weighing
      record.
- [ ] An operator can be signed out, and the session ends.
- [ ] A privileged action is refused for an operator.
- [ ] A privileged action is refused for a supervisor who has not
      authenticated at the point of action.
- [ ] A privileged action is refused when the reason is missing.
- [ ] A supervisor authorisation is accepted only for the action and
      subject it was issued for.
- [ ] An expired authorisation is refused.
- [ ] An expired session is refused.

### Non-Functional

- [ ] No credential is stored in plaintext or written to a log.
- [ ] A failed sign-in does not reveal whether the identity exists.
- [ ] The authentication path is exercised by an exhaustive test suite
      independent of the other units.

### Quality

- [ ] The self-escalation case is covered by a test.
- [ ] The missing-reason case is covered by a test.
- [ ] The scoped-to-subject case is covered by a test.
- [ ] The expiry cases are covered by tests at the boundary.
- [ ] Code reviewed and approved.

---

## Bolt Suggestions

| Bolt | Type | Stories | Objective |
|------|------|---------|-----------|
| `008-operator-identity-1` | DDD | 001 | The `Operator` and `IdentitySession` model, sign-in and sign-out, and the local identity provider |
| `008-operator-identity-2` | DDD | 002 | The supervisor authorisation model — scoping, reason, expiry, and the refusal rules |

---

## Notes

**This unit was created because the security requirement and the open
question both point at the same boundary.** NFR-12 is the only requirement
in the build that says *only one specific role may do this, and only with
its own credentials*. Q-08 asks whether FCI supplies a directory. Both
concern identity, and both are invisible to the rest of the system if
identity is a unit.

**It has no FR of its own, and that is deliberate.** The workbook's
discipline is one FR per unit, and a reviewer who prefers strict
FR-per-unit discipline may prefer to fold this into unit 003. The argument
for keeping it separate is that **folding it in would put the security
path inside the largest and busiest unit in the build**, where the
authentication checks would be one concern among eleven, and where a
regression in the weighing logic could plausibly reach the authorisation
path. A separate unit lets the authentication path be tested exhaustively
on its own and keeps the "who is the operator" question from leaking into
every other unit's signature.

The choice is recorded in `units.md` §Notes for Checkpoint 3, and it is a
judgement call rather than a settled fact.

**No dummy for the identity source.** The system context recorded this
deliberately: operator identity is a *local* concern of the station, not an
external integration, and giving it a fake external service would
misdescribe the boundary. The unit therefore ships with a local provider
behind a seam, and the real source can replace it without touching
anything else.
