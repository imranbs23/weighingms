---
unit: 008-operator-identity
bolt: 001-008-operator-identity
stage: model
status: complete
updated: 2026-10-30T10:30:00Z
---

# Static Model - Operator Identity

## Bounded Context

**Operator Identity** answers three questions, and is the only place in the
system that answers them:

1. **Who is this?** — the operator's identity, display name and role.
2. **What may they do?** — whether the current session authorises an action.
3. **Have they proved it?** — whether a privileged action carries a separate,
   fresh supervisor authentication.

The context is deliberately small and **deliberately has no functional
requirement of its own**. FR-18 is assigned to unit `003-weighing-station`
because the *weighing* must carry the operator; this unit produces the
identity that FR-18 requires. Keeping the two apart means the authorisation
path is not reachable by a change in weighing logic — which is the entire
reason this unit exists separately (BRD NFR-12).

**What this context owns.** The `Operator`, the `Credential`, the
`IdentitySession` and the `SupervisorAuthorisation` (the last of which is
modelled in this bolt's sibling, `002`, but its shape is fixed here because
it consumes this model). It owns the **rules** about when a session authorises
something and when it does not.

**What this context does not own.** The audit trail (the trail *records* what
happened here, but the trail itself belongs to unit 006); the weighing record
(unit 003); the sign-in screen (unit 007); the identity *source* (FCI, and
undecided — `Q-08`).

### The boundary that matters

Every other unit consumes identity through exactly two things: the
`Operator` value, and a session token that the API resolves. No other unit
names a credential store, a hash, or a session table. This is the property
that makes `Q-08` survivable: when FCI answers whether it supplies a
directory, only the `IdentityProvider` implementation changes.

### Invariants the model must make structural

These four are not conventions. Each is expressed below as a type-level
constraint or a single chokepoint, so that a mistake is a compile error or a
failed test rather than a review comment.

- **I-1** — No plaintext secret exists anywhere in the domain model. The
  `Credential` aggregate holds a `SecretHash` and a `SecretHash` can only be
  produced by hashing; the reverse is impossible.
- **I-2** — The session token is opaque. It is a `SessionToken` value with no
  readable fields; it carries no operator id, no role and no expiry.
- **I-3** — A failed sign-in is indistinguishable from a successful one in
  its *observable* result. The `AuthenticationOutcome` type has exactly one
  failure shape, and the `IdentityProvider` contract requires the
  no-such-identity path to perform the same KDF work as the wrong-password
  path.
- **I-4** — The role on a session is determined by the *authenticated
  credential*, never by the request. There is no parameter through which a
  caller could supply a role.

---

## Domain Entities

| Entity | Properties | Business Rules |
|--------|------------|----------------|
| **Operator** | `id` (`OperatorId`), `displayName`, `role` (`OperatorRole`), `active` | `id` is the identity as presented at the terminal and is the value stamped onto weighing records and audit entries. `displayName` is what the top bar shows. `role` is one of exactly two values — `OPERATOR` or `SUPERVISOR` (BRD NFR-12). A deactivated operator (`active = false`) authorises nothing from the next check onward, even on a live session. An `Operator` never carries a secret. |
| **Credential** | `operatorId` (`OperatorId`), `secretHash` (`SecretHash`), `role` (`OperatorRole`), `rotatedAt` | Holds **only** a hash (I-1). The `role` here is the authority of record — the session's role is copied from the *matched* credential row, never from the request (I-4). `rotatedAt` marks credential rotation; rotation invalidates the credential but does **not** invalidate a session already established. Exactly one credential per operator per role — credentials are never shared between roles (BRD NFR-12, BRD C-09). |
| **IdentitySession** | `id` (`SessionId`), `operatorId` (`OperatorId`), `role` (`OperatorRole`), `authenticatedAt`, `expiresAt`, `method` (`AuthenticationMethod`), `token` (`SessionToken`), `endedAt` | Exists only between `authenticatedAt` and `expiresAt`, unless ended earlier by sign-out. **At exactly `expiresAt` the session is expired** — the boundary is evaluated inclusively, not after it. An expired session authorises nothing. Sign-out sets `endedAt` and the session authorises nothing from that moment. The `token` is opaque (I-2). The terminal is single-operator: signing in while another session is live **ends the earlier session** as a defined policy, not as an accident. |
| **SupervisorAuthorisation** *(modelled here, implemented in bolt 002)* | `id` (`AuthorisationId`), `sessionId` (`SessionId`), `supervisorId` (`OperatorId`), `action`, `subject`, `reason`, `authorisedAt`, `expiresAt` | A supervisor's approval of **one** privileged action against **one** subject. It is scoped — it cannot authorise a different over-dose — and it expires. It must carry a reason. The supervisor must be a **different person** from the operator: an operator cannot satisfy a supervisor authorisation with their own session. Modelled in this bolt because its shape consumes `Operator` and `IdentitySession`, but its behaviour belongs to `002`. |

