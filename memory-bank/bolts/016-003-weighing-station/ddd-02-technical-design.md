---
stage: design
bolt: 016-003-weighing-station
created: 2026-11-06T08:50:00Z
---

## Technical Design: 003-weighing-station (bolt 016)

### Architecture Pattern

**Hexagonal (ports and adapters), with the seam owned by the consumer** — the
same shape as the previous bolts.

**But this bolt's defining property is that it adds a port over ANOTHER
UNIT'S SERVICE, not over an external system.**

| Port | What it is | Bound to |
|---|---|---|
| `OverrideAuthorisationPort` | The privileged-action authorisation | Unit `008`'s `AuthorisationService` |
| **Unit `008`'s own service** | The authorisation mechanism | **Not this bolt's** |

### Layer Structure

```text
┌──────────────────────────────────────────────────────────────────┐
│ Presentation                                                     │
│   EscalationController     POST /api/escalation                  │
│                          GET  /api/escalation                  │
│   (Zod schemas on the boundary)                                   │
├──────────────────────────────────────────────────────────────────┤
│ Application                                                      │
│   EscalateOverdose        raise the escalation                    │
│   AuthoriseEscalation     consume the authorisation, record it   │
├──────────────────────────────────────────────────────────────────┤
│ Domain                                                           │
│   Escalation              the aggregate — the awaiting state    │
│   EscalationState         ESCALATED | AUTHORISED | REFUSED | EXPIRED │
│   AuthorisationScope      the derived session+component scope    │
│   OverrideRecord          the immutable audit entry               │
│   OverrideAuthorisationPort  THE PORT (unit 008's service)      │
│   OverrideRecordRepository   THE PORT                            │
├──────────────────────────────────────────────────────────────────┤
│ Infrastructure                                                   │
│   CompositionRoot              binds every port in ONE place       │
│   OverrideDatabase             the table and migration            │
│   SqliteOverrideRecordRepository   append-only                  │
└──────────────────────────────────────────────────────────────────┘
```

### API Design

#### `GET /api/escalation/:componentId` — the escalation's state

`200` with the escalation, or `200` with `escalation: null` when there is
none.

#### `POST /api/escalation` — raise the escalation

| Status | Meaning | Body |
|---|---|---|
| **201** | The escalation was raised | `{ escalation: {...} }` |
| **400** | The body is not a request | `{ error: "VALIDATION_ERROR" }` |
| **401** | No operator session | `{ error: "UNAUTHENTICATED" }` |
| **404** | The recipe holds no such component | `{ error: "COMPONENT_NOT_FOUND" }` |
| **409** | The zone is not `OVER`, or the surplus is compensable | `{ error: "NOT_ESCALATABLE", reason }` |

**The body carries `{ componentId }`.** There is **no `surplus` field** — the
surplus is the over-dose's, detected by the domain, and a client that could
assert it could escalate a quantity that was never over-dosed.

#### `POST /api/escalation/authorise` — the supervisor authorises

| Status | Meaning | Body |
|---|---|---|
| **200** | The authorisation was consumed and the escalation is `AUTHORISED` | `{ escalation: {...} }` |
| **400** | The body is not an authorisation | `{ error: "VALIDATION_ERROR" }` |
| **401** | No operator session | `{ error: "UNAUTHENTICATED" }` |
| **404** | There is no escalation for this component | `{ error: "ESCALATION_NOT_FOUND" }` |
| **403** | The authorisation was **refused** | `{ error: "AUTHORISATION_REFUSED" }` |

**The body carries the supervisor's id, their secret and the reason** — and
those three are the authorisation's own inputs, exactly as unit `008`'s
`AuthorisationRequest` defines them.

**AND THE `403` IS UNIFORM.** Every refusal — a wrong credential, a
non-supervisor, a self-authorisation, a missing reason, an expired window, a
spent authorisation — returns **the same body**. That is ADR-004, and this
bolt **does not add a field to it** (a precise reason would be a map of the
defences).

**The refusal's reason goes to the audit trail**, not to the client — and
unit `008` already publishes `PrivilegeRefused` with it. So the reason is
**not lost**; it is simply not on the wire.

#### Authentication

**An operator session is required** (ADR-020) — the escalation is raised
**by the operator**, and the supervisor's fresh authentication happens
**at the point of the action**, not in the session.

### Data Model

#### `override_records` — append-only

| Column | Type | Notes |
|---|---|---|
| `record_id` | `TEXT NOT NULL PRIMARY KEY` | A **uuid** |
| `authorisation_id` | `TEXT NOT NULL` | Unit `008`'s authorisation — the provenance |
| `supervisor_id` | `TEXT NOT NULL` | Who authorised it |
| `operator_id` | `TEXT NOT NULL` | The operator it was authorised **for** |
| `reason` | `TEXT NOT NULL` | In **clear text** (ADR-005) |
| `component_id` | `TEXT NOT NULL` | The component it covers |
| `session_id` | `TEXT NOT NULL` | The session it covers |
| `surplus_amount` | `TEXT NOT NULL` | The surplus it covers — a decimal string |
| `surplus_unit` | `TEXT NOT NULL` | Its unit |
| `authorised_at` | `TEXT NOT NULL` | When |
| `recorded_at` | `TEXT NOT NULL` | When the row was written |

**The reason is in CLEAR TEXT** — ADR-005's reasoning: *"it must be readable
by an auditor five years later — it is a record, not a credential."*

**Every quantity is TEXT** — BRD NFR-16.

