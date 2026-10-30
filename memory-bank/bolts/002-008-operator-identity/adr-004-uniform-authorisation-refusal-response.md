---
bolt: 002-008-operator-identity
created: 2026-10-30T17:50:00Z
status: accepted
superseded_by: null
---

# ADR-004: One uniform response for every authorisation refusal

## Context

The authorisation endpoint has a large number of ways to say no:

1. the signed-in identity has the role `OPERATOR`, not `SUPERVISOR`;
2. the supervisor's credential is wrong;
3. the supervisor id does not exist;
4. the supervisor is deactivated;
5. no reason was supplied;
6. the reason is whitespace-only or punctuation-only;
7. the supervisor is the same person as the requesting operator;
8. the authorisation was issued for a different action;
9. the authorisation was issued for a different subject;
10. the authorisation has expired;
11. the authorisation has already been consumed;
12. there is no signed-in operator at all.

The domain model (Stage 1) says these refusals must be **named** — it
requires a `RefusalReason` value with one value per failure mode, and the
story requires that a refused attempt be audited "with the actor, the
subject and the reason for refusal".

The technical design (Stage 2) says the opposite thing about the HTTP
response: every refusal returns `403 { "error": "AUTHORISATION_REFUSED" }`,
with no reason field and no code.

Those two are not in conflict, but only if the split is deliberate and
understood. The question this ADR answers is: **where does the reason go,
and what does the caller learn?**

There is a strong precedent in the codebase. Bolt `001` established a
constant-response rule for sign-in failures: `401 { "error":
"AUTHENTICATION_FAILED" }`, byte-for-byte identical for "no such
operator" and "wrong secret". ADR-002's reasoning extends the same way to
session tokens — the session table is a table of live credentials, so its
blast radius is limited.

The threat here is not identical to bolt `001`'s, and the difference is
worth being precise about.

**Bolt `001`'s threat is enumeration of operator identities.** An attacker
tries badge IDs against sign-in and learns which exist. The defence is
that "no such operator" and "wrong password" are indistinguishable.

**This bolt's threat is enumeration of supervisor identities.** An attacker
at the terminal — or anyone who can reach the endpoint — tries supervisor
credential pairs against the authorisation endpoint and learns which
supervisors exist. The same defence applies.

But there is a second, subtler threat that bolt `001` did not have, and it
is the one that decides this ADR.

**A precise error is a map of the defences.** The authorisation endpoint
enforces a set of checks: role, distinct person, mandatory reason, scope,
expiry, single use. Each refusal reason names one of those checks. A
response that says `SELF_AUTHORISATION_REJECTED` tells the caller:

- there is a distinct-person check, and it fired;
- the caller *was* recognised as a supervisor (otherwise the role check
  would have fired first);
- the credential was accepted, so the caller **is** the requesting
  operator.

That last inference is the damaging one. A single, carefully chosen
request can turn the refusal into an oracle: if the caller knows their own
operator id and tries to self-authorise, a `SELF_AUTHORISATION` refusal
confirms that the credential was accepted. If it instead says
`AUTHENTICATION_FAILED`, the caller learns nothing.

So a refusal reason is only safe to disclose to a party who is already
entitled to know it. The audit trail is; the caller is not.

**The legitimate operator's experience is a real cost.** The operator
standing at the terminal cannot tell "the supervisor typed the wrong PIN"
from "that authorisation has already been used". They see one opaque
refusal. The supervisor has to ask what they typed.

That cost is real, and it is accepted deliberately. It is bounded: the
supervisor prompt can be retried, and a supervisor who types a wrong PIN
can try again. The unbounded cost of the alternative — an adversary
probing for supervisor identities and for which defence fired — is not
bounded.

## Decision

**Every authorisation refusal returns the same status code and the same
body.**

```json
{ "error": "AUTHORISATION_REFUSED" }
```

with HTTP `403`.

This applies to **all twelve** refusal modes above, without exception.
Notably it includes:

