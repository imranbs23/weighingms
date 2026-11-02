---
unit: 005-orgatex-integration
bolt: 006-005-orgatex-integration
stage: model
status: complete
updated: 2026-11-02T20:35:00Z
---

# Static Model - OrgaTEX Integration (bolt 006)

## Bounded Context

**OrgaTEX Integration** owns *linkage* — what the MES said, what we sent,
and whether it landed. It owns **no meaning**: what a batch is, what a
recipe means and what a component is, belong to units 001 and 002.

This bolt covers the **write** direction only. Bolt 005 built the read
seam; this bolt adds the consumption posting and the batch-status write,
and it adds the **idempotency ledger** that makes a retry safe.

### The one problem this bolt exists to solve

A posting that times out **after** the MES accepted it is
indistinguishable from one that never arrived. The only safe response is
to retry with the **same idempotency key**. Without that, an interrupted
session double-posts a dye batch — a quantities error on a real order.

### The asymmetry this bolt inherits

Bolt 005's ADR-021 established that **snapshots are not persisted** — a
snapshot of an external system's truth can always be re-fetched. This bolt
is the other half:

| | Owner | Persisted? | Why |
|---|---|---|---|
| Batch queue snapshot | bolt 005 | **No** | A projection of a system we do not own |
| Recipe snapshot | bolt 005 | **No** | Same |
| **Consumption posting** | **this bolt** | **Yes** | A statement about what *we* did — it cannot be re-derived |
| **Idempotency ledger** | **this bolt** | **Yes** | The durable proof that a key has been consumed |

The unit brief states the rule exactly: *"The queue is durable, the
snapshots are not."* A queued posting must survive a restart (NFR-05),
because a consumption the station believes it sent but cannot prove is a
correctness problem, not an inconvenience.

### What this bolt does NOT own

- The link state machine — story 004, bolt 007.
- The offline queue, the retry backoff and the flush — story 005, bolt 007.
- Deciding that a weighing is confirmed — unit 003.
- The ticket — unit 006.

**This bolt owns the posting contract, the key, the guard and the ledger.**

---

## Domain Entities

| Entity | Properties | Business Rules |
|--------|------------|----------------|
| **ConsumptionPosting** | `id` (the idempotency key), `batchId`, `componentId`, `actualQuantity`, `unit`, `lotNumber`, `operatorId`, `weighedAt`, `createdAt`, `state` | The `id` is the idempotency key and is **derived from the weighing record's identity**, so a retry of the same weighing is recognised as a retry. The `actualQuantity` is a **fixed-point decimal**, never a float. `state` is one of `QUEUED`, `ACCEPTED`, `REJECTED`. A posting in `QUEUED` is reported as **pending** and **never** as posted. A posting is **immutable** — a state change appends a new row (DR-02). |
| **PostingAttempt** | `postingId`, `attemptedAt`, `outcome`, `reason` | An **append-only** record of one attempt to deliver a posting. The attempt history is what makes "logged with enough detail to diagnose it without OrgaTEX-side access" (IR-09) answerable. Never updated, never deleted. |
| **BatchStatusWrite** | `batchId`, `status`, `writtenAt`, `state` | The write of **one** OrgaTEX field — the weighing status. **No other OrgaTEX batch field is altered** (BRD §9.2, C-01). The status written is `WEIGHED`, and it is written **only when the batch's postings are all resolved**. |

### The three states of a posting, and why there are exactly three

```
QUEUED    the posting has not landed; it is pending
ACCEPTED  the MES accepted it; the consumption exists there
REJECTED  the MES refused it; the reason is recorded
```

There is deliberately **no `UNKNOWN` state**, even though a lost response
leaves the outcome genuinely unknown. The reason is that `UNKNOWN` would
be a fourth state with no defined consequence, and the story's edge case
says what must happen instead:

> "The MES accepts the posting but the response is lost | The posting's
> state is unknown. A retry carries the same key and the MES-side effect
> occurs once, not twice."

The resolution is that **the attempt's outcome** is unknown, not the
posting's *state*. The posting stays `QUEUED` — it has not been accepted
and it has not been rejected — and the next attempt reuses the key. The
attempt row records `outcome: 'UNKNOWN'`, which is a **fact about the
attempt**, not a state the posting is left in.

This distinction is the whole design: the posting's state is only ever
advanced by a **definitive** answer from the MES.

---

## Value Objects

