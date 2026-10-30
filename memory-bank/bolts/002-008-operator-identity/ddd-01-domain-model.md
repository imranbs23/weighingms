---
unit: 008-operator-identity
bolt: 002-008-operator-identity
stage: model
status: complete
updated: 2026-10-30T16:05:00Z
---

# Static Model - Supervisor Authorisation

## Bounded Context

**Supervisor Authorisation** is the second half of the **Operator Identity**
bounded context, and it is the compliance-critical half. Bolt `001` built the
identity that this bolt consumes; this bolt builds the *authorisation*.

The context answers one question, and it answers it exhaustively:

> **Has a privileged action been authorised by a supervisor, in their own
> name, at the point of the action, for a stated reason, and is that
> authorisation still live and still scoped to this exact action?**

The context is **the only place in the product where a defect is a
compliance breach rather than a usability bug**. Every other unit's bugs
produce a wrong number on a ticket. A bug here releases an out-of-tolerance
over-dose that should have been blocked, or blocks one that was properly
approved. That asymmetry drives every design decision in this document: the
**refusal paths are the product**, not error handling.

### What this context owns

1. The `SupervisorAuthorisation` aggregate — its shape (fixed in bolt `001`'s
   domain model) and its **behaviour** (owned here).
2. The rules that decide whether a privileged action may proceed.
3. The record of **refusals**, which are audited as first-class outcomes.
4. The **retention** of authorisations on audit terms.

### What this context does not own

- The **decision** to escalate an over-dose, the compensability rule and the
  weighing state machine → unit `003-weighing-station`. This context
  supplies the *authorisation* that unit 003 consumes; it does not decide
  what needs authorising.
- The **audit trail** — the trail's storage, immutability enforcement,
  retention job and export format → unit `006-ticket-printing`. This context
  **emits** the events the trail records; it must not create an audit table,
  because that would give the trail two owners.
- The **supervisor prompt** UI → unit `007-weighingms-ui`.
- The **identity source** → `Q-08`, undecided, reached only through the
  `IdentityProvider` seam that bolt `001` established.

### The boundary that matters

Unit `003` consumes authorisation through exactly one interface: present an
authorisation, get a verdict. It never re-derives the rules, never inspects
the credential store, and never asks "could the supervisor have been the
operator?". That single-chokepoint property is what lets this context's rules
be exhausted by a test suite rather than re-implemented at each call site —
and it is the reason the unit brief keeps this unit separate from unit 003
rather than folding it in.

### Invariants the model must make structural

Bolt `001` established four invariants for the identity half (I-1 no
plaintext secret, I-2 opaque token, I-3 indistinguishable failure, I-4 role
from the credential). This bolt adds three of its own, and each is expressed
below as a type-level constraint or a single chokepoint, so a mistake is a
compile error or a failed test rather than a review comment.

- **A-1 — A different person.** The authorising supervisor's identity must
  differ from the identity of the operator the privileged action is *for*.
  The check is on **identity**, not on role: a person who holds both roles
  still cannot self-authorise. Expressed as a check on
  `OperatorId` equality, so the role label cannot influence it.
- **A-2 — A fresh authentication at the point of action.** The authorisation
  is created by a supervisor **authenticating at the moment the privileged
  action is attempted**. A supervisor session being live elsewhere is
  irrelevant. Expressed structurally: the authorisation's `sessionId` refers
  to a session that is *itself* the product of the supervisor's own
  authentication, and no path creates an authorisation from an existing
  session without a fresh credential verification.
- **A-3 — A reason, and it is not empty.** The reason is mandatory and must
  contain something other than whitespace or punctuation. Expressed as a
  value object that **cannot be constructed** from an empty or
  contentless string.

These three are the story's "three invariants". The remaining requirements —
scoping, expiry, single use, audit-on-refusal, retention, no credential
sharing — are expressed as further invariants below.

### The complete invariant set for this context

