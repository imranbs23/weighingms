---
unit: 008-operator-identity
bolt: 001-008-operator-identity
stage: test
status: complete
updated: 2026-10-30T13:30:00Z
---

# Test Report - Operator Identity

## Test Summary

| Category | Passed | Failed | Skipped | Coverage |
|----------|--------|--------|---------|----------|
| Unit | 133 | 0 | 0 | 94.0% |
| Integration | 71 | 0 | 0 | 97.5% |
| Security | 20 | 0 | 0 | - |
| Performance | 0 | 0 | 0 | - |
| **Total** | **224** | **0** | **0** | **96.25%** |

Coverage is measured across the whole of `src/` with the v8 provider, not
per category. The per-category figures above are the share of each
category's own files reached by that category's tests; the authoritative
number is the **96.25% statements / 90.05% branches / 98.58% functions /
96.75% lines** for the unit as a whole, against a threshold of 80% on all
four.

**Performance: deliberately not covered in this bolt.** The identity unit
has no throughput or latency requirement of its own — it is a
sign-in-and-check-our-session service called a handful of times per
weighing, not the 10 Hz weight path. The one performance property that
*does* matter here is the **timing class** of a failed sign-in, and that is
tested as a security property (S1 below), not as a throughput target.
Recording a p95 target against a service with no such requirement would
manufacture a number that means nothing.

**Test files**

| File | Tests | What it covers |
|------|-------|----------------|
| `tests/unit/session-policy.test.ts` | 7 | The expiry boundary |
| `tests/unit/value-objects.test.ts` | 40 | The type-level invariants |
| `tests/unit/domain-entities.test.ts` | 20 | Entities and published events |
| `tests/unit/credential-service.test.ts` | 10 | The only scope a plaintext secret exists in |
| `tests/unit/identity-config.test.ts` | 15 | Configuration parsing and rejection |
| `tests/unit/local-identity-provider.test.ts` | 12 | The constant-work provider |
| `tests/unit/persistence.test.ts` | 29 | Round trips, schema constraints, migrations |
| `tests/integration/identity-api.test.ts` | 25 | The acceptance criteria, end to end |
| `tests/integration/identity-api-edge-cases.test.ts` | 31 | Malformed requests, token extraction, re-sign-in |
| `tests/integration/api-surface.test.ts` | 15 | CORS, the error handler, the protected route |
| `tests/security/identity-security.test.ts` | 20 | S1–S4, the four security properties |

## Acceptance Criteria Validation

Story `001-sign-in-at-terminal` — all ten criteria.

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| AC 1 | An `IdentitySession` is established carrying `id`, `displayName`, `role`, `method` and `authenticatedAt` | ✅ | `identity-api.test.ts` → *establishes a session carrying the operator identity* asserts the exact response shape; `domain-entities.test.ts` → *OperatorSignedIn carries the session, operator, role and method* |
| AC 2 | The current operator is returned to other units | ✅ | `identity-api.test.ts` → *returns the operator for a valid session*; `api-surface.test.ts` → *reports the signed-in operator* (the protected route other units will copy) |
| AC 3 | Sign-out ends the session; it authorises nothing afterwards | ✅ | `identity-api.test.ts` → *ends the session so it authorises nothing afterwards*, *is idempotent*, *succeeds with an unknown token*; `persistence.test.ts` → *ENDS a session — it never deletes the row* |
| AC 4 | An expired session authorises nothing | ✅ | `session-policy.test.ts` → *is EXPIRED exactly at the expiry instant* (the inclusive boundary); `identity-api.test.ts` → *refuses a session AT the expiry instant*, *still allows a session one millisecond before expiry* |
| AC 5 | The credential store holds only a memory-hard KDF hash, never a plaintext secret | ✅ | `identity-security.test.ts` → *stores argon2id hashes, not the secret*, *uses a DIFFERENT salt per credential*, *uses the FULL cost profile from ADR-001*; `persistence.test.ts` → *stores the hash and NEVER a plaintext secret* |
| AC 6 | A failed sign-in is identical in response **and timing class** | ✅ | `identity-security.test.ts` → *returns identical STATUS*, *returns a BYTE-IDENTICAL body*, *does not disclose existence through response TIMING*, *performs a verification on the unknown-operator path* |
| AC 7 | An operator-only action is refused when there is no session | ✅ | `identity-api.test.ts` → *refuses an anonymous request*; `api-surface.test.ts` → *refuses an expired session*, *refuses a session whose operator has been deactivated* |
| AC 8 | The session token is opaque and cannot be decoded | ✅ | `identity-security.test.ts` → *does not decode to the operator*, *is stored as a digest, never in plaintext*; `value-objects.test.ts` → *has NO decode operation — the value is opaque* |
| AC 9 | The role is determined by the credential, never by the request | ✅ | `identity-security.test.ts` → *ignores a role requested in the body*, *a SUPERVISOR credential yields the SUPERVISOR role*; `identity-api.test.ts` → *ignores a client-requested role*, *ignores a client-requested role of supervisor in any casing* |
| AC 10 | Signing in grants no supervisor privilege | ✅ | `identity-security.test.ts` → *signing in grants NO supervisor privilege on its own*; the privileged path itself is story `002`, correctly out of scope here |