### Identity

The `Operator` is a **stable reference to a person**, not a record of what
they did. It is the value stamped onto a weighing record and onto an audit
entry. Units 003 and 006 read it; they never re-derive it. This is why the
`Operator` carries no password, no credential and no mutable session state —
if it did, every consumer would inherit a security surface it has no business
holding.

---

## Value Objects

| Value Object | Properties | Constraints |
|--------------|------------|-------------|
| **OperatorId** | `value` (string) | The identity as presented at the terminal. Non-empty, trimmed, and compared **exactly** — no case folding, because the badge ID is the credential namespace and case folding would merge two distinct badges. |
| **OperatorRole** | `value`: `OPERATOR` \| `SUPERVISOR` | Exactly two values. Not extensible at runtime — the set is the BRD's, and adding a third role would silently widen what a credential can do. Enforced as a closed union type, not a string. |
| **SecretHash** | `value` (string), `algorithm`, `parameters` | The output of a **memory-hard KDF**. Carries its own algorithm and parameters so the cost can be raised later without invalidating existing hashes. **Constructible only by hashing a secret** — there is no constructor that accepts a hash-shaped string from outside the hashing module, so I-1 holds by construction rather than by review. |
| **SessionToken** | `value` (string, opaque) | High-entropy random value, mapped server-side to a session row. **Opaque by type**: the value object exposes no accessor that returns a decodable payload, and there is no `decode` operation anywhere in the model. A client that inspects it learns nothing about the operator (I-2, BRD NFR-12). |
| **SessionId** | `value` (string) | The server-side key of the session. Distinct from `SessionToken`: the token is what the client holds, the id is what the server indexes by. |
| **AuthenticationMethod** | `value`: `LOCAL` \| `DIRECTORY` | Which identity source authenticated the operator. `LOCAL` is the shipped implementation; `DIRECTORY` exists in the model because `Q-08` may resolve to FCI supplying a directory, and the model should not have to change when it does. It records *provenance*, not policy. |
| **AuthenticationOutcome** | `session` (`IdentitySession` \| `null`), `failure` (`AuthenticationFailure` \| `null`) | **Exactly one** of `session`/`failure` is set. The failure shape is a single value (`AuthenticationFailure` with no discriminating field), so a caller cannot branch on *why* authentication failed — the identity-oracle defence (I-3) is a property of the type, not of the implementation. |
| **OperatorStamp** | `operatorId`, `displayName`, `role` | The immutable snapshot of the operator attached to a weighing record or an audit entry. Taken **once**, at the moment of the action, so a later rename or role change cannot rewrite history (BRD DR-02). This is the value other units consume. |
| **SessionLifetime** | `milliseconds` | The configured session duration. A **configuration value, not a constant** — the open question of whether identity is established per shift or per weighing (`CQ-02`) is unsettled, so the duration must not be hard-coded in the model. |

---

## Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **Operator** | `Operator` (root), referenced `Credential`s | 1. `role` is one of exactly two values. 2. A deactivated operator authorises nothing. 3. The operator identity is stable — it never changes because a display name or role changes. 4. The operator holds no secret. |
| **Credential** | `Credential` (root), `OperatorId` | 1. Only a `SecretHash` is stored — never a plaintext secret (I-1). 2. The `role` on the credential is the **authority of record**; the session's role is copied from here and nowhere else (I-4). 3. One credential per (operator, role) — no sharing across roles. 4. `rotatedAt` is monotonic and present after the first rotation. |
| **IdentitySession** | `IdentitySession` (root), referenced `Operator` | 1. `authenticatedAt < expiresAt`. 2. At `expiresAt` exactly, the session is **expired** (inclusive boundary). 3. A session with `endedAt` set authorises nothing. 4. The `role` on the session equals the role of the credential that authenticated it. 5. The token is opaque and unique across live sessions (I-2). 6. Signing in ends any other live session for the same operator. |
| **SupervisorAuthorisation** | `SupervisorAuthorisation` (root), referenced `IdentitySession`, `Operator` | 1. The supervisor is a **different person** from the operator the action is for. 2. The reason is non-empty — an authorisation without one is not a valid authorisation. 3. It is scoped to exactly one `(action, subject)` pair. 4. It expires; at `expiresAt` it is invalid. 5. It is **append-only** — never updated, never deleted (BRD DR-01, DR-02). |

### Aggregate boundaries, and why they fall here

**`Operator` and `Credential` are separate aggregates** even though they are
one-to-one. A credential's `secretHash` and `rotatedAt` are credentials'
business, and a rotation must not require loading or rewriting the operator.
It also keeps the operator's own identity — the value every other unit
consumes — free of anything secret, so a consumer cannot accidentally persist
a credential.

**`IdentitySession` is its own aggregate.** It has a life of its own (bounded
by `expiresAt`), it is ended independently of any operator change, and it
must be loadable by *token* without loading the operator or the credential.
Making it a child of `Operator` would force every session lookup to load the
operator, and would put the operator in the path of an authorisation check.

**`SupervisorAuthorisation` is append-only by construction.** It is never
updated — a correction is a new authorisation. This is the same immutability
discipline the weighing record uses (BRD DR-02), and it is why the
authorisation can be retained on audit terms (BRD DR-01).

---

## Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **OperatorSignedIn** | A sign-in attempt succeeds | `sessionId`, `operatorId`, `role`, `method`, `authenticatedAt`, `expiresAt` |
| **OperatorSignedOut** | A signed-in operator signs out, or a session is ended by a new sign-in on the same terminal | `sessionId`, `operatorId`, `endedAt`, `cause` (`SIGNED_OUT` \| `REPLACED` \| `EXPIRED`) |
| **SessionExpired** | A session's `expiresAt` passes and it is reaped | `sessionId`, `operatorId`, `expiredAt` |
| **CredentialRotated** | A credential's hash is replaced | `operatorId`, `role`, `rotatedAt` |
| **OperatorDeactivated** | An operator is deactivated | `operatorId`, `deactivatedAt` |
| **SignInRefused** | A sign-in attempt fails | `operatorId` (as **presented**, not as resolved), `occurredAt`, `reason` (`INVALID_CREDENTIAL`) — **no** field distinguishing "no such identity" from "wrong password" (I-3) |

**The `SignInRefused` event is the security-critical one.** It records the
operator id *as presented by the client*, and its `reason` field has a single
value. If the event carried a reason that distinguished "unknown identity"
from "wrong password", the event stream itself would become the identity
oracle that the response body is careful not to be.

**`OperatorSignedIn` carries no secret and no token.** The token is returned
to the client exactly once, at sign-in, and is never published as an event.

---

## Domain Services

| Service | Operations | Dependencies |
|---------|------------|--------------|
| **AuthenticationService** | `signIn(credentials, sessionLifetime) → AuthenticationOutcome`; `signOut(sessionId)`; `currentOperator(token) → Operator \| null`; `requireOperator(token) → Operator` (throws if none) | `IdentityProvider` (find + verify), `CredentialRepository`, `SessionRepository`, `SecretHasher` |
| **SessionPolicy** | `isLive(session, now) → boolean`; `isExpired(session, now) → boolean`; `remainingLifetime(session, now)` | `IdentitySession`, `SessionLifetime` — **pure, no I/O** |
| **CredentialService** | `create(operatorId, secret, role) → Credential` (hashes the secret); `rotate(credential, newSecret)`; `matches(credential, presentedSecret) → boolean` | `SecretHasher` — the only component that ever sees a plaintext secret |
| **IdentityProvider** *(interface)* | `kind`; `available`; `findOperator(id) → Operator \| null`; `verifyCredential(id, secret) → VerificationOutcome`; `describe()` | — (the seam over `Q-08`) |
| **LocalIdentityProvider** *(implementation)* | as `IdentityProvider` | `OperatorRepository`, `CredentialRepository`, `SecretHasher` |
| **OperatorStampFactory** | `stamp(operator) → OperatorStamp` | `Operator` — the single place the identity snapshot is taken |