| Value Object | Properties | Constraints |
|--------------|------------|-------------|
| **IdempotencyKey** | `value` | A bounded, non-empty, **opaque** string. It is **not** a secret — it is carried on the request so the MES can dedupe — but it is **not** guessable either, because a guessable key would let a third party replay a posting. Derived from the weighing record's identity, **not** from the component: the story's edge case says *"The operator confirms the same component twice | The second confirmation is a distinct weighing record with a distinct key."* |
| **PostingState** | — | The closed set `QUEUED` \| `ACCEPTED` \| `REJECTED`. A type, not a string, so a caller cannot read a state it has not proved. |
| **AttemptOutcome** | — | The closed set `ACCEPTED` \| `REJECTED` \| `UNKNOWN` \| `UNREACHABLE`. **Wider than `PostingState`** on purpose — an attempt can record an outcome the posting cannot hold. |
| **RejectionReason** | `code`, `message` | A **code** from a closed set plus a human-readable detail. The code is the contract; the detail is for the log (NFR-11 — codes on the wire, text owned by the UI). |
| **LotNumber** | `value` | A bounded, non-empty identifier. Opaque — this unit does not interpret lot formats. |
| **OperatorReference** | `value` | The operator's badge id, carried on the posting so the MES's consumption record says **who** weighed it. Reuses unit 008's `OperatorId`; this is a reference to it, not a copy of it. |

### The quantities

`actualQuantity` is a **`WeightValue`** from unit 004 — the same type, with
the same string-only constructor and the same `decimal.js` arithmetic.

The reuse is deliberate and it is the reason unit 004's value object
exists as a shared type rather than a scale-local one: ADR-008's rule —
*"a quantity crosses every boundary as a decimal string"* — applies to a
consumption posting exactly as it applies to a tare.

**The unit is recorded on the posting**, not inferred. The story's edge
case says: *"The actual quantity is in kilograms while the recipe target
was in grams | The quantity is converted to fixed-point decimal in a
single declared unit before posting; the posted unit is recorded on the
posting."*

---

## Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **ConsumptionPosting** | the posting itself; its attempts | 1. The `id` **is** the idempotency key, and it is **unique** across all postings — the uniqueness is enforced by the ledger's primary key, not by a convention. 2. The `state` advances **only** on a definitive MES answer: `QUEUED → ACCEPTED` or `QUEUED → REJECTED`. 3. A posting's **content** — batch, component, quantity, unit, lot, operator, weighed-at — is **immutable** after creation (DR-02). 4. `actualQuantity` is a fixed-point decimal and its unit is recorded. 5. A rejected posting is **retained**; it is never silently discarded. |

### There is no aggregate spanning a batch and its postings

A batch's `WEIGHED` status is written when **all** of the batch's
postings are resolved — but that is a **read** across the aggregate
boundary, not an invariant inside one aggregate.

The reason is the same one that stopped bolt 005's snapshots from being an
aggregate: **the MES owns the batch**. The station's copy of the batch's
status is a projection of somebody else's truth, and an invariant that
spans it would have to be enforced against data we do not control.

So the rule is expressed where it can be enforced: the status write
**queries** the postings for the batch and refuses to write `WEIGHED`
while any posting is unresolved. It is a **precondition on the write**,
not an invariant on a shared aggregate.

---

## Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **ConsumptionPostingAccepted** | The MES definitively accepts a posting | `postingId`, `batchId`, `componentId`, `acceptedAt` |
| **ConsumptionPostingRejected** | The MES definitively rejects a posting | `postingId`, `batchId`, `componentId`, `reason` (code + detail), `rejectedAt` |
| **ConsumptionPostingAttempted** | One delivery attempt is made, whatever its outcome | `postingId`, `attemptedAt`, `outcome` (`ACCEPTED` \| `REJECTED` \| `UNKNOWN` \| `UNREACHABLE`) |
| **BatchWeighingStatusWritten** | The batch's weighing status is advanced to `WEIGHED` | `batchId`, `status`, `writtenAt` |

### Why there is no `BatchReleased` event

Bolt 005 established this and it carries over: a `BatchReleased` event
would create a **second source of truth** for when a batch was released —
the MES's own record, and this system's inferred one from the difference
between two snapshots. The inferred one would be wrong whenever a read
was missed, and it would be **invisible** when it was wrong.

### Why the attempt event exists even though the outcome event does too

They are not redundant. The attempt event fires **on every attempt**,
including the ones that establish nothing; the outcome event fires only
on a **definitive** answer. A caller that wants to know "what happened?"
subscribes to the attempt event; a caller that wants to know "what is the
state?" reads the posting.

