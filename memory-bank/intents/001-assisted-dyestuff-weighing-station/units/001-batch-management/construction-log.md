---
unit: 001-batch-management
intent: 001-assisted-dyestuff-weighing-station
created: 2026-11-04T15:30:00Z
last_updated: 2026-11-04T16:30:00Z
---

# Construction Log: 001-batch-management

## Original Plan

**From Inception**: 2 bolts planned
**Planned Date**: 2026-10-30

| Bolt ID | Stories | Type |
|---------|---------|------|
| `008-001-batch-management` | 001-retrieve-released-batch-queue | ddd |
| `009-001-batch-management` | 002-filter-batch-queue-by-status, 003-select-batch-and-record-identity | ddd |

## Replanning History

| Date | Action | Change | Reason | Approved |
|------|--------|--------|--------|----------|
| — | none | — | The plan was executed as written. | — |

## Current Bolt Structure

| Bolt ID | Stories | Type | Status |
|---------|---------|------|--------|
| `008-001-batch-management` | 001-retrieve-released-batch-queue | ddd | complete |
| `009-001-batch-management` | 002-filter-batch-queue-by-status, 003-select-batch-and-record-identity | ddd | complete |

## Progress

- **2026-11-04T15:30:00Z**: `008-001-batch-management` started - Stage 1: model
- **2026-11-04T15:45:00Z**: `008-001-batch-management` stage-complete - model → design
- **2026-11-04T16:00:00Z**: `008-001-batch-management` stage-complete - design → adr
- **2026-11-04T16:20:00Z**: `008-001-batch-management` stage-complete - adr → implement (ADR-028)
- **2026-11-04T16:30:00Z**: `008-001-batch-management` stage-complete - test → complete (1139 tests, 45 new)
- **2026-11-05T14:20:00Z**: `009-001-batch-management` started - Stage 1: model
- **2026-11-05T14:45:00Z**: `009-001-batch-management` stage-complete - model → design
- **2026-11-05T15:05:00Z**: `009-001-batch-management` stage-complete - design → adr (ADR-029, ADR-030)
- **2026-11-05T15:10:00Z**: `009-001-batch-management` stage-complete - adr → implement
- **2026-11-05T15:25:00Z**: `009-001-batch-management` stage-complete - test → complete (1201 tests, 62 new)

## Verification

| Date | Check | Result |
|------|-------|--------|
| 2026-11-04T16:30:00Z | `npm test` | **1139 passed** across 57 files (45 new) |
| 2026-11-04T16:30:00Z | `npm run typecheck` | clean |
| 2026-11-04T16:30:00Z | `npm run test:coverage` | 92.51% stmts / 86.96% branches / 94.34% funcs / 93.30% lines — **every new file at 100%** |
| 2026-11-04T16:30:00Z | `npm run verify:adrs` | 28 ADRs well-formed, the index agrees |
| 2026-11-04T16:30:00Z | `npm run verify:frontmatter` | every bolt's frontmatter valid |
| 2026-11-04T16:30:00Z | `npm run verify:fr-refs` | no problems |
| 2026-11-04T16:30:00Z | `npm run verify:inception` | all checks pass |
| 2026-11-04T16:30:00Z | `npm run verify:requirements` | all requirement checks pass |
| 2026-11-05T15:25:00Z | `npm test` | **1201 passed** across 60 files (62 new) |
| 2026-11-05T15:25:00Z | `npm run typecheck` | clean |
| 2026-11-05T15:25:00Z | `npm run test:coverage` | 92.42% stmts / 86.91% branches / 94.06% funcs / 93.22% lines — threshold 80% met |
| 2026-11-05T15:25:00Z | `npm run verify:adrs` | 30 ADRs well-formed, the index agrees |
| 2026-11-05T15:25:00Z | `npm run verify:frontmatter` | every bolt's frontmatter valid |
| 2026-11-05T15:25:00Z | `npm run verify:implementation` | all checks pass |

## Bolt 008: What Was Built

**The station's own queue endpoint**, `GET /api/batch-queue`, reading the
released queue through unit 005's reader and projecting it into unit 001's
own model with its receipt time.