### `IdentityProvider` — the seam for `Q-08`

The interface is the whole answer to an open question. It has exactly two
implementations in view: `LOCAL` (shipped) and a future `DIRECTORY`.

**What the interface deliberately does *not* have:**

- no method that returns a plaintext secret,
- no method that returns a session,
- no method that mutates an operator's role.

The provider answers *"is this credential valid, and who is this operator?"*
and nothing else. Session management, hashing policy and expiry belong to
this context regardless of where the identity came from. If a `DIRECTORY`
provider were added tomorrow, it would verify credentials and return an
operator; the session, the token and the expiry rules would be unchanged, and
no consuming unit would notice.

### `SecretHasher` — the only component that sees plaintext

`SecretHasher` has two operations: `hash(secret) → SecretHash` and
`verify(hash, presentedSecret) → boolean`. It is the only place in the
system where a plaintext secret is in scope.

**`verify` must perform the full KDF work on a miss**, not short-circuit.
This is the mechanism behind I-3: the "no such identity" path must run
`verify` against a **dummy hash** so that its timing class matches the
"wrong password" path. This is a property of the *provider
implementation*, not of the type, which is why it is recorded here as an
explicit obligation on `LocalIdentityProvider`.

---

## Repository Interfaces

| Repository | Entity | Methods |
|------------|--------|---------|
| **OperatorRepository** | `Operator` | `findById(id) → Operator \| null`; `save(operator)`; `findAll()` |
| **CredentialRepository** | `Credential` | `findByOperatorAndRole(operatorId, role) → Credential \| null`; `save(credential)`; `findByOperator(operatorId) → Credential[]` |
| **SessionRepository** | `IdentitySession` | `findByToken(token) → IdentitySession \| null`; `save(session)`; `end(sessionId, endedAt, cause)`; `findLiveByOperator(operatorId) → IdentitySession[]`; `expireDue(now) → IdentitySession[]` |

### Notes on the repository contracts

**`SessionRepository.findByToken` returns `null` for an unknown, tampered,
truncated or ended token.** All four cases collapse to one result — the
request is refused and the requester is treated as anonymous. There is no
"invalid token" exception distinct from "no token", because that difference
is exactly what an attacker probes for.

**`SessionRepository` has no `delete`.** Sessions are *ended*, not deleted —
an ended session is a record that something happened, and `OperatorSignedOut`
depends on it. Expiry reaps the row after a retention window, but the
transition to "not live" is a state change, not a removal.

**`CredentialRepository` exposes no method that returns a secret.** It
returns `Credential` objects, which by construction hold only a
`SecretHash`. There is no `findSecretByOperator` for anything to call.

**Repositories return domain objects, not rows.** The mapping from a database
row to a `SecretHash` (reconstructing the algorithm and parameters) happens
inside the infrastructure adapter, so a row can never circulate in the
application layer where it might be logged in full.

---

## Ubiquitous Language