Story `002-authorise-privileged-action-as-supervisor` — **not in this bolt**.
It is assigned to bolt `002-008-operator-identity` and is not implemented
yet. Nothing in this bolt claims to satisfy it.

## Unit Tests

**The expiry boundary (7 tests).** The boundary is the interesting case:
the story says a session "expires exactly at `expiresAt`", so a session
live at the instant of expiry would be live for one instant too many. The
tests pin all three points — `expiresAt - 1ms` is live, `expiresAt` is
expired, `expiresAt + 1ms` is expired — and assert that `remainingLifetime`
never returns a negative number. `SessionPolicy` also keeps *ended* and
*expired* apart: an ended session was ended early, which is a different
fact, and conflating them would make the reaper delete live sessions.

**The type-level invariants (40 tests).** These are the tripwires. If
someone later adds a `decode()` to `SessionToken`, or a public constructor
to `SecretHash`, or a field to `AuthenticationFailure`, these tests fail
and the change has to be argued for. The `SessionToken` test inspects the
prototype's own property names for `decode`, `payload`, `claims`, `parse`
and `verify` — the check is against the *shape of the type*, not against
today's behaviour. `AuthenticationFailure.create()` is tested to **throw**
if given any reason other than the single permitted one, so the
identity-oracle defence cannot be weakened by adding a field.

**The entities and events (20 tests).** `Operator` and `IdentitySession`
are immutable — `deactivate()`, `rename()` and `end()` return new
instances, and the tests assert the original is unchanged. This matters
because a consumer holding a reference must not see it change underneath
them.

The event tests cover the identity-oracle defence's *second* front. The
HTTP response is careful to carry one failure body; the **event stream**
must be equally careful, or anyone with read access to the audit trail
could enumerate operators even though the response cannot. A test asserts
that `SignInRefused` carries exactly one reason (`INVALID_CREDENTIAL`) and
exactly one presented id. A further test serialises **every** published
event and asserts none of them contains the substring `token`, `secret`,
`argon2` or `$argon2id$` — a token or hash in an event would land in an
audit trail that unit 006 owns and that may be shipped elsewhere.

**The credential service (10 tests).** Tested against a recording double,
because what is under test is the *service's* behaviour — that it hashes
before it stores, that it delegates verification, and that the plaintext
never reaches the repository. The real Argon2 implementation is covered
separately by the security suite; testing it again here would only slow
the suite down.

**The configuration (15 tests).** The session lifetime is a configuration
value rather than a constant because `CQ-02` — whether identity is
established per shift or per weighing — is unresolved. The dangerous case
is a **silently-defaulted bad value**: a typo in a deployment's
environment variable would produce a lifetime of zero and every sign-in
would fail in production with nothing at startup to explain why. The tests
therefore assert that a non-numeric, zero or negative value is **rejected**
with an explicit error, not defaulted.

**The constant-work provider (12 tests).** The provider is the adapter
that would be *replaced* if `Q-08` resolves to FCI supplying a directory,
so these tests pin the behaviour that must not change when it is. They
assert the provider's **control flow**: that the unknown-operator path,
the operator-with-no-credential path and the wrong-secret path each
perform exactly one verification; that the dummy hash is computed **once**
at construction (recomputing it per request would make the unknown path
*slower* than the known one — the opposite of what the guarantee needs);
and that *every* candidate credential is verified rather than stopping at
the first match, because the number of verifications must not depend on
*which* credential matched.

