---
id: 001-sign-in-at-terminal
unit: 008-operator-identity
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: true
---

# Story: 001-sign-in-at-terminal

## User Story

**As a** weighing operator
**I want** to sign in at the terminal once
**So that** every weighing I make is attributed to me and my work is traceable

## Acceptance Criteria

- [ ] **Given** an active operator with a valid credential, **When** the operator signs in at the terminal, **Then** an `IdentitySession` is established carrying the operator's `id`, `displayName`, `role`, the authentication `method` and the `authenticatedAt` time (FR-18, BRD FR-34).
- [ ] **Given** an established identity session, **When** the weighing station, batch management, recipe management or ticket printing ask who is signed in, **Then** the current operator is returned and appears on the weighing record and on the ticket (FR-18, BRD FR-25, BRD AC-07).
- [ ] **Given** an operator is signed in, **When** the operator signs out, **Then** the session is ended, no further action is attributed to that operator, and the current session authorises nothing (FR-18, BRD FR-34).
- [ ] **Given** a session's `expiresAt` has passed, **When** the session is used for any action, **Then** the session is expired, it authorises nothing, and the operator must sign in again (FR-18, BRD FR-34, BRD NFR-12).
- [ ] **Given** a credential is stored, **When** the credential store is inspected, **Then** it holds only a `secretHash` produced by a memory-hard KDF — never a plaintext secret — and no plaintext secret appears in any log (FR-18, BRD NFR-12).
- [ ] **Given** a sign-in attempt, **When** the identity does not exist or the password is wrong, **Then** the response and its timing class are identical in both cases, so the endpoint does not disclose whether the identity exists (FR-18, BRD NFR-12).
- [ ] **Given** no identity session is established, **When** an operator-only action is attempted, **Then** the action is refused and the requester is treated as anonymous (FR-18, BRD FR-34).
- [ ] **Given** the session token held by the client, **When** the token is decoded or inspected, **Then** it is opaque — it carries no information about the operator and cannot be decoded to reveal one (FR-18, BRD NFR-12).
- [ ] **Given** an operator signs in, **When** the role on the session is read, **Then** it is either `OPERATOR` or `SUPERVISOR` and it was determined by the authenticated identity, never by a role requested by the client (FR-18, BRD FR-34, BRD NFR-12).
- [ ] **Given** an operator with the `OPERATOR` role signs in, **When** they attempt a privileged action, **Then** signing in alone grants no supervisor privilege and the privileged action is refused until a supervisor authorisation is obtained separately (FR-21, BRD FR-35, BRD NFR-12).

## Technical Notes

- **Credentials are hashed with a memory-hard KDF, and this is not optional.** The credential store *is* this unit — a defect here is a compliance breach, not a usability bug (BRD NFR-12). A fast general-purpose hash (SHA-256, MD5) would be trivially brute-forced from a stolen database, so the KDF must be deliberately expensive per guess. The stored `Credential` row holds `operatorId`, `secretHash`, `role` and `rotatedAt` — never the secret itself (FR-18).
- **The session token is opaque.** It is a random, high-entropy value mapped server-side to a session row; it is not a JWT, not a signed payload, and it carries no operator id, role or expiry that a reader could decode. An attacker who captures a token learns nothing about the operator from it (BRD NFR-12).
- **The failed sign-in response is identical for "no such identity" and "wrong password."** Two responses would turn the sign-in endpoint into an **identity oracle** — it would let anyone enumerate which operator ids exist on the station, which is exactly the reconnaissance a credential-stuffing attempt needs. The response body, status and timing class are therefore held constant; the "no such identity" path performs the same KDF work as the "wrong password" path so the timing does not leak the difference either (FR-18, BRD NFR-12).
- **The role comes from the stored credential, never from the request.** A client that asks for `role=SUPERVISOR` is ignored — the role is read from the credential row that matched. A client cannot elevate itself by asking (FR-18, BRD NFR-12, BRD FR-34).
- **Sessions expire, so an unattended terminal does not stay authorised.** An operator who walks away from a signed-in terminal leaves a live session; expiry bounds that exposure. The session lifetime is time-boxed and the expiry boundary is tested (FR-18, BRD NFR-12). The exact session lifetime is a configuration value and the open question of whether identity is established per shift or per weighing (`CQ-02`) is not settled, so the duration is not hard-coded here.
- **The identity source is undecided (`Q-08`) and is reached only through the `IdentityProvider` seam.** The unit ships with a `LOCAL` implementation — identities and hashed credentials held locally. If FCI supplies a directory, this provider is **replaced** and every other unit keeps its contract: no other unit names a credential store, a hash, or a session table, and all of them consume identity through `currentOperator` and the `IdentitySession` (FR-18, `Q-08`).
- The identity stamp attached to a weighing record and to audit entries is the same `Operator` value produced here; units `003-weighing-station` and `006-ticket-printing` read it and never re-derive it (FR-18, BRD FR-25, BRD AC-07).
- **Signing in does not grant supervisor privileges.** The privileged-action path — a *different* person, a *fresh* authentication at the point of the action, and a *reason* — is story 002. The unit brief's authorisation model requires all three, and the "different person" rule means an operator can never satisfy a supervisor authorisation with their own session (BRD FR-35, BRD NFR-12, BRD AC-06).
- Sign-in and sign-out are audited as privileged-adjacent events, and privileged actions are recorded to the audit trail (FR-21, BRD FR-36, BRD NFR-13). Audit retention is ≥ 5 years (BRD DR-01); session rows are retained only until expiry, because a session is not a record of what was weighed.
- The authentication path is exercised by an exhaustive test suite **independent of the other units** — that is the reason this unit is separate from unit 003, and a regression in weighing logic must not be able to reach the authorisation path (BRD NFR-12).

