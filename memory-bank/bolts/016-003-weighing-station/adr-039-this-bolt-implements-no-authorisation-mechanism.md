---
bolt: 016-003-weighing-station
created: 2026-11-06T09:00:00Z
status: accepted
---

# ADR-039: This bolt implements no authorisation mechanism — it consumes unit 008's, and re-checks nothing

## Context

Bolt `016` must let a supervisor authorise a **non-compensable over-dose**,
so that an unavoidable excess is released *deliberately and traceably*.

The story's requirements are severe, and they are all about the
**authorisation**:

- the operator's own credentials **cannot** authorise it;
- a reason is **mandatory**;
- the authorisation is scoped to **one action** and **one subject**;
- it **expires** after a short validity window;
- it **cannot be reused** for a later confirmation;
- every privileged action is **audited** (BRD FR-36, NFR-13).

**And unit `008` has already built all of it.** The identity unit's ADR-004
says the checks live behind **one** interface *"so they can be exhausted
exhaustively by tests rather than re-implemented at each call site"* — and
its `AuthorisationService` is that interface, with three operations:

- `authorise(request)` — a **fresh** credential verification at the point
  of the action;
- `evaluate(id, act, subj)` — a **pure** check;
- `consume(id, act, subj, operator)` — the same check, and on success the
  authorisation is **spent**.

**And unit `008` already named this exact action.** Its
`PrivilegedAction` carries `CONFIRM_COMPONENT`, with the comment: *"Unit
003's story 007 names a fourth — `confirmComponent`, the confirmation of a
component under a non-compensable over-dose override."*

So the question is not *what* the rules are. **The question is whether this
bolt implements them, or consumes them.**

## Decision

**This bolt implements NO authorisation mechanism. It calls unit `008`'s
`AuthorisationService` and re-checks nothing.**

1. **The port is over unit `008`'s service**, and unit `008`'s
   `AuthorisationService` satisfies it **structurally** — its `authorise`
   and `consume` have exactly the port's signatures. The composition root
   binds the service directly, with **no adapter class**.

2. **The action is `CONFIRM_COMPONENT`** — unit `008`'s closed set, already
   named for this story.

3. **The subject is DERIVED** from the session's own ids
   (`sessionId/componentId`), never supplied by a client. Unit `008`'s
   `AuthorisationSubject` is deliberately opaque to the weighing domain, so
   the composition is this unit's business — and deriving it makes the
   scope check **structural** rather than a check this bolt might forget.

4. **The refusal is unit `008`'s, and the HTTP body is the uniform
   `403 { "error": "AUTHORISATION_REFUSED" }`** — no field is added here.
   The reason goes to the **audit trail** (unit `008` publishes
   `PrivilegeRefused` with it), not to the wire.

5. **The single-use guarantee is unit `008`'s `UNIQUE` constraint**, not a
   check here.

## Rationale

### Why a second implementation would be the defect, not a redundancy

**Because unit `008`'s ADRs are a record of every way a privileged-action
check can go wrong — and each of those failures is silent.**

Unit `008` settled, in five ADRs, the failure modes this bolt would
otherwise re-invent:

| ADR | The failure it prevents |
|---|---|
| **ADR-001** | A second credential path is a second place for the timing defence to be wrong — and the supervisor endpoint is precisely where a timing leak becomes an **identity oracle** |
| **ADR-003** | An authorisation id treated as a bearer credential: a leaked id would authorise **any** confirmation |
| **ADR-004** | A precise refusal reason is a **map of the defences** — it tells the caller which check fired, and therefore which defences are present |
| **ADR-005** | The reason hashed or truncated: an auditor five years later could not read **why** an excess was released |
| **ADR-006** | A `consumed_at` column mutated on the authorisation: a race would let two confirmations spend one authorisation |

**Now consider what a "reasonable" re-implementation in this bolt looks
like.** The author reads the story's requirements and writes:

```ts
if (supervisorId === operatorId) return refuse('SELF_AUTHORISATION');
if (reason.trim().length === 0) return refuse('NO_REASON');
if (now > expiresAt) return refuse('EXPIRED');
```

That code is **correct in every branch** — and it is a **compliance
regression**, because:

- it has a **different** refusal vocabulary from unit `008`'s, so a caller
  comparing the two sees two answers to *"was this refused?"*;
- it has a **different** expiry boundary, because `AuthorisationWindow` is
  unit `008`'s and its exact edges were tested there;
- it has **no** `UNIQUE` constraint, so a concurrent double-spend is
  admitted — the check-then-write race ADR-006 exists to close;
- it has **no** audit event, because `PrivilegeRefused` is unit `008`'s;
- and it **does not verify the credential freshly**, because that is
  `provider.verifyCredential` and unit `008`'s constant-work guarantee is
  bound to *that* call — a different call path would be a different timing
  profile.

**So the re-implementation would be invisible.** Every test in this bolt
would pass. And the product would have two privileged-action surfaces, one
of which was never audited and never constant-work.

**The rule this ADR states is therefore negative and absolute: this bolt
calls `consume` and does not re-check anything.** Not *"checks the same
things"*, not *"checks the important ones"* — **nothing**. Because the
value of unit `008`'s interface is precisely that it is the *only* place
those questions are answered, and a second answer, however correct, undoes
that.

### Why the subject is DERIVED, and not supplied

**Because a supplied subject is an authorisation for something the session
is not working on.**