---

## Domain Services

| Service | Operations | Dependencies |
|---------|------------|--------------|
| **ConsumptionPostingService** | `post(posting)` → `ACCEPTED` \| `REJECTED` \| `QUEUED`; `enqueue(posting)` → refused as duplicate, or queued | the `OrgatexAdapter` port; the `IdempotencyLedger`; the `PostingRepository`; the clock |
| **IdempotencyKeyFactory** | `derive(weighingRecord)` → `IdempotencyKey` | the weighing record's identity — **not** the component |
| **BatchStatusWriteService** | `advanceToWeighed(batchId)` → written or refused | the `OrgatexAdapter` port; the `PostingRepository` (to check all postings resolved); the `BatchStatusWriteRepository` |
| **PostingFailureRecorder** | `record(postingId, outcome, reason)` | the `PostingAttemptRepository`; the logger |

### The two guards, and why there are two

The story names two distinct refusals, and they are at **different paths**:

1. **The send path.** Posting the same consumption twice must produce one
   consumption. Guarded by the MES's own idempotency (if it has one) and
   by the **ledger**: a key already recorded as accepted is not sent
   again.
2. **The enqueue path.** *"Given a consumption posting has already been
   enqueued with its idempotency key, When an enqueue of that same key is
   requested, Then the request is refused as a duplicate and no second
   queue entry is created."*

The second guard is on the **enqueue** path, not only on the send path,
and the story says why: *"so that a duplicated submission while the link
is down cannot create two queue entries for one weighing."* That is a
**different failure** from the first — two queue entries for one weighing
means two deliveries, and two deliveries with the same key is exactly what
the key is supposed to prevent, but the local guard must not *rely* on the
MES to dedupe.

**The two guards are not the same check**, and a single "has this key been
seen?" query would be wrong: a key that is `ACCEPTED` must not be
re-enqueued, and a key that is `QUEUED` must not be re-enqueued, but a key
that is `REJECTED` **may** be — a rejected posting's retryability follows
the configured disposition (CQ-06).

---

## Repository Interfaces

| Repository | Entity | Methods |
|------------|--------|---------|
| **IdempotencyLedger** | `IdempotencyKey` | `has(key)` → boolean; `record(key, postingId, acceptedAt)` → void; `find(key)` → the ledger entry \| null. **Persisted.** Unique on `key`. |
| **PostingRepository** | `ConsumptionPosting` | `save(posting)` → void; `findById(id)` → posting \| null; `findByBatch(batchId)` → postings[]; `findByKey(key)` → posting \| null. **Persisted.** |
| **PostingAttemptRepository** | `PostingAttempt` | `append(attempt)` → void; `findByPosting(postingId)` → attempts[] **in order**. **Persisted, append-only.** |
| **BatchStatusWriteRepository** | `BatchStatusWrite` | `save(write)` → void; `findByBatch(batchId)` → writes[]. **Persisted.** |

### Why the ledger is a SEPARATE repository from the postings

They could be one table, and the ledger is the smaller one. They are
separate because they answer **different questions** with different
lifetimes:

- The **ledger** answers *"has this key ever been consumed?"* — a
  yes/no, and it is the thing that makes a retry safe.
- The **postings** answer *"what did we try to send, and what happened?"* —
  a history.

The ledger is the **deduplication index**; the postings are the **record**.
Keeping them apart means the deduplication check does not have to parse a
posting's state to answer a question about a key — and it means a posting
whose history is long does not make the key lookup slow.

### What is NOT persisted

- **No snapshot.** Bolt 005's ADR-021 stands; this bolt adds no table for
  the queue or the recipe.
- **No attempt's outcome is updated.** Attempts are appended, never
  rewritten — the same append-only discipline as ADR-006's consumption
  records and ADR-009's link events.
- **No `idempotency_key` on the MES side is assumed.** The key is carried
  on the request, but **no claim is made that OrgaTEX understands it**
  (Q-02 is unanswered). If it does not, the local ledger is the fallback,
  and the behaviour is unchanged from the caller's point of view.

---

## Ubiquitous Language

