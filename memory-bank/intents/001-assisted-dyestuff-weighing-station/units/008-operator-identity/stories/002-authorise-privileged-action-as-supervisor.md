---
id: 002-authorise-privileged-action-as-supervisor
unit: 008-operator-identity
intent: 001-assisted-dyestuff-weighing-station
status: draft
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: false
---

# Story: 002-authorise-privileged-action-as-supervisor

## User Story

**As a** dyehouse supervisor
**I want** to authorise a privileged action with a recorded reason
**So that** an exception is released deliberately and can be justified afterwards

## Acceptance Criteria

- [ ] **Given** a privileged action is requested and the signed-in identity has the role `OPERATOR`, **When** the authorisation is attempted, **Then** the action is refused and no authorisation is created — an operator's session alone never authorises a privileged action (BRD NFR-12, BRD FR-35, NFR-6, C-09).
- [ ] **Given** a supervisor holds a valid, unexpired session elsewhere, **When** a privileged action is requested at the terminal without the supervisor authenticating at the point of the action, **Then** the action is refused — being "already signed in" elsewhere is not a valid authorisation (BRD NFR-12, BRD FR-35, NFR-6).
- [ ] **Given** a supervisor authenticates at the point of the action, **When** no reason is supplied, **Then** the authorisation is refused and the privileged action is not permitted — the reason is mandatory (BRD AC-06, BRD FR-24, BRD FR-35, AC-06).
- [ ] **Given** the operator who raised the request attempts to authorise it with their own credential, **When** the authorisation is requested, **Then** the authorisation is refused — the authoriser must be a different person and self-authorisation is refused (BRD NFR-12, BRD FR-35, NFR-6, FR-13).
- [ ] **Given** a supervisor authenticates with a valid reason and is not the requesting operator, **When** the authorisation is granted, **Then** it is scoped to **one** action and **one** subject, and presenting it to authorise a different action or a different subject is refused (BRD FR-24, BRD FR-35, NFR-6, AC-06).
- [ ] **Given** an authorisation has passed its expiry time, **When** it is presented for a privileged action, **Then** the action is refused — an expired authorisation authorises nothing and a fresh authorisation is required (BRD NFR-12, BRD FR-35, NFR-6).
- [ ] **Given** an authorisation has already been used successfully once, **When** it is presented a second time, **Then** the second use is refused — the authorisation is single-use (BRD FR-35, BRD FR-36, NFR-6, AC-06).
- [ ] **Given** a valid authorisation is granted, **When** it is created, **Then** it carries the authorising supervisor's identity, the reason and the time of authorisation, and it is written to the audit trail so the justification is retained with the action it permits (BRD FR-24, BRD FR-36, BRD NFR-13, FR-21).
- [ ] **Given** authorisations have been recorded, **When** the retention policy is inspected, **Then** the authorisation records are retained for at least 5 years on the same terms as the audit entries they justify (BRD DR-01, BRD DR-02, FR-21).
- [ ] **Given** an authorisation is refused for any reason — wrong role, no fresh authentication, missing reason, self-authorisation, wrong scope, expired, or already used — **When** the refusal happens, **Then** the refused attempt is itself audited with the actor, the subject and the reason for refusal (BRD FR-36, BRD NFR-13, FR-21).
- [ ] **Given** a supervisor credential and an operator credential both exist, **When** either is used, **Then** a supervisor credential cannot be used to act as an operator and an operator credential cannot be used to act as a supervisor — credentials are never shared between roles (BRD NFR-12, NFR-6, C-09).
- [ ] **Given** a privileged action is completed under a valid authorisation, **When** the action is recorded, **Then** the record carries the authorising supervisor's identity, the reason and the time, so the exception is identifiable in the confirmed weighing and in the audit trail (BRD FR-24, BRD FR-25, FR-13, FR-21).

## Technical Notes