The scope check — *"this authorisation was issued for a different
component or session"* — is one of the story's edge cases, and it is a
check that can only fail if the subject is **wrong**. If the subject comes
from the client, then:

- the client presents an authorisation issued for **another component**,
  and the check has to catch it — a check that exists, and that a future
  change might weaken;
- the client presents an authorisation issued for **another session**, and
  the same check has to catch that too.

If the subject is **derived** from the session's own ids — the session
the operator is working in and the component it has active — then the
scope is **correct by construction**, and the check has nothing to do.

**And the derivation is exactly the composition unit `008` asked for.** Its
`AuthorisationSubject` comment says: *"The composition of the subject (unit
003 uses 'the specific componentId in the specific sessionId') is the
CALLER's business. This value object only guarantees that it is non-empty
and that it compares exactly."*

So the derivation is not an optimisation — it is **the contract**.

### Why the refusal body is not extended

**Because ADR-004's reasoning applies here with exactly the same force, and
this bolt is the case that proves it.**

Unit `008`'s ADR-004 says a precise error is *"a map of the defences"* —
and lists what a `SELF_AUTHORISATION_REJECTED` response would tell an
attacker: that a distinct-person check exists, that the caller **was**
recognised as a supervisor, that the credential was **accepted** — and
therefore that the caller is a supervisor at that station.

**This bolt is where that matters most**, because the supervisor endpoint is
reachable by anyone who can reach the station's API, and the escalation is
a **standing** request: the operator asks for an override, and the request
waits. An attacker could poll it with credential pairs.

So the body is `403 { "error": "AUTHORISATION_REFUSED" }` — for **every**
refusal — and the reason goes to the audit trail, where an auditor needs it
and an attacker cannot reach it.

**And the reason is not lost by putting it in the trail rather than on the
wire.** Unit `008` publishes `PrivilegeRefused` with the reason, the actor
and the time, and unit `006` records the trail (BRD FR-36). The evidence
exists exactly where it is needed.

### Why the single-use guarantee is a constraint, not a check

**Because a check-then-write is racy, and a unique constraint is not.**

Unit `008`'s ADR-006 settled this: *"The `UNIQUE` constraint on
`authorisation_consumptions.authorisation_id` is the real guarantee against a
double-spend. The existence check above is racy under concurrency; this
insert is not."*

So this bolt's `consume` call **spends** the authorisation atomically, and
this bolt does not check whether it has been spent — because that check is
already inside the same atomic insert. Adding a check here would be a
**race that returns a false answer**, and it would be a *second* answer to
a question unit `008` already answers.

## Consequences

### Positive

- **One privileged-action surface in the product.** Every check, every
  refusal and every audit event comes from one place, and unit `008`'s
  exhaustive test suite proves the rules this bolt relies on.
- **The scope is correct by construction**, not by a check this bolt might
  forget to write.
- **The single-use guarantee is atomic**, because it is unit `008`'s
  constraint.
- **The refusal leaks nothing**, because the body is uniform.
- **The override record is the exception's own evidence** — the supervisor,
  the reason in clear text, the time, the scope and the surplus it covers.
- **This bolt is small**, because it contains no authorisation logic.

### Negative

- **The escalation's outcome depends on another unit's service.** A defect
  in unit `008` surfaces here — and that is **correct**: the defect is
  found by one suite rather than two, and fixed in one place.
- **The escalation cannot be reasoned about in isolation.** A reader of this
  bolt must read unit `008`'s five ADRs to know what the authorisation
  guarantees. That is a real cost, and it is paid deliberately.
- **The port's shape is unit `008`'s shape.** If unit `008` changes its
  signature, this bolt's port changes with it — which is the correct
  coupling, because they are the same concept.

### Risks

- **A future agent adds "just one more check"** — an extra expiry test, or a
  "belt and braces" distinctness check — "for safety". *Mitigation*: the
  decision index's "Read when" points here, and this ADR names the specific
  failure: a second implementation of a check that is already exhaustive
  produces a second answer, and the second answer is the one nobody tested.
- **A future agent implements a "simplified" authorisation** because unit
  `008`'s service is awkward to call. *Mitigation*: the same index entry.
  The port exists precisely so the call is easy.
- **A future agent adds a `reason` field to the `403` body** because "the
  operator needs to know why". *Mitigation*: the same index entry; ADR-004
  says why, and the reason is in the trail where the operator's supervisor
  and the auditor both need it.

## Related

- **Stories**: `007-escalate-non-compensable-overdose`
- **Requirements**: FR-13, FR-21, FR-23, FR-24, FR-35, FR-36 · BRD AC-06,
  BRD NFR-12, NFR-13 · NFR-6
- **Previous ADRs**: ADR-003 (the authorisation id is not a bearer
  credential — why the subject must be derived, not supplied); ADR-004 (one
  uniform refusal response — why this bolt adds no field to the body);
  ADR-005 (the reason is stored in clear text — why the override record
  carries it); ADR-006 (consumption is a separate append-only record — why
  the single-use guarantee is a constraint here and not a check); ADR-028
  (the station owns its own endpoint — this bolt's two paths are the
  station's, not the MES's); ADR-034 (the station's own acts are durable —
  the override record is one of them)
- **Standards**: `standards/tech-stack.md` § "Authentication" — *"the
  checks live behind one interface and are exhausted exhaustively by tests
  rather than re-implemented at each call site"*
