---
bolt: 002-008-operator-identity
created: 2026-10-30T17:40:00Z
status: accepted
superseded_by: null
---

# ADR-003: The authorisation id is not a bearer credential

## Context

A `SupervisorAuthorisation` is a record that a supervisor, having
authenticated at the point of a privileged action, approved that action.
The Stage 1 domain model gave it a shape fixed by bolt `001`:
`id`, `sessionId`, `supervisorId`, `action`, `subject`, `reason`,
`authorisedAt`, `expiresAt`.

The record carries an `id`, and that id has to be **presented** at the
point where the privileged action is applied — otherwise the weighing
station, which is a different unit, has no way to say "this is the
authorisation I am relying on".

That creates a decision that the domain model did not make explicitly: **is
the authorisation id a bearer credential?**

The question is not academic. Consider what "presenting the authorisation"
means in each design:

1. **Design A — the id alone authorises.** The station calls the identity
   unit with an authorisation id and receives "yes, this action is
   authorised". Whoever holds the id may apply it.
2. **Design B — the id plus the operator's live session authorises.** The
   station calls the identity unit with the authorisation id *and* the
   requesting operator's bearer token. The identity unit checks both.

The difference is the blast radius of a leak. Under Design A, the
authorisation id behaves like a session token: anyone who obtains it can
apply the authorisation. Under Design B, the id is useless on its own —
it must be presented by the operator the authorisation was issued for,
proving they are still the operator the exception is being made for.

Two facts push in opposite directions.

**Toward Design A.** An authorisation id is a 256-bit random value, and it
is scoped to one action and one subject, it expires, and it is single-use.
Those four properties together already make it a narrow credential. The
story says an authorisation "is scoped to one action and one subject, and
carries a short validity period after which it is void" and "it cannot be
reused to authorise a second action". A holder of a leaked id can apply
**one** privileged action, on **one** subject, **once**, **within a short
window**. That is a much smaller blast radius than a session token, which
authorises everything the operator may do for its whole lifetime.

**Toward Design B.** The scoping properties limit what a leaked id buys,
but they do not limit *who* can use it. Under Design A, the id could be
read from a log, a support bundle, a crash dump, a browser history entry,
or a screenshot of the supervisor's confirmation screen — and used by
anyone. Under Design B, obtaining the id is not enough; the attacker would
also need the operator's session token.

**The asymmetric cost matters.** The story's edge case says "the scale
disconnects while awaiting authorisation → the authorisation retains its
scope and validity window". A narrow window is a mitigation, not a
control. It reduces the value of a leak; it does not make possession of the
id sufficient authority.

**There is a second consideration that only Design B satisfies.** The
privileged action is being performed *on behalf of the operator*. The
station must know who is performing it, for the weighing record to carry
the right identity (FR-18, BRD FR-24). Under Design A the station would
have to obtain the operator's identity by some other route, and the
authorisation id would be a separate, parallel credential for the same
request — two things to correlate, two things that can disagree. Under
Design B the session token is *already* on the request, because the
station makes every authenticated request with it, so requiring it costs
nothing and removes the ambiguity.

## Decision

**An authorisation id is a reference, not a credential.**

The consume operation requires **both**:

1. the **authorisation id**, and
2. the **requesting operator's live session token**.

The identity unit verifies that the session is live, that the
authenticated operator is the operator the authorisation was issued
**for**, that the requested `(action, subject)` matches the
authorisation's scope, that the authorisation has not expired, and that it
has not already been consumed.

Design B is chosen.

**The rule in one sentence:** *the authorisation id says which approval
applies; the session says who is applying it. Neither is sufficient
alone.*

### What this does NOT change

**The authorisation id is still required.** Design B is not a replacement
for the id — it is an addition. The station must still name which
authorisation it is relying on, and the id remains the lookup key.

**The scope, expiry and single-use rules are unchanged.** They remain the
primary limits on what a *legitimate* authorisation can do, and Design B
adds a limit on who may use it.

**The session token's own properties are unchanged.** It remains opaque,
stored as a SHA-256 digest (ADR-002), and never persisted in plaintext.

### The single exception, and why it exists

There is exactly one case where an authorisation is applied **without** the
operator's session: **at the moment the authorisation is created.**

