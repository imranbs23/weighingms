---
unit: 005-orgatex-integration
intent: 001-assisted-dyestuff-weighing-station
phase: inception
status: draft
created: 2026-10-30T04:05:00Z
updated: 2026-10-30T04:05:00Z
---

# Unit Brief: OrgaTEX Integration

## Purpose

The single seam through which WeighingMS talks to the MES — and the only
place where an undocumented contract can be wrong.

This unit owns **linkage**, not meaning. It answers "what did OrgaTEX say,
has what we sent landed, and can we carry on if it cannot?" — and it answers
those questions for the whole system through one interface, so that the
documented-or-not status of the SETEX contract is contained in one place.

## Scope

### In Scope

- The **OrgaTEX adapter** and its training implementation (the Dummy
  OrgaTEX MES).
- Reading the **released batch queue**.
- Reading the **recipe** for a batch, including components, targets,
  units, tolerances and scale classes.
- Writing **batch weighing status** on progression and completion.
- Writing **actual consumption**, **idempotently** (IR-08).
- **Link state** reporting — `LINKED`, `DEGRADED`, `OFFLINE` — replacing the
  prototype's hard-coded `ORGATEX · LINKED`.
- The **deferred synchronisation queue**: what could not be sent, why, and
  when it will be retried.
- **Outage handling** that never loses a consumption posting and never
  silently discards one.

### Out of Scope

- What to do with the data once read → units 001 and 002.
- The weighing itself → `003-weighing-station`.
- The ticket → `006-ticket-printing`.
- Whether the MES contract really looks like this → FCI (Q-01, Q-02).

---

## Assigned Requirements

| FR | Requirement | Priority |
|----|-------------|----------|
| FR-16 | OrgaTEX write-back | Must |
| FR-19 | Peripheral status and failure handling — **OrgaTEX half** | Must |
| FR-20 | Offline operation and deferred synchronisation | Must |

---

## Domain Concepts

### Key Entities

| Entity | Description | Attributes |
|--------|-------------|------------|
| `LinkState` | How well the station can reach OrgaTEX | `status` (`LINKED` \| `DEGRADED` \| `OFFLINE`), `lastContactAt`, `lastError`, `consecutiveFailures` |
| `BatchQueueSnapshot` | The released queue as last received | `batches[]`, `receivedAt`, `source` |
| `RecipeSnapshot` | A batch's recipe as last received | `batchId`, `shadeCode`, `components[]`, `receivedAt`, `source` |
| `ConsumptionPosting` | One intended write of what was dispensed | `id` (idempotency key), `batchId`, `componentId`, `actualQuantity`, `unit`, `lotNumber`, `operatorId`, `createdAt`, `state` |
| `SyncQueueEntry` | A posting that has not landed | `postingId`, `attempts`, `lastAttemptAt`, `nextAttemptAt`, `lastError`, `state` |
| `BatchStatusWrite` | A status change sent to OrgaTEX | `batchId`, `status`, `writtenAt`, `state` |

### Key Operations

| Operation | Description | Inputs | Outputs |
|-----------|-------------|--------|---------|
| `readQueue` | Fetch the released batch queue | filter (optional status) | `BatchQueueSnapshot` |
| `readRecipe` | Fetch a batch's recipe | `batchId` | `RecipeSnapshot` |
| `writeBatchStatus` | Report the batch's weighing status | `batchId`, `status` | `BatchStatusWrite` |
| `postConsumption` | Post actual consumption **idempotently** | `ConsumptionPosting` | accepted / rejected / queued |
| `enqueue` | Hold a posting for later delivery | `ConsumptionPosting` | `SyncQueueEntry` |
| `retryQueue` | Attempt delivery of queued postings | — | delivery outcomes |
| `readLinkState` | Report the current link state | — | `LinkState` |
| `flushOnRecovery` | Deliver everything queued, in order | — | delivery outcomes |

### The idempotency contract

IR-08 requires that consumption posting be **idempotent**: posting the same
consumption twice must not double-count it. The mechanism implemented here
is an **idempotency key** carried on every posting — derived from the
weighing record's identity, so that a retry of the *same* weighing is
recognised as a retry — plus a **client-side guard** that refuses to enqueue
a posting whose key is already present in the sync queue.

This matters because the failure mode is not hypothetical. A posting that
times out after the MES accepted it is indistinguishable from one that
never arrived, and the only safe response is to retry with the same key.
Without that, an interrupted session can double-post a dye batch — a
quantities error on a real order.

