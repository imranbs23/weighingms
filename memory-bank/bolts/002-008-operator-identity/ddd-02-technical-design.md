---
unit: 008-operator-identity
bolt: 002-008-operator-identity
stage: design
status: complete
updated: 2026-10-30T17:10:00Z
---

# Technical Design - Supervisor Authorisation

## Architecture Pattern

**Hexagonal (Ports and Adapters)**, continuing bolt `001`'s structure exactly.
The authorisation domain is **pure TypeScript with zero runtime
dependencies** — no framework imports, no database imports, no `crypto`
imports in the entity files.

**Why the same pattern and not a new one.** Bolt `001` already established
the layering and the direction rule. Introducing a second pattern for the
second half of the same bounded context would mean the authorisation path
and the identity path have different shapes, and the one place where a
defect is a compliance breach would be the part that does *not* look like
the part that was already reviewed. The value of the hexagonal choice here
is the same as it was in `001`: the authorisation must be reachable through
a port, so that unit 003 consumes a contract rather than an
implementation.

```text
Presentation  ──►  Application  ──►  Domain
                                  ◄──  Infrastructure
```

Nothing in `domain/` imports from `infrastructure/` or `presentation/`.

### The one addition to the layering

Bolt `001` had a single domain service that owned the security-sensitive
path: `AuthenticationService`. This bolt adds a second —
`AuthorisationService` — and it **does not sit beside**
`AuthenticationService`; it **calls** it.

```text
AuthorisationService
  ├─ depends on ──►  IdentityProvider.verifyCredential   (the fresh authentication)
  ├─ depends on ──►  AuthorisationPolicy                 (pure rules)
  ├─ depends on ──►  AuthorisationRepository              (the record)
  └─ depends on ──►  ConsumptionRepository                (the single-use fact)
```

The fresh authentication is **not reimplemented**. It is the *same*
`IdentityProvider.verifyCredential` that `AuthenticationService.signIn`
uses, with the *same* constant-work guarantee and the *same* Argon2id
profile (ADR-001). A second credential-verification path would be a second
place for the timing defence to be wrong, and this context has no tolerance
for that.

---

## Layer Structure

Everything marked **NEW** is added by this bolt. Everything else already
exists from bolt `001` and is listed to show exactly what is reused.

```text
src/008-operator-identity/
├── domain/                          ← pure TypeScript, ZERO runtime deps
│   ├── entities/
│   │   ├── operator.ts                        (existing)
│   │   ├── credential.ts                      (existing)
│   │   ├── identity-session.ts                (existing)
│   │   └── supervisor-authorisation.ts        ← NEW
│   ├── value-objects/
│   │   ├── operator-id.ts                     (existing)
│   │   ├── operator-role.ts                   (existing)
│   │   ├── operator-stamp.ts                  (existing)
│   │   ├── secret-hash.ts                     (existing)
│   │   ├── session-token.ts                   (existing)
│   │   ├── authentication-method.ts           (existing)
│   │   ├── authentication-outcome.ts          (existing)
│   │   ├── privileged-action.ts               ← NEW
│   │   ├── authorisation-subject.ts           ← NEW
│   │   ├── authorisation-reason.ts            ← NEW
│   │   ├── authorisation-scope.ts             ← NEW
│   │   ├── authorisation-window.ts            ← NEW
│   │   ├── authorisation-outcome.ts           ← NEW
│   │   ├── authorisation-refusal.ts           ← NEW
│   │   ├── refusal-reason.ts                  ← NEW
│   │   └── authorisation-consumption.ts       ← NEW
│   ├── services/
│   │   ├── authentication-service.ts          (existing)
│   │   ├── session-policy.ts                  (existing, PURE)
│   │   ├── credential-service.ts              (existing)
│   │   ├── session-factory.ts                 (existing)
│   │   ├── operator-stamp-factory.ts          (existing)
│   │   ├── identity-provider.ts               (existing, THE PORT)
│   │   ├── authorisation-policy.ts            ← NEW, PURE
│   │   ├── authorisation-service.ts           ← NEW
│   │   ├── authorisation-clock.ts             ← NEW (the PORT)
│   │   └── authorisation-window-factory.ts    ← NEW (the PORT)
│   ├── events/
│   │   ├── identity-events.ts                 (existing)
│   │   └── authorisation-events.ts            ← NEW
│   └── ports/
│       ├── repositories.ts                     (existing, EXTENDED)
│       ├── secret-hasher.ts                   (existing)
│       └── authorisation-repository.ts        ← NEW
│
├── application/
│   ├── use-cases/
│   │   ├── sign-in.ts                         (existing)
│   │   ├── sign-out.ts                        (existing)
│   │   ├── get-current-operator.ts            (existing)
│   │   ├── authorise-privileged-action.ts     ← NEW
│   │   ├── evaluate-authorisation.ts          ← NEW
│   │   └── consume-authorisation.ts           ← NEW
│   └── dto/
│
├── infrastructure/
│   ├── persistence/
│   │   ├── database.ts                        (existing, EXTENDED — migrations)
│   │   ├── sqlite-operator-repository.ts      (existing)
│   │   ├── sqlite-credential-repository.ts    (existing)
│   │   ├── sqlite-session-repository.ts       (existing)
│   │   ├── sqlite-authorisation-repository.ts ← NEW
│   │   └── sqlite-consumption-repository.ts   ← NEW
│   ├── security/
│   │   ├── argon2-secret-hasher.ts            (existing)
│   │   ├── local-identity-provider.ts         (existing)
│   │   └── session-token-generator.ts         (existing)
│   ├── config/
│   │   └── identity-config.ts                 (existing, EXTENDED)
│   └── composition-root.ts                    (existing, EXTENDED)
│
└── presentation/
    ├── controllers/
    │   ├── identity-controller.ts             (existing)
    │   └── authorisation-controller.ts        ← NEW
    ├── middleware/
    │   ├── require-operator.ts                (existing)
    │   └── resolve-current-operator.ts        (existing)
    └── schemas/
        ├── identity-schemas.ts                (existing)
        └── authorisation-schemas.ts           ← NEW (Zod)
```

