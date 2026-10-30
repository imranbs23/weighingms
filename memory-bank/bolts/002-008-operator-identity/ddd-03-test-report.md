---
unit: 008-operator-identity
bolt: 002-008-operator-identity
stage: test
status: complete
updated: 2026-10-30T20:30:00Z
---

# Test Report - Supervisor Authorisation

## Test Summary

| Category | Passed | Failed | Skipped | Coverage |
|----------|--------|--------|---------|----------|
| Unit | 228 | 0 | 0 | 95.2% |
| Integration | 92 | 0 | 0 | 91.7% |
| Security | 20 | 0 | 0 | - |
| Performance | 0 | 0 | 0 | - |
| **Total** | **340** | **0** | **0** | **93.89%** |

Coverage is measured across the whole of `src/` with the v8 provider, not
per category. The authoritative number is **93.89% statements / 89.64%
branches / 95.37% functions / 94.09% lines**, against a threshold of 80% on
all four.

**Performance: deliberately not covered in this bolt.** The authorisation
path is a once-per-exception operation that happens while the weighing is
awaiting a supervisor. It is never in the 10 Hz weight stream — the design
states that explicitly, and NFR-01's 200 ms lag budget does not bind here.
Recording a p95 target against a path with no throughput requirement would
manufacture a number that means nothing.

**Test files**

| File | Tests | What it covers |
|------|-------|----------------|
| `tests/unit/authorisation-value-objects.test.ts` | 44 | The type-level invariants A-1 … A-9 |
| `tests/unit/authorisation-policy.test.ts` | 17 | The pure rules, including the expiry boundary |
| `tests/integration/authorisation-service.test.ts` | 36 | The service, the repositories, the append-only rules |
| `tests/integration/authorisation-api.test.ts` | 19 | The HTTP contract, including ADR-004's uniform refusal |

## Acceptance Criteria Validation

Story `002-authorise-privileged-action-as-supervisor` — all nine criteria.

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| AC 1 | An operator's session alone never authorises a privileged action | ✅ | `authorisation-service.test.ts` → *refuses when the authoriser is not a supervisor* asserts `ROLE_NOT_SUPERVISOR`; `authorisation-api.test.ts` → *requires a signed-in operator* asserts `401` on an anonymous request |
| AC 2 | "Already signed in elsewhere" is not a valid authorisation | ✅ | `authorisation-service.test.ts` → *grants an authorisation when a supervisor authenticates with a reason* — the only path to an authorisation runs a fresh credential verification; there is no session-id path |
| AC 3 | The reason is mandatory | ✅ | `authorisation-service.test.ts` → *refuses a MISSING reason* and *refuses a reason with no letters or digits*; `authorisation-api.test.ts` → *returns the IDENTICAL refusal body for EVERY cause* includes both |
| AC 4 | The authoriser must be a different person; self-authorisation is refused | ✅ | `authorisation-service.test.ts` → *refuses SELF authorisation*; `authorisation-value-objects.test.ts` → *is NOT distinct from the same operator — even a supervisor* |
| AC 5 | Scoped to one action and one subject | ✅ | `authorisation-service.test.ts` → *refuses an authorisation presented for a different ACTION* / *…different SUBJECT*; `authorisation-value-objects.test.ts` → *does NOT match on the action alone* / *…on the subject alone* |
| AC 6 | An expired authorisation authorises nothing | ✅ | `authorisation-service.test.ts` → *refuses an authorisation AT exactly its expiry instant* and *permits an authorisation ONE millisecond before expiry* — the inclusive boundary, tested exactly via the injected clock |
| AC 7 | Single-use | ✅ | `authorisation-service.test.ts` → *refuses a SECOND use — the authorisation is single-use*; the UNIQUE constraint on `authorisation_consumptions.authorisation_id` is asserted directly against the adapter |
| AC 8 | Carries the supervisor's identity, the reason and the time; written to the audit trail | ✅ | `authorisation-service.test.ts` → *publishes a PrivilegeAuthorised event* and *publishes a PrivilegeRefused event for EVERY refusal* |
| AC 9 | Retained ≥ 5 years on audit terms | ✅ | `authorisation-service.test.ts` → *finds EXPIRED authorisations without deleting them* and *refuses to overwrite an existing authorisation — it is append-only* |

## The three defects this stage found

The test suite was not written to prove the implementation correct. It was
written to prove the **invariants** correct, and three implementation
defects fell out of that.

### Defect 1 — `NOT_THE_REQUESTING_OPERATOR` was unreachable

**Severity: high.** ADR-003 requires that a consume request presents the
authorisation id *together with* the live session of "the operator the
authorisation was issued **for**". The implementation checked only that
the applying operator was *distinct from the supervisor*.

**The consequence:** an authorisation raised for operator A could be
applied by operator B. B is not the supervisor, so the distinctness check
passed. The exception granted to A was silently usable by anybody else at
the terminal.

**Why it happened:** `SupervisorAuthorisation` never recorded *who it was
issued for*. The field simply did not exist, so the check could not be
written. The `NOT_THE_REQUESTING_OPERATOR` refusal reason was in the closed
set and unreachable — a symptom that is now covered by a test that asserts
every reason in the set is producible.