**The persistence adapters (29 tests).** Run against a real SQLite
database, not a mock — the properties under test are properties of the
adapters and the schema, and a mock would only prove the mock agrees with
itself. Round trips, the CHECK and FOREIGN KEY constraints, the UNIQUE
token hash, the "ended, never deleted" behaviour, and the fact that a
token is not recoverable from the stored row. The migration tests use a
**file-backed** database, because an in-memory database cannot demonstrate
idempotency: reopening one gives a *different, empty* database.

## Integration Tests

71 tests across three files, all against the real stack — real Argon2id,
real SQLite, real Express, through Supertest.

**The acceptance-criteria suite (25 tests)** maps one-to-one onto the
story's criteria, so a failure names the criterion it breaks. It covers
sign-in, the current operator, sign-out, expiry at three points, the
protected route, role authority, the session endpoint, the health check
and the 404.

**The edge-case suite (31 tests)** covers the branches a well-behaved
client never reaches but an attacker or a confused consumer will:
malformed requests, the sign-out body fallback, every way a bearer token
can be absent or unusable, and re-sign-in.

Two results here are worth stating explicitly:

- **A validation error does not disclose whether the operator exists.**
  The same malformed request against a known and an unknown operator
  produces a **byte-identical** response. The request shape is rejected
  before the credential store is consulted, so the store is never asked a
  question the caller could read the answer to.
- **The previous session is *ended*, not deleted.** The test asserts the
  row remains, carrying `ended_at` and `ended_cause = 'REPLACED'`. A
  deleted session would leave no trace that it ever existed.

**The API-surface suite (15 tests)** covers the shared HTTP shell that
every later unit inherits: CORS, the error handler, and the protected
route shape.

CORS is tested because the session token is a **bearer credential**: if a
wildcard origin could read a response, any page the operator visited could
exfiltrate their token. The tests assert that a configured origin is
allowed, an unknown origin is **not**, and no response ever carries `*`.

The error handler is tested for the same reason in reverse: the detail
goes to the log, never to the client. A test throws an error carrying
`secret internal detail: /var/data/weighingms.sqlite` and asserts the
response is a bare `{ "error": "INTERNAL_ERROR" }` containing neither the
message nor the path, while the detail **is** present in the log. The real
application is also tested with an oversized body, confirming the body
parser's own message never crosses the boundary.

## Security Tests

20 tests covering the four properties the unit brief calls "the tightest
security requirement in the build". A defect here is not a usability bug,
it is a compliance breach.

**S1 — a failed sign-in does not disclose whether the identity exists.**
In the response body, in the status, *and* in the timing class.

| Aspect | Assertion |
|--------|-----------|
| Status | Identical for unknown-operator and wrong-secret (both 401) |
| Body | **Byte-identical** — `{"error":"AUTHENTICATION_FAILED"}`, one key, no discriminating field |
| Deactivated | Byte-identical to the unknown-operator body |
| Timing | Median ratio of the two paths < 2.5 |
| Work | A counting hasher proves a verification happens on the unknown path |

The timing test is the one that needed judgement. It asserts an **order
of magnitude**, not equality: a single-threaded Node cannot fully equalise
two *concurrent* requests, so requiring exact equality would make the test
flaky for a reason that is not a defect. What matters is that neither path
is an order of magnitude cheaper than the other.

**The measured margin is comfortable, not marginal.** The raw KDF timings
were measured directly, outside the test harness:

```
wrong-secret median: 12.25 ms
unknown-op  median: 12.42 ms
ratio: 1.014   (threshold 2.5)
```

The two paths are within **1.4%** of each other against a threshold of
2.5. The timing test was also run 10 consecutive times and passed 10/10.

**S2 — the session token is opaque and not recoverable.** The token is not
a JWT (no `.` separators), does not contain the operator id or display
name, does not decode to JSON, and is stored as a 64-character hex
SHA-256 digest that differs from the token. Two sessions never share a
token.