- **A-1** — a different person.
- **A-2** — a fresh authentication at the point of action.
- **A-3** — a mandatory, non-empty reason.
- **A-4** — scoped to exactly one `(action, subject)` pair; presenting it
  for any other action or subject is refused.
- **A-5** — expiring; at `expiresAt` exactly, it is invalid (inclusive
  boundary).
- **A-6** — single-use; once consumed by a successful action it is spent.
- **A-7** — append-only; the authorisation record is never updated and never
  deleted. Consumption is recorded as a **separate** fact, not by mutating
  the authorisation (BRD DR-02).
- **A-8** — every refusal is audited with actor, subject and reason for
  refusal.
- **A-9** — credentials are never shared between roles: a supervisor
  credential cannot act as an operator, and an operator credential cannot
  act as a supervisor.

---

## Domain Entities

| Entity | Properties | Business Rules |
|--------|------------|----------------|
| **Operator** *(from bolt 001)* | `id` (`OperatorId`), `displayName`, `role` (`OperatorRole`), `active` | Carried unchanged. The authorisation references the operator **by id**, never by role label — that is what makes A-1 a check on identity rather than on a role string. A deactivated operator cannot authenticate, so a deactivated supervisor cannot authorise. |
| **IdentitySession** *(from bolt 001)* | `id` (`SessionId`), `operatorId`, `role`, `authenticatedAt`, `expiresAt`, `method`, `token`, `endedAt` | Carried unchanged. The supervisor's own session is the *evidence* of the fresh authentication (A-2). It is **not** sufficient on its own: the session must have been established by a supervisor credential **presented at the point of action**. |
| **SupervisorAuthorisation** | `id` (`AuthorisationId`), `sessionId` (`SessionId`), `supervisorId` (`OperatorId`), `action` (`PrivilegedAction`), `subject` (`AuthorisationSubject`), `reason` (`AuthorisationReason`), `authorisedAt`, `expiresAt` | A supervisor's approval of **one** privileged action against **one** subject. Carries the supervisor's identity (A-1), the reason (A-3), the time of authorisation, the scope (A-4) and the expiry (A-5). **Append-only** (A-7). The shape was fixed in bolt `001`'s domain model; the *behaviour* — how it is created, consumed and refused — belongs to this bolt. |

### Identity

The `Operator` remains a **stable reference to a person**, not a record of
what they did. This bolt adds one new consumer of it: the authorisation
names the supervisor by id, and the audit entry and the confirmed weighing
record carry that id, the reason and the time.

**Why the authorisation holds the supervisor's `OperatorId` rather than a
role string.** If it held a role, then two different supervisors would be
indistinguishable in the record, and A-1 ("a different person") could not be
evaluated at all — it would degenerate into "the authoriser had the
supervisor role", which is precisely the self-escalation the story forbids.
Holding the id makes the person checkable and the record attributable
(BRD FR-24, FR-36).

---

## Value Objects

