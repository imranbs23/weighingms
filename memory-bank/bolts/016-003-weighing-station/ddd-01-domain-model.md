---
stage: model
bolt: 016-003-weighing-station
created: 2026-11-06T08:30:00Z
---

## Static Model: 003-weighing-station (bolt 016)

### Entities

- **Escalation**: an over-dose awaiting a supervisor's decision — the
  session's `ESCALATED` state, plus the facts the authorisation is scoped
  to.

  It is **not** a record of a completed act. It is a **state the work is
  in**, and it is carried by the session.

- **OverrideRecord**: the recorded authorisation of a non-compensable
  over-dose — `authorisationId`, `supervisorId`, `reason`, `componentId`,
  `sessionId`, `surplusAmount`, `surplusUnit`, `authorisedAt`.

  It is a **fact about the past** and therefore immutable (BRD DR-02).

### Value Objects

| Value object | Shape | Rules |
|---|---|---|
| **EscalationState** | `ESCALATED` \| `AUTHORISED` \| `REFUSED` \| `EXPIRED` | The states of an escalation. A **closed set of four**, and each names a **different next step** for the operator. |
| **AuthorisationScope** | `sessionId` + `componentId` | The subject the authorisation is bound to. **This unit's** scope — unit `008`'s `AuthorisationSubject` is opaque, and this is the composition. |
| **SurplusAmount** | a `WeightValue` | The surplus the escalation covers. Fixed-point, never a float. |

### The authorisation is CONSUMED, never created here

**This is the whole of the bolt, and it is why the bolt is small.**

Unit `008` already owns the entire privileged-action surface, and it settled
it in five ADRs:

| ADR | What it established |
|---|---|
| **ADR-002** | The session token is a **digest**, never a bearer credential in plaintext |
| **ADR-003** | The authorisation id is **not** a bearer credential — it must be presented with the requesting operator's live session |
| **ADR-004** | **Every** refusal returns one uniform `403 { "error": "AUTHORISATION_REFUSED" }` |
| **ADR-005** | The reason is stored in **clear text** — it must be readable by an auditor five years later |
| **ADR-006** | Consumption is a **separate append-only record** whose `UNIQUE` constraint is the real single-use guarantee |

**And the identity unit already named this exact action.** `PrivilegedAction`
carries `CONFIRM_COMPONENT`, with the comment: *"Unit 003's story 007 names a
fourth — `confirmComponent`, the confirmation of a component under a
non-compensable over-dose override."*

**So bolt 016 does not implement an authorisation mechanism. It implements
the CONSUMPTION of one** — and it must not re-implement any of the checks.

The three operations unit `008` exposes are:

- `authorise(request)` — the supervisor authenticates **freshly**, at the
  point of the action, and an authorisation is created;
- `evaluate(id, act, subj)` — a **pure check** against an existing one;
- `consume(id, act, subj, operator)` — the same check, and on success the
  authorisation is **spent**.

### Why this bolt has no authorisation logic of its own

**Because a second implementation of the checks is the failure ADR-004
describes.** Unit `008`'s ADR says the checks live behind **one** interface
*"so they can be exhausted exhaustively by tests rather than re-implemented
at each call site."*

Bolt 016 is a call site. If it re-implemented *"is the operator distinct?"*
or *"has it expired?"* or *"has it been spent?"* — even correctly — then there
would be two answers to each question, and unit `008`'s exhaustive test suite
would be proving the rules of a code path this bolt uses.

**So the rule is: this bolt calls `consume` and does not re-check
anything.** The single-use guarantee comes from unit `008`'s `UNIQUE`
constraint, not from a check here.

### The scope — one action, one subject

