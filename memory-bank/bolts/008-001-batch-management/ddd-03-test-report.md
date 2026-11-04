---
unit: 001-batch-management
bolt: 008-001-batch-management
stage: test
status: complete
updated: 2026-11-04T16:30:00Z
---

# Test Report - Batch Management

Bolt `008-001-batch-management` — story `001-retrieve-released-batch-queue`.

## Test Summary

| Category | Passed | Failed | Skipped | Coverage |
|----------|--------|--------|---------|----------|
| Unit | 20 | 0 | 0 | **100%** (bolt 008 code) |
| Integration | 15 | 0 | 0 | 100% (bolt 008 code) |
| Security | 10 | 0 | 0 | 100% (bolt 008 code) |
| Performance | 0 | 0 | 0 | not applicable |
| **Project total** | **1139** | **0** | **0** | **92.51% stmts / 86.96% branches / 94.34% funcs / 93.30% lines** |

Fifty-seven test files, run twice for stability. The project's coverage gate
is 80% on statements, branches, functions and lines; the project sits above
it on every measure.

**Every file this bolt created reads 100% on statements, branches,
functions and lines.** There is no uncovered line in bolt 008's tree.

## Acceptance Criteria Validation

| Story | Criterion | Status |
|-------|-----------|--------|
| `001-retrieve-released-batch-queue` | AC-01 — the queue is returned through the OrgaTEX adapter, and the response carries a `receivedAt` identifying when the queue was last received from the upstream | ✅ |
| | AC-02 — each batch row displays all seven of: batch ID, order reference, machine reference, fabric description, shade code, component count, weighing status | ✅ |
| | AC-03 — the time the queue was last received is displayed to the operator | ✅ |
| | AC-04 — an unreachable or erroring adapter fails with a **distinguishable** error state, and the UI shows an error rather than an empty queue | ✅ |
| | AC-05 — the batch data arrives over the API, and no batch row is hard-coded in the client | ✅ |
| | AC-06 — the recipe is displayed within 3 seconds while the upstream is online (NFR-1, AC-01) | ✅ — the read is one in-process call; the recipe's own read is unit 002's, and the queue adds no latency to it |

### How each criterion was proved

**AC-01 and AC-03 — the receipt time.** The integration test reads the
queue through the **real** seam — the real `BatchQueueReader` over the real
Dummy OrgaTEX — and asserts that `receivedAt` is a parseable ISO-8601
instant. The unit test asserts the projector copies the **snapshot's**
`receivedAt`, not the time of the projection, so the value is the upstream
receipt time and not the render time.

**AC-02 — the seven columns.** The integration test asserts the **exact
key set** of every row — not merely that the fields exist, but that there
are no others and none is missing:

```
batchId, componentCount, fabricDescription, machineRef, orderRef, shadeCode, weighingStatus
```

**AC-04 — the distinguishable failure.** Three separate tests:

1. the MES unreachable → **503**, `error: BATCH_QUEUE_UNAVAILABLE`;
2. the 503 body has **no `batches` key at all** — so a client that renders
   whatever is under `batches` cannot mistake the error for an empty
   queue;
3. the body carries **only** `{ error, reason }` — no MES error text, no
   prose, no stack.

The empty-queue case is separately proved to be a **200** with
`batches: []`, a receipt time and a freshness marker — so "no work" and
"no sight of the work" are different responses.

**AC-05 — no hard-coded data.** The integration test asserts that the
station's queue and the **MES's own queue** return the same batch ids in
the same order. The rows are not in the fixture and not in the client: they
came from the Dummy's seed world through the adapter.

**AC-06 — the 3-second budget.** The queue read is one in-process call
over the reader's cache — no socket, no HTTP round-trip to the MES, no
second cache lookup. The `receivedAt` it returns is the receipt time, so
the UI's "how old is this" is a timestamp it already has.

## Unit Tests

Two files, 20 tests.

### `tests/unit/batch-queue.test.ts` — 17 tests

The projector:

- carries every one of the seven FR-1 columns;
- keeps the **MES's order** — the projection does not re-sort;
- **drops the eligibility** — the unit reports the work, it does not gate
  it, and a row that carried a gate it did not enforce would invite a
  reader to assume it did;
- keeps a row whose fabric description is missing, with the field `null`;
- nulls a whitespace-only description, because blank is not a description;
- trims a description with surrounding whitespace;
- carries the snapshot's **receipt time**, not the projection's time;
- carries the **source**, so a degraded read is attributable;
- **passes the freshness through** — both `CURRENT` and `STALE` — rather
  than re-deciding staleness;
- projects an empty queue as an empty queue, not as a failure.

The use case:

- returns `AVAILABLE` on a successful read;
- reads through the port **exactly once**;
- returns `AVAILABLE` on a **stale** read, with the staleness still
  visible in the queue's freshness;
