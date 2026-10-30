---
bolt: 001-008-operator-identity
created: 2026-10-30T12:05:00Z
status: accepted
superseded_by: null
---

# ADR-002: Store session tokens as a digest, not in plaintext

## Context

The Stage 1 domain model specified that the session token is **opaque** — a
random, high-entropy value mapped server-side to a session row, carrying no
operator id, role or expiry, and having no `decode` operation anywhere in
the model. That satisfies BRD NFR-12's requirement that a token reveal
nothing about the operator.

But the domain model said nothing about **how the token is stored**. That
was an unexamined gap, and it is the kind of gap that decides things by
accident rather than by decision.

The session table is a table of **live credentials**. Anyone who obtains it —
by copying a database file, by pulling a backup, by reading a support
bundle, by a misconfigured log of a query — holds a set of tokens that
authorise actions as whichever operator was signed in when they were issued.
Unlike a password, a session token needs no cracking: it is used verbatim.

The project's data model has a strong retention and immutability discipline
(DR-01 five-year retention, DR-02 immutability of confirmed records), and
it stores weighing records for years. The session table is explicitly
*excluded* from that retention — a session is not a record of what was
weighed, and is reaped after expiry. So the session table is short-lived,
which makes it a natural target: it holds high-value, short-lived
credentials.

## Decision

Store **only a digest** of the session token in `identity_sessions.token_hash`.
The raw token is returned to the client exactly once, in the `sign-in`
response body, and is **never persisted**.

```text
client presents token  ──►  SHA-256(token)  ──►  lookup by token_hash
```

The digest is SHA-256, deliberately **fast**. It is a lookup key for a
256-bit random value, not a low-entropy secret — there is nothing to
brute-force, so a slow KDF would add latency to *every authenticated
request* and buy no security.

The `token_hash` column is `NOT NULL UNIQUE`. The uniqueness guarantee
means two sessions can never share a token, even in the astronomically
unlikely event of a random collision.

### What this does NOT change

The **opaque-token property is unaffected**. That property is about what a
reader of the token can learn: a 256-bit random value reveals nothing about
the operator whether it is stored raw or hashed. Hashing it adds a second,
independent protection — it protects the *server's copy*, not the token's
structure.

### What this does change

The token cannot be recovered from the database. If a client loses its
token, the operator signs in again. This is acceptable: the client holds
the token, and the session is short-lived by design.

## Rationale

**Why a digest rather than plaintext.** The blast radius of a stolen table
drops from "every live session in it" to "nothing usable". A session table
is copied far more casually than a credential table — it is a small,
frequently-backed-up, frequently-queried table, and support and diagnostic
routines touch it routinely. The credential table justifies hashing because
passwords are low-entropy and guessable. The session table needs it for a
different reason: the tokens are high-entropy and unguessable, so a digest
costs nothing in attack resistance but limits what a copy can do.

**Why SHA-256 and not Argon2.** Argon2id (see ADR-001) is right for the
*credential* path, where the input is a human-chosen password with low
entropy. The session token is 32 bytes from `crypto.randomBytes` — 256 bits
of entropy. There is no search space to attack: an attacker who has the
digest cannot brute-force their way to a preimage. A slow KDF here would
add ~55 ms to every authenticated API call in the product — including the
10 Hz weight path's authorisation check — to defend against an attack that
is already infeasible.

**Why not a keyed hash (HMAC)?** An HMAC with a server secret would also
resist a stolen-table attack, and would additionally mean a stolen table
cannot be used for offline token *guessing* even if the token space were
small. It was rejected because the token space is not small, the extra
secret introduces its own rotation problem, and SHA-256 over 256 bits of
entropy is already sufficient.

**Why the token is in the `Authorization` header rather than a query
parameter.** A query parameter ends up in server access logs, in `Referer`
headers and in browser history. The `Authorization` header does not. This is
part of the same decision: keeping live credentials out of places they leak.

