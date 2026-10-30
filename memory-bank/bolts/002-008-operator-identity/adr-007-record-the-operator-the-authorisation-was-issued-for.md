---
bolt: 002-008-operator-identity
created: 2026-10-30T20:15:00Z
status: accepted
superseded_by: null
---

# ADR-007: Record the operator an authorisation was issued for

## Context

ADR-003 decided that a consume request must present **both** the
authorisation id **and** the live session token of "the operator the
authorisation was issued **for**". The reasoning was that a leaked
authorisation id must authorise nothing on its own — the session proves
the person applying it is still the person the exception was made for.

The Stage 5 test suite found that this could not actually be implemented
as designed, because `SupervisorAuthorisation` **never recorded who it
was issued for**. The entity carried the supervisor's identity, the
scope, the reason and the window — but not the operator the exception
was for.

The implementation therefore fell back to the only check it could make:
that the applying operator was *distinct from the supervisor*.

**The gap that creates.** An authorisation raised for operator A could be
applied by operator B. B is not the supervisor, so the distinctness check
passed, and B was never the person the exception was granted to. The
authorisation was scoped to one action and one subject, expired, and was
single-use — but it was **not scoped to one operator**, which is the one
scoping the ADR required and the one that made the leak harmless.

The symptom that pointed at the root cause: `NOT_THE_REQUESTING_OPERATOR`
was present in the closed `RefusalReason` set and **unreachable**. No code
path could produce it. A refusal reason that cannot be produced is the
domain telling you that a check it models is missing.

The same gap made two smaller defects possible:

- `GET /api/identity/authorisations/:id` checked only "not the
  supervisor", so any other operator could read a supervisor's
  justification text for an exception raised for somebody else.
- `POST /api/identity/authorisations` took the requesting operator from
  the session or `null`, so an authorisation could be created with no
  operator behind it at all.

## Decision

**Record the operator an authorisation was issued for, and check it
wherever the authorisation is applied or read.**

1. `SupervisorAuthorisation.requestedOperatorId` — an `OperatorId`, or
   `null` when the attempt was made with no signed-in operator. The
   `null` case is kept rather than rejected at creation: the story
   requires the attempt to be *audited as a refusal*, and an
   authorisation raised with nobody behind it can never be applied, so
   storing it records what happened without granting anything.

2. `isIssuedFor(operatorId)` on the entity, beside the existing
   `isDistinctFrom(operatorId)`. They are **different facts** and both
   are required:

   - *distinct from the supervisor* — A-1, the self-authorisation rule.
   - *issued for this operator* — ADR-003, the binding rule.

   Checking only the first is the defect. Checking only the second would
   be wrong too: the supervisor must never apply their own exception,
   even when they are the only supervisor on shift.

3. The check is applied on **both** the consume path and the read path,
   because the read path has the same disclosure: a supervisor's
   justification text is their written account of why an exception was
   granted, and a different operator has no business reading it.

4. `requested_operator_id` is stored in `supervisor_authorisations` with
   a foreign key to `operators(id)`, so the record is referentially
   sound and the exception's beneficiary is as durable as the exception
   itself.

5. `POST /api/identity/authorisations` requires a live session and
   returns `401 UNAUTHENTICATED` without one. The supervisor
   authenticates *in the request* — that is the fresh authentication
   A-2 requires — but the supervisor's credential is not what authorises
   the action. The **operator's** session is.

## Alternatives Considered
## Rationale

**Why record the operator at all.** Because the authorisation's whole
purpose is to be an *exception granted to one person*. An authorisation
that any operator at the terminal may apply is not an exception granted to
a person; it is a capability, and it would need to be protected as one —
scoped, expiring, single-use and revocable, which it already is, but the
person it was granted to is the part that makes it an approval rather
than a token. The story's wording is explicit: the authorisation is for
"the operator the privileged action is **for**". Recording that operator
is what makes the word "for" mean something the database can check.

**Why the operator check and the supervisor check are both needed.** They
are different facts and neither subsumes the other.

- *Distinct from the supervisor* (A-1) asks: is the authoriser someone
  other than the person doing the work? A supervisor who applies their own
  exception has approved themselves.
- *Issued for this operator* (ADR-003) asks: is the person applying it the
  person it was granted to? An authorisation granted to A does not belong
  to B.