- **A different person.** The supervisor must be a distinct identity from the operator who raised the request; an operator cannot escalate to themselves. The check is on the *identity*, not on the role alone — a person who holds both roles still cannot self-authorise. Credentials are never shared between roles, so the identity behind a credential is unambiguous (BRD NFR-12, NFR-6).
- **A fresh authentication.** The authorisation is a separate act from the operator's sign-in, performed *at the point of the action* with a supervisor credential. A supervisor who signed in on another terminal, or earlier in the shift, has not authorised this action; "already signed in elsewhere" is not a valid authorisation. This is failure boundary **B-10** (Identity → session): a supervisor override attempted without valid authentication is refused and the attempt is audited.
- **A reason.** The reason is not optional. An authorisation without one is not a valid authorisation, because the audit entry must be able to demonstrate justification — an audit row with an empty reason proves nothing. The reason is captured at the point of authorisation and is carried on the authorisation record itself, so the justification stays bound to the action it permits.
- **Scoped and expiring.** Each authorisation is bound to one action and one subject with a short validity window. A stale authorisation, an authorisation issued for a different action, and an authorisation issued for a different subject are all **refused**, never silently applied — the refusal names which check failed. The authorisation is also **single-use**: once it has been consumed by an action it is spent, so it cannot be replayed to authorise a second action.
- **Where the checks live.** The checks live behind one interface in this unit, so they can be exhausted exhaustively by tests rather than re-implemented at each call site. This is the only unit in the system where a defect is a **compliance breach** rather than a usability bug, and the design reflects that: the refusal paths are the product, not error handling. The `SupervisorAuthorisation` record is append-only, and validation is a pure check against it — never a re-derivation of the rules at the consumer.
- **The identity source is undecided (`Q-08`)** and is reached only through the `IdentityProvider` seam. The unit ships with a `LOCAL` implementation storing hashed credentials; if FCI supplies a directory, the provider is replaced and every other unit keeps its contract. Credentials are never stored in plaintext and never appear in logs, and a failed authentication does not disclose whether the identity exists.
- The authorisation record carries `id`, `sessionId`, `supervisorId`, `action`, `subject`, `reason`, `authorisedAt` and `expiresAt`. Unit 006 writes the authorisation's reason into the audit trail; this story owns the authorisation and its retention, unit 006 owns the trail's storage and export.

## Dependencies

### Requires
- 001-sign-in-at-terminal (the session and credential machinery — sign-in, role determination, session lifetime, and the hashed credential store that the supervisor authentication reuses)

### Enables
- 007-escalate-non-compensable-overdose (unit 003 — consumes a valid authorisation as the only route out of a non-compensable over-dose)
- 004-record-and-export-audit-trail (unit 006 — the authorisation's supervisor identity, reason and time are what the audit entry attributes)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The operator is also a supervisor | The operator's own request cannot be self-authorised; a distinct supervisor must authorise it (BRD NFR-12) |
| A supervisor authenticates but supplies no reason | Refused — the reason is mandatory (BRD AC-06) |
| A supervisor authenticates with a blank or whitespace-only reason | Refused — the reason is validated as present and non-empty, not merely as a non-null string |
| The authoriser is the operator under a second role or a shared terminal login | Refused — the check is on identity, not on the role label |
| A supervisor credential is presented for an ordinary weighing action | Refused — a supervisor credential cannot be used to act as an operator |
| An operator credential is presented for a privileged action | Refused — an operator credential cannot be used to act as a supervisor |
| The authorisation was issued for a different action or a different subject | Refused — the authorisation is scoped to one action and one subject |
| The authorisation is presented at the exact expiry boundary | Refused — expiry is inclusive of the expiry instant |
| The authorisation has expired | Refused; a fresh authorisation with a fresh authentication and reason is required |
| The same authorisation is presented twice | Refused on the second use — the authorisation is single-use |
| The supervisor's credential is wrong | Refused and audited, without disclosing whether the identity exists |
| The reason contains only punctuation or whitespace | Refused — no meaningful justification has been given |
| The privileged action is attempted with no signed-in operator at all | Refused and audited as a refusal; there is no operator for the authorisation to be distinct from |
| The scale disconnects while awaiting authorisation | The authorisation retains its scope and validity window; the privileged action still needs its own preconditions to hold |

## Out of Scope

- The decision to escalate an over-dose, the compensability rule, and the weighing state machine → `003-weighing-station`.
- The audit trail's storage, immutability enforcement, retention job and export format → `006-ticket-printing` (story 004).
- Rendering the sign-in screen and the supervisor prompt → `007-weighingms-ui`.
- Whether FCI supplies an operator directory, and the authentication factor mechanism → `Q-08`, FCI IT.
- The operational reporting of overrides and tolerance failures → `006-ticket-printing` (story 006).
