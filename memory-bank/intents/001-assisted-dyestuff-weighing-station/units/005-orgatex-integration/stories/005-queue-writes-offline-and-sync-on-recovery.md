---
id: 005-queue-writes-offline-and-sync-on-recovery
unit: 005-orgatex-integration
intent: 001-assisted-dyestuff-weighing-station
status: draft
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: false
---

# Story: 005-queue-writes-offline-and-sync-on-recovery

## User Story

**As a** dyehouse operator
**I want** to keep weighing when the MES is unreachable and have my work sent on its own once it comes back
**So that** a network outage never stops my shift, and never means I have to re-enter a single weight or produce a duplicate one

## Acceptance Criteria

- [ ] **Given** the link is down and a weighing is confirmed, **When** its consumption posting is attempted, **Then** the posting is enqueued and reported as **pending** — never as posted — and weighing continues normally (BRD FR-20, BRD FR-16, BRD FR-17, BRD AC-09).
- [ ] **Given** postings are queued, **When** the process is restarted immediately, **Then** every queued posting is still present and still pending, with its original idempotency key (BRD FR-20, NFR-3).
- [ ] **Given** the link is restored, **When** the queue is flushed, **Then** the queued postings are delivered in the order they were queued, and each is delivered with the **same** idempotency key it was first created with (BRD FR-16, BRD FR-20, BRD IR-08, BRD AC-09).
- [ ] **Given** a posting has failed permanently under the configured disposition, **When** the failure is recorded, **Then** the posting remains visible as a failed entry with its last error, its attempt count and its last attempt time, and it can be re-driven — it is never silently discarded (BRD FR-20, BRD FR-33).
- [ ] **Given** a posting is retried, **When** the retry also fails, **Then** the attempt count and the last error are updated and the posting remains in the queue — a failure never removes the entry (BRD FR-20).
- [ ] **Given** queued postings exist, **When** the operator views the queue, **Then** the count of un-synchronised records and each entry's pending or failed state are visible (BRD FR-20, BRD FR-32).

## Technical Notes

- **The queue is durable; the snapshots are not.** A queued posting must survive a restart (NFR-3, BRD NFR-05) because a consumption that the station believes it sent but cannot prove is a correctness problem, not an inconvenience. A batch queue or recipe snapshot, by contrast, is a projection of an external system that can always be re-fetched (stories 001 and 002).
- **Storage.** SQLite via `better-sqlite3` for the sync queue and the idempotency ledger. A `SyncQueueEntry` holds `postingId`, `attempts`, `lastAttemptAt`, `nextAttemptAt`, `lastError`, `state`. Queue entries, the idempotency ledger and the postings history are retained ≥ 5 years (BRD DR-01).
- **The queue is owned here and only here**, because only this unit knows whether what it returns is current. Duplicating a cache in units 001 or 002 would create two sources of truth for the same queue.
- **The governing rule: no failure at any boundary may produce a silently wrong number.** A queued posting is shown as *pending*, never as *posted*; a stale snapshot is shown with its age, never as *current*.
- **Retry policy.** A queued posting is retried on a bounded backoff. The retry count and the last error are retained so an operator can see *why* something has not landed.
- **Nothing is silently discarded.** A permanently failed posting stays visible as a failed entry and can be re-driven. Re-driving it uses the **same idempotency key**, so a re-drive of an ambiguous failure cannot double-post.
- **CQ-06 — "is a rejected posting permanent or retryable?" — is answered by making the disposition configuration rather than code.** A posting that the MES rejects as invalid is a different situation from one that failed because the network dropped, and the unit does not pretend those are the same event. The disposition — retryable or permanent — is a configuration value, so both answers work without a code change.
- **The station keeps weighing while the link is down** (BRD FR-20, BRD NFR-03, A-03). The link state (story 004) decides what happens to *writes*; it does not decide whether the operator can weigh.
- On recovery, the flush delivers everything queued **in order**, without re-keying and without duplication (BRD AC-09). A posting that was accepted but whose response was lost is not double-counted on retry, because the retry carries the original key.
- The idempotency key and the local duplicate guard are owned by story 003; this story owns the enqueue, the persistence, the backoff, the flush and the failed-entry visibility.
- All quantities in a queue entry are fixed-point decimal (BRD NFR-16).
- The **Dummy OrgaTEX honours an offline mode**, so this story is exercisable end to end without unplugging anything.

## Dependencies

### Requires
- 003-post-consumption-idempotently (the posting, its idempotency key and the local duplicate guard)
- 004-report-link-state (the state that decides send-versus-queue and triggers the flush)

### Enables
- 003-weighing-station (weighing completion can proceed with the link down)
- 007-weighingms-ui (the un-synchronised count and the pending/failed entries)
- 006-ticket-printing (the ticket can state the pending write-back state)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The link is down for the whole of a batch | The entire batch is weighed; every posting is queued and pending; the batch's write-back is reported as pending, not confirmed. |
| The station loses power with postings queued | On restart the postings are still queued, still pending and still carrying their original keys. |
| The link is restored and the flush is in progress when the link drops again | The undelivered postings remain queued with their attempt counts incremented; the delivered ones are resolved and are not re-delivered. |
| A posting is rejected by the MES as invalid | Under a *permanent* disposition it becomes a visible failed entry with its reason and can be re-driven; under a *retryable* disposition it is retried on the backoff. The disposition is configuration (CQ-06). |
| A posting times out and the MES actually accepted it | The retry carries the same key, and the MES-side effect occurs once. |
| The same posting is enqueued twice | The local guard refuses the second enqueue as a duplicate; only one queue entry exists. |
| The queue is empty and the link is restored | The flush completes with nothing to deliver and reports zero deliveries. |
| A failed entry is re-driven while the link is still down | The re-drive is refused with a stated reason; the entry remains visible as failed with its attempt count updated. |
| Many postings are queued and the link comes back | They are delivered in order; a failure part-way through does not reorder or lose the remainder. |
| The MES rejects one posting and accepts the rest | The accepted ones are resolved; the rejected one stays visible as a failed entry. A single bad posting does not block the queue. |

## Out of Scope

- The link state model itself — story 004.
- The posting, the idempotency key generation and the local guard — story 003.
- The queue and recipe reads — stories 001 and 002.
- The weighing session itself and the tolerance decisions — `003-weighing-station`.
- The audit trail for privileged actions — unit 006.
- Rendering the pending and failed entries — `007-weighingms-ui`.