Checking only the first is the defect this ADR closes. Checking only the
second would be a different defect: the supervisor is never the operator
the exception is for, so that check would pass for a supervisor applying
their own approval.

**Why the check belongs on the read path too.** The read path returns the
authorisation's reason — the supervisor's written account of why an
exception was granted. That text is part of the exception and is not
addressed to other operators. The design already said the endpoint "does
not return the reason to an unauthorised caller"; the implementation was
simply checking the wrong half of "unauthorised".

**Why `null` is stored rather than the authorisation being rejected.** The
story's edge case says an attempt with no signed-in operator is "Refused
and audited as a refusal". Auditing it requires the attempt to exist. An
authorisation with a null operator is a record that an exception was
raised and could not be applied — and because `isIssuedFor` matches nobody
when the operator is null, it can never be spent.

**Why the operator id is stored in clear.** The operator id is not a
secret. It is printed on the weighing record, carried on the ticket and
written into the audit trail. Hashing it would protect nothing and would
make the audit trail's job harder — the same reasoning as ADR-005's
clear-text reason.

## Alternatives Considered

**Design A — keep only the supervisor-distinctness check.** Rejected.
This is the defect. It makes the authorisation's blast radius the whole
terminal rather than one operator.

**Design B — bind the authorisation to the operator's session id at
creation and check that session at consume.** Rejected. The session may
have expired or been replaced between creation and consume, making a
legitimate authorisation unusable. And the session *id* is not what the
client holds — the token is. Checking the token proves the operator is
present, which is strictly better. This was already considered and
rejected in ADR-003; recording it here because the same trade-off
reappears once the operator binding is made explicit.

**Design C — put the operator id inside the authorisation id, so the id
encodes who it is for.** Rejected. It requires the authorisation id to
be decodable, which violates the opaque-token discipline ADR-002
established for session tokens. A decodable id is an id that can be
inspected, and an inspection surface on an exception identifier is one
more thing to protect.

**Design D — store only a digest of the operator id.** Rejected. The
operator id is not a secret — it is printed on the weighing record and
carried on the ticket. Hashing it would buy nothing and would make the
audit trail's job harder.

## Consequences

### Positive

- **The authorisation is now scoped to one operator as well as one
  action and one subject.** A leaked id authorises nothing, which is
  what ADR-003 said it would do.
- **`NOT_THE_REQUESTING_OPERATOR` is reachable**, and every reason in the
  closed set is now producible. A test asserts that.
- **The justification text is no longer readable by other operators.**
- **The exception's beneficiary is durable** — the audit trail can say
  not just who authorised the exception but who it was granted to.
- **A supervisor cannot apply their own exception**, and neither can
  anybody else.

### Negative

- **The schema changed**, so an existing database would need a migration.
  In practice this bolt has never been released — `scripts/probe-dev-db.cjs`
  confirms no database has applied migration `005` — so `005` was edited
  in place rather than replaced with a new migration. The probe is kept
  in the repository so the next bolt checks rather than assumes.
- **The controller needs the operator's session** to read an
  authorisation, which the design already required and the
  implementation had not enforced.

### Neutral

- The distinctness check remains, and remains separate. Both facts are
  recorded, both are checked, and neither subsumes the other.

## Related

- **Stories**: `002-authorise-privileged-action-as-supervisor` (this bolt) ·
  `007-escalate-non-compensable-overdose` (unit 003 — the consumer of this
  authorisation)
- **Requirements**: FR-13, FR-21, AC-06 · BRD FR-35, BRD FR-36, BRD NFR-13
- **ADRs**: **ADR-003** (an authorisation id is not a bearer credential —
  this ADR makes that decision enforceable, because it requires the
  consume request to prove *whose* exception it is) · **ADR-004** (the
  uniform refusal response — the new refusal reason follows the same
  discipline: named internally, constant externally) · **ADR-005** (the
  reason is stored in clear text — the same treatment the operator id
  receives) · **ADR-002** (opaque tokens — why the operator id is stored
  as a column rather than encoded in the authorisation id)
- **Standards**: `memory-bank/standards/tech-stack.md` — the Authentication
  and Privileged-action authorisation sections
- **Test report**: `memory-bank/bolts/002-008-operator-identity/ddd-03-test-report.md`
  — the three defects this ADR was written to close