**S3 — the credential store holds no plaintext secret.** The stored hash is
`$argon2id$`-prefixed; it does not contain the secret; each credential has
a **different salt**, so the table is not one precomputed set; hashing the
same secret twice yields different hashes; a correct secret verifies and a
wrong one does not; and the shipped cost profile is the documented one
(**19 MiB, 2 passes, parallelism 1, 32-byte tag**) — asserted against
ADR-001, not against the reduced profile the tests use for speed.

**S4 — the role is determined by the credential, never by the request.** A
`role: 'SUPERVISOR'` in the request body is ignored; a SUPERVISOR
credential yields the SUPERVISOR role; signing in grants no supervisor
privilege; and the database's CHECK constraint rejects a role outside the
set — so the role set is enforced by the type system *and* by the storage
layer.

**The `Q-08` seam.** A test builds the module with an injected
`DIRECTORY` stub provider and confirms the API contract is unchanged — a
failed sign-in still returns `401 { "error": "AUTHENTICATION_FAILED" }`.
If FCI supplies a directory, only the provider changes.

## Coverage Report

| Layer | Statements | Branches | Functions | Lines |
|-------|-----------|----------|-----------|-------|
| `domain/entities` | 100% | 100% | 100% | 100% |
| `domain/events` | 100% | 100% | 100% | 100% |
| `domain/services` | 95.1% | 88.9% | 96% | 96.3% |
| `domain/value-objects` | 100% | 100% | 100% | 100% |
| `infrastructure/config` | 100% | 100% | 100% | 100% |
| `infrastructure/persistence` | 96% | 94.4% | 100% | 95.6% |
| `infrastructure/security` | 92% | 55.6% | 100% | 91.7% |
| `infrastructure` (composition root) | 93.8% | 75% | 66.7% | 100% |
| `presentation/controllers` | 88.5% | 85.7% | 100% | 88.5% |
| `presentation/middleware` | 100% | 100% | 100% | 100% |
| `presentation/schemas` | 100% | 100% | 100% | 100% |
| `api` | 96.7% | 83.3% | 100% | 100% |
| **Total** | **96.25%** | **90.05%** | **98.58%** | **96.75%** |

Coverage totals: 463/481 statements, 163/181 branches, 139/141 functions,
447/462 lines.

**What is deliberately excluded.** `src/**/domain/ports/*.ts` are excluded
from the measurement. They are TypeScript interfaces with no runtime
code, so the v8 provider reports them as 0% covered — a measurement
artefact, not a gap. Their contracts are exercised through the adapters
that implement them.

**What remains uncovered, and why it is acceptable.**

- `infrastructure/security/argon2-secret-hasher.ts` — 55.6% branch
  coverage. The uncovered branches are the `timingSafeEqual` fallback for
  digests of **different lengths**, which cannot occur: a stored hash and
  a computed hash are always the same length. The branch exists for
  safety, not because it is reachable.
- `presentation/controllers/identity-controller.ts` — 88.5%. The
  uncovered lines are the defensive branches: a session that was created
  but cannot be resolved, and a session token that cannot be constructed
  from the body. Both are unreachable through the API without a defect
  elsewhere; they exist so that a defect elsewhere produces a refusal
  rather than a half-populated response.
- `infrastructure/composition-root.ts` — 66.7% function coverage. The
  uncovered branch is the composition root's default-provider path when
  no provider is injected; the injected path is the one the seam test
  exercises.

## Issues Found

| Issue | Severity | Status |
|-------|----------|--------|
| The test suite failed once on its first execution with a Vitest-internal `Cannot read properties of undefined (reading 'config')`, raised in the reporter for all four test files before any project code ran | Medium | **Fixed** — see below |
| `require()` was used inside an ESM test module (`"type": "module"`), which cannot work at runtime | Medium | **Fixed** — replaced with a static `import` |
| The coverage threshold was initially **not met** (75.75% statements, 70.16% branches) | Medium | **Fixed** — the gaps were real: the domain events, the configuration parser, the credential service, the provider's control flow and the persistence round trips were untested. Closing them raised coverage to 96.25% / 90.05% |
| The `SecretHash` comparison test used a malformed replacement string and threw `Malformed encoded secret hash` | Low | **Fixed** — replaced with a well-formed hash at a different work factor |
| The persistence test asserted a synchronous throw from an `async` repository method | Low | **Fixed** — changed to `rejects.toThrow` |
| The migration-idempotency test reopened an in-memory database, which creates a *different* empty database and so tested nothing | Low | **Fixed** — rewritten against a file-backed database, plus a second test asserting data survives a reopen |
| The `RecordingHasher` double used the same encoded string for the dummy hash and a real hash, so the dummy-path assertions could not distinguish them | Low | **Fixed** — the dummy hash now has its own distinct encoded value |

