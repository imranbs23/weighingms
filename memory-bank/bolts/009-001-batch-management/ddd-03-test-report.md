---
unit: 001-batch-management
bolt: 009-001-batch-management
stage: test
status: complete
updated: 2026-11-05T15:20:00Z
---

# Test Report - Batch Management (Bolt 009: Filtering and Selection)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 60 passed, 0 failed |
| **Tests** | **1201 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`) |
| **Coverage (all files)** | 92.42% statements · 86.91% branches · 94.06% functions · 93.22% lines |
| **Coverage threshold** | 80% on all four — **met** |
| **New tests** | **70** (23 unit + 9 unit-persistence + 25 integration + 13 security) |
| **Baseline before the bolt** | 1139 tests, 57 files |
| **Defects found by the tests** | **2**, both fixed (below) |

### The two defects the tests found

Both were found by this bolt's own tests, and **both were fixed at the root
cause rather than in the test**.

---

## Defect 1 — the filter narrowed unit 005's CACHE

**Found by:** `tests/integration/batch-selection-api.test.ts` —
*"still offers every status when a filter is applied"*.

**Symptom:** with `?status=QUEUED` applied, the response's `statuses` array
was `['QUEUED']` instead of `['QUEUED', 'WEIGHING']`.

**Root cause.** The bolt's original design grew `BatchQueueSource` with a
`filter` parameter and pushed the filter into unit 005's reader. Two things
were wrong with that, and the test caught only the first:

1. **The option set.** The statuses the operator may filter **to** must
   come from the **whole** queue. A read that arrives already filtered
   cannot supply them — so applying a filter collapsed the control's
   options to the one status being filtered by. The control became a
   **one-way door**: the operator could narrow the queue and never widen it
   again.

2. **The cache — and this one is worse.** Unit 005's reader **caches the
   snapshot it built**, and that snapshot is the one it was asked for. A
   filtered read would put a **filtered** queue into that cache, and the
   reader's DEGRADED fallback would later serve that partial queue as
   though it were the whole released schedule. The operator would see
   three `QUEUED` batches and believe that was all the work on offer.

**The fix.** The filter was removed from the seam entirely:

- `BatchQueueSource.read()` takes **no parameter** — the port's shape is
  the enforcement, so the next implementer cannot reintroduce the defect.
- The whole queue is read, and the filter is applied to **this unit's own
  rows**, after the projection.
- The statuses are computed from the **unfiltered** queue.

Unit 005's own filtering (BRD IR-01) is **untouched** — the reader still
accepts a filter, passes it to the adapter and re-applies it. This unit
simply does not use that capability, because it needs the whole queue.

**The rule that came out of it:** *the filter is a view over the whole
queue, and a view is never a gate.* It is recorded in the port's
docstring, in the use case, and in the design.

**How it is now proved:** the integration test asserts that every status
present in the queue is still offered when a filter is applied; the
composition-root test asserts the source is read with **no** filter; and
the unit test asserts the option set is derived from the unfiltered queue.

---

## Defect 2 — "the active selection" was arbitrary within a millisecond

**Found by:** `tests/integration/batch-selection-api.test.ts` —
*"SUPERSEDES the previous selection when a new one is made"*.

**Symptom:** after selecting `B-24188` and then `B-24190`, `GET
/api/selection` still reported `B-24188`.

**Root cause.** The row's identifier was a `randomUUID()`, and the active
selection is `ORDER BY selected_at DESC, id DESC`. Two selections made in
the same millisecond — which the harness's fixed clock makes certain —
therefore had their tie broken **at random**. The "latest" selection was
whichever UUID sorted higher, which is not the selection that happened
last.

This is a **correctness** defect and not a test artefact: the tie-breaker
exists precisely for the case where two acts coincide, and answering it
randomly means the crumb could show a batch the operator had already
moved on from.

**The fix.** The identifier is now the **insertion sequence** —
`INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT` — so the tie is broken in
the order the acts **happened**. This is the same mechanism unit 005's
`link_transitions` already uses.

**How it is now proved:** the persistence test asserts that two selections
in the same millisecond resolve to the same answer on every read (the
answer is deterministic), and the integration test asserts that the second
selection supersedes the first.

---

## What is under test

### The filter — `tests/unit/batch-filter-and-selection.test.ts`, `tests/integration/batch-selection-api.test.ts`

| Property | How it is proved |
|---|---|
| Only the rows with the chosen status are shown | Unit + integration: the count equals the match count, and every row carries the status |
| The MES's order is kept among the surviving rows | Unit: the filter removes rows and does not re-sort them |
| The receipt time, the source and the freshness are **unchanged** | Unit + integration: the filtered response's `receivedAt` and `freshness` equal the unfiltered ones |
| "All" is the **absent** parameter, and the only spelling | Integration: absent → 200 with `filter: null`; `?status=` → 400 |
| An unknown status is a **400**, never a silently widened answer | Integration + security: `?status=NOT_A_STATUS` → 400 with no `batches` key |
| A **repeated** status is refused | Security: `?status=RELEASED&status=QUEUED` → 400 — a filter holds exactly one status |
| A filter that matches nothing is a **200 with zero rows**, not an error | Integration: `?status=WEIGHED` → 200, `batches: []`, and the receipt time is still there |
| The offered statuses are the **queue's**, not the MES's vocabulary | Integration: the offered set equals the set of statuses in the rows, and `CANCELLED`/`WEIGHED` are **not** offered |
| Every status is still offered **while a filter is applied** | Integration — **the test that found Defect 1** |
| The filter does not change the queue's **availability** | Integration: an unreachable MES is still a 503 with no `batches` key |
| The input queue is not mutated | Unit |

### The selection — `tests/unit/batch-filter-and-selection.test.ts`, `tests/integration/batch-selection-api.test.ts`

| Property | How it is proved |
|---|---|
| A touch records **TOUCH**; a scan records **SCAN** | Unit + integration |
| The **method is derived**, and the client cannot supply it | Integration: a body carrying `selectionMethod: 'SCAN'` on a touch yields `TOUCH` — the field is stripped, because the schema does not have it (ADR-030) |
| The **operator comes from the session**, never the body | Integration: a body carrying `operatorId: 'OP-999'` yields the signed-in operator (ADR-005) |
| The record carries the batch, the order, the machine, the operator and the moment | Unit + integration |
| An ineligible batch is refused with the **specific** reason | Unit (all four reasons) + integration (`BEING_WEIGHED_ELSEWHERE`) |
| An **unrecognised code** is refused before eligibility is asked | Unit: the refusal carries no eligibility reason |
| A **disconnected scanner** is `SCANNER_UNAVAILABLE`, not a refusal | Integration: 503, and distinct from the 409 |
| A refusal writes **nothing** | Unit + integration: the selection is still `null` after a refused attempt |
| The queue is read **without** a filter — the filter is never a gate | Unit: `source.filters` is `[undefined]`; integration: a batch hidden by the current filter still selects successfully |
| The eligibility is read from the **snapshot**, not the projection | Unit: the selection succeeds on a snapshot whose eligibility is `ELIGIBLE` — the projection carries no eligibility at all |
| An empty selection is a **200 with null**, never a 404 | Integration |
| A new selection **supersedes** the previous one | Integration — **the test that found Defect 2** |
| A repeated selection is a **new** selection, and the history is kept | Unit + persistence: two rows, one active selection |

### The durable record — `tests/unit/batch-selection-persistence.test.ts`

| Property | How it is proved |
|---|---|
| A selection is saved and read back intact | Unit |
| The active selection is the **newest row**, not a flag | Unit |
| The ordering is **total** — the same millisecond gives the same answer every time | Unit |
| The **history** is kept — every row is still there | Unit: the row count is 2 |
| A row **cannot be updated** | Unit: the trigger raises `append-only` |
| A row **cannot be deleted** | Unit: the trigger raises `append-only` |
| A method outside the closed set **cannot be written** | Unit: the `CHECK` refuses it |
| The selection time and the recording time are **separate** | Unit |

### The security properties — `tests/security/batch-queue-security.test.ts`

The suite grew from 10 tests to 13, because the endpoint now **has** an
input and therefore needs an input-validation property.

| Property | Status |
|---|---|
| The queue still requires a session | **Kept** — 401 without one |
| A malformed token is refused | **Kept** |
| A token of the wrong shape is refused | **Kept** |
| An ended session is refused | **Kept** |
| An empty queue is never substituted for a failed read | **Kept** — the 503 body has **no** `batches` key |
| The MES's internal message never leaks | **Kept** |
| The failure path carries no prose | **Kept** |
| The station's contract is not exposed through the Dummy MES's open surface | **Kept** |
| **An unknown status is refused, not silently widened** | **New** — 400 |
| **An empty status is refused, not read as "All"** | **New** — 400 |
| **A repeated status is refused** | **New** — 400 |
| **A query parameter cannot reach the seam unvalidated** | **New** — the parameter is compared against a closed set and never interpolated |

---

## The security suite is the executable record

This repository's security review is **manual**, against the requirements
and the ADRs in `memory-bank/`, and the suite under `tests/security/` is
the executable record of the properties that matter. The properties this
bolt adds, and where each is enforced:

| Property | Enforced by | ADR |
|---|---|---|
| A session is required on every new endpoint | The controller's guard; `401` | ADR-020 |
| The operator comes from the session | The **schema has no `operatorId` field** — Zod strips it | ADR-005 |
| The method is derived, not supplied | The **schema has no `selectionMethod` field** — Zod strips it | ADR-030 |
| The refusal body carries a **code**, never prose | The controller's response shape | NFR-11, FR-22 |
| The MES's diagnostic never reaches the client | The use case's `onError` handler | BRD IR-09 |
| The status is validated against a **closed set** | `isBatchWeighingStatus`, before use | ADR-030 |
| The scanned code is **bounded** and compared in memory | The schema's `max(64)`, and `BatchId`'s own bound | — |
| A selection cannot be rewritten | No update path, **and** the database's triggers | ADR-029, BRD DR-02 |
| The method's set is closed in storage | The `CHECK` constraint | ADR-030 |

### The injection surface, stated plainly

The two new inputs are a **status** and a **code**.

- The **status** is checked against a closed set before use and compared
  against already-parsed values. It never reaches a SQL statement, a log
  line or a filesystem path.
- The **code** is bounded at 64 characters and compared **in memory**
  against the queue's ids. It never reaches a query.

Neither is interpolated anywhere. That is the whole surface, and the
security suite asserts it.

---

## What the tests do NOT cover, and why

| Not covered | Why |
|---|---|
| The **scanner's device protocol** | The contract is unconfirmed (Q-03). The port is the boundary, and the Dummy Scanner is a training artefact behind it. |
| The **recipe load** that follows a selection | Unit 002's story. This bolt records the choice; it does not load the recipe. |
| The **session** that the selection starts | Unit 003's story, and its resume semantics (CQ-02, CQ-03). |
| The **UI** | Unit 007. The "no batches match this filter" state and the crumb are the UI's; this bolt publishes the data and the codes they need. |
| The **MES's own filtering** (BRD IR-01) | Unit 005's, and it is **untouched** by this bolt. |
| **Retention** of the selection table | No pruning is implemented, deliberately — see ADR-029's consequences. BRD DR-01's five-year policy applies, and a pruning policy that deleted selections would destroy the history DR-02 protects. |

---

## The manual review against the ADRs

| ADR | How the code honours it | Where it is proved |
|---|---|---|
| **ADR-028** — the station owns its queue endpoint; the MES is read only through unit 005's reader | `BatchQueueSource` is the only outbound path, and it has **no** filter parameter. The composition root binds it once. | The composition-root test; the integration test's real Dummy MES |
| **ADR-029** — the selection is append-only; the active selection is the newest row | No update or delete method; the table's triggers abort; the id is the insertion sequence so the tie is broken in act order | The persistence test |
| **ADR-030** — the filter's options come from the queue; the method is derived | `statusesIn` is called on the unfiltered queue; the schema has no `selectionMethod` field | The integration tests for both |

---

## Commands run

```text
npm run typecheck      → clean
npm test               → 60 files, 1201 tests, 0 failures
npm run test:coverage  → 92.42% stmts / 86.91% branches / 94.06% funcs / 93.22% lines
```

---

## Verdict

**The bolt is complete and the suite is green.**

Two defects were found by the tests during the work — the filter narrowing
unit 005's cache, and the active selection being arbitrary within a
millisecond — and both were fixed **at the root cause**. The first changed
the port's shape, so the defect cannot be reintroduced by a later
implementer; the second changed the storage identity, so the tie-break now
reflects the order the acts happened.

The remaining gap is deliberate and stated: the scanner's device contract,
the recipe load, the weighing session and the UI belong to other bolts, and
the retention policy for the selection table is FCI's.