| Value Object | Properties | Constraints |
|--------------|------------|-------------|
| **PrivilegedAction** | `value` (string) | The **kind** of privileged action being authorised — e.g. `OVERDOSE_OUTSIDE_TOLERANCE`. A closed, finite vocabulary owned by this context, because the vocabulary *is* the authorisation surface: an action that is not in the vocabulary cannot be authorised at all. Enforced as a closed union type, not a free string, so a typo cannot create an unauthorised action kind. **The concrete action names are settled at Stage 2** — the *mechanism* (closed set, one action per authorisation) is what this stage fixes. |
| **AuthorisationSubject** | `value` (string) | The specific thing the authorisation applies to — e.g. a weighing record id, or a batch-and-lot reference. **Opaque to this context**: the context must not parse it, must not resolve it, and must not know what a "weighing" is. It compares subjects for equality; it does not understand them. This keeps unit 003's domain out of this context. |
| **AuthorisationReason** | `value` (string) | The mandatory justification. **Cannot be constructed from an empty string, a whitespace-only string, or a string with no letters or digits** — punctuation alone is not a justification. The rule is in the constructor, so a missing reason is a *type error* at the boundary rather than a runtime check that a call site can forget. This is A-3 expressed structurally. |
| **AuthorisationId** | `value` (string) | The server-side key of the authorisation. Distinct from any credential the client might hold. |
| **AuthorisationScope** | `action` (`PrivilegedAction`), `subject` (`AuthorisationSubject`) | The pair the authorisation is bound to. Grouping them makes A-4 a **single equality check** against a scope, rather than two independent checks that could be applied inconsistently. There is no "scope" value that contains an action without a subject, or a subject without an action. |
| **AuthorisationWindow** | `authorisedAt`, `expiresAt` | The validity window. `authorisedAt < expiresAt` is enforced at construction. The **length** of the window is a **configuration value, not a constant** — how long a supervisor authorisation should remain live is an operational question the story leaves open, and the model must not hard-code it. |
| **AuthorisationOutcome** | `authorisation` (`SupervisorAuthorisation` \| `null`), `refusal` (`AuthorisationRefusal` \| `null`) | Exactly one of `authorisation`/`refusal` is set — the same one-or-the-other shape bolt `001` used for `AuthenticationOutcome`. The **refusal is a value, not an exception**: a refusal is a *legitimate business outcome* of this context, and the shape makes that structural. |
| **AuthorisationRefusal** | `reason` (`RefusalReason`), `actor` (`OperatorId` \| `null`), `subject` (`AuthorisationSubject` \| `null`), `action` (`PrivilegedAction` \| `null`), `occurredAt` | The **named** reason a privileged action was refused. Unlike bolt `001`'s `AuthenticationFailure` — which deliberately has a *single* reason, because the sign-in failure must not be an identity oracle — the refusal here **must** name which check failed. The story requires it explicitly: "the refusal names which check failed", and "the refused attempt is itself audited with the actor, the subject and the reason for refusal". These are different requirements for different reasons, and the contrast is deliberate. |
| **RefusalReason** | `value` (closed union) | The closed set of ways an authorisation can be refused. Every value corresponds to one of the story's refusal cases, so a new refusal path cannot be added without extending this union — and extending it is a visible, reviewable change. |
| **AuthorisationConsumption** | `authorisationId`, `consumedAt`, `action`, `subject` | The **fact** that an authorisation was used. Recorded as its own append-only entity rather than a flag on the authorisation, because A-7 forbids mutating the authorisation (BRD DR-02). This is how A-6 (single use) is enforced: the authorisation is spent if and only if a consumption exists for it. |

### Why `AuthorisationRefusal` may name a reason while `AuthenticationFailure` may not

This looks like an inconsistency between two bolts, so it is worth stating
why it is not.

Bolt `001`'s failure shape is deliberately **anonymous** because the threat
there is *enumeration*: an attacker probing sign-in to discover which badge
IDs exist. The defence is to make "no such operator" and "wrong password"
indistinguishable.

This context's refusal shape is deliberately **specific** because the threat
here is the opposite: an operator, or a caller building an unauthorised
escalation path, must not be able to discover *why* a legitimate supervisor
failed to authorise — but the **system** must be able to record precisely
which control was not satisfied. The story requires that record for the
audit trail. The two requirements do not conflict because they protect
different audiences:

- The **client-facing** response for a refused privileged action is a
  *generic* refusal. It does not tell the caller which control failed,
  because the caller is an operator attempting escalation, and a precise
  error would be a map of the defences.
- The **internal** `AuthorisationRefusal` value names the reason, because the
  audit trail needs it.

So `AuthorisationRefusal` is a domain value, and the presentation layer
decides how much of it to reveal. That separation is a design decision, not
an accident, and it is recorded here so Stage 2 does not collapse the two.

---

## Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **SupervisorAuthorisation** | `SupervisorAuthorisation` (root), referenced `IdentitySession`, `Operator` | 1. The supervisor is a **different person** from the operator the action is for — checked on `OperatorId` equality, never on role (A-1). 2. The reason is present and non-empty (A-3). 3. It is scoped to exactly one `(action, subject)` pair (A-4). 4. It expires; at `expiresAt` exactly it is invalid (A-5, inclusive). 5. It is **append-only** — never updated, never deleted (A-7, BRD DR-01/DR-02). 6. The supervisor's session was created by a supervisor credential presented at the point of action (A-2). 7. Consumption is recorded outside the aggregate, so the record itself never changes (A-6 via `AuthorisationConsumption`). |
| **AuthorisationConsumption** | `AuthorisationConsumption` (root), referenced `SupervisorAuthorisation` | 1. At most one consumption per authorisation — the single-use rule (A-6) is a uniqueness constraint, not a check. 2. Append-only. 3. Its `action` and `subject` equal the authorisation's scope. |

### Aggregate boundaries, and why they fall here

**`SupervisorAuthorisation` is its own aggregate, separate from
`IdentitySession`.** This is the structural expression of A-2. If the
authorisation were a child of the session, the authorisation's existence
would imply "the session is live and the operator is a supervisor", and the
fresh-authentication requirement would be unenforceable — a supervisor
session opened at shift start would carry an authorisation with it. Keeping
them apart means the authorisation *references* a session that was proven
fresh at a specific moment, and the check happens when the authorisation is
created rather than being inherited.

**`AuthorisationConsumption` is a separate aggregate, not a field on the
authorisation.** A-7 forbids updating the authorisation. If consumption were
a `consumedAt` field on it, consuming it would mutate an append-only record
and break BRD DR-02's immutability. A separate append-only fact keeps both
records intact, and the single-use rule becomes "a consumption exists for
this authorisation", which is checkable by an existence query rather than by
trusting a flag.

**The consumption aggregate is not a child of the authorisation.** If it
were, deleting the authorisation would delete the evidence that it was used,
and the audit trail's account of the exception would become unverifiable.
Both records are retained on audit terms for the same reason.

---

## Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **PrivilegeAuthorised** | A supervisor's fresh authentication succeeds, the reason is valid, and the authorisation is granted | `authorisationId`, `supervisorId`, `sessionId`, `action`, `subject`, `reason`, `authorisedAt`, `expiresAt` |
| **PrivilegeRefused** | A privileged action is refused for **any** reason | `actor` (the signed-in operator, or `null`), `requestedBy` (who presented the credential, if any), `supervisorId` (if a supervisor identity was resolved), `action`, `subject`, `reason` (`RefusalReason`), `occurredAt` |
| **AuthorisationConsumed** | A live, in-scope, unconsumed authorisation is applied to a privileged action | `authorisationId`, `action`, `subject`, `consumedAt`, `operatorId` |
| **AuthorisationExpired** | An authorisation's `expiresAt` passes and it is reaped | `authorisationId`, `expiredAt` |

**`PrivilegeRefused` is the event that closes A-8.** It is emitted on
**every** refusal path — wrong role, no fresh authentication, missing reason,
self-authorisation, wrong scope, expired, already used, and no signed-in
operator at all. A refusal is not an exception that escapes to a generic
error handler, because a generic error handler would not audit it, and the
story requires the refused attempt to be audited just as the granted one is.