That is not an exception to the rule — it is the rule's other half. The
supervisor authenticates at the point of action and the authorisation
*comes into existence* as a result. The supervisor's credential is
verified, a fresh session is established for the supervisor (or the
supervisor's existing session is re-verified against the credential), and
the authorisation is bound to it.

What this means concretely: **there is no code path anywhere that creates
an authorisation from a session id alone.** The only path runs through a
credential verification. That is what makes "a supervisor is signed in
elsewhere" structurally irrelevant rather than merely refused by a check
someone might forget to write.

## Rationale

**Why not Design A.** The cost of Design A is a leak of a live, usable
credential through any of the ordinary channels through which ids leak:
server logs, support bundles, browser history, screenshots, a printed
worksheet. The cost of Design B is that the consume endpoint cannot be
called without a session — which costs nothing, because the station is
already making an authenticated request.

The asymmetry is the whole argument. **Design A buys nothing that Design B
does not also provide**, and it buys it with a strictly larger blast
radius.

**Why the "already signed in elsewhere" case is not a counter-argument.**
One might worry that requiring a session makes the authorisation unusable
in a workflow where the operator has stepped away. But the authorisation is
*for an action the operator is performing* — the operator raises the
override request and the operator's session confirms the component. The
operator is present at the terminal by definition. There is no workflow
where the authorisation is consumed by someone who is not the operator.

**Why the id is not made a secret instead.** An alternative is to treat the
authorisation id as a high-entropy secret and store only its digest, the
way the session token is treated (ADR-002). That would raise the cost of a
leak. It is rejected as **belt-and-braces on a property that scoping
already provides**, and because it would introduce a second credential
type into a system that currently has exactly one (the session token). A
single credential type is easier to reason about and easier to revoke.

**Why the operator identity check is on the session, not on the id.** The
identity unit already knows how to resolve a session token to an operator.
Requiring the session reuses that path unchanged, so the "is this the right
operator?" check needs no new mechanism and no new lookup.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **Design A — the id alone authorises** | Simplest call site; no session needed to consume | The id is a usable credential for one privileged action; leaks through ordinary channels; separates "who is acting" from "what authorises" | Buys nothing over Design B and has a strictly larger blast radius |
| **Design B — id + the operator's live session (chosen)** | A leaked id is worthless alone; the operator's identity is established by the same session it uses for everything else; no parallel credential | The consume endpoint requires a session, so it cannot be called anonymously | The station is already authenticated for the action, so the requirement costs nothing |
| **Store only a digest of the authorisation id, as with the session token** | Raises the cost of a leak | A second credential type; guards a property (unforgeability) that scoping, expiry and single-use already largely provide | Belt-and-braces; a single credential type is easier to reason about and revoke |
| **Bind the authorisation to the operator's session id at creation, and check that session at consume** | No session token needed at consume | The session may have expired or been replaced between creation and consume, making a legitimate authorisation unusable; and the session id is not what the client holds | The session *token* is what the client holds; checking the token also proves the operator is present |
| **Make the authorisation id itself a signed token (like a JWT) carrying the operator id** | Stateless; the id alone proves everything | **Violates the opaque-token discipline** the project already applies to session tokens (ADR-002); a decodable token is a token that can be inspected, forged or replayed | Directly contrary to the established pattern; the session token already carries the identity |

## Consequences

### Positive

- **A leaked authorisation id authorises nothing.** The attacker would also
  need the requesting operator's live session token, which is a credential
  the system already protects with a stored digest (ADR-002).
- **One credential type, not two.** The session token is the only bearer
  credential in the product. The authorisation id is a lookup key.
- **The operator's identity on the record is established by the same
  session the station already uses.** There is no second, parallel
  credential to correlate or to get out of step.
- **The "already signed in elsewhere" case is structurally impossible to
  satisfy.** No code path creates an authorisation from a session id alone.
- **Revocation stays simple.** Ending the operator's session invalidates
  every authorisation that operator could apply, without needing a
  per-authorisation revocation list.

### Negative

- **The consume endpoint cannot be called without a session.** A caller
  with only an authorisation id gets a `401`, not a `403`. This is a
  deliberate difference from the *authorisation* endpoint, where a wrong
  supervisor credential returns `403` (see ADR-004) — the two situations
  are different and the difference is intended.
- **The identity unit now does two checks at consume time** — session
  validity and authorisation validity — where Design A would do one.
  Both are cheap; neither involves a KDF.
- **The design couples the authorisation to the session's lifetime.** If
  the operator signs out between the override request and the confirmation,
  the authorisation cannot be applied and a fresh escalation is needed. This
  is the correct behaviour — the operator is no longer at the terminal — but
  it is a workflow consequence worth stating.

### Risks

- **Risk: a future developer adds an "apply by id only" path** for
  convenience, or for a background job that has no session. *Mitigation*:
  this ADR; the consume operation's signature requires both arguments, so
  the "id only" call does not compile; and the Stage 5 test suite asserts
  that consuming without a valid operator session is refused.
- **Risk: a future developer treats the authorisation id as a loggable
  identifier.** It is safe to log — it is not a credential under this
  decision — but if that ever changes, the log becomes a leak vector.
  *Mitigation*: this ADR states plainly that the id is not a credential, so
  the assumption is visible to anyone reading the log-handling code.
- **Risk: an operator's session expires between escalation and
  confirmation, and the workflow has no path to re-authorise.** *Mitigation*:
  the escalation state is `ESCALATED` and awaits a fresh authorisation, so
  the operator can simply re-raise the override. This is unit 003's
  behaviour; this ADR only records that the authorisation is not usable
  without a live session.

## Related

- **Stories**: `002-authorise-privileged-action-as-supervisor` ·
  `007-escalate-non-compensable-overdose` (unit 003 — consumes the
  authorisation)
- **Requirements**: FR-13, FR-21, AC-06 · BRD NFR-12, BRD FR-24, BRD FR-35
- **Standards**: `memory-bank/standards/tech-stack.md` — the Authentication
  section describes sign-in but not privileged-action authorisation; this
  ADR and ADR-004 close that gap.
- **Previous ADRs**: ADR-002 (the session token is stored as a digest —
  the token this decision requires is that token)