**Why not a cookie.** A cookie would give `HttpOnly` and `SameSite`
protection, and would keep the token out of JavaScript's reach. It was
rejected for now because the SPA (`:5173`) and the API (`:3000`) are on
different origins with CORS enabled, and a cross-origin cookie introduces a
CSRF surface. A bearer token avoids CSRF entirely. **This choice is
provisional**: if the SPA is served same-origin in production, a cookie
becomes better and this decision should be revisited. That is recorded in
the Operations context rather than settled here, because the deployment
topology is not yet known.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **Plaintext token in the table** | Simplest; token recoverable for support | A stolen table = every live session, usable verbatim | The session table is copied and backed up routinely; its contents are high-value and short-lived |
| **SHA-256 digest (chosen)** | Fast lookup; no plaintext at rest; no extra dependency | Token not recoverable from the DB | Nothing at a cost worth paying |
| **HMAC-SHA-256 with a server secret** | Also resists offline token guessing; digest not usable across environments | Introduces a secret with its own rotation and storage problem; no benefit at 256 bits of entropy | Protects against an attack that is already infeasible |
| **Argon2id digest** | Matches the credential path's KDF | ~55 ms per authenticated request; pointless for a 256-bit random value | Performance cost on every request, including the weight path, for no security gain |
| **Store a hash of the session id instead of the token** | Same benefit | Slightly less direct | No advantage; the token *is* the credential |
| **Signed token (JWT) containing the operator id** | Stateless; no lookup | **Violates the opaque-token requirement** (BRD NFR-12) — the token would be decodable to reveal the operator | Directly forbidden by the story and by the domain model |
| **Cookie instead of the bearer header** | HttpOnly; SameSite; token not readable by JS | CSRF surface on a cross-origin setup | Provisional — revisit when the deployment topology is known |

## Consequences

### Positive

- **A stolen, copied or backed-up session table yields nothing usable.**
  The blast radius of that exposure is reduced from "every live session" to
  "nothing".
- The token **cannot leak through a query log**, an access log, or a
  diagnostic dump of the session table.
- **No cost on the request path.** SHA-256 over a short input is
  microseconds; authenticated requests stay fast, including the 10 Hz
  weight path's authorisation check.
- **One fewer secret at rest.** The `token_hash` column holds a digest, so
  "no plaintext secret anywhere in the database" is true of the session
  table as well as the credential table.
- The `UNIQUE` constraint on `token_hash` guarantees token uniqueness at
  the storage layer, not merely by generation discipline.

### Negative

- **A lost token cannot be recovered.** The operator signs in again. For a
  single-operator terminal this is a non-issue; it would matter for a
  support workflow that revives a session by hand.
- **"Clear all sessions" now means deleting rows**, which removes the
  record that a session existed. A session that is ended keeps its
  `ended_at` and `ended_cause`; a *deleted* session leaves no trace. This
  is acceptable because the session table is not an audit trail — the audit
  trail (unit 006) records the sign-in and sign-out events independently,
  and the weighing record (unit 003) carries the operator stamp.
- The digest is a **one-way function**, so a row cannot be inspected to
  determine which token it belongs to. This is the point, but it does make
  the table less legible to a human debugging it.

### Risks

- **Risk: a future developer adds a column storing the raw token for
  "support convenience".** *Mitigation*: this ADR, and the domain model's
  statement that the token is never persisted. The raw token exists only in
  the sign-in response.
- **Risk: a future developer adds a lookup by raw token** (e.g. to
  "support" a token pasted from a log). *Mitigation*: the repository
  interface exposes only `findByToken`, which hashes before looking up. A
  second, raw-token path would have to be written deliberately.
- **Risk: the digest leaks the token's randomness quality.** If the token
  generator is ever weakened to a predictable value, the digest would let an
  attacker confirm a guessed token offline. *Mitigation*: the token is
  32 bytes from `crypto.randomBytes`, generated by a dedicated component
  (`SessionTokenGenerator`), and the domain model forbids a decode path.
- **Risk: the bearer token is held by client-side JavaScript**, so an XSS
  elsewhere in the SPA could read it. *Mitigation*: this is inherent to a
  bearer-token design and is one of the reasons the cookie option should be
  revisited if the topology becomes same-origin. The SPA's own XSS posture
  is unit 007's concern.

## Related

- **Stories**: `001-sign-in-at-terminal`
- **Bolt**: `001-008-operator-identity` (unit `008-operator-identity`)
- **Requirements**: FR-18 · BRD NFR-12, BRD FR-34
- **Standards**: `memory-bank/standards/tech-stack.md` — the stack describes
  the token as "opaque" but does not specify its stored form; this ADR
  closes that gap.
- **Previous ADRs**: ADR-001 (the credential path's KDF — note the
  deliberate contrast: Argon2id for the credential, SHA-256 for the
  session token, for different reasons)