### Why the ports live where they do

The two new ports — `AuthorisationClock` and `AuthorisationWindowFactory` —
are declared under `domain/services/`, alongside `IdentityProvider`, rather
than under `domain/ports/`. This is consistent with bolt `001`: a port that
the *domain service* itself needs is a collaborator of that service, and
`IdentityProvider` — the most important port in the unit — already sits
there. The repository contracts are domain-owned contracts about *storage*
and so remain under `domain/ports/`.

**One repository file or two?** `AuthorisationRepository` and
`ConsumptionRepository` are **two** interfaces in **two** files. They are
separate aggregates with separate invariants, and a single file would
invite an adapter that could mutate one while appearing to own the other.
They live in `domain/ports/authorisation-repository.ts` as a **single file
containing both interfaces** — they are ports of the same context and are
always consumed together — while their **adapters** are separate files,
because their table mappings differ.

---

## API Design

Base path: `/api/identity`. All bodies are JSON. All responses are
`application/json`.

### New endpoints

| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| `/api/identity/authorisations` | POST | `{ supervisorId, secret, action, subject, reason }` | `201 { authorisationId, supervisorId, action, subject, reason, authorisedAt, expiresAt }` or `403 { "error": "AUTHORISATION_REFUSED" }` |
| `/api/identity/authorisations/:id` | GET | header `Authorization: Bearer <token>` | `200 { authorisationId, supervisorId, action, subject, reason, authorisedAt, expiresAt, consumed }` or `403` / `404` |
| `/api/identity/authorisations/:id/consume` | POST | header `Authorization: Bearer <token>`, body `{ action, subject }` | `200 { authorisationId, consumedAt, action, subject }` or `403 { "error": "AUTHORISATION_REFUSED" }` |

### The refusal response — one body, no reason

**Every** refusal returns exactly:

```json
{ "error": "AUTHORISATION_REFUSED" }
```

with status `403`. There is **no** `reason` field, **no** `code` field and
**no** message. This is the design decision Stage 1 flagged as needing a
test on both sides, and it is the one place in this bolt where the domain
and the API deliberately disagree about how much to say:

- The **domain** carries `AuthorisationRefusal` with a named
  `RefusalReason`. The audit trail needs it, and the story requires it.
- The **API** returns a generic refusal. The caller is an operator
  attempting escalation, and a precise error is a map of the defences:
  `SELF_AUTHORISATION` teaches them the identity check exists, `EXPIRED`
  teaches them the window, `ALREADY_USED` teaches them the single-use
  rule. Each of those is a piece of the defence, handed to the adversary.