The authorisation is bound to:
- the **action** — `CONFIRM_COMPONENT` (unit `008`'s closed set);
- the **subject** — this component in this session.

**The subject is composed here** and it is **not** free-form: it is the
session id and the component id, joined in one opaque string, because unit
`008`'s `AuthorisationSubject` is deliberately opaque to the weighing domain
(its own comment: *"letting unit 003's vocabulary leak in here would couple
two units that are meant to stay separate"*).

So the composition is **this unit's** business, and it is built from the
**session's own ids** — never from a client-supplied string. A client
cannot present an authorisation for a different component, because the
subject is derived from what the session is working on.

### The escalation's four states

| State | Meaning | What the operator sees |
|---|---|---|
| `ESCALATED` | The request is awaiting a supervisor | The weighing is **not** confirmed |
| `AUTHORISED` | A supervisor authorised it | The weighing may now be confirmed |
| `REFUSED` | A supervisor declined, or the authorisation was refused | The weighing is **not** confirmed; the batch is held |
| `EXPIRED` | The authorisation's window passed | The weighing is **not** confirmed; a fresh authorisation is needed |

**And the expiry is NOT a refusal.** It is its own state, because the next
step differs: a refused escalation is finished, and an expired one asks
for a **fresh** authorisation. Collapsing them would tell the operator
that the supervisor declined when in fact nobody answered in time.

### Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **Escalation** | the state, the scope, the surplus, the authorisation id? | 1. The scope is **derived** from the session — never supplied. 2. The surplus is the one the over-dose detected — never supplied. 3. It moves `ESCALATED → AUTHORISED` only through a **consumed** authorisation. 4. It moves `ESCALATED → REFUSED` only on a refusal or a decline. 5. It moves `ESCALATED → EXPIRED` when the authorisation's window passes. 6. **The weighing is not confirmed in any state but `AUTHORISED`.** |
| **OverrideRecord** | the record | 1. **Immutable** once written (BRD DR-02, C-12). 2. It names the supervisor, the reason, the time, the component, the session and the surplus it covers. 3. The reason is in **clear text** (ADR-005). |

### Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **OverdoseEscalated** | The surplus could not be absorbed | `componentId`, `sessionId`, `surplusAmount`, `surplusUnit` |
| **OverrideAuthorised** | An authorisation was consumed | `componentId`, `authorisationId`, `supervisorId`, `reason`, `surplusAmount` |
| **OverrideRefused** | The authorisation was refused | `componentId`, `requestingOperatorId` — **without** the reason, which is unit `008`'s to keep (ADR-004) |
| **OverrideExpired** | The authorisation's window passed | `componentId`, `authorisationId` |

### Domain Services

- **EscalationService**: raises the escalation, and moves it through its
  states. It **calls** unit `008`'s `AuthorisationService` and does not
  re-check anything.

- **OverrideRecorder**: writes the `OverrideRecord` — the audit trail's
  entry for the exception (BRD FR-24, FR-36).

### Repository Interfaces

| Repository | Entity | Methods | Persisted? |
|---|---|---|---|
| **OverrideRecordRepository** | `OverrideRecord` | `save(record)`, `latestFor(componentId)` | **Yes** — append-only |

### Ubiquitous Language

- **Escalation** — an over-dose waiting for a supervisor.
- **Override** — a supervisor's authorisation of an out-of-tolerance
  weighing.
- **Authorisation** — unit `008`'s record of the supervisor's fresh
  authentication, the reason, the scope and the window.
- **Scope** — the action and the subject the authorisation is bound to.
- **Consumed** — the authorisation spent against one action.
- **Declined** — a supervisor who refused, as opposed to one who never
  answered.

---

## Constraints carried into the Technical Design

1. **This bolt does NOT implement an authorisation mechanism.** It calls
   unit `008`'s `AuthorisationService.consume` and re-checks **nothing**
   (ADR-004's "one interface" rule).
2. **The action is `CONFIRM_COMPONENT`** — unit `008`'s closed set, already
   named for this story.
3. **The subject is DERIVED** from the session's own ids — never supplied by
   a client.
4. **The refusal is UNIT 008's**, and its HTTP body is the uniform
   `403 { "error": "AUTHORISATION_REFUSED" }` — never a distinguishable
   reason (ADR-004).
5. **The operator's own credentials cannot authorise the escalation.** The
   distinctness check is unit `008`'s, and it compares **identities**, never
   roles.
6. **A reason is MANDATORY**, and it is stored in **clear text** (ADR-005).
7. **The authorisation is single-use**, and the guarantee is unit `008`'s
   `UNIQUE` constraint — not a check here.
8. **The weighing is not confirmed unless the escalation is `AUTHORISED`.**
   There is no other path to a `WeighingRecord` (invariant 3).
9. **The record written under an override carries the OVER-DOSE zone** as
   its `zoneAtConfirm` — **not** `OK` — so the exception is visible in the
   record and in reporting (BRD FR-11, FR-23).
10. **The override record and the weighing record are both retained ≥ 5
    years** (BRD DR-01), and both are **immutable**.

---

## The edge cases, answered

| Scenario | Where it is answered |
|----------|----------------------|
| The operator is also a supervisor | The operator's own request **cannot** be self-authorised — unit `008`'s distinctness check, which compares identities and not roles |
| A supervisor authenticates but gives no reason | The authorisation is **refused** — unit `008`'s `AuthorisationReason` makes an empty or punctuation-only reason a refusal |
| The authorisation has expired | The escalation moves to `EXPIRED`, **not** `REFUSED` — and a fresh authorisation is needed |
| The authorisation was issued for a different component or session | **Refused** — the scope check, and the subject is derived from the session so a client cannot present another one |
| The same authorisation is presented twice | **Refused** on the second use — unit `008`'s `UNIQUE` constraint |
| The supervisor is on the session but is not the requesting operator | **Accepted**, provided authentication, a reason and the scope all hold |
| No supervisor authorises | The weighing is **not** confirmed and the batch is held — the escalation stays `ESCALATED` |
| The scale disconnects while awaiting authorisation | The authorisation stays valid for its scope and window; the **confirmation** still requires the scale to be connected |

---

## Open points carried forward

- **The audit trail** — unit `006` owns it (BRD FR-36, NFR-13). This bolt
  **publishes** the events; unit `006` records them. The events are
  published, not stored, here.
- **The supervisor's own view of the escalation.** The station is a
  single-terminal product (A-11), so the escalation is awaited **at the
  station** — a supervisor who is not the operator authorises at the same
  terminal. Unit `007` renders it.
