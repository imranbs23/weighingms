---
bolt: 005-005-orgatex-integration
created: 2026-11-02T18:55:00Z
status: accepted
superseded_by: null
---

# ADR-020: The OrgaTEX reads require an operator session

## Context

ADR-013 decided that the **scale unit's read endpoints are open** — no
session required. Its reasoning was specific and is worth quoting, because
this ADR departs from it:

> "a scale's current weight and calibration state are physically visible to
> anyone at the station, and the UI needs the status strip before anyone
> signs in."

Two premises. The **read is physically visible**, and the **UI needs it
before sign-in**. The scale's weight is on a display in front of the
operator; a scale's calibration expiry is a sticker on the indicator. There
is nothing to protect, and there is a concrete need to serve it early.

The OrgaTEX batch queue has neither premise.

- It is **not physically visible**. It is OrgaTEX's record of what
  production released for this station — the schedule the station works
  from.
- The UI does **not** need it before sign-in. The batch queue is screen 1 of
  a three-screen workflow whose first act is an operator signing in. The
  scale status strip, by contrast, is a persistent footer across all three
  screens, and it is genuinely useful while someone is walking up to the
  terminal.

The unit brief adds a second consideration. The queue "is owned here and
only here, because only this unit knows whether what it returns is current"
— so this unit is the only place that can say whether the operator is looking
at a live schedule or a stale one. An open endpoint would expose that
distinction to anyone who could reach the API.

There is a third factor, and it is a precedent rather than a principle: the
identity unit's endpoints all require a session, and ADR-013 itself
recorded that the scale reads were "the shape other units' protected
endpoints will use". This ADR is that shape arriving.

## Decision

**Both OrgaTEX read endpoints require an operator session. Neither requires
a supervisor.**

```text
GET /api/orgatex/batches                       → 401 without a session
GET /api/orgatex/batches/:batchId/recipe       → 401 without a session
```

An **operator** session, not a **supervisor authorisation**. Reading the
queue and the recipe authorises nothing: it grants no capability that a
signed-out person could not exercise by asking a colleague who is signed
in. BRD NFR-12 requires supervisor authorisation for *privileged actions*,
and reading a work queue is not one.

**The precedent it sets:** a read is open only when the thing being read is
**physically present at the station**. That is a test a future agent can
apply to any new endpoint, and it is the question ADR-013 actually asked.

**What this does NOT change.** The scale unit's read endpoints stay open
(ADR-013 stands). The Dummy OrgaTEX's own router stays open — the Dummy MES
*is* the external system, and the product's adapter reaches it without a
WeighingMS session either.

## Rationale

The alternative — leaving the MES reads open for symmetry with the scale
reads — was rejected because symmetry is not a reason. The two units'
endpoints look similar and have different properties, and the reason
ADR-013 gave for the scale's openness (physical visibility) is **false** for
the MES.

The other alternative — requiring a **supervisor** — was rejected because it
turns every queue read into an escalation. The operator needs the queue to
do their job; a supervisor standing by to authorise a read would make the
station unusable in the ordinary case, and would train operators to avoid
the queue rather than to use it.

A third alternative — leaving it open but **redacting** the fields that
matter — was rejected as strictly worse. It creates a second, lesser shape
of the same endpoint, and a reader has to know which endpoint they are
talking to. One endpoint, one rule.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **Open, like the scale reads** (ADR-013) | Consistent with an existing recorded decision; the UI could show the queue before sign-in | Exposes OrgaTEX's production schedule to anyone who can reach the API; ADR-013's premise (physical visibility) does not hold here | The precedent's reasoning does not transfer. Similar shape, different properties |
| **Supervisor authorisation** | Maximum control over who reads the schedule | Every queue read needs an escalation; makes the station unusable in the ordinary case | Reading authorises nothing (BRD NFR-12). Over-restriction is its own failure |
| **Open, with sensitive fields redacted** | No session needed for the harmless fields | Two shapes of one endpoint; a caller must know which they are talking to; "harmless" is a judgement that changes | Strictly worse than a single rule |
| **Session required, no supervisor** (adopted) | The schedule is read only by signed-in operators; no escalation in the ordinary case | The UI must sign in before showing the queue | **Adopted.** The cost is a change to the prototype's flow, stated in the consequences |

## Consequences

### Positive

- The production schedule is read only by signed-in operators.
- The rule is **testable**: "is this thing physically present at the
  station?" is a question a reviewer can ask of any new endpoint.
- The endpoint set stays uniform: the identity unit's endpoints, the MES's
  endpoints, and the scale's write endpoints all require a session.
- The `freshness` field — the thing that says whether the operator is
  looking at a live schedule — is only ever seen by a signed-in operator.

### Negative

- **The UI must sign in before it can show the batch queue.** This is a
  change to the prototype's flow, which shows the queue as the entry screen.
  The prototype's operator chip (`R. Karim · Shift A`) is a display of who
  is at the station, not proof of a session — so the prototype's flow was
  never secure, and this ADR makes it so.
- The boot sequence is longer: sign in, then the queue.
- A reader who wanted an open queue now has to reason about the difference
  between the MES's records and a device's readout.

### Risks

- **A future agent adds a new MES endpoint and leaves it open.** *Mitigation*:
  the decision index's "Read when" field points at exactly this question, and
  the rule is stated in the ADR's own words rather than as "use a session".
- **A future agent opens a scale-like endpoint elsewhere and applies ADR-013
  too broadly.** *Mitigation*: the same entry points at the scale reads, and
  states that ADR-013 stands for them.
- **The prototype's flow is treated as the specification.** *Mitigation*:
  this ADR states the departure explicitly and names it as a cost.

## Related

- **Stories**: 001-read-released-batch-queue, 002-read-batch-recipe
- **Requirements**: FR-1, FR-3, BRD NFR-12, BRD IR-07, BRD C-13
- **Previous ADRs**: ADR-013 (the scale telemetry endpoints are not behind
  an operator session) — this ADR **narrows** it to physically present
  devices; ADR-004 (uniform refusal responses) is not affected
- **Standards**: the tech stack's "API shape" section lists the Dummy
  OrgaTEX's endpoints; this ADR governs the **product's** endpoints over
  that seam, not the Dummy's