**The refusal reason is not discarded — it is routed to the audit trail.**
The `PrivilegeRefused` event carries it; the HTTP response does not. This
is why the controller returns a constant rather than branching on the
reason: there is no branch to get wrong.

### Status code selection

`403` rather than `401` for every authorisation refusal. The distinction
matters:

- `401 UNAUTHENTICATED` means "you have no session" — the caller's
  *credential for the session* was absent or invalid. This is bolt `001`'s
  code.
- `403 AUTHORISATION_REFUSED` means "you are authenticated, and the
  privileged action is still not permitted". This includes the case where
  the *supervisor's* credential was wrong.

That last case is the awkward one, and it deserves care. If the supervisor
credential is wrong, is that `401` or `403`? It is **`403`**, and the
reason is the identity-oracle defence: a `401` for "wrong supervisor
credential" versus a `403` for "right credential, wrong scope" would let an
attacker **probe for supervisor identities** by trying credential pairs and
reading the status code. Every authorisation refusal therefore returns
`403`, uniformly, including a wrong supervisor secret, an unknown
supervisor id, a missing reason, a self-authorisation, a wrong scope, an
expired authorisation and an already-used one.

**This is a deliberate strengthening of the constant-response rule**, and it
costs the caller the ability to distinguish "you typed the wrong PIN" from
"that authorisation is spent". That cost is accepted: the operator can
retry the supervisor prompt, and the supervisor can ask the operator what
they typed. The alternative leaks more than the confusion costs.

**One deliberate exception, consistent with bolt `001`.** A *malformed
request* — a body that fails schema validation — is rejected with
`400 { "error": "VALIDATION_ERROR", "fields": [...] }` before any
credential lookup happens. This says nothing about whether the supervisor
exists, because it describes the shape of the request and the caller already
knows the request was malformed. This is the same exception bolt `001` made
for sign-in, and the same reasoning applies: the constant-response rule
governs failures *of authentication*, not malformed requests.

### The `GET /api/identity/authorisations/:id` endpoint

This endpoint exists for the UI (unit 007) to show the supervisor what they
are about to authorise, and for support. It requires the **operator's**
bearer token — the supervisor's own session is not sufficient, because the
point of the check is to show the *requesting operator* what is pending.

It returns `consumed: true | false` so the UI can grey out a spent
authorisation.

**It does not return the reason to an unauthorised caller.** If the
requester is not the operator the authorisation was issued for, the endpoint
returns `403` — the same generic refusal — rather than the authorisation's
details. This prevents an operator from reading a supervisor's justification
text for an authorisation they did not request, which is a small but real
disclosure.

### The `POST /consume` endpoint

Consumption is a **separate endpoint from authorisation**, not a flag on
it. This is what makes single-use work:

1. `POST /authorisations` — supervisor authenticates, authorisation created.
2. `POST /authorisations/:id/consume` — the operator applies it to the
   privileged action.

If they were one endpoint, then "authorise" and "apply" would be the same
act, and the authorisation could not be reviewed before use. Separating them
also means the **evaluate** step can run without spending the
authorisation — which is what unit 003 needs to ask "may I do this?" before
it commits to doing it.

The consume endpoint takes `action` and `subject` in the body and checks
them against the authorisation's scope. The scope check is therefore
performed **at the point of use**, not merely at the point of issue — a
client cannot skip it by omitting the fields, because a missing or
mismatched action or subject is a refusal.

**Concurrency.** Two simultaneous consume requests for the same
authorisation must result in exactly one success. The `authorisation_id`
column on the consumption table carries a `UNIQUE` constraint, so the second
insert fails at the storage layer and is reported as a refusal
(`ALREADY_USED`). The check-then-insert in the service is *not* relied upon
for correctness — it is an optimisation that produces a good error message;
the database is the enforcement.

### Request bodies and Zod schemas

`authorisation-schemas.ts` defines:

- `authoriseSchema` — `{ supervisorId: string, secret: string, action: enum, subject: string, reason: string }`
- `consumeSchema` — `{ action: enum, subject: string }`

`action` is validated against the **same closed union** the domain uses.
Zod's `z.enum` and the domain's union type are kept in step by deriving the
Zod enum from the domain's exported array of action names, so there is one
source of truth and a new action cannot be added to one and forgotten in the
other.

