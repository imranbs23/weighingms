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
| `009-001-batch-management` | 002-filter-batch-queue-by-status, 003-select-batch-and-record-identity | ddd | planned |

## Progress

- **2026-11-04T15:30:00Z**: `008-001-batch-management` started - Stage 1: model
- **2026-11-04T15:45:00Z**: `008-001-batch-management` stage-complete - model → design
- **2026-11-04T16:00:00Z**: `008-001-batch-management` stage-complete - design → adr
- **2026-11-04T16:20:00Z**: `008-001-batch-management` stage-complete - adr → implement (ADR-028)
- **2026-11-04T16:30:00Z**: `008-001-batch-management` stage-complete - test → complete (1139 tests, 45 new)

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
