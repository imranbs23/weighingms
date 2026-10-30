---
unit: 008-operator-identity
bolt: 001-008-operator-identity
stage: design
status: complete
updated: 2026-10-30T11:30:00Z
---

# Technical Design - Operator Identity

## Architecture Pattern

**Hexagonal (Ports and Adapters)**, layered within the DDD bolt type's
four-layer structure.

The domain model from Stage 1 is expressed as **pure TypeScript with zero
runtime dependencies** — no framework imports, no database imports, no
`crypto` imports in the entity files. The identity rules (session expiry at
the boundary, role authority of record, opaque tokens) are the security
boundary of the whole product, and they must be testable without booting a
server or a database.

**Why hexagonal and not plain layered.** The decisive constraint is `Q-08`:
the identity *source* is undecided. If identity is reached through a
concrete `LocalIdentityProvider` type, then answering `Q-08` means editing
every consumer. With a port (`IdentityProvider`) and an adapter
(`LocalIdentityProvider`), answering it means writing one new class and
changing one line of wiring. The pattern is chosen **for that reason
specifically**, not as a general preference.

**Why the domain has no dependencies at all.** `SecretHash`, `SessionToken`
and `AuthenticationOutcome` are the three types whose integrity matters most.
If the domain imported a hashing library, then a change in that library's
API would ripple into the entities that are supposed to be unassailable. The
domain depends on nothing; the ports it declares are contracts, and the
adapters implement them.

**Layer dependency rule (strictly one-directional):**

```text
Presentation  ──►  Application  ──►  Domain
                                  ◄──  Infrastructure
```

Infrastructure implements ports declared by Domain and Application. Nothing
in Domain imports from Infrastructure. Nothing in Domain imports from
Presentation.

---

## Layer Structure

```text
src/008-operator-identity/
├── domain/                          ← pure TypeScript, ZERO runtime deps
│   ├── entities/
│   │   ├── operator.ts              Operator, OperatorRole
│   │   ├── credential.ts            Credential, SecretHash
│   │   ├── identity-session.ts      IdentitySession, SessionToken, SessionLifetime
│   │   └── supervisor-authorisation.ts
│   ├── value-objects/
│   │   ├── operator-id.ts
│   │   ├── authentication-outcome.ts
│   │   ├── operator-stamp.ts
│   │   └── authentication-method.ts
│   ├── services/
│   │   ├── authentication-service.ts
│   │   ├── session-policy.ts        pure
│   │   ├── credential-service.ts
│   │   ├── operator-stamp-factory.ts
│   │   └── identity-provider.ts     the PORT (interface)
│   ├── events/
│   │   └── identity-events.ts
│   └── ports/                       repository + hasher contracts
│       ├── operator-repository.ts
│       ├── credential-repository.ts
│       ├── session-repository.ts
│       └── secret-hasher.ts
│
├── application/
│   ├── use-cases/
│   │   ├── sign-in.ts
│   │   ├── sign-out.ts
│   │   └── get-current-operator.ts
│   └── dto/
│
├── infrastructure/
│   ├── persistence/
│   │   ├── sqlite-operator-repository.ts
│   │   ├── sqlite-credential-repository.ts
│   │   └── sqlite-session-repository.ts
│   ├── security/
│   │   ├── argon2-secret-hasher.ts
│   │   ├── local-identity-provider.ts
│   │   └── session-token-generator.ts
│   └── config/
│       └── identity-config.ts
│
└── presentation/
    ├── controllers/
    │   └── identity-controller.ts
    ├── middleware/
    │   ├── require-operator.ts
    │   └── resolve-current-operator.ts
    └── schemas/
        └── identity-schemas.ts      Zod
```

### Why the ports live in `domain/ports/` and not in `application/`

`SecretHasher` and the three repositories are contracts the **domain** relies
on. Placing them under `domain/ports/` makes the dependency inversion
visible in the directory tree: the domain declares what it needs, and the
infrastructure folder supplies it. If they lived in `application/`, the
domain would import from the application layer to describe its own
dependencies, which inverts the intended direction.

---

## API Design

Base path: `/api/identity`. All bodies are JSON. All responses are
`application/json`.

| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| `/api/identity/sign-in` | POST | `{ operatorId: string, secret: string }` | `200 { token, sessionId, operator: OperatorStamp, expiresAt }` |
| `/api/identity/sign-out` | POST | `{ token: string }` | `200 { signedOut: true, sessionId }` |
| `/api/identity/current` | GET | header `Authorization: Bearer <token>` | `200 { operator: OperatorStamp, sessionId, expiresAt }` or `401 { error }` |
| `/api/identity/session` | GET | header `Authorization: Bearer <token>` | `200 { sessionId, operatorId, role, method, authenticatedAt, expiresAt }` or `401` |

### Response design notes

**`sign-in` returns `200` with a body on success, and `401` with a
**single, fixed** error body on failure.** The failure body is byte-for-byte
identical for "no such identity" and "wrong password":

```json
{ "error": "AUTHENTICATION_FAILED" }
```

There is no `errorCode`, no `message`, and no field that distinguishes the
two cases. `AUTHENTICATION_FAILED` is not a paraphrase of "wrong password" —
it is deliberately ambiguous about *which* of the two it was.

**`current` and `session` return `401` for every refusal reason** — no
session, expired session, ended session, tampered token, deactivated
operator. All five collapse to one response. This mirrors the repository
contract from Stage 1: the difference between "no token" and "bad token" is
exactly what an attacker probes for, so it is not observable.

**`sign-out` on an already-ended or unknown token returns `200`.** Signing
out is idempotent. Making it fail would tell a caller whether a token was
ever valid.

### The `Authorization` header

`Authorization: Bearer <token>`. The token is opaque and carries no
structure. The server resolves it to a session row; the client never
parses it.

**The token is returned exactly once**, in the `sign-in` response body. It
is not placed in a cookie, and not echoed in any other response. A cookie
would be preferable for a browser SPA (HttpOnly, SameSite), but it would
also mean the API sets browser-scoped state on a cross-origin request — and
the tech stack has the SPA on `:5173` and the API on `:3000` with CORS
enabled. A bearer token keeps the API stateless with respect to the browser
and avoids a CSRF surface entirely. The cost is that the token must be held
by the client, which is stated in the domain model and is acceptable for a
single-user terminal that is itself a physical control.

---

## Data Persistence

SQLite via `better-sqlite3`. Migrations applied at startup. All columns are
TEXT or INTEGER — **no quantity columns here**, so NFR-16's fixed-point
decimal rule does not bind this unit (that rule binds the weighing domain,
and it is honoured in the tables that hold quantities).

| Table | Columns | Relationships |
|-------|---------|---------------|
| `operators` | `id` TEXT PK, `display_name` TEXT NOT NULL, `role` TEXT NOT NULL CHECK (role IN ('OPERATOR','SUPERVISOR')), `active` INTEGER NOT NULL DEFAULT 1, `created_at` TEXT NOT NULL | — |
| `credentials` | `operator_id` TEXT NOT NULL, `role` TEXT NOT NULL CHECK (role IN ('OPERATOR','SUPERVISOR')), `secret_hash` TEXT NOT NULL, `rotated_at` TEXT NOT NULL, PRIMARY KEY (`operator_id`, `role`) | → `operators(id)` ON DELETE CASCADE |
| `identity_sessions` | `id` TEXT PK, `operator_id` TEXT NOT NULL, `role` TEXT NOT NULL, `method` TEXT NOT NULL, `token_hash` TEXT NOT NULL UNIQUE, `authenticated_at` TEXT NOT NULL, `expires_at` TEXT NOT NULL, `ended_at` TEXT NULL, `ended_cause` TEXT NULL | → `operators(id)` |

### The `token_hash` column — a design decision worth stating

The session token is stored **hashed**, not plaintext.

The domain model specified an opaque token mapped server-side to a session
row. It did not specify that the stored form is a hash. This design
tightens it: `identity_sessions.token_hash` holds a SHA-256 digest of the
token, and the raw token is never persisted.

**Why.** A session table is exactly the kind of table that gets copied into
a support bundle, a backup, or a log. If the raw token were stored, every
copy of that table would be a copy of a set of live session credentials. A
digest makes the table useless for session hijacking while still allowing
lookup — the client presents a token, the server hashes it and looks it up.

The trade-off is that the raw token cannot be recovered from the database.
That is not a problem: the client holds it, and if it is lost the operator
signs in again.

**This does not weaken the "opaque token" property.** The property that
matters is that the token reveals nothing about the operator *to anyone who
reads it* — and a random 256-bit value satisfies that whether it is stored
raw or hashed. Hashing it additionally protects against the token leaking
via the database.