**The fix:** `requestedOperatorId` added to the entity, the event, the
table and the repository, plus `isIssuedFor()` and a second check in
`consume`. Migration `005` was edited in place — safe, because no database
had applied it (`scripts/probe-dev-db.cjs` confirms this, and the probe is
kept so the next bolt does not have to assume it).

### Defect 2 — `GET /authorisations/:id` disclosed a supervisor's justification

**Severity: medium.** The design says the endpoint "does not return the
reason to an unauthorised caller" and "if the requester is not the operator
the authorisation was issued for, the endpoint returns `403`". The
implementation checked only "is not the supervisor", so **any other
operator could read the supervisor's justification text** for an exception
raised for somebody else.

**The fix:** the same `isIssuedFor()` check as Defect 1, applied to the
read path.

### Defect 3 — `POST /authorisations` accepted an anonymous request

**Severity: medium.** The story's edge case says the privileged action
attempted with no signed-in operator is "Refused and audited as a
refusal; there is no operator for the authorisation to be distinct from".
The implementation took `req.currentOperator?.id ?? null` and carried on,
so an authorisation could be created with no operator behind it.

**The fix:** the endpoint now requires a live session and returns
`401 UNAUTHENTICATED` without one.

### A fourth, smaller finding — the schema pre-empted the domain

The Zod schema rejected a blank reason as a validation error, which made
the domain's named `REASON_MISSING` refusal unreachable over HTTP. The
story requires a missing reason to be **refused** (`403`), not merely
malformed (`400`) — the refusal is what the audit trail records, and it
needs a name. The schema now validates the *shape* of the reason and the
domain validates its *meaning*, which is the split the two layers already
use elsewhere.

## The refusal matrix — every cause, one response

ADR-004 is the contract this bolt is most careful about. Twelve refusal
causes, one status, one body. The HTTP layer never branches on the reason.

| Cause | Named reason (internal) | HTTP |
|-------|------------------------|------|
| Supervisor credential wrong | `SUPERVISOR_AUTHENTICATION_FAILED` | `403` |
| Supervisor does not exist | `SUPERVISOR_AUTHENTICATION_FAILED` | `403` |
| Authoriser is not a supervisor | `ROLE_NOT_SUPERVISOR` | `403` |
| Supervisor deactivated | `SUPERVISOR_INACTIVE` | `403` |
| Reason missing | `REASON_MISSING` | `403` |
| Reason has no letters or digits | `REASON_NOT_MEANINGFUL` | `403` |
| Authoriser is the requesting operator | `SELF_AUTHORISATION` | `403` |
| No signed-in operator at all | `NO_SIGNED_IN_OPERATOR` | `403` |
| Different operator applies it | `NOT_THE_REQUESTING_OPERATOR` | `403` |
| Wrong action or subject | `OUT_OF_SCOPE` | `403` |
| Expired | `EXPIRED` | `403` |
| Already used | `ALREADY_USED` | `403` |
| Unknown authorisation id | `UNKNOWN_AUTHORISATION` | `403` |
| Malformed request body | *(not a refusal)* | `400` |
| No requester session | *(not a refusal)* | `401` |

`authorisation-api.test.ts` → *returns the IDENTICAL refusal body for
EVERY cause* asserts that five different causes produce byte-identical
bodies, and *refuses with 403 and the generic body — never names the
cause* asserts the body leaks nothing about which control failed.

## What is proved about the storage

| Property | How it is proved |
|----------|------------------|
| The authorisation is append-only | No `update`/`delete` on the port; a second `save` of the same id raises a UNIQUE constraint violation |
| Consumption is a separate fact | The authorisation row has no `consumed_at`; the consumption is its own row, and the authorisation's fields are byte-identical before and after a consume |
| Single-use holds under concurrency | The UNIQUE constraint on `authorisation_consumptions.authorisation_id` is asserted directly against the adapter, not only through the service |
| The reason is stored in clear text | The raw row is read back and compared; hashing it would destroy the audit record (ADR-005) |
| No secret, token or hash leaks | The whole authorisation row is serialised and asserted to contain no secret, no `$argon2` and no token |
| The reason round-trips exactly | `AuthorisationReason.fromStored` re-applies the meaningfulness check, so a corrupted row cannot become a record that appears to carry a justification it does not |

## The expiry boundary, tested exactly

The clock is injected, so the boundary is asserted at the millisecond
rather than approximated with a sleep.

| Instant | Result |
|---------|--------|
| `expiresAt − 1 ms` | live — permitted |
| `expiresAt` | expired — refused |
| `expiresAt + 1 ms` | expired — refused |

The boundary is **inclusive**: at exactly `expiresAt` the authorisation is
already invalid, matching `SessionPolicy`'s treatment of the session
boundary in bolt `001`.

## Success Criteria

- [x] All stories implemented — `002-authorise-privileged-action-as-supervisor`
- [x] All acceptance criteria met — 9/9, validated above
- [x] Tests passing — 340/340; coverage 93.89% statements / 89.64% branches / 95.37% functions / 94.09% lines (threshold 80%)
- [ ] Code reviewed and approved — **awaiting the Stage 5 human checkpoint**