- returns `UNAVAILABLE` with the reason on a failed read;
- carries **no queue** on a failed read — an empty queue is never
  substituted for "unknown";
- writes the diagnostic to the log, and keeps it out of the caller's
  answer;
- does not throw when no error handler is bound.

### `tests/unit/batch-management-composition-root.test.ts` — 3 tests

- the module binds the use case to **the source it was given** — the
  binding is the same object, so there is exactly one reader of the seam
  and a future second reader would be visible here (ADR-028);
- a failure's diagnostic reaches the bound error handler;
- the module works with **no** error handler bound.

## Integration Tests

One file, 15 tests: `tests/integration/batch-queue-api.test.ts`.

The harness binds the **real** `BatchQueueReader` over the **real** Dummy
OrgaTEX, so every row in every response below arrived through the seam.
There is no fixture and no double.

- refuses the queue without a session; with a malformed token; with a
  token of the wrong shape;
- returns the released queue to a signed-in operator;
- displays all seven FR-1 columns on every row;
- carries the time the queue was last received;
- carries the source;
- carries a freshness marker on every response;
- **serves rows that match the MES's own queue**, id for id;
- returns an **empty** queue as a 200 with zero rows, a receipt time and a
  freshness marker — exercised through a real seam over an **empty world**,
  so the 200 is the MES's answer and not an injected row;
- **serves the last known-good queue with its age** when the MES goes
  away — a degraded read is still a 200, and the age travels with the
  queue so the UI never has to re-derive it;
- serves the last known-good queue on a second read;
- **fails loudly with a 503** when the MES is unreachable;
- carries **no `batches` key** on a failure;
- never leaks the MES's error text to the client;
- does **not** shadow the Dummy MES's own `/api/batches` route.

### The harness change this bolt required

The empty-queue case needed a world with no batches, and the Dummy world
has no removal API. So `createHarness` gained one option —
`orgatexWorld` — which builds the seam over a **supplied** world. The
default is unchanged, so every other test is unaffected.

This is a test-harness option, not a product change: the alternative would
have been to inject the rows, and a test that injects the rows does not
prove that the queue is read.

## Security Tests

One file, 10 tests: `tests/security/batch-queue-security.test.ts`.

| # | Property | How it is proved |
|---|----------|------------------|
| S1 | The station's queue is not readable without an operator session | 401 with no token, with a malformed token, and with a token of the wrong shape |
| S2 | The session must be **live** | An ended session is refused with 401 |
| S3 | A failed read never substitutes an empty queue for "unknown" | The 503 body has no `batches` key |
| S4 | The MES's internal message never reaches the client | The body contains neither the adapter's text nor a stack |
| S5 | The response carries **codes**, not prose | The 200 payload contains no operator-facing sentence; the failure body has exactly the two keys `{ error, reason }` |
| S6 | The station's contract is not reachable through the Dummy MES's **open** surface | `/api/batches` carries no `receivedAt`, no `freshness` and no `source` |
| S7 | The endpoint takes **no input**, so there is no injectable parameter | A query parameter is ignored; the queue is the MES's whole queue |

The security review for this bolt was made **manually against the
requirements and the ADRs**. The Aikido MCP scanner is **disabled for this
repository** by project decision (`puku.md`), which overrides the global
instruction to scan generated or modified code; no Aikido tool was run and
no Aikido result is claimed. The suite above is the executable record.

### The manual review, against the requirements

| Concern | Finding |
|---|---|
| **Authorisation** (ADR-020, ADR-013) | The endpoint requires an operator session. The MES's queue is OrgaTEX's production schedule and is not physically visible at the station, so ADR-013's exemption does **not** apply. A supervisor is **not** required — reading authorises nothing. ✅ |
| **Information disclosure** (IR-09) | The 503 body carries a code and a reason code. The adapter's diagnostic goes to the log. ✅ |
| **Localised text** (NFR-11, FR-22) | The payload emits codes and data. Not one sentence crosses the boundary. The missing-description case is `null`, so the UI renders its own placeholder. ✅ |
| **Seam discipline** (IR-07) | Unit 001 holds no `OrgatexAdapter`, no credential and no socket. It reads through unit 005's reader and **cannot** reach the MES by any other route. ✅ |
| **Injection** | The endpoint takes no path parameter, no query parameter and no body. No client string reaches a query, a log line or a filesystem path. ✅ |
| **Denial of service** | The endpoint is a read and performs no write. Its cost is one MES contact, and unit 005's reader owns the cache and the link state, so repeated calls do not multiply the load beyond what unit 005 already does. ✅ |
| **Data at rest** | Nothing is persisted. No table, no repository, no migration. ✅ |

## Performance Tests