## Dependencies

### Requires
- **No unit dependencies — this is a leaf unit.** It depends on nothing in `003-weighing-station`, `006-ticket-printing` or any other unit, and nothing in the build depends on it to build.
- The local `IdentityProvider` seam and its `LOCAL` implementation — the only place the station touches an identity source, and the only place that changes if `Q-08` resolves to an FCI directory (FR-18, `Q-08`).
- `Q-08` (does FCI supply its own operator directory?) — owned by FCI IT and **undecided**; the unit is built so the answer changes only the provider implementation (FR-18, `Q-08`).

### Enables
- `002-authorise-privileged-action-as-supervisor` (the sibling story in this unit — it consumes the `Operator`, `IdentitySession` and `Credential` model established here).
- `003-weighing-station` — the operator attached to the weighing record (FR-18, BRD FR-25, BRD AC-07).
- `002-recipe-material-management` — the operator attributed to lot capture and identity verification.
- `001-batch-management` — the operator attributed to the batch selection (FR-2).
- `006-ticket-printing` — the operator on the ticket and in the audit trail (BRD FR-27, BRD FR-36).
- `007-weighingms-ui` — the sign-in screen and the signed-in operator chip in the top bar (FR-18).

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The sign-in request names an operator id that does not exist | The response is byte-for-byte identical to a wrong-password response and falls in the same timing class; no session is established (FR-18, BRD NFR-12) |
| The operator signs in while another session for the same operator is already active | The new session is established; the behaviour of the earlier session is a defined policy, not an accident — the terminal is single-operator, so the earlier session is ended on the new sign-in |
| The operator signs out with an in-progress batch weighing | The session ends and authorises nothing further; the weighing record already confirmed stays confirmed and immutable (BRD DR-02) |
| The session expires exactly at `expiresAt` | The session is expired and authorises nothing; expiry is evaluated at the boundary, not after it (FR-18, BRD NFR-12) |
| The client presents a token that was tampered with or truncated | The token does not resolve to a session; the request is refused and treated as anonymous |
| The client presents a token from a session that was signed out | The session is not current; the request is refused and treated as anonymous |
| The request body asks for `role: SUPERVISOR` at sign-in | The requested role is ignored; the role on the session is the one stored against the matched credential (FR-18, BRD NFR-12) |
| The operator's credential is rotated while a session is live | The live session remains valid until it expires; rotation invalidates the credential, not the session already established (FR-18) |
| The operator account is deactivated while a session is live | The session authorises nothing from the next check onward; the operator must not be able to continue on a stale session (FR-18) |
| The identity provider is a directory rather than the local store | The `IdentityProvider` implementation is replaced; the session contract, the operator stamp and every consuming unit are unchanged (`Q-08`) |
| An operator signs in and the terminal is left unattended | The session expires on its own; the terminal does not stay authorised indefinitely (FR-18, BRD NFR-12) |

## Out of Scope

- Supervisor authorisation for a privileged action — the reason capture, the scoping to one action and subject, and the expiry of the authorisation → story `002-authorise-privileged-action-as-supervisor` in this unit (BRD FR-35, BRD FR-36, BRD AC-06).
- Rendering the sign-in screen and the signed-in operator chip in the top bar → `007-weighingms-ui` (FR-18).
- Deciding whether an over-dose is compensable, and the tolerance zone judgement → `003-weighing-station` (BRD FR-10, BRD FR-20).
- The audit trail itself, its immutability and its export → `006-ticket-printing` (BRD FR-36, BRD NFR-13).
- The weighing record and the weighing record's immutability and 5-year retention → `003-weighing-station` (BRD FR-25, BRD DR-01, BRD DR-02).
- The ticket's content and layout → `006-ticket-printing` (BRD FR-27, `Q-11`).
- Whether FCI supplies a directory to authenticate against, and the choice of identity source → FCI IT, `Q-08`. The seam and the `LOCAL` implementation are in scope; the decision is not.
