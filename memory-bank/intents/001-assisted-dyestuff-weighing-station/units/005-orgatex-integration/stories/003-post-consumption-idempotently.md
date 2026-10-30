---
id: 003-post-consumption-idempotently
unit: 005-orgatex-integration
intent: 001-assisted-dyestuff-weighing-station
status: draft
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: false
---

# Story: 003-post-consumption-idempotently

## User Story

**As a** dyehouse operator
**I want** what I weighed to be recorded against the batch exactly once
**So that** my weighing is counted in the order's actual consumption, and a retried or interrupted send never inflates the dye used for my batch

## Acceptance Criteria

- [ ] **Given** a confirmed weighing of a component, **When** its consumption is posted, **Then** the posting carries the batch id, the component id, the actual quantity, the unit, the lot number, the operator id and the time of the weighing, all as fixed-point decimal where they are quantities (BRD FR-16, BRD FR-18, NFR-2).
- [ ] **Given** the same consumption is posted twice, **When** the second post completes, **Then** exactly one consumption exists for that batch and component — the second post adds nothing (BRD FR-16, BRD IR-08).
- [ ] **Given** a consumption posting has already been enqueued with its idempotency key, **When** an enqueue of that same key is requested, **Then** the request is refused as a duplicate and no second queue entry is created (BRD FR-16, BRD IR-08).
- [ ] **Given** a posting fails in a way that leaves it unknown whether the MES received it, **When** it is retried, **Then** the retry carries the **same idempotency key** as the original attempt (BRD FR-16, BRD IR-08).
- [ ] **Given** a posting is rejected or fails, **When** the failure is recorded, **Then** the error is logged with enough detail to diagnose it without OrgaTEX-side access (BRD FR-16, BRD IR-09).
- [ ] **Given** consumption postings have been made for a batch, **When** the batch's weighing status is advanced, **Then** the batch weighing status is advanced to `WEIGHED` and **no** other OrgaTEX batch field is altered (BRD FR-16, BRD IR-06).

## Technical Notes

- **The idempotency key is generated and tracked locally.** The BRD requires the *mechanism* (BRD IR-08) but does not specify the key's shape, and **the MES's support for an idempotency key is unconfirmed (Q-02)**. The key is therefore derived from the weighing record's identity — so that a retry of the *same* weighing is recognised as a retry — generated locally, carried on the request, and recorded in a local ledger. **No claim is made that OrgaTEX understands the key.**
  - If the real contract does not support an idempotency key, the fallback is a local deduplication table. The behaviour is **unchanged from the caller's point of view**: one weighing produces one consumption either way.
- **This is not a hypothetical failure.** A posting that times out *after* the MES accepted it is indistinguishable from one that never arrived, and the only safe response is to retry with the same key. Without this, an interrupted session can double-post a dye batch — a quantities error on a real order.
- **The local guard refuses to enqueue a key already present.** The guard is on the *enqueue* path, not only on the send path, so that a duplicated submission while the link is down cannot create two queue entries for one weighing.
- `ConsumptionPosting` fields: `id` (the idempotency key), `batchId`, `componentId`, `actualQuantity`, `unit`, `lotNumber`, `operatorId`, `createdAt`, `state`.
- **The external contract is not confirmed.** A-01 assumes a REST interface exists; **A-02 assumes OrgaTEX accepts actual-consumption postings at all**, and **Q-02 asks exactly that** ("Will OrgaTEX accept external consumption postings?"). If A-02 is false, reconciliation is unreachable and the product's shape changes. Accordingly: **describe the adapter seam and the direction of data flow only.** No specific external endpoint, payload shape or field name is asserted here as fact.
- The direction of flow is **write**: adapter → MES, with the consumption, and separately the batch weighing status. **No OrgaTEX batch field other than the weighing status is altered** (BRD §9.2, C-01).
- The **idempotency ledger** is persisted (SQL) and retained ≥ 5 years (BRD DR-01), as are the postings history and the consumption postings. The ledger is the durable record that a key has been consumed.
- The posting's `state` distinguishes **accepted**, **rejected**, and **queued**. A queued posting is reported as *pending* and never as *posted* — the governing rule from the system context is that **no failure at any boundary may produce a silently wrong number.**
- The retry, backoff and permanent-failure disposition belong to story 005. This story owns the posting contract, the key, the guard and the ledger.
- **CQ-06** (is a rejected posting permanent or retryable?) is answered by making the disposition a **configuration value** rather than a code change, so that the unit supports both answers.

## Dependencies

### Requires
- 001-read-released-batch-queue (the adapter seam and the link state it establishes)

### Enables
- 005-queue-writes-offline-and-sync-on-recovery (the enqueue path and the ledger it writes)
- 004-report-link-state (the contact outcome of a posting attempt)
- 003-weighing-station (the confirmed weighing that is posted)
- 006-ticket-printing (the consumption reference carried on the ticket)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The MES accepts the posting but the response is lost | The posting's state is unknown. A retry carries the same key and the MES-side effect occurs once, not twice. |
| The operator confirms the same component twice | The second confirmation is a distinct weighing record with a distinct key; the key is derived from the weighing record's identity, not from the component. |
| Two postings for the same component and batch are submitted concurrently | The local guard admits exactly one; the other is refused as a duplicate. |
| The MES rejects the posting as invalid | The rejection is recorded with its reason and the posting is retained as a failed entry; it is never silently discarded. Its retryability follows the configured disposition (CQ-06). |
| The MES rejects the posting because the batch is not in a postable state | The rejection is recorded with the reason and surfaced for manual attention (BRD FR-33). |
| The link is down when the posting is attempted | The posting is enqueued and reported as *pending*, not as posted. It is retried with the same key on recovery (story 005). |
| The actual quantity is zero | A zero-quantity consumption is posted as a zero quantity, distinguishable from a missing posting. |
| The actual quantity is in kilograms while the recipe target was in grams | The quantity is converted to fixed-point decimal in a single declared unit before posting; the posted unit is recorded on the posting. |
| The posting is made after the MES has moved the batch past `WEIGHED` | The rejection is recorded with the reason; the weighing record itself is not affected (records are immutable — BRD DR-02). |
| The batch has several components | Each component's consumption is a separate posting with its own key; the batch weighing status advances to `WEIGHED` only when the batch's postings are all resolved. |

## Out of Scope

- The link state model — story 004.
- The offline queue, the retry backoff and the flush on recovery — story 005.
- Deciding that a weighing is confirmed and recording the weighing record — `003-weighing-station`.
- The ticket and its content — `006-ticket-printing`.
- The batch queue and the recipe reads — stories 001 and 002.
- Any change to OrgaTEX beyond the batch weighing status and the consumption posting (C-01, BRD §9.2).