`reason` is validated for presence and type at the schema level (it must be
a string), but **meaningfulness** (not empty, not whitespace-only, not
punctuation-only) is enforced by the **domain's `AuthorisationReason`**, not
by Zod. The reason for this split: the domain rule is the rule that matters,
and duplicating it in the schema would create two places where it could
diverge. The schema catches "not a string"; the domain catches "not a
justification". A schema-level minimum length would additionally reject a
reason the domain would accept, which would be a schema bug, not a security
improvement.

---

## Data Persistence

SQLite via `node:sqlite` (bolt `001`'s deviation from the original
`better-sqlite3` choice — see the tech stack's Database section). Migrations
applied at startup, recorded in `schema_migrations`. All columns are TEXT or
INTEGER — **no quantity columns here**, so NFR-16's fixed-point decimal rule
does not bind this unit.

### New tables

| Table | Columns | Relationships |
|-------|---------|---------------|
| `supervisor_authorisations` | `id` TEXT PK, `session_id` TEXT NOT NULL, `supervisor_id` TEXT NOT NULL, `action` TEXT NOT NULL CHECK (action IN (...)), `subject` TEXT NOT NULL, `reason` TEXT NOT NULL, `authorised_at` TEXT NOT NULL, `expires_at` TEXT NOT NULL | → `identity_sessions(id)`, → `operators(id)` |
| `authorisation_consumptions` | `id` TEXT PK, `authorisation_id` TEXT NOT NULL UNIQUE, `action` TEXT NOT NULL, `subject` TEXT NOT NULL, `consumed_at` TEXT NOT NULL | → `supervisor_authorisations(id)` |

### New indexes

| Index | Columns | Why |
|-------|---------|-----|
| `idx_supervisor_authorisations_subject` | `subject` | "Is there a live authorisation for this subject?" — the check unit 003 makes when an escalation is raised. |
| `idx_supervisor_authorisations_expires` | `expires_at` | The expiry reaper. |
| `idx_authorisation_consumptions_authorisation` | `authorisation_id` | Already covered by the `UNIQUE` constraint, which creates its own index — **no separate index is created**, because it would be a duplicate. |

### The `action` CHECK constraint

`action IN ('CONFIRM_COMPONENT', 'TOLERANCE_OVERRIDE', 'MANUAL_SCALE_RESELECTION', 'CALIBRATION_BYPASS')`.

The `CHECK` constraint is the last line of defence, exactly as `role IN
('OPERATOR','SUPERVISOR')` was in bolt `001`. The domain's union type bounds
the set; the `CHECK` means a corrupted write or a future migration cannot
widen the set behind the domain's back. Two independent mechanisms, because
this set *is* the authorisation surface.

### The `authorisation_consumptions.authorisation_id` UNIQUE constraint

This is the **single-use rule (A-6) at the storage layer**. Two independent
enforcements exist — the service's existence check and this constraint — and
the constraint is the one that matters under concurrency.

### `session_id` is stored, and it is a reference, not a capability

The authorisation records which session the supervisor authenticated in. It
is a **provenance reference** — it tells the audit trail *how* the
supervisor proved themselves. It is **not** a credential: the session's
`token_hash` is what authorises the session, and the authorisation id is
what the operator presents at the point of use.

**The `session_id` column does not grant access to the session.** It is a
foreign key to a row that already exists, and reading it reveals only that
a supervisor authenticated at a time. It carries no token.

### `reason` is stored in clear text

The reason is **not** a secret. It is free text written by a supervisor to
justify an exception, and it must be readable in the audit trail five years
later by someone who was not there. Hashing it would make the audit trail
useless. This is stated explicitly because every other credential-ish value
in this system is hashed, and the reason is the deliberate exception.

**The reason is never truncated or normalised in a lossy way.** It is stored
as given, trimmed of surrounding whitespace only. The *meaningfulness* check
is applied at the domain boundary, and the original text is what is retained.

### Retention

Authorisations and consumptions are **append-only and retained ≥ 5 years**
(BRD DR-01, DR-02), on the same terms as the audit entries they justify. A
retention policy that kept the justification and deleted the authorisation
would be worthless.

The `expireDue` operation **marks** an authorisation expired — it does not
delete it. An expired authorisation that was deleted would destroy the
evidence that the exception had been released.

**This unit does not implement the retention job.** The job belongs with the
audit trail (unit 006), which owns the 5-year clock for the records this
context produces. This unit provides the append-only storage; the job that
eventually reaps *sessions* and *authorisation consumption evidence* after
their retention window is an Operations concern, recorded here rather than
silently omitted.

---

## Security Design

| Concern | Approach |
|---------|----------|
| **Fresh authentication (A-2)** | The only path to an authorisation runs through `IdentityProvider.verifyCredential`. **There is no method anywhere that creates an authorisation from a session id.** "A supervisor is signed in elsewhere" is structurally irrelevant. |
| **Different person (A-1)** | The policy compares `OperatorId` values. Never roles. A person holding both roles still cannot self-authorise. |
| **Mandatory reason (A-3)** | `AuthorisationReason` cannot be constructed from an empty, whitespace-only or punctuation-only string. A missing reason is a construction failure, not a runtime check. |
| **Role separation (A-9)** | The credential's role is the authority of record (bolt `001`, I-4). `credentials.role` is the `SUPERVISOR` row; the credential table's primary key `(operator_id, role)` means a supervisor credential and an operator credential are separate rows with separate hashes. |
| **Credential sharing** | The `credentials` table's primary key `(operator_id, role)` means one credential per (operator, role). A supervisor's secret and an operator's secret are different rows with different hashes. The provider looks up by `(operatorId, SUPERVISOR)` for authorisation — so an operator's secret presented against the supervisor row simply fails the hash comparison. |
| **Constant-work verification** | Reuses bolt `001`'s `LocalIdentityProvider` verbatim. The supervisor's credential verification takes the **same** constant-work path as a sign-in, including the dummy-hash full verification on a miss. No second verification path exists. |
| **Identity enumeration** | Every authorisation refusal returns `403 AUTHORISATION_REFUSED` — including an unknown supervisor id and a wrong supervisor secret. A caller cannot distinguish them. |
| **Refusal reason not disclosed** | The domain carries the reason; the API returns a constant body. A test asserts the response contains no reason field. |
| **Single use (A-6)** | `UNIQUE` constraint on `authorisation_consumptions.authorisation_id` plus an existence check. Concurrent double-consume resolves to one success. |
| **Expiry (A-5)** | `AuthorisationPolicy.isLive` — `now >= expiresAt` is expired. The **inclusive** boundary, matching `SessionPolicy`. The clock is injected, so the boundary is tested exactly. |
| **Append-only (A-7)** | `AuthorisationRepository` exposes **no `update` and no `delete`**. The interface is the enforcement point. Consumption is a separate record, so consuming never mutates the authorisation. |
| **Audit on refusal (A-8)** | Every refusal emits `PrivilegeRefused`. There is no path that refuses without emitting. |
| **Secret handling** | The supervisor's secret exists only in the request body and inside `SecretHasher.verify`. Never stored, never logged, never returned. |
| **Token handling** | The session token is the operator's bearer credential, carried in the `Authorization` header, stored as a SHA-256 digest (ADR-002). |
| **Logging** | The secret, the token, the token digest and the stored hash are never logged. The `PrivilegeRefused` event carries the actor, the subject and the reason — **not** the secret. |

### The constant-work guarantee applies here too, and it is inherited rather than reimplemented

A supervisor authorisation involves a credential verification. If that
verification were cheaper on some paths than others, the authorisation
endpoint would become an **operator-identity oracle** — a caller could try
operator ids as supervisors and learn which exist by timing.

Bolt `001` already established this property in
`LocalIdentityProvider.verifyCredential`: an unknown operator id, an absent
credential and a wrong secret each perform **exactly one** full Argon2id
verification, using a dummy hash computed at construction. This bolt
**reuses that provider unchanged**. There is no second credential check
anywhere in the authorisation path, so there is no second place for the
timing property to be wrong.

The existing bolt `001` test — which asserts the verification count on every
path — therefore covers the authorisation path too, because it is the same
code. The Stage 5 test plan adds an authorisation-specific assertion that
the authorisation path calls the provider exactly once, so that a future
refactor which introduces a second lookup is caught.

### The known limitation, restated

A single-threaded Node process cannot fully equalise timing between two
*concurrent* requests. This was recorded in bolt `001` and it still holds
here. The order-of-magnitude property — which is what defeats practical
enumeration — does hold, and it is measured rather than assumed.

---

## NFR Implementation

| Requirement | Design Approach |
|-------------|-----------------|
| **FR-21 (privileged actions; supervisor authentication required; credentials never shared; every privileged action recorded)** | The whole unit. `FR-21` names three privileged actions — tolerance override, manual scale reselection, calibration bypass — plus unit 003's `confirmComponent`; all four are in the closed `PrivilegedAction` union. Every one of them requires the same authorisation path. |
| **FR-13 (non-compensable over-dose escalation; supervisor authentication and a recorded reason)** | The `CONFIRM_COMPONENT` action and the `AuthorisationReason` value object. The reason is mandatory by construction. |
| **NFR-6 / BRD NFR-12 (credentials never shared between roles; only an authenticated supervisor may authorise)** | The `credentials` table's `(operator_id, role)` primary key; the provider's lookup by `(operatorId, SUPERVISOR)`; the policy's identity check; the absence of any session-based authorisation path. |
| **NFR-05 (survives immediate power loss)** | `synchronous = FULL` and WAL, as in bolt `001`. An authorisation write that survived is durable; a lost authorisation costs one supervisor prompt, not a compliance failure. The **consumption** write matters more — losing it would re-open a spent authorisation — so it is written with the same durability settings. |
| **NFR-03 (weighing available during outage)** | Not binding on this unit. Identity is local; there is no network dependency. Authorisation works offline. |
| **DR-01 / DR-02 (≥ 5-year retention; immutable records)** | The authorisation and consumption tables are append-only with no update or delete path in the repository contracts. Retention is ≥ 5 years on audit terms. |
| **NFR-11 (externalised text)** | The API emits codes (`AUTHORISATION_REFUSED`, `VALIDATION_ERROR`), never prose. All operator-facing text lives in unit 007's locale bundle. The refusal reason is an internal code, not user-facing text. |
| **NFR-01 (≤ 200 ms weight lag)** | Not binding. The authorisation path is **never** in the 10 Hz weight stream. It is a once-per-exception operation that happens while the weighing is in the `ESCALATED` state and awaiting a supervisor. **Explicitly**: the weight readout must not wait on an authorisation check. |
| **FR-22 / NFR-14 (configuration without redeployment)** | `AuthorisationLifetime` is configuration (`WEIGHINGMS_AUTHORISATION_LIFETIME_MS`), not a constant. |

---

## Error Handling

| Error Type | Code | Response |
|------------|------|----------|
| Any authorisation refusal | `AUTHORISATION_REFUSED` | `403 { "error": "AUTHORISATION_REFUSED" }` — **one body for every cause**, including a wrong supervisor credential |
| Malformed request body | `VALIDATION_ERROR` | `400 { "error": "VALIDATION_ERROR", "fields": [...] }` — rejected before any credential lookup |
| Consume with no operator session | `UNAUTHENTICATED` | `401 { "error": "UNAUTHENTICATED" }` — the caller cannot even attempt a privileged action without a session |
| Get a non-existent authorisation | `NOT_FOUND` | `404 { "error": "NOT_FOUND" }` |
| Unknown route | `NOT_FOUND` | `404 { "error": "NOT_FOUND" }` |
| Unexpected server fault | `INTERNAL_ERROR` | `500 { "error": "INTERNAL_ERROR" }` — the detail goes to the log, never to the client |

### The `401` / `403` split, stated precisely

- `401 UNAUTHENTICATED` — the **requester** has no live session. The request
  never reaches the authorisation logic.
- `403 AUTHORISATION_REFUSED` — the requester has a session, and the
  privileged action is nonetheless not permitted.

**A wrong supervisor credential is `403`, not `401`.** This is the
non-obvious case, and it is `403` because a `401` would distinguish "your
supervisor credential was rejected" from "that authorisation is spent" —
which is an enumeration oracle over supervisor identities.

### Validation errors do not leak credential state

A `VALIDATION_ERROR` says "the `reason` field is required" or "the `action`
field is not one of the permitted actions". It describes the *request*. It
never says whether a supervisor exists, and — critically — it is returned
**before** the credential store is consulted, so the timing of a `400` is
also distinguishable from the timing of a `403`. That is acceptable for the
same reason bolt `001` accepted it: a malformed request reveals only that
the request was malformed, which the caller already knew.

### The refusal reason goes to the log, not the response

The `PrivilegeRefused` event carries `reason`. If the application logs
refusals, the reason appears in the log — **but the reason is a fixed
enum code, not prose**, and it is logged together with the actor and the
subject. The supervisor's secret is never in the log, and neither is the
operator's session token.

---

## External Dependencies

| Service | Purpose | Integration |
|---------|---------|-------------|
| **None** | — | — |

This unit has **no external service dependency**, for the same reason bolt
`001` did not: the identity source is a *local* concern reached through the
`IdentityProvider` port, not an external integration. A `DIRECTORY` provider
remains deliberately unimplemented — writing one would invent a contract for
a system that does not exist.

---

## Dependency Set Required by Stage 4

**No new package is required.** Everything this bolt needs already exists:

| Package | Purpose | Status |
|---------|---------|--------|
| `zod` | Request validation | **already installed** (bolt `001`) |
| `node:sqlite` | Persistence | **built in** (Node 26) — bolt `001`'s recorded deviation |
| `node:crypto` | Argon2id | **built in** — ADR-001 |
| `typescript`, `express`, `vitest`, `supertest` | Build and test | **already installed** |

The one thing Stage 4 must not do is introduce a package for the
authorisation path. The reason this bolt's security surface is defensible is
that it reuses bolt `001`'s credential path wholesale; a new dependency here
would be a new thing to audit on the compliance-critical path.

---

## Traceability — story to design element

| Story acceptance criterion | Design element |
|---|---|
| Operator's session alone never authorises | `AuthorisationPolicy` role check; no session-based creation path exists |
| "Already signed in elsewhere" is not authorisation | `AuthorisationService.authorise` takes a credential, never a session id |
| Reason is mandatory | `AuthorisationReason` value object — unconstructible from an empty/contentless string |
| Authoriser must be a different person | `AuthorisationPolicy` compares `OperatorId`s, never roles |
| Scoped to one action and one subject | `AuthorisationScope`; checked at **both** issue and consume |
| Expired authorisation authorises nothing | `AuthorisationPolicy.isLive`, inclusive boundary, injected clock |
| Single-use; second use refused | `UNIQUE` constraint on `authorisation_consumptions.authorisation_id` |
| Carries supervisor identity, reason, time; audited | `SupervisorAuthorisation` fields; `PrivilegeAuthorised` event |
| Retained ≥ 5 years on audit terms | Append-only tables; no delete path; retention job owned by unit 006 |
| Every refusal audited with actor, subject, reason | `PrivilegeRefused` event emitted on every refusal path |
| Credentials never shared between roles | `credentials` PK `(operator_id, role)`; provider lookup by role |
| Record carries supervisor identity, reason, time | `SupervisorAuthorisation`; consumed by unit 003 and unit 006 |

---

## Notes for Stage 3

Three ADR candidates, all surfaced by real findings during this stage
rather than manufactured:

1. **The authorisation identifier is not a bearer credential.** An
   authorisation id is presented by the operator at the point of use. The
   question is whether presenting it *alone* should authorise the action, or
   whether it must be presented **together with the operator's session** as
   this design specifies. This is the difference between "a leaked
   authorisation id authorises an over-dose" and "it does not". The design
   chooses the latter — the consume endpoint requires the operator's bearer
   token — but the trade-off deserves recording, because it is the kind of
   decision that a future developer might quietly reverse.

2. **Every authorisation refusal returns one status and one body, including
   a wrong supervisor credential.** The alternative — distinguishing
   "your credential was wrong" from "that authorisation is spent" — is more
   helpful to a legitimate operator and is an enumeration oracle over
   supervisor identities. The design takes the oracle. This is a
   deliberate, costly trade-off on the same shape as bolt `001`'s constant
   sign-in response, and it should be recorded as a decision rather than
   left as an implementation detail.

3. **The reason is stored in clear text while every other credential-ish
   value in the system is hashed.** The reason must be readable in the audit
   trail five years later; hashing it would make the trail useless. The
   asymmetry is intentional and deserves a record, so that a future
   "let's hash everything" sweep does not break the audit trail.

A fourth item is **not** an ADR candidate, and the reason is worth stating:
the `AuthorisationClock` seam is not a decision, it is a testability
mechanism, and the pattern (an injected clock) is already established by
bolt `001`'s `SessionPolicy`.