| Term | Definition |
|------|------------|
| **Operator** | An identified person known to the station, with an id, a display name and a role. Never carries a secret. |
| **Credential** | The stored secret for one (operator, role) pair, held only as a `SecretHash`. |
| **Session** | A period during which one operator is signed in at the terminal. Bounded by `expiresAt`. |
| **Session token** | The opaque value the client holds and presents on every request. Reveals nothing about the operator. |
| **Role** | Either `OPERATOR` or `SUPERVISOR`. Determined by the matched credential, never by the request. |
| **Sign in** | The act of establishing a session by presenting a credential. |
| **Sign out** | The act of ending the current session. |
| **Anonymous** | The state of a request with no live session. Anonymous authorises nothing. |
| **Expired** | A session whose `expiresAt` has passed — evaluated at the boundary, inclusive. Authorises nothing. |
| **Current operator** | The operator on the live session for a request. `null` when anonymous. |
| **Identity stamp** | The immutable snapshot of the operator attached to a weighing record or audit entry. |
| **Memory-hard KDF** | A key-derivation function deliberately expensive per guess, so a stolen credential table cannot be brute-forced cheaply. |
| **Identity provider** | The seam over the source of identity. `LOCAL` today; possibly FCI's directory later (`Q-08`). |
| **Authentication method** | Which identity source authenticated the operator. Provenance, not policy. |
| **Failed sign-in** | Any unsuccessful authentication attempt. Identical in response, status and timing class whether the identity exists or not. |
| **Privileged action** | An action reserved to a supervisor and requiring a separate, fresh authentication. Modelled in bolt `002`. |
| **Supervisor authorisation** | A supervisor's scoped, expiring, reasoned approval of one privileged action. Modelled here, implemented in bolt `002`. |

---

## Story Coverage

| Story | Covered by |
|-------|-----------|
| **001-sign-in-at-terminal** | `Operator`, `Credential`, `IdentitySession`, `SessionToken`, `OperatorStamp`, `AuthenticationOutcome`, `SessionPolicy`, `CredentialService`, `AuthenticationService`, `IdentityProvider` / `LocalIdentityProvider`, `OperatorRepository`, `CredentialRepository`, `SessionRepository`, events `OperatorSignedIn` / `OperatorSignedOut` / `SessionExpired` / `SignInRefused` |

**Acceptance criteria → model elements.**

| Acceptance criterion | Model element that carries it |
|---|---|
| Session carries id, displayName, role, method, authenticatedAt | `IdentitySession` + `Operator` |
| Current operator returned to the other units | `AuthenticationService.currentOperator` → `OperatorStamp` |
| Sign-out ends the session and authorises nothing | `IdentitySession.endedAt` + invariant 3 |
| Expired session authorises nothing, at the boundary | `SessionPolicy.isLive` + invariant 2 (inclusive) |
| Credential store holds only a hash; no secret in a log | `SecretHash` + `SecretHasher` (the only plaintext scope) |
| Failed sign-in indistinguishable in response and timing | `AuthenticationOutcome` (one failure shape) + `LocalIdentityProvider.verify` full-KDF-on-miss obligation |
| No session → action refused, requester anonymous | `AuthenticationService.requireOperator` + `OperatorRepository` |
| Session token is opaque | `SessionToken` (no decode operation exists) |
| Role is `OPERATOR` or `SUPERVISOR`, from the credential | `OperatorRole` closed union + `Credential.role` as authority of record |
| Signing in grants no supervisor privilege | No privilege state on `IdentitySession`; privilege lives only in `SupervisorAuthorisation` (bolt 002) |

---

## Notes for Stage 2

1. **The KDF choice is a Stage 2 decision with a Stage 3 candidate.** The
   story and the unit brief both require a memory-hard KDF. `scrypt` and
   `argon2id` both qualify and they differ in dependency footprint
   (`argon2` needs a native build; `scrypt` ships with Node's `crypto`).
   This is worth an ADR.
2. **The `DIRECTORY` provider is modelled but not implemented.** It must stay
   unimplemented in this build — implementing it would invent a contract for a
   system that does not exist, which the workbook forbids. The model's job is
   to make the future replacement *possible*, not to pre-build it.
3. **Session lifetime is configuration.** `CQ-02` (per shift vs per weighing)
   is unresolved, so `SessionLifetime` is injected, not defaulted in the model.
4. **Audit events for sign-in and sign-out are published, not stored.** This
   unit emits `OperatorSignedIn` / `OperatorSignedOut`; unit 006 owns the
   trail. The unit must not create an audit table — that would give the
   audit trail two owners.
5. **`SupervisorAuthorisation` is modelled here but implemented in bolt
   `002`.** The model fixes its shape so that `001` does not have to be
   reopened when `002` is built.