- a **wrong supervisor credential** → `403`, not `401`;
- an **unknown supervisor id** → `403`, not `401`;
- an **expired authorisation** → `403`, not `410`;
- an **already-consumed authorisation** → `403`, not `409`.

The response contains **no** reason field, **no** code field and **no**
message. There is exactly one body.

### Where the refusal reason actually goes

**The reason is not discarded — it is routed to the audit trail.** The
domain's `AuthorisationRefusal` value carries the named `RefusalReason`,
and the `PrivilegeRefused` event publishes it with the actor, the subject
and the time. Unit 006's audit trail records it. That is where the
requirement "the refused attempt is itself audited with the actor, the
subject and the reason for refusal" is satisfied.

**The HTTP response is a constant, and the controller does not branch on
the reason to produce it.** This is deliberate: if the controller had a
`switch` over refusal reasons and returned different bodies, then a future
developer adding a new reason would have to remember to keep it generic —
and the failure mode of forgetting is a silent information leak. A
controller that ignores the reason entirely cannot leak it. There is no
branch to get wrong.

### The one deliberate exception

A **malformed request** — a body that fails schema validation — is
rejected with `400 { "error": "VALIDATION_ERROR", "fields": [...] }`,
**before** any credential lookup happens.

This is the same exception bolt `001` made for sign-in, and the reasoning
is identical: a validation error describes the *shape of the request*,
which the caller already knows, and it is returned before the credential
store is consulted, so it discloses nothing about whether the supervisor
exists. The constant-response rule governs failures **of authorisation**,
not malformed requests.

### `401` remains available, and means one thing only

`401 { "error": "UNAUTHENTICATED" }` is returned when the **requester**
has no live session — i.e. the request never reaches the authorisation
logic at all. It is a different situation from "the privileged action is
not permitted", and it says nothing about the supervisor.

### The audit trail may be queried by a party entitled to see it

This ADR constrains the **HTTP authorisation response**. It does not
prevent the audit trail from exposing a refusal reason to an authorised
reader — for example a supervisor reviewing the day's overrides. That
reader is already entitled to know which control failed. The audit trail
is unit 006's concern, and this ADR does not constrain it.

## Rationale

**Why one status code for a wrong credential.** Because a `401` for "your
supervisor credential was rejected" and a `403` for "that authorisation is
spent" is a **distinguishable pair**, and distinguishing them is exactly
what an attacker needs to probe for supervisor identities. Two codes for
two situations is a two-bit oracle.

**Why the reason is not returned even though the story asks for it to be
recorded.** The story asks for the refusal to be **audited** with the
reason. It does not ask for the reason to be **disclosed** to the
requester. Those are different requirements, and this ADR is the place
where the distinction is drawn. The audit trail gets the reason; the
caller gets a refusal.

**Why not return a generic message but keep distinct status codes.**
Status codes are machine-readable and are exactly what a client would
branch on. A generic *body* with varying *codes* leaks through the code.
There is no defence in "the body is generic" if the status differs.

**Why the constant response is not a usability disaster.** The supervisor
prompt is a human interaction with a human present. A supervisor who typed
a wrong PIN can see that the prompt rejected the attempt and try again; a
supervisor who does not realise they typed it wrong can ask the operator.
The cost is a conversation. The alternative is an oracle.