`token_hash` is a **fast** hash (SHA-256), deliberately. It is a lookup key
for a 256-bit random value, not a secret with low entropy — there is
nothing to brute-force, so a slow KDF would only add latency to every
authenticated request.

### `CHECK` constraints as the last line of defence

`role IN ('OPERATOR','SUPERVISOR')` is enforced by the database as well as
by the type. The domain's `OperatorRole` is a closed union; the `CHECK`
constraint means a corrupted write or a future migration cannot widen the
role set behind the domain's back. Two independent mechanisms, because the
role set is what authorises privileged actions.

### The `identity_sessions.token_hash` uniqueness

`UNIQUE` on `token_hash` guarantees that two sessions cannot share a token.
The token is 32 bytes from `crypto.randomBytes`, so a collision is
astronomically unlikely — but "unlikely" is not "impossible", and a
duplicate token would mean two operators sharing one credential.

### `ended_at` and `ended_cause`

A session is **ended**, never deleted (Stage 1: no `delete` on the
repository). `ended_cause` records `SIGNED_OUT`, `REPLACED` or `EXPIRED`,
so the sign-in/sign-out event stream can be reconstructed. Rows are reaped
by a retention job after a configurable window — the reap is a physical
delete of an *ended* session, which is not the same as deleting a live one.

---

## Security Design

| Concern | Approach |
|---------|----------|
| **Credential storage** | Argon2id, memory-hard, per-credential random salt. The plaintext secret exists only inside `SecretHasher.hash`/`verify` and in the request body. Never stored, never logged. |
| **KDF choice** | **Argon2id**, `memory=19456 KiB` (19 MiB), `passes=2`, `parallelism=1`, `tagLength=32`. See the ADR candidate in Stage 3. |
| **Session token** | 32 bytes from `crypto.randomBytes`, base64url-encoded. Opaque — no operator id, role or expiry is encoded. Stored as a SHA-256 digest server-side. |
| **Identity enumeration** | The "no such identity" path performs a full Argon2id verification against a **dummy hash** before refusing, so both failure paths cost the same. See "The constant-work guarantee" below. |
| **Failed-sign-in response** | One fixed body, one fixed status, no distinguishing field. |
| **Role authority** | The session's role is copied from the matched `credentials.role` row. No request field is read for a role. |
| **Session expiry** | Evaluated at the boundary inclusively — `now >= expiresAt` means expired. Configurable lifetime, not hard-coded. |
| **Deactivated operator** | `active = false` is checked on every authorisation, so a live session stops authorising immediately. |
| **Credential rotation** | Rotation replaces the hash. It does **not** invalidate a live session — the story says rotation invalidates the credential, not the session already established. |
| **Logging** | The secret, the token and the stored hash are never logged. The `SignInRefused` event carries the **presented** operator id and a single reason value. |
| **Transport** | Development runs the SPA on `:5173` and the API on `:3000` over plain HTTP with CORS enabled. This is a **local training build**, and the token travels in cleartext on loopback. Production deployment over TLS is an Operations concern; it is recorded in the Operations context, not solved here. |

### The constant-work guarantee — the one property the type system cannot enforce

Stage 1 made the *response* indistinguishable by construction: the
`AuthenticationOutcome` type has a single failure shape, so no caller can
branch on the reason.

The *timing* is different. Two failure paths that cost different amounts of
work are distinguishable by an attacker with a stopwatch, and the
difference is exactly "does this operator id exist".

The guarantee is implemented in **one place only** — the local provider's
verification path:

```text
presented operator id → look up credential
  ├─ found     → argon2id verify(presented secret, stored hash)   [real work]
  └─ not found → argon2id verify(presented secret, DUMMY hash)    [same work]
```

Both paths perform one full Argon2id verification. The dummy hash is a real
Argon2id output computed at startup with the same parameters, so the cost is
identical, not merely similar.

**This is not guaranteed by the type system.** It is guaranteed by a test
that asserts both paths perform a verification, plus a statistical timing
test that is tolerant of scheduler noise but would catch an order-of-magnitude
difference. The test is the enforcement, and it lives in Stage 5.

**A known limitation, stated rather than hidden.** A single-threaded Node
process cannot fully equalise timing between two requests that arrive
concurrently — one request waits for the other, and the second one's total
latency includes the first's work. Full constant-time behaviour would need
either a fixed-work queue or per-request isolation. This is recorded as a
known limitation, not silently accepted. The **order-of-magnitude**
property, which is what defeats practical enumeration, does hold.

### Secrets and the `Authorization` header