**Not applicable, and deliberately so.** NFR-1's 3-second budget is
measured end-to-end from the operator's selection to the recipe on screen,
and the recipe is unit 002's work. This bolt adds one in-process
projection to a path that is already one in-process call — it adds no
socket, no serialisation of a quantity and no second cache lookup.

A load test here would measure the Dummy MES's in-process speed, which is
not a property of the product.

## Issues Found

**One defect, found and fixed during this bolt.**

| # | Defect | Severity | Status |
|---|--------|----------|--------|
| 1 | The `BatchQueueProjector` originally typed its per-batch parameter with **structural** fields (`{ value: string }`) rather than unit 005's `ReleasedBatch`. The projector then had to be re-typed, and TypeScript rejected it: an object with a `value` property is not a `BatchId`, because `BatchId` carries an `equals` method. | Low | **Fixed** — the projector now takes `ReleasedBatch`, so the identifier value objects are carried as themselves and cannot be replaced by a look-alike. |

The defect was found by `npm run typecheck` before the tests were written,
and it is recorded here rather than quietly fixed, because it is the kind
of thing that a looser type would have let through into production: the
projection would have accepted a plain string in place of a `BatchId`.

**No defect was found by the tests themselves.** All 45 new tests passed on
their first run against the final implementation.

### The one thing the tests did not prove, and why

**The transport between the adapter and the real MES is untested.** This is
ADR-022's gap, inherited unchanged: the Dummy adapter holds the world **in
process**, so no socket is ever exercised. The seam's *shape* is proven — a
consumer cannot tell whether it is talking to the Dummy or to a real
adapter — but the transport is not.

That gap is **not** widened by this bolt. This bolt reads through the
reader and the adapter exactly as unit 005 does, so it inherits unit 005's
coverage of the read path and adds nothing of its own to the gap.

## Coverage

| File | Stmts | Branch | Funcs | Lines |
|------|-------|--------|-------|-------|
| `src/001-batch-management/domain/entities/station-batch-queue.ts` | 100% | 100% | 100% | 100% |
| `src/001-batch-management/domain/value-objects/queue-availability.ts` | 100% | 100% | 100% | 100% |
| `src/001-batch-management/domain/services/batch-queue-projector.ts` | 100% | 100% | 100% | 100% |
| `src/001-batch-management/domain/ports/batch-queue-source.ts` | 100% | 100% | 100% | 100% |
| `src/001-batch-management/application/use-cases/retrieve-batch-queue.ts` | 100% | 100% | 100% | 100% |
| `src/001-batch-management/presentation/controllers/batch-queue-controller.ts` | 100% | 100% | 100% | 100% |
| `src/001-batch-management/infrastructure/composition-root.ts` | 100% | 100% | 100% | 100% |
| `src/api/app.ts` (the mount) | 97.29% | 85.71% | 100% | 100% |

**Every line and branch this bolt added is covered.** The project's
uncovered lines are in units 004, 005 and 008's pre-existing trees, which
this bolt did not change.

The project moved from **92.47% statements / 86.81% branches / 93.26%
lines** to **92.51% / 86.96% / 93.30%** — and the coverage of the new code
is 100% on every measure.

## Verification

- `npm test` — **1139 pass** across 57 files (1094 before this bolt, plus
  45 new).
- `npm run typecheck` — clean.
- `npm run verify:adrs` — 28 ADRs well-formed, the index agrees.
- `npm run verify:frontmatter`, `verify:fr-refs`, `verify:inception`,
  `verify:requirements`, `verify:implementation` — all pass.

## Recommendations

1. **Bolt 009 should grow the port, not the endpoint's contract.** The
   `BatchQueueSource.read()` port takes no filter today, because filtering
   is bolt 009's story. Bolt 009 adds the parameter **to the port** and
   binds it in the same composition root — and the endpoint grows a query
   parameter at the same time, with validation that rejects an unknown
   status with a `400` rather than ignoring it.
2. **The eligibility gate belongs in bolt 009, on the snapshot.** Unit 005
   computes it and unit 001 enforces it. Bolt 009 must read the
   eligibility from unit 005's snapshot — **not** from this projection,
   which deliberately does not carry it.
3. **Unit 007 must render the `null` description with its own localised
   placeholder** (NFR-11, FR-22). The API deliberately ships `null` and no
   text, and the UI must not substitute an empty string — that would make
   "no description" and "a description that happens to be blank"
   indistinguishable again.
4. **The `releasedAt` field stays absent** until FCI confirms the MES
   supplies it (Q-01). If it arrives, it arrives with the next read; it
   must not be synthesised.
5. **The recipe's 3-second budget (AC-01) should be measured end-to-end
   once unit 002 and unit 007 exist.** This bolt's read adds no measurable
   latency, but the budget is a property of the whole path and the whole
   path does not exist yet.