**`BEFORE UPDATE` and `BEFORE DELETE` triggers that abort.** The record
describes something that physically happened, and BRD DR-02 forbids
revising it.

### The port over unit 008's service

```ts
export interface OverrideAuthorisationPort {
  /** The fresh authentication and the authorisation it creates. */
  authorise(request: AuthorisationRequest): Promise<AuthorisationOutcome>;
  /** The consumption — the same check, and the authorisation is SPENT. */
  consume(
    authorisationId: string,
    action: PrivilegedAction,
    subject: AuthorisationSubject,
    requestingOperatorId: OperatorId | null,
  ): Promise<AuthorisationOutcome>;
}
```

**And unit `008`'s `AuthorisationService` satisfies it structurally** — its
`authorise` and `consume` have exactly these signatures. So the composition
root binds the service **directly**, with no adapter class and no second
implementation of any check.

### The subject — DERIVED, never supplied

Unit `008`'s `AuthorisationSubject` is opaque to the weighing domain, and
its own comment says the composition is the caller's business. So this bolt
composes it:

```text
`${sessionId}/${componentId}`
```

**From the session's own ids** — so a client cannot present an
authorisation issued for a different component or a different session. The
scope check is therefore structural rather than a check this bolt might
forget.

### The order of operations at authorisation

1. **The escalation must exist and be `ESCALATED`.** A second
   authorisation attempt is refused — the escalation is decided once.
2. **The operator's session must be present** — unit `008`'s `consume`
   refuses without one.
3. **The authorisation is consumed** — unit `008`'s `consume` runs the whole
   check set and **spends** it. **This bolt re-checks nothing.**
4. **The `OverrideRecord` is written** — with the supervisor, the reason,
   the time, the scope and the surplus it covers.
5. **The escalation becomes `AUTHORISED`.**

**And a refusal moves the escalation to `REFUSED`** — with the reason
**absent** from the wire, and the operator left with a batch that is held.

### Security Design

| Concern | Approach |
|---|---|
| **Session** | Required (ADR-020). The escalation is raised by the signed-in operator. |
| **A client-supplied surplus** | There is **no** `surplus` field. The over-dose's surplus is detected by the domain. |
| **A client-supplied scope** | There is **no** `componentId`-in-the-subject field — the subject is **derived** from the session. The body carries the `componentId` to escalate, and that is checked against the session's active component. |
| **A client-supplied reason** | The reason IS the supervisor's, and unit `008`'s `AuthorisationReason` refuses an empty or punctuation-only one. |
| **A distinguishable refusal** | Every refusal is the **same** `403 { "error": "AUTHORISATION_REFUSED" }` (ADR-004). No field is added here. |
| **A second authorisation** | The escalation is decided **once**; a second attempt is refused. |
| **Self-authorisation** | Unit `008`'s check, on **identity** — never on role. |
| **Immutability** | Append-only, with the triggers. |
| **The weighing without an authorisation** | The confirmation gate accepts an `OVER` zone **only** when the escalation is `AUTHORISED` and its authorisation is **consumed** in the same call. |

### NFR Implementation

| Requirement | Design approach |
|---|---|
| **BRD NFR-12 / NFR-13** | The authorisation is unit `008`'s — scoped, expiring, single-use, audited. This bolt adds no second mechanism. |
| **BRD AC-06** | Three things are mandatory: a supervisor, a reason and an audit entry. The supervisor and the reason are unit `008`'s; the audit entry is this bolt's `OverrideRecord`. |
| **BRD FR-23** | The weighing written under an override records the **over-dose zone** as its `zoneAtConfirm` — the exception is visible in the record. |
| **BRD DR-01 / DR-02** | Append-only, retained ≥ 5 years, and the triggers enforce it. |
| **BRD NFR-16** | Every quantity is a decimal string. |

### Integration Plan

**Bound in the composition root, and nowhere else:**

```text
src/api/server.ts
  └── buildWeighingStationModule({
        ...
        authorisations: identity.authorisationService,   // unit 008's
        overrides: new SqliteOverrideRecordRepository(...),
      })
```

**What this bolt adds to unit `008`: nothing.** Its `AuthorisationService`
already names `CONFIRM_COMPONENT` for this story, and its ADRs already
settle every rule.

**What this bolt adds to the API surface:** two paths under
`/api/escalation`.

### Testing Plan

| Suite | What it proves |
|---|---|
| **Unit — the scope** | The subject is **derived** from the session's ids; two components give two subjects; an empty subject is refused. |
| **Unit — the escalation** | It starts `ESCALATED`; it moves to `AUTHORISED` only through a consumed authorisation; it moves to `REFUSED` on a refusal; it moves to `EXPIRED` when the window passes; it cannot be decided twice. |
| **Integration — the endpoints** | The `403` is **uniform** across every refusal; the `201` carries the escalation; the scope is derived; the `OverrideRecord` is written with the reason in clear text. |
| **Persistence** | The record round-trips; the triggers abort an update and a delete. |
| **Security** | No session → `401`; a client-supplied surplus is dropped; the refusal body carries **no** reason; the weighing cannot be confirmed without a consumed authorisation. |

### Open points carried forward

1. **The audit trail** — unit `006` records the published events (BRD
   FR-36). This bolt publishes; it does not store the trail.
2. **The batch being held** when the escalation is refused — that is unit
   `003`'s progression (bolt `017`).
3. **The supervisor's view** — unit `007` renders the awaiting state.