The bearer token is read from the `Authorization` header, not from a query
parameter. A query parameter ends up in server access logs, in `Referer`
headers and in browser history; the `Authorization` header does not.

---

## NFR Implementation

| Requirement | Design Approach |
|-------------|-----------------|
| **NFR-12 (privileged actions require authentication; credentials never shared)** | The whole unit. Roles come from the credential row; the `CHECK` constraint and the closed union type both bound the role set; the supervisor-authorisation model (bolt 002) adds the fresh-authentication requirement on top of the session. |
| **FR-18 (operator identification and traceability)** | `OperatorStamp` is taken once, at the moment of the action, and is what units 003 and 006 read. They never re-derive it, so a later rename cannot rewrite a historical record. |
| **NFR-11 (externalised text)** | The sign-in error string is a fixed API code (`AUTHENTICATION_FAILED`), and all operator-facing text lives in the UI's locale bundle (unit 007). The API emits codes, not prose. |
| **NFR-01 (≤ 200 ms weight lag)** | Not binding on this unit. Sign-in is a once-per-shift operation, not in the weight path. **Explicitly**: the identity check must never sit in the 10 Hz weight stream. |
| **NFR-05 (survives immediate power loss)** | `better-sqlite3` in WAL mode with `synchronous = FULL` for the credential and operator tables. A session row lost to a power cut costs one sign-in; a **credential** row lost would lock an operator out permanently, so credential writes are the ones that must be durable. |
| **NFR-03 (weighing available during outage)** | Not binding on this unit. Identity is local — there is no network dependency, so an OrgaTEX outage cannot affect sign-in. This is a consequence of the `LOCAL` provider and would NOT hold if the source became a remote directory. Recorded because it is a property the product depends on. |
| **DR-01 (≥ 5-year retention)** | Does **not** apply to this unit's data. Operators and credentials are retained indefinitely (they are live operational data, not records of what was weighed). Sessions are retained only until expiry plus a short reap window. The audit trail (unit 006) and the weighing record (unit 003) carry the 5-year obligation. Stated explicitly because "everything is retained 5 years" would be the wrong reading of DR-01 for a session table. |
| **NFR-14 / FR-22 (configuration without redeployment)** | Session lifetime is configuration (`identity-config.ts`), not a constant in code. `CQ-02` is unresolved, so the duration must be settable without a rebuild. |

---

## Error Handling

| Error Type | Code | Response |
|------------|------|----------|
| Authentication failed (any cause) | `AUTHENTICATION_FAILED` | `401 { "error": "AUTHENTICATION_FAILED" }` — one body for every cause |
| No session / expired / ended / tampered token | `UNAUTHENTICATED` | `401 { "error": "UNAUTHENTICATED" }` — one body for every cause |
| Malformed request body | `VALIDATION_ERROR` | `400 { "error": "VALIDATION_ERROR", "fields": [...] }` — field-level detail is safe here because it describes the *request*, never the credential store |
| Unknown route under `/api/identity` | `NOT_FOUND` | `404 { "error": "NOT_FOUND" }` |
| Unexpected server fault | `INTERNAL_ERROR` | `500 { "error": "INTERNAL_ERROR" }` — the detail goes to the log, never to the client |

**The two 401 codes are different on purpose.** `AUTHENTICATION_FAILED` is
returned by `sign-in` (the credential was presented and rejected);
`UNAUTHENTICATED` is returned by the endpoints that need a session (no
valid session was presented). Both are ambiguous *within* their code. The
distinction between "your credential was wrong" and "you have no session" is
not sensitive — both mean "you are not signed in" — and keeping them apart
makes the API's behaviour legible to a developer without making it an oracle.

**Validation errors do not leak credential state.** A `VALIDATION_ERROR`
says "the `operatorId` field is required" or "the `secret` field is too
short" — it describes the shape of the request. It never says whether the
operator id exists. A missing `secret` and a too-short `secret` are
validation failures **before** any credential lookup happens, so they cannot
be distinguished from an authentication failure by their content — but they
are distinguishable by status code (`400` vs `401`).

This is a genuine, deliberate exception to the constant-response rule, and it
is worth stating plainly: **a request that is malformed is rejected with
`400` before the credential store is consulted.** An attacker learns only
that their request was malformed — which they already knew — and never
whether the identity exists. The rule "one response for all credential
failures" governs failures *of authentication*; it does not require a
malformed request to be answered as though it were an authentication
attempt.