**On the first-execution failure.** The very first run of the suite failed
in all four test files with a Vitest-internal error, before any project
code had executed. It did not reproduce: the suite then passed **17
consecutive runs**, including 8 deliberately cold-cache starts, and
neither `node:sqlite`, `crypto.argon2Sync` nor Express reproduced it in
isolation. The fault is therefore in Vitest 5's parallel worker pool on
this Windows host, not in the code under test.

The decision was to **disable file-level parallelism** (`fileParallelism:
false` in `vitest.config.ts`) rather than to hope. This is a security
suite whose entire value is that it is trustworthy, and a green run that
might have been red is worse than a slow one. The whole suite takes about
two seconds, so serialising the files costs nothing that matters. The
reasoning is recorded in the config file itself, with a note to revisit
when Vitest 5.x is upgraded.

### Issues deliberately NOT fixed

| Issue | Why it is left |
|-------|---------------|
| A single-threaded Node cannot fully equalise the timing of two **concurrent** failed sign-ins | A structural property of the runtime, not of this code. Documented in the technical design, in the provider's own source comment, and in this report. The order-of-magnitude property — which is what defeats practical enumeration — holds, and is measured at a ratio of 1.014 |
| `better-sqlite3` is not used; `node:sqlite` is | `better-sqlite3` cannot be installed here (no node-gyp, no Visual Studio C++ toolchain). Recorded as a deviation from the approved tech stack and in ADR-001's sibling argument |
| The `argon2` npm package is not used; `crypto.argon2Sync` is | ADR-001, accepted. Node's built-in Argon2id removes a native-build dependency from a product that must run offline on the customer's Windows machines |
| The bearer-token-vs-cookie decision is not written as an ADR | It flips if the SPA becomes same-origin. Recorded in ADR-002's Risks and pointed at Operations, where the deployment topology is decided |

## Verification Beyond the Test Suite

The suite is not the only evidence. `scripts/verify-implementation.cjs`
starts the **real server** and exercises it over HTTP — 15 checks, all
passing: the token is 43 characters and opaque, the two failure bodies are
byte-identical, a client-supplied role is ignored, both 401 bodies are
identical, sign-out is idempotent and the session authorises nothing
afterwards, and all credentials are stored as Argon2id hashes with no
plaintext while all session rows store a SHA-256 digest rather than the raw
token.

`npx tsc --noEmit` passes with the strict configuration (`strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitReturns`, `noFallthroughCasesInSwitch`,
`noPropertyAccessFromIndexSignature`, `useUnknownInCatchVariables`,
`verbatimModuleSyntax`).

## Ready for Operations

- [x] All acceptance criteria met — 10/10 for story `001`, verified above
- [x] Code coverage > 80% — 96.25% statements, 90.05% branches, 98.58% functions, 96.75% lines; the threshold gate passes on all four
- [x] No critical/high severity issues open — every issue found in this stage is fixed; the four deliberately-open items are documented above and none is a defect
- [x] Performance targets met — no throughput or latency target applies to this unit; the timing-class property that does apply is measured and passes at a ratio of 1.014
- [x] Security tests passing — 20/20, covering S1–S4 and the `Q-08` seam

**One thing this bolt does not deliver.** Supervisor authorisation — story
`002-authorise-privileged-action-as-supervisor` — is **not** implemented.
It is assigned to bolt `002-008-operator-identity`. The privileged path
requires a different person, a fresh authentication at the point of the
action, and a reason; the domain model established here carries the
`Operator`, `Credential` and `IdentitySession` that story will build on,
but the authorisation itself is out of scope for this bolt and this report
makes no claim about it.