| Artefact | What it is |
|----------|------------|
| `src/001-batch-management/domain/entities/station-batch-queue.ts` | `StationBatch` (the seven FR-1 columns) and `StationBatchQueue` (the projection, its receipt time, its source, its freshness) |
| `src/001-batch-management/domain/value-objects/queue-availability.ts` | `AVAILABLE` \| `UNAVAILABLE` — two values, because the operator can act on those and on nothing in between |
| `src/001-batch-management/domain/ports/batch-queue-source.ts` | The port this unit reads through — declared **here**, because a port belongs to the consumer |
| `src/001-batch-management/domain/services/batch-queue-projector.ts` | The **pure** mapping from unit 005's snapshot to this unit's projection |
| `src/001-batch-management/application/use-cases/retrieve-batch-queue.ts` | The read use case — it holds a port, not an adapter; no cache, no clock |
| `src/001-batch-management/presentation/controllers/batch-queue-controller.ts` | The endpoint — `200` with the queue, `401` without a session, `503` with no queue at all |
| `src/001-batch-management/infrastructure/composition-root.ts` | Where the port is bound to unit 005's reader — the **one** place the two units meet |

**Nothing is persisted.** No table, no repository, no migration. The queue
is a projection of a system this station does not own, and a second durable
copy would be a second source of truth for the same queue.

## Bolt 008: The Decisions That Mattered

### ADR-028 — the station owns its own queue endpoint

Three things could have served the read: unit 005's own endpoint, the
Dummy MES's endpoint, or a **second reader of the adapter**. The third was
rejected because it would have created two readers of one seam, two
contacts, two caches and therefore two sources of truth for the same queue.

So unit 001 declares its own port, binds it to unit 005's reader in the
composition root, and publishes its own endpoint. The path is
`/api/batch-queue` because `/api/batches` belongs to the Dummy MES, and a
queue route under that prefix would be **silently captured** by the
Dummy's `/batches/:batchId` route.

### The empty queue and the unreachable MES are different facts

An empty queue is a **200** with zero rows and a receipt time. An
unreachable MES is a **503** whose body has **no `batches` key at all** —
not an empty array. A client that renders whatever is under `batches` is
therefore forced to look at the status code, and the operator can never
confuse "there is no work" with "we cannot see the work".

### The receipt time is the upstream's, not the renderer's

The projector copies the snapshot's `receivedAt`; it holds no clock. A
projector that computed the time itself would report when the client asked
rather than when the queue was received — and the story names the second.

### The staleness is passed through, not re-decided

Unit 005's freshness decision travels inside the queue unchanged. The
threshold that decides it is unit 005's freshness **window**, which is
configuration (BRD NFR-14) and which the UI does not have — so the UI
reads the decision rather than re-deriving it.

## Bolt 008: What Was NOT Built

| Not built | Belongs to |
|-----------|------------|
| Filtering the queue by status | bolt 009, story `002-filter-batch-queue-by-status` |
| Selecting a batch, and enforcing the eligibility gate | bolt 009, story `003-select-batch-and-record-identity` |
| The recipe's contents | unit 002 |
| Rendering the queue, and the placeholder's text | unit 007 |
| The queue's read, the MES contract, the cache, the freshness window | unit 005 |

## Carried Forward to Bolt 009

1. **The port grows the filter**, and the endpoint grows a query parameter
   with validation that rejects an unknown status with a `400` rather than
   ignoring it.
2. **The eligibility is read from unit 005's snapshot**, not from this
   bolt's projection — the projection deliberately does not carry it.
3. **The selection is a write**, and it needs a session: ADR-020's rule
   applies to the selection endpoint as it does to the queue's.
4. **Unit 007 must render the `null` description with its own localised
   placeholder** and must not substitute an empty string.

---

## Bolt 009: What Was Built

**The filter** on the station's own queue endpoint, and **the selection**
as a recorded act — with the eligibility gate enforced, and the record
durable.

| Artefact | What it is |
|----------|------------|
| `src/001-batch-management/domain/services/batch-queue-filter.ts` | The **pure** filter — the rows, and the statuses present in the queue |
| `src/001-batch-management/domain/value-objects/queue-filter.ts` | `QueueFilter` (one status, or none) and `FilterableStatuses` |
| `src/001-batch-management/domain/entities/batch-selection.ts` | The selection as an **immutable recorded act** — batch, order, machine, operator, time, method |
| `src/001-batch-management/domain/value-objects/selection-method.ts` | `SCAN` \| `TOUCH`, and the guard that keeps the set closed |
| `src/001-batch-management/domain/value-objects/selection-refusal.ts` | The refusal reasons — two recognition failures and the four ineligibility reasons |
| `src/001-batch-management/domain/ports/batch-scanner.ts` | The scanner's seam — a **port**, not a client, because the device's contract is unconfirmed (Q-03) |
| `src/001-batch-management/domain/ports/batch-selection-repository.ts` | **Two methods. No update, no delete.** The active selection is the newest row |
| `src/001-batch-management/application/use-cases/select-batch.ts` | The write use case — the eligibility gate, the refusal that writes nothing, and the derived method |
| `src/001-batch-management/presentation/controllers/batch-selection-controller.ts` | `POST`/`GET /api/selection` — `201`, `400`, `401`, `409`, `503` |
| `src/001-batch-management/presentation/schemas/batch-selection-schemas.ts` | The boundary — **no `operatorId` field and no `selectionMethod` field** |
| `src/001-batch-management/infrastructure/persistence/batch-selection-database.ts` | The table, the `CHECK`, and the append-only triggers |
| `src/001-batch-management/infrastructure/adapters/dummy-batch-scanner.ts` | The training scanner — **off by default**, so the product's default configuration is honest |