---

## External Dependencies

| Service | Purpose | Integration |
|---------|---------|-------------|
| **None** | — | — |

This unit has **no external service dependency**. That is deliberate: it is
a leaf unit, and the identity source (`Q-08`) is a *local* concern reached
through the `IdentityProvider` port, not an external integration.

**A `DIRECTORY` provider is deliberately not implemented.** Doing so would
invent a contract for a system that does not exist, which the workbook
forbids. The port exists so the future replacement is possible; the adapter
does not exist because there is nothing to adapt to yet.

---

## Dependency Set Required by Stage 4

Probed against the actual environment (`scripts/probe-runtime-deps.cjs`,
`scripts/probe-kdf.cjs`) rather than assumed:

| Package | Purpose | Status |
|---------|---------|--------|
| `typescript` | Strict-mode compile | **not installed** |
| `express` | HTTP layer | **not installed** |
| `zod` | Request validation | **not installed** |
| `better-sqlite3` | Persistence | **not installed** |
| `vitest` | Test runner | **not installed** |
| `supertest` | API integration tests | **not installed** |
| `decimal.js` | Fixed-point arithmetic (later bolts) | **not installed** |
| `react`, `vite`, `zustand` | UI (bolt 027–028) | **not installed** |

**Argon2id needs no npm package.** Node 26's built-in `crypto.argon2Sync`
provides it, so the memory-hard KDF adds **no native build step** to the
project. This is a material finding: the `argon2` npm package would have
required a native compile, and the tech stack's "no external services, runs
on Windows" promise is better served by the built-in.

### The argon2 API differs from the common npm packages

`crypto.argon2Sync(algorithm, parameters)` takes **different parameter
names** than `argon2` (the npm package) or `argon2-cffi`:

| Field | This design | `argon2` npm package |
|-------|-------------|----------------------|
| password | `message` (Buffer) | `password` |
| salt | `nonce` (Buffer) | `salt` |
| memory | `memory` (KiB) | `memoryCost` |
| iterations | `passes` | `timeCost` |
| parallelism | `parallelism` | `parallelism` |
| output length | `tagLength` | `hashLength` |
| variant | `type` (algorithm arg) | `type` |

Using the npm package's names against Node's API fails with a confusing
error about the "algorithm" argument, because the first positional
argument is the variant, not the password. The `SecretHasher` adapter
encapsulates this in one file, so the difference is contained — but it is
recorded here because it is a trap.

---

## Traceability — stories to design elements

| Story acceptance criterion | Design element |
|---|---|
| Session carries id, displayName, role, method, authenticatedAt | `identity_sessions` table; `sign-in` response |
| Current operator returned to other units | `GET /api/identity/current`; `resolveCurrentOperator` middleware; `OperatorStamp` |
| Sign-out ends the session and authorises nothing | `POST /api/identity/sign-out`; `ended_at` + `ended_cause`; idempotent `200` |
| Expired session authorises nothing, at the boundary | `SessionPolicy.isLive` — `now >= expiresAt` is expired; `UNAUTHENTICATED` |
| Credential store holds only a hash | `credentials.secret_hash`; `Argon2SecretHasher` |
| Failed sign-in indistinguishable | `AUTHENTICATION_FAILED`; `AuthenticationOutcome` single failure shape; **constant-work guarantee** |
| No session → refused, requester anonymous | `requireOperator` middleware; `UNAUTHENTICATED` |
| Token is opaque | 32 random bytes; `token_hash` column; no decode operation anywhere |
| Role is OPERATOR or SUPERVISOR, from the credential | `credentials.role` → `identity_sessions.role`; `CHECK` constraint; closed union type |
| Signing in grants no supervisor privilege | No privilege state on the session row; `SupervisorAuthorisation` is the only carrier of privilege (bolt 002) |

---

## Notes for Stage 3

Two ADR candidates, both surfaced by real findings during this stage rather
than manufactured:

1. **Argon2id via Node's built-in `crypto` rather than the `argon2` npm
   package.** A trade-off between dependency footprint and API stability,
   with a security dimension: the built-in has no native build step and no
   supply-chain surface beyond Node itself.
2. **Session tokens stored as a SHA-256 digest rather than in plaintext.**
   A trade-off between recoverability and blast radius, in the direction of
   limiting the blast radius of a database copy.

Both are decisions that will outlive this bolt and will constrain later
bolts (the audit trail and the weighing record both reference the operator).
Both are worth recording.