| Term | Definition |
|------|------------|
| **Posting** | One intended write of what was dispensed, for one component of one batch. |
| **Idempotency key** | The posting's identity, derived from the weighing record, and carried on every attempt. A retry of the same weighing reuses it; a second weighing of the same component does not. |
| **Ledger** | The durable record of which keys have been consumed. The thing that makes a retry safe. |
| **Attempt** | One try to deliver a posting. Append-only. Its outcome may be `UNKNOWN`, which the posting's state may not be. |
| **Definitive answer** | The MES's `ACCEPTED` or `REJECTED`. Only a definitive answer advances a posting's state. |
| **Ambiguous outcome** | A timeout, a dropped connection, a lost response. The attempt records it; the posting stays `QUEUED`; the next attempt reuses the key. |
| **Resolved** | A posting whose state is `ACCEPTED` or `REJECTED`. A batch's status advances to `WEIGHED` only when every one of its postings is resolved. |
| **Rejected** | The MES definitively refused the posting. The reason is recorded and the posting is retained. **Not** discarded. |
| **Pending** | What a `QUEUED` posting is reported as. Never "posted". |
| **Unlanded** | A posting the station believes it sent but cannot prove. The reason the ledger is durable. |
| **Batch status write** | The write of exactly one OrgaTEX field — the weighing status. No other OrgaTEX batch field is ever altered. |

---

## Story Coverage

### Story `003-post-consumption-idempotently`

| # | Acceptance criterion | Covered by |
|---|----------------------|-----------|
| 1 | The posting carries the batch id, the component id, the actual quantity, the unit, the lot number, the operator id and the time of the weighing, as fixed-point decimal where they are quantities | `ConsumptionPosting`; `WeightValue` (ADR-008); `OperatorReference`; `LotNumber` |
| 2 | Posting the same consumption twice produces exactly one consumption — the second post adds nothing | `IdempotencyLedger`; the send-path guard; the `ACCEPTED` key is not sent again |
| 3 | An enqueue of a key already enqueued is refused as a duplicate, and no second queue entry is created | the enqueue-path guard; `IdempotencyLedger.has(key)` |
| 4 | A retry after an ambiguous outcome carries the **same** idempotency key | `IdempotencyKey` is the posting's `id`; the retry reuses the posting; `AttemptOutcome.UNKNOWN` |
| 5 | A failure is logged with enough detail to diagnose it without OrgaTEX-side access | `PostingAttempt`; `PostingFailureRecorder`; `RejectionReason` |
| 6 | The batch's weighing status advances to `WEIGHED`, and **no other** OrgaTEX batch field is altered | `BatchStatusWrite`; `BatchStatusWriteService.advanceToWeighed`; the adapter's write method touches one field |

### Edge cases from the story

| Scenario | Where it is answered |
|----------|----------------------|
| The MES accepts but the response is lost | `AttemptOutcome.UNKNOWN`; the posting stays `QUEUED`; the retry reuses the key |
| The operator confirms the same component twice | `IdempotencyKeyFactory` derives from the **weighing record**, not the component — so the keys differ |
| Two postings for the same component and batch, concurrently | the ledger's **unique** key; one is admitted, the other refused |
| The MES rejects the posting as invalid | `REJECTED`; the reason is recorded; the posting is retained |
| The MES rejects because the batch is not postable | the same, with the MES's own reason code; surfaced for manual attention (FR-33) |
| The link is down when the posting is attempted | the posting is enqueued and reported as **pending**, never as posted |
| The actual quantity is zero | a zero quantity is a **quantity**, distinguishable from a missing posting |
| Kilograms posted where the recipe target was grams | the quantity is converted to a single declared unit before posting, and the posted unit is recorded |
| Posted after the MES moved the batch past `WEIGHED` | the rejection is recorded; the weighing record is **not** affected (DR-02) |
| The batch has several components | each is a separate posting with its own key; `WEIGHED` is written only when all are resolved |

---

## Constraints carried into the Technical Design

1. **Every quantity is a fixed-point decimal**, on the wire and on disk
   (ADR-008, NFR-16).
2. **The posting is immutable**; its state advances by appending
   (DR-02).
3. **The attempts are append-only** and are never rewritten.
4. **The ledger is persisted**, and so are the postings, the attempts and
   the status writes (DR-01 — ≥ 5 years).
5. **No OrgaTEX batch field other than the weighing status is altered**
   (C-01, BRD §9.2).
6. **A rejected posting is retained**, never discarded, and its
   retryability is a **configuration value** (CQ-06).
7. **The idempotency key's shape is local.** No claim is made that
   OrgaTEX understands it (Q-02).
8. **The MES's contract is assumed, not confirmed.** The adapter's write
   methods are the seam; the shape on the far side is not asserted as fact.