**One table, and it is append-only.** The selection is persisted — unlike
the queue — because it cannot be re-derived: the MES has no idea the
operator chose a batch.

## Bolt 009: The Decisions That Mattered

### ADR-029 — the selection is append-only, and the active selection is the newest row

BRD DR-02 requires that a selection — a fact about what the operator
physically did — be immutable, while the workflow needs a *current*
selection that changes. Storing "which one is active" as a `superseded_at`,
an `is_active` flag or a pointer row would mutate a historical record and
create a second source of truth that a partial failure could leave
inconsistent — the same rejection ADR-006 applied to the identity unit's
`consumed_at`.

So the table is strictly append-only, the `BEFORE UPDATE` / `BEFORE
DELETE` triggers **abort**, and the active selection is
`ORDER BY selected_at DESC, id DESC LIMIT 1`.

### ADR-030 — the filter's options come from the queue, and the method is derived

Two decisions in one ADR, because both have a plausible alternative that
would look right in a code review and would be wrong in the product.

**The option set** is derived from the **queue**, not from the MES's
five-status vocabulary. A status that is not in the queue is a filter that
will match nothing, and an option set that collapses to the filtered status
is a one-way door. The vocabulary is still consulted — to reject an unknown
`?status=` with a `400`, never to widen the answer silently.

**The method** is derived from the request's shape — a `code` came from the
scanner, a `batchId` came from a touched row — and the schema has **no**
`selectionMethod` field, so a client cannot record a scan that never
happened in an immutable traceability record.

## Bolt 009: The Two Defects the Tests Found

Both were fixed at the **root cause**, and both are recorded in
`ddd-03-test-report.md`.

1. **The filter narrowed unit 005's CACHE.** The bolt's design grew the
   queue port with a `filter` parameter. Unit 005's reader **caches the
   snapshot it built**, so a filtered read would have put a *filtered*
   queue into that cache — and the reader's DEGRADED fallback would later
   serve the partial queue as though it were the whole released schedule.
   The port now takes **no** filter, and the filter is applied to this
   unit's own rows. The port's shape is the enforcement.

2. **The active selection was arbitrary within a millisecond.** The row's
   identifier was a `randomUUID()`, and the tie-break in
   `ORDER BY selected_at DESC, id DESC` was therefore **random** — exactly
   in the case the tie-breaker exists for. The identifier is now the
   **insertion sequence**, so the tie is broken in the order the acts
   **happened**.

## Bolt 009: What Was NOT Built

| Not built | Belongs to |
|-----------|------------|
| The recipe's contents and the load that follows a selection | unit 002 |
| The weighing session, and a selection's resume semantics (CQ-02, CQ-03) | unit 003 |
| The scanner's device protocol | the device's contract (Q-03) |
| Rendering the queue, the filter control, the crumb and the refusal text | unit 007 |
| Pruning the selection table | **nobody's, deliberately** — see ADR-029's consequences |
| The MES's own filtering (BRD IR-01) | unit 005, and **untouched** by this bolt |

## Carried Forward

1. **Unit 002 must invoke the selection** and load the recipe; the
   selection carries the batch identity it needs. NFR-1's timing criterion
   stays open until that unit exists.
2. **Unit 003 must read the active selection** — the newest row — and own
   the resume decision (CQ-02, CQ-03).
3. **Unit 007 must render** the filter control from the published
   `statuses`, the no-match state from the zero rows and the echoed
   filter, the crumb from the selection, and the refusal from the reason
   **code** — the text is the UI's (NFR-7, NFR-11).
4. **Unit 007 must not hard-code the statuses** — the option set arrives
   as data.
5. **The selection's table has no pruning policy.** BRD DR-01's five-year
   retention applies, and a pruning policy that deleted selections would
   destroy the history DR-02 protects. Deciding it is FCI's.