**Why the domain still models the reason at all.** Because the audit trail
needs it, and because the domain's job is to record what happened, not
only what the caller is allowed to know. A domain that could not represent
the reason would force the audit trail to re-derive it — and re-derivation
at the consumer is exactly what the unit brief forbids ("validation is a
pure check against it — never a re-derivation of the rules at the
consumer").

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **Distinct status codes per refusal class** (`401` bad credential, `403` bad scope, `410` expired, `409` used) | Most helpful to a legitimate operator | A multi-valued oracle over supervisor identities and over which defence fired | The help is worth less than the leak; and the help is recoverable by conversation |
| **A distinct error code in the body, same status** | Still machine-readable, so still an oracle | Same leak, one field deeper | A generic body with a distinctive code leaks exactly as much |
| **Return the reason only when the caller is the authorised operator** | Reduces the leak; keeps most of the help | The self-authorisation case *is* the operator's own request, and disclosing `SELF_AUTHORISATION` to it confirms the credential was accepted — the precise inference this ADR exists to prevent | The mitigation does not cover the case that matters most |
| **A generic refusal, with the reason in the audit trail only (chosen)** | No oracle; the audit trail still has the reason; the domain still models it precisely | The operator cannot self-diagnose a typo | A bounded, recoverable cost traded against an unbounded leak |
| **Return the reason to the caller but rate-limit aggressively** | Helps legitimate operators | Rate limiting does not prevent a low-and-slow enumeration, and it adds a failure mode to a safety path | Does not close the oracle; adds complexity |
| **No domain-level reason at all — only a boolean** | Simplest domain | The audit trail would have to re-derive which control failed, at a place that has none of the context; and "a refusal was audited" would be recorded without saying what was refused | The story explicitly requires the reason in the audit |

## Consequences

### Positive

- **No supervisor-identity oracle.** The response is identical whether the
  supervisor id exists, the secret is wrong, the role is wrong, the reason
  is missing, the scope is wrong, or the authorisation is spent.
- **The defence set is not mapped by the endpoint.** A caller learns only
  that the action was not permitted. Which check fired is not observable.
- **The audit trail keeps full detail.** The named reason, the actor, the
  subject and the time are all recorded — so the compliance record is
  complete even though the client-facing response is not.
- **No branch to get wrong.** The controller returns a constant; a new
  refusal reason cannot leak because there is nowhere for it to leak to.
- **Consistent with bolt `001`.** The same discipline already governs
  sign-in and session resolution, so the product has one rule rather than
  two.

### Negative

- **The operator cannot tell a typo from a spent authorisation.** A
  supervisor who has already used an authorisation and tries again sees
  the same opaque refusal as one who typed the wrong PIN. This is a
  real usability cost and it is accepted.
- **Debugging a failed authorisation requires the audit trail.** A
  developer cannot diagnose a failure from the HTTP response alone; they
  must look at the `PrivilegeRefused` event. This is a deliberate
  trade — it is the same trade every production system makes — and it
  means the audit trail's `PrivilegeRefused` event must carry the reason
  reliably, or diagnosis becomes impossible.
- **The `403` code is less specific than a developer's instinct wants.**
  A developer reading `403 AUTHORISATION_REFUSED` cannot tell which check
  failed. The constant is the feature.

### Risks

- **Risk: a future developer adds a distinct code for one refusal class,
  "just for this one case".** *Mitigation*: this ADR; the controller has no
  branch to extend; and the Stage 5 test suite asserts that the response
  body is byte-for-byte identical across several distinct refusal causes.
- **Risk: a future developer concludes the refusal is "not specific enough"
  and adds a `?reason=` query parameter or a debug header.** *Mitigation*:
  this ADR; the same response-equality test covers the body, and a query
  parameter would have to be handled somewhere, which is a visible change.
- **Risk: the audit trail's `PrivilegeRefused` event does not carry the
  reason, making refusals undiagnosable.** *Mitigation*: the Stage 5 test
  suite asserts the event carries the reason; and the event's payload is
  specified in the domain model.
- **Risk: a legitimate supervisor support call ("why was my override
  rejected?") cannot be answered from the API.** *Mitigation*: the audit
  trail is the answer, and it is the correct place for it. This is
  recorded in the Operations context rather than solved here.

## Related

- **Stories**: `002-authorise-privileged-action-as-supervisor`
- **Requirements**: FR-21, AC-06 · BRD NFR-12, BRD NFR-13, BRD FR-35,
  BRD FR-36
- **Standards**: `memory-bank/standards/tech-stack.md` — the Authentication
  section describes sign-in but not privileged-action authorisation; this
  ADR and ADR-003 close that gap.
- **Previous ADRs**: ADR-001 and ADR-002 (bolt `001` — the same
  constant-response discipline applied to sign-in and to session tokens,
  and the reason this ADR extends it rather than inventing a new rule)