**`PrivilegeRefused` deliberately carries the reason, while the
client-facing response does not.** The event is internal (consumed by unit
006's trail); the response body is not. See the note on
`AuthorisationRefusal` above.

**`PrivilegeAuthorised` carries no credential and no token.** It names the
supervisor, the reason, the scope and the times — which is exactly what the
audit trail and the confirmed weighing record need, and nothing more.

---

## Domain Services

| Service | Operations | Dependencies |
|---------|------------|--------------|
| **AuthorisationService** | `authorise(request) → AuthorisationOutcome`; `consume(authorisationId, action, subject) → AuthorisationOutcome`; `evaluate(authorisationId, action, subject) → AuthorisationOutcome` | `IdentityProvider` (verify the supervisor's credential), `CredentialRepository`, `SessionRepository`, `AuthorisationRepository`, `ConsumptionRepository`, `AuthorisationClock`, `AuthorisationWindowFactory` |
| **AuthorisationPolicy** | `mayAuthorise(actor, supervisor, action, subject, reason, now) → RefusalReason \| null`; `isLive(authorisation, now)`; `isInScope(authorisation, action, subject)`; `isSpent(authorisationId) → boolean` | `SupervisorAuthorisation`, `AuthorisationScope`, `AuthorisationWindow` — **pure, no I/O** |
| **AuthorisationClock** *(interface)* | `now() → Date` | — (injected, so expiry is testable at the boundary without sleeping) |
| **AuthorisationWindowFactory** *(interface)* | `create(authorisedAt) → AuthorisationWindow` | `AuthorisationLifetime` (configuration) |
| **AuthorisationLifetime** | `milliseconds` | The configured lifetime of an authorisation. **A configuration value, not a constant** — the operational question of how long a supervisor's approval stays live is not answered by the BRD, and the model must not decide it. |
| **AuthorisationReasonValidator** *(interface)* | `isMeaningful(text) → boolean` | — (a seam so the "punctuation-only is not a reason" rule can be tightened without touching the aggregate) |

### `AuthorisationService` — the single chokepoint

The unit brief and the story both insist that "the checks live behind one
interface in this unit, so they can be exhausted exhaustively by tests rather
than re-implemented at each call site". `AuthorisationService` is that
interface, and it has exactly three operations:

1. `authorise(request)` — the supervisor authenticates at the point of
   action, presenting their credential, the action, the subject and the
   reason. Returns `AuthorisationOutcome`.
2. `evaluate(authorisationId, action, subject)` — a *pure check* against an
   existing authorisation: is it live, in scope, unspent? Returns
   `AuthorisationOutcome`. **No re-derivation of the rules at the consumer** —
   unit 003 calls this and obeys the verdict.
3. `consume(authorisationId, action, subject)` — the same check as
   `evaluate`, and on success records the consumption. The privileged action
   proceeds only if `consume` returns an authorisation.

`evaluate` and `consume` share one implementation of the checks. `evaluate`
is what a caller uses to ask "would this be permitted?"; `consume` is what
it uses to actually permit it. Having both, with the checks written once,
is what stops the "is it allowed?" question and the "do it" question from
drifting apart.

### `AuthorisationPolicy` — pure, and exhaustible

The policy is a **pure function** of its arguments: it reads no clock, no
database, no environment. It takes `now` as an argument, which is what makes
the expiry boundary testable exactly rather than approximately, and it takes
the actor and supervisor identities as arguments, which is what makes A-1 a
pure identity comparison rather than a lookup.

The policy returns a `RefusalReason | null` — **`null` means permitted**.
Returning the reason rather than a boolean is what allows the refusal to be
audited with the reason it failed, and it means the caller cannot
accidentally ignore the reason.

### The fresh-authentication check is in the policy, but the *evidence* comes from the provider

A-2 is discharged in two halves:

- The **policy** checks that the authorisation is bound to a session that was
  established by a supervisor credential, and it is the policy — not the
  caller — that decides this.
- The **provider** performs the actual credential verification at the moment
  of authorisation, using the same constant-work path bolt `001` built. This
  is the structural reason A-2 cannot be satisfied by "the supervisor is
  signed in somewhere".

**The crucial structural point:** the authorisation is created from a
*verification result*, not from a *session lookup*. There is no method
anywhere that takes a session id and produces an authorisation. The only
path to a `SupervisorAuthorisation` runs through a credential verification.
That is what makes "a supervisor holds a valid session elsewhere" structurally
irrelevant rather than merely refused by a check someone might forget to
write.

### `AuthorisationClock` — the clock is injected, never ambient

Expiry is a core rule here, and a rule that reads an ambient clock cannot be
tested at its boundary. The clock is an interface; production injects a
system clock, tests inject a fixed one. This is why the inclusive-expiry
boundary (A-5) is a *tested* fact rather than an assertion in a comment.

---

## Repository Interfaces

| Repository | Entity | Methods |
|------------|--------|---------|
| **AuthorisationRepository** | `SupervisorAuthorisation` | `save(authorisation)` (insert only — **no update, no delete**); `findById(id) → SupervisorAuthorisation \| null`; `findBySubject(subject) → SupervisorAuthorisation[]`; `expireDue(now) → SupervisorAuthorisation[]` |
| **ConsumptionRepository** | `AuthorisationConsumption` | `save(consumption)` (insert only); `findByAuthorisationId(id) → AuthorisationConsumption \| null`; `existsFor(authorisationId) → boolean` |

### Notes on the repository contracts

**`AuthorisationRepository` has no `update` and no `delete`.** This is A-7 at
the storage layer, not merely in the aggregate. The interface is the
enforcement point: there is no method to call that would mutate an existing
authorisation, so the prohibition is structural rather than a convention.

**`ConsumptionRepository.existsFor` is the single-use check (A-6).** It is an
existence query rather than a count, because the rule is "at most one". The
database also carries a unique constraint on `authorisation_id`, so a race
between two concurrent consumptions is rejected by the storage layer as well
as prevented by the check.

**The repositories return domain objects, not rows** — the same rule bolt
`001` established for its repositories. The mapping from a row to an
`AuthorisationReason` (including the "is this meaningful?" judgement on
read-back) happens inside the infrastructure adapter.

**Authorisations are retained on audit terms (≥ 5 years, BRD DR-01).** The
`expireDue` operation exists to mark an authorisation expired — it does
**not** delete it. An expired authorisation that is deleted would destroy the
evidence that the exception had been released, and would leave the audit
trail's claim unverifiable.

---

## Ubiquitous Language

| Term | Definition |
|------|------------|
| **Privileged action** | An action reserved to a supervisor, requiring a separate fresh authentication. Named by a `PrivilegedAction` from a closed vocabulary. |
| **Authorisation** | A supervisor's scoped, expiring, reasoned, single-use approval of one privileged action against one subject. |
| **Authorise** | The act of creating an authorisation, by authenticating at the point of action. |
| **Fresh authentication** | A credential verification performed *now*, at the moment of the privileged action. Not a session lookup, not "signed in elsewhere". |
| **Scope** | The `(action, subject)` pair an authorisation is bound to. One action, one subject. |
| **Subject** | The specific thing an authorisation applies to. Opaque to this context. |
| **Reason** | The mandatory justification. Not empty, not whitespace, not punctuation-only. |
| **Consume** | The act of applying an authorisation to a privileged action, which spends it. |
| **Spent** | An authorisation that has already been consumed once. It authorises nothing further. |
| **Live** | An authorisation whose `expiresAt` has not passed. At `expiresAt` exactly, it is not live. |
| **Refusal** | A named, audited, legitimate outcome in which a privileged action is not permitted. Not an error. |
| **Refusal reason** | Which control was not satisfied. Recorded internally; not disclosed to the caller. |
| **Self-authorisation** | An authorisation where the supervisor is the same person as the operator the action is for. Always refused, regardless of role. |
| **Role separation** | A supervisor credential cannot act as an operator, and an operator credential cannot act as a supervisor. |
| **Privilege escalation** | The attempt this context exists to refuse. |

---

## Story Coverage

| Story | Covered by |
|-------|-----------|
| **002-authorise-privileged-action-as-supervisor** | `SupervisorAuthorisation`, `AuthorisationScope`, `AuthorisationReason`, `AuthorisationWindow`, `AuthorisationOutcome`, `AuthorisationRefusal`, `RefusalReason`, `AuthorisationConsumption`, `AuthorisationService`, `AuthorisationPolicy`, `AuthorisationClock`, `AuthorisationWindowFactory`, `AuthorisationLifetime`, `AuthorisationRepository`, `ConsumptionRepository`, events `PrivilegeAuthorised` / `PrivilegeRefused` / `AuthorisationConsumed` / `AuthorisationExpired` |

**Acceptance criteria → model elements.**

| Acceptance criterion | Model element that carries it |
|---|---|
| Operator's session alone never authorises a privileged action | `AuthorisationPolicy.mayAuthorise` (role check) + the fact that the only path to an authorisation runs through credential verification (A-2) |
| "Already signed in elsewhere" is not a valid authorisation | `AuthorisationService.authorise` takes a **credential**, never a session id; `IdentityProvider.verifyCredential` is the only path |
| Reason is mandatory | `AuthorisationReason` — **cannot be constructed** from an empty or contentless string (A-3) |
| The authoriser must be a different person; self-authorisation refused | `AuthorisationPolicy.mayAuthorise` compares `OperatorId`s, never roles (A-1) |
| Scoped to one action and one subject; a different action or subject is refused | `AuthorisationScope` + `AuthorisationPolicy.isInScope` (A-4) |
| An expired authorisation authorises nothing | `AuthorisationWindow` + `AuthorisationPolicy.isLive`, inclusive at `expiresAt` (A-5) |
| Single-use; the second use is refused | `AuthorisationConsumption` aggregate + `ConsumptionRepository.existsFor` + unique constraint (A-6) |
| Carries supervisor identity, reason, time; written to the audit trail | `PrivilegeAuthorised` event payload + the authorisation's own fields |
| Retained ≥ 5 years on audit terms | `AuthorisationRepository` has no delete; `expireDue` marks, never removes (BRD DR-01) |
| Every refusal is audited with actor, subject and reason | `PrivilegeRefused` event + `AuthorisationRefusal` (A-8) |
| Credentials are never shared between roles | `CredentialService` / `Credential` role-of-record from bolt `001` + `AuthorisationPolicy` role checks (A-9) |
| The record carries the authorising supervisor's identity, reason and time | `SupervisorAuthorisation.supervisorId` / `.reason` / `.authorisedAt`, consumed by unit 003 and unit 006 |

---

## Notes for Stage 2

1. **The `PrivilegedAction` vocabulary is a Stage 2 decision.** This stage
   fixes the *mechanism* — a closed, finite set; one action per
   authorisation; a scope check that compares rather than parses. The
   concrete action names depend on what unit 003 actually needs to escalate,
   and Stage 2 should confirm them against unit 003's brief rather than
   inventing them here.
2. **`AuthorisationLifetime` is configuration.** The story fixes that an
   authorisation expires but not how long it lives. It must be injected, as
   `SessionLifetime` was in bolt `001`, not defaulted in the model.
3. **The authorisation identifier is not a bearer credential.** The
   authorisation is consumed by presenting its id *together with* the
   operator's session; the id alone grants nothing. This is worth an ADR
   candidate, because it is the difference between "a leaked authorisation
   id authorises an over-dose" and "it does not" — and the story's
   single-use and scoping rules are what make the latter true.
4. **The audit emission is an interface, not a table.** This unit must
   publish `PrivilegeAuthorised` / `PrivilegeRefused` /
   `AuthorisationConsumed` and must **not** create an audit table. Unit 006
   owns the trail's storage and export. If this unit wrote audit rows, the
   trail would have two owners and two retention clocks.
5. **The consumption record is a domain fact, not a flag.** A-6 is enforced
   by the *existence* of an append-only consumption record, so that
   consuming an authorisation never mutates it (A-7, BRD DR-02).
6. **The refusal reason is internal.** The presentation layer must return a
   generic refusal to the caller while the domain value carries the
   specific reason to the audit trail. This is the one place where the
   domain and the API deliberately disagree about how much to say, and it
   is worth a test on both sides.