**Rule 2 (workbook): no invented requirements.** The *shape* of the
idempotency key is not specified by the BRD. This unit implements the
mechanism the BRD requires (IR-08) in the form that does not depend on the
unknown MES contract: the key is **generated and tracked locally** and
carried on the request. If the real contract does not support it, the
fallback is a local deduplication table, and the behaviour is unchanged
from the caller's point of view.

### Link state and the deferred queue

The link state is not a boolean. Three states, each with a defined
consequence:

| State | Meaning | Consequence |
|---|---|---|
| `LINKED` | The last contact succeeded | Reads and writes proceed normally. |
| `DEGRADED` | Recent contacts failed, but the last successful snapshot is still within its freshness window | Reads serve the last snapshot, clearly marked with its age; writes queue. |
| `OFFLINE` | The station cannot reach the MES | Reads fail loudly; writes queue; weighing continues. |

**The governing rule from the system context: no failure at any boundary may
produce a silently wrong number.** A queued posting is shown as *pending*,
never as *posted*. A stale snapshot is shown with its age, never as
*current*. The prototype's hard-coded `ORGATEX · LINKED` becomes a real
state with real consequences.

**The queue is owned here and only here**, because only this unit knows
whether what it returns is current. Duplicating a cache in units 001 or 002
would create two sources of truth for the same queue.

### Retry policy

A queued posting is retried on a bounded backoff, and the retry count and
last error are retained so an operator can see *why* something has not
landed. A posting that fails permanently is **not silently discarded** —
it remains visible as a failed entry that can be re-driven. CQ-06 asks
whether a rejected posting is permanent or retryable; the unit is built so
both answers work, with the disposition being a configuration value rather
than a code change.

---

## Story Summary

| Metric | Count |
|--------|-------|
| Total Stories | 5 |
| Must Have | 5 |
| Should Have | 0 |
| Could Have | 0 |

### Stories

| Story ID | Title | Priority | Status |
|----------|-------|----------|--------|
| 001 | Read the released batch queue from OrgaTEX | Must | Planned |
| 002 | Read the recipe for a selected batch | Must | Planned |
| 003 | Post actual consumption idempotently | Must | Planned |
| 004 | Report the OrgaTEX link state | Must | Planned |
| 005 | Queue writes while offline and synchronise them on recovery | Must | Planned |

---

## Dependencies

### Depends On

| Unit | Reason |
|------|--------|
| — | **None.** This is a leaf unit. |

### Depended By

| Unit | Reason |
|------|--------|
| `001-batch-management` | The queue is read through this adapter — never from the MES directly (BRD IR-07). |
| `002-recipe-material-management` | The recipe, tolerances and dyestuff master are read through this adapter. |
| `003-weighing-station` | Batch weighing status is written on progression and completion. |
| `006-ticket-printing` | The ticket may carry the batch's OrgaTEX identity and consumption reference. |
| `007-weighingms-ui` | The link state in the peripheral status strip. |

### External Dependencies

| System | Purpose | Risk |
|--------|---------|------|
| OrgaTEX MES | Queue, recipe, dyestuff master; consumption write-back | **Severe** — A-01, A-02, Q-01, Q-02, IR-07, IR-08 |

---

## Technical Context

### Suggested Technology

TypeScript strict · Express 4 · Zod for validation · SQLite via
better-sqlite3 for the **sync queue** and the **idempotency ledger**
(durable across a restart — the queue must not be lost with the process) ·
fixed-point decimal for every quantity · REST/JSON over the adapter seam.

### Integration Points

| Integration | Type | Protocol |
|-------------|------|----------|
| `001-batch-management` | API (internal) | REST/JSON |
| `002-recipe-material-management` | API (internal) | REST/JSON |
| `003-weighing-station` | API (internal) | REST/JSON |
| `006-ticket-printing` | API (internal) | REST/JSON |
| `007-weighingms-ui` | API (internal) | REST/JSON |
| OrgaTEX MES | API (external, via adapter) | REST/JSON — **assumed shape, not confirmed** |

### Data Storage

| Data | Type | Volume | Retention |
|------|------|--------|-----------|
| Batch queue | Not persisted — projected live from OrgaTEX | — | — |
| Recipe | Not persisted — projected from OrgaTEX | — | — |
| Sync queue entries | SQL | One row per unlanded posting | Until resolved; failures retained ≥ 5 years (DR-01) |
| Idempotency ledger | SQL | One row per posted key | ≥ 5 years (DR-01) |
| Postings history | SQL | One row per consumption posting | ≥ 5 years (DR-01) |

**The queue is durable, the snapshots are not.** A queued posting must
survive a restart (NFR-05) because a consumption that the station believes
it sent but cannot prove is a correctness problem, not an inconvenience. A
batch queue snapshot, by contrast, is a projection of an external system
that the system does not own and can re-fetch.

---

## Constraints

- **All OrgaTEX interaction is confined to this adapter** (BRD IR-07). No
  other unit reads the MES directly, and none of them import a client for
  it.
- **Consumption posting is idempotent** (IR-08). A retry of the same
  posting must not create a second consumption.
- **No floating point for quantities** (BRD NFR-16).
- The station **keeps weighing while the link is down** (FR-20); writes
  queue, and queued work is visible as pending.
- **Nothing is silently discarded.** A permanently failed posting stays
  visible and re-drivable.
- The **link state is real**, never hard-coded.
- The MES contract shape is **assumed, not confirmed** — and is confined
  here so that a wrong assumption costs one unit.

---

## Success Criteria

### Functional

- [ ] The released batch queue is read through the adapter.
- [ ] A batch's recipe is read through the adapter with components, targets,
      units, tolerances and scale classes.
- [ ] Batch weighing status is written on progression and completion.
- [ ] Actual consumption is posted, and posting the same consumption twice
      produces one consumption.
- [ ] The link state is `LINKED`, `DEGRADED` or `OFFLINE` and reflects real
      recent contact.
- [ ] While offline, weighing continues and writes queue.
- [ ] On recovery, queued postings are delivered in order and each is
      retried with the same idempotency key.
- [ ] A permanently failed posting remains visible with its error and can
      be re-driven.

### Non-Functional

- [ ] The sync queue survives an immediate restart (NFR-05).
- [ ] A posting that was accepted but whose response was lost is not
      double-counted on retry.
- [ ] All quantities are fixed-point decimal.

### Quality

- [ ] Idempotency is covered by a test that posts the same consumption
      twice and asserts a single consumption.
- [ ] The retry path is covered by a test that fails a posting, restores
      the link, and asserts exactly one delivery.
- [ ] Link-state transitions are covered by a test per state, including
      `DEGRADED` → `OFFLINE` and back.
- [ ] Code reviewed and approved.

---

## Bolt Suggestions

> Generated from the bolt plan in `memory-bank/bolts/` by
> `scripts/sync-bolt-suggestions.cjs`. The bolt ids are a **global**
> sequence across all units, not a per-unit one.

| Bolt | Type | Stories | Objective |
|------|------|---------|-----------|
| `005-005-orgatex-integration` | DDD | 001-read-released-batch-queue, 002-read-batch-recipe | Build the OrgaTEX adapter seam and the Dummy OrgaTEX MES behind it: the released batch queue and the batch… |
| `006-005-orgatex-integration` | DDD | 003-post-consumption-idempotently | Post actual consumption idempotently, using a locally generated and tracked idempotency key, so that a retr… |
| `007-005-orgatex-integration` | DDD | 004-report-link-state, 005-queue-writes-offline-and-sync-on-recovery | Own the link state and the deferred synchronisation queue, so that the station keeps weighing while OrgaTEX… |

---

## Notes

**This is the unit that could invalidate the premise.** A-01 assumes
OrgaTEX exposes a REST interface at all, and A-02 assumes it accepts
consumption write-back. If either is false, the product's shape changes:
without a queue read there is no batch selection, and without write-back
there is no closure of the loop with the MES. Every one of those questions
— Q-01, Q-02 — is about *this* boundary and nowhere else.

The unit is structured so that the answer is contained. If the answer is
"the MES has no API and exposes only files", then this unit's *implementation*
is replaced while every other unit keeps its contract. That is the entire
purpose of BRD IR-07's adapter boundary, and it is why the boundary is
made here, once, rather than sprinkled through the other units.

**The Dummy OrgaTEX is a real artefact, not a mock.** Rule 5 of the
workbook treats dummy integrations as development artefacts in their own
right: they are part of the product, they are exercised by the test suite,
and the UI never contains their data inline. The Dummy OrgaTEX here holds a
coherent, mutable world — batches with statuses, recipes with components and
tolerances, and consumption it accumulates — so that the same UI can be
driven through a normal weighing, a rejection, and an outage.

**The queue and the idempotency ledger are persisted; the snapshots are
not.** That asymmetry is deliberate. A snapshot can always be re-fetched; an
unlanded consumption posting cannot.

**CQ-06 — "is a rejected posting permanent or retryable?"** — is answered
by making the disposition configuration rather than code. A posting that the
MES rejects as invalid is a different situation from one that failed because
the network dropped, and the unit does not pretend those are the same
event.
