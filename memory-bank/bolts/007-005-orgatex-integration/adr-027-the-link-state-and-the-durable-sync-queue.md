---
bolt: 007-005-orgatex-integration
created: 2026-11-03T14:10:00Z
status: accepted
superseded_by: null
---

# ADR-027: The MES link state is derived, and the sync queue is the only durable record of an unlanded consumption

## Context

The weighing station must work while OrgaTEX is unreachable. Two things
are missing, and bolt `007` supplies exactly those two things.

**A truthful link state.** The station's relationship with the MES is a
fact about a **boundary**, observed from contact outcomes and **derived** —
never asserted by a literal and never guessed by a UI layer. The prototype
shows a hard-coded `ORGATEX · LINKED` label, which is a statement about
nothing.

**A durable sync queue.** When a confirmed weighing cannot be posted to
OrgaTEX, the posting must survive the outage *and* the restart, must be
reported as **pending** (never as posted), and must later be delivered
with the **same idempotency key** it was first created with, so that a
recovery cannot double-count a dye batch.

The governing rule is the BRD's, and it decides every shape below:

> *"No failure at any boundary may produce a silently wrong number."*

The two stories in scope are `004-report-link-state` and
`005-queue-writes-offline-and-sync-on-recovery`, both `must`. The upstream
anchors are FR-19, FR-20, NFR-03, NFR-05, NFR-11, NFR-14, NFR-16, DR-01,
DR-02, IR-07, IR-08 and AC-09.

The binding prior decisions are ADR-011 (the link state is a separate axis
from the published device status), ADR-012 (the disconnection deadline is
scheduled, not polled), ADR-021 (the snapshots are not persisted),
ADR-022 (the adapter's transport is not exercised by the tests),
ADR-023 (the ledger's PRIMARY KEY is the idempotency guarantee), ADR-024
(the posting's content is immutable), ADR-025 (the local ledger is the
guarantee) and ADR-026 (the rejection disposition is configuration).

### The ten questions this decision answers

The Stage 1 domain model fixed the shape but left ten decisions open. They
are stated here because a decision with no stated reasoning is one a future
agent will not question:

1. **OQ-1** — the freshness window's name and owner.
2. **OQ-2** — the backoff schedule's configuration surface.
3. **OQ-3** — `jitter` as a value or as a function.
4. **OQ-4** — what "queue order" means durably.
5. **OQ-5** — which contact outcomes update the link state.
6. **OQ-6** — what triggers the retry worker.
7. **OQ-7** — whether an online `REJECTED` posting gets a queue entry.
8. **OQ-8** — the re-drive's entry point, and whether it is privileged.
9. **OQ-9** — the retention mechanics for a delivered queue entry.
10. **OQ-10** — the presentation scope.

## Decision

### The link state is derived, never stored

The link state is exactly one of `LINKED` | `DEGRADED` | `OFFLINE`, and
it is **derived from observed contact outcomes** by a pure function:

```text
LINKED     consecutiveFailures === 0
DEGRADED   the last contact failed
           AND a last successful contact exists
           AND now − lastSuccessAt ≤ freshnessWindow
OFFLINE    otherwise — including "never contacted successfully"
```

The persisted row holds the **observations** — the last successful
contact time, the last failure, the failure count — and **never** the
derived status. A persisted status would be a second source of truth that
could disagree with the derivation.

The boundary is **inclusive**: at exactly `window.durationMs` the state is
still `DEGRADED`, and one millisecond later it is `OFFLINE`. A freshness
window of **zero** is legal and makes `DEGRADED` unreachable.

**Every** MES contact outcome — the posting path's, the read path's and the
queue's delivery — reports through **one** service, `LinkStateService`.
There is one writer of the observation row and **no separate health
probe**, because a probe would be a second writer and a second opinion
about the same boundary.

The freshness deadline is **scheduled** at the moment a contact fails
(ADR-012), and the scheduled callback evaluates the **same pure policy**
the contact path evaluates, so the two paths cannot disagree.

**Weighing continues in every link state.** The state changes what the
MES-facing reads and writes do; it never refuses a weighing.

### The sync queue is the only durable record of an unlanded consumption

A `SyncQueueEntry` carries an **immutable copy** of the posting's content
(ADR-024), its attempt count, its last error and its next attempt time.
Its state is `PENDING` | `FAILED` — there is deliberately **no**
`DELIVERED` state, because a delivered entry leaves the queue and the
*posting* becomes `ACCEPTED`. A `DELIVERED` row would be a second source
of truth that could disagree with the ledger.

Six invariants, enforced by the aggregate's constructor and by the table's
constraints:

1. `postingId` **is** the idempotency key and is unique across the queue.
2. The content is **immutable** once written.
3. `attempts` only ever **increases**.
4. A `PENDING` entry **always** has a next attempt time.
5. A `FAILED` entry has **no** next attempt time — it is off the automatic path.
6. The entry is **never silently discarded**: it leaves the queue only by being delivered, and it is never deleted while it is failed.

### The queue does not implement posting — it reuses bolt 006's path

This is the decision that keeps the idempotency guarantee single-sourced.

Every delivery goes through `ConsumptionPostingService.post()`, which
already derives the key from the weighing's identity, refuses a key in the
**ledger** (the atomic PRIMARY KEY guard, ADR-023), refuses a second
enqueue of a key whose posting is still `QUEUED`, and writes the posting,
the attempt and the ledger entry in **one transaction**.

If bolt 007 wrote its own send path, *"has this key been consumed?"* would
have two implementations, and they would drift.

### The two guards are different checks

- **On enqueue:** the key is refused if it is in the **ledger** *or* already
  in the **queue**. The two are read **together**, because a `QUEUED`
  posting's key is deliberately absent from the ledger (ADR-023).
- **On delivery:** the queue calls bolt 006's path, which consults the
  ledger before it sends. There is **one** implementation of the check.

The **ledger's presence always wins**. The queue holds the keys the ledger
does not yet hold — the keys of postings that have not landed.

### The rejection disposition is consumed, not re-decided

ADR-026 made the disposition configuration, defaulting to `RETRYABLE`, and
left the decision of *what to do next* to this bolt.

- `RETRYABLE` (the default): the entry stays `PENDING`, the attempt count
  and the last error are updated, and it returns to the queue with a
  backoff. **The entry is not removed.**
- `PERMANENT`: the entry becomes `FAILED` — visible, with its last error,
  attempt count and last attempt time, and re-drivable by an operator. It
  is **not** deleted.

**Under either disposition the entry is retained.** The disposition decides
whether the *worker* tries again; it never decides whether the *record*
survives.

### The decisions that answer the ten questions

| # | Decision |
|---|---|
| **OQ-1** | **One number, one env var.** `WEIGHINGMS_ORGATEX_SNAPSHOT_TTL_MS` feeds both bolt 005's read path and this bolt's `FreshnessWindow`. `WEIGHINGMS_ORGATEX_FRESHNESS_WINDOW_MS` is **not** introduced. Unifying `FreshnessWindow` with bolt 005's `SnapshotFreshness` into one type is deferred and needs an ADR, because it would edit bolt 005's tree. |
| **OQ-2** | `WEIGHINGMS_ORGATEX_SYNC_BACKOFF_BASE_MS` / `_MAX_MS` / `_MULTIPLIER` / `_JITTER_MS`, defaults 1000 / 300000 / 2 / 250, plus `WEIGHINGMS_ORGATEX_SYNC_RETRY_INTERVAL_MS` at 5000. |
| **OQ-3** | `jitter` is a **bounded magnitude** (`jitterMs`), with the randomness **injected** as a `random: () => number` source, so the policy stays pure and testable. |
| **OQ-4** | `queued_at ASC, posting_id ASC` — a total order, stable across processes and across a restart, matching the shape bolt 006's `findByBatch` already uses. |
| **OQ-5** | **All** contact outcomes report through `LinkStateService`. One writer, no health probe. |
| **OQ-6** | **Both.** The flush on recovery is **event-driven** from the `LINKED` transition; the periodic retry is a **scheduled** task with a bounded interval. |
| **OQ-7** | **No.** A queue entry exists only for the **offline** path. An online rejection is recorded on the posting (bolt 006) and surfaced through the same disposition reader. |
| **OQ-8** | An **ordinary operator action** at `POST /api/orgatex/sync-queue/:postingId/redrive`. No supervisor authorisation in this bolt; the seam with unit `008` is recorded, not crossed. |
| **OQ-9** | A delivered entry leaves the **queue**. The five-year durable history stays in bolt 006's `consumption_postings` and `posting_attempts`. The queue is never pruned. |
| **OQ-10** | This bolt exposes the link state, the un-synchronised count and the queue entries as **data** through the controller. Unit `007` (`028-007-weighingms-ui`) renders them. |

### The three new tables

`sync_queue_entries` (the durable unlanded record), `link_contact_observations`
(one row, the observations only) and `link_transitions` (the append-only
status-change log). There is **no snapshot table** (ADR-021), **no second
idempotency ledger** (ADR-023) and **no queue-attempt history table** — the
attempt history stays in bolt 006's `posting_attempts`, which carries the
five-year retention.

`link_transitions` carries triggers that abort any UPDATE or DELETE: a
history that could be rewritten is not a history, and a trigger is stronger
than a convention.

## Rationale

### Why the link state is derived rather than stored

A stored status is a **second source of truth**. It has to be updated on
every path that can change the link — the posting path, the read path, the
queue's delivery, the scheduled deadline — and every path that forgets is
a path that reports the wrong state to the operator. Deriving it from the
observations means there is exactly one thing to keep correct, and the
derivation is a pure function that can be tested at an exact instant.

The same reasoning is why there is **no health probe**: a probe would be a
second writer, and it would also be a *different* opinion about the same
boundary from the one the operator's last real request produced.

### Why the MES link is not the scale's link

ADR-011 established that the link state is a separate axis from any
self-reported device status. The MES is **not a device** — it has no idea
it is unreachable, so every word of the link state is something the station
concluded.

The scale's link can **block weighing**: a disconnected scale has no weight
to confirm. The MES's link **cannot** — there is no reading to take from
OrgaTEX, and the BRD requires the shift to continue without it. A shared
"link" abstraction carrying the scale's semantics would import *"disconnected
means blocking"* into a boundary where blocking is forbidden.

### Why the queue entry duplicates the posting's content

A queue entry holding only `postingId` and reading the posting at delivery
time would be less data and one source of truth. It is rejected for two
reasons, and both come from ADR-024:

1. The posting's state is **mutable** — it moves `QUEUED → ACCEPTED`. A
   queue that reads a mutable row at delivery time has content that can
   change underneath it.
2. The queue must be **self-sufficient to deliver**. A flush is the one
   operation that runs while something else may have failed; depending on a
   second row gives it two failure modes instead of one.

### Why the delivery reuses bolt 006's posting path

Because the alternative is two implementations of *"has this key been
consumed?"*, and the guarantee that matters most in this bolt is exactly
that one.

The ledger's PRIMARY KEY is the **atomic** guard (ADR-023): there is no
check-then-write window. The queue's enqueue guard is a *read* — it avoids
doing the work twice — and the **ledger's constraint** is what actually
admits one posting of a key. If the queue wrote its own send path, the
read would become the guard, and a read cannot be atomic.

### Why `RETRYABLE` is consumed rather than re-decided

ADR-026 already made the disposition configuration and deliberately did not
resolve CQ-06. This bolt consumes it, and it does so without re-deciding
anything: the posting's state is `REJECTED` under either disposition, and
the disposition decides only whether the *worker* tries again.

The asymmetry is the same one ADR-026 reasoned about, applied to the
queue: a permanently-dropped consumption is a **silently wrong number**,
and a noisy retry is a **visible problem**. Between the two, the loud one
is the safer failure. That is why **the entry is retained under either
disposition** — the disposition decides whether the automation stops, not
whether the record disappears.

### Why a re-drive is not privileged

Because it re-sends work the operator themselves produced — their own
weighing, with their own captured operator identity — and because the
alternative would open a seam into unit `008`'s authorisation flow for no
security benefit. The seam is recorded rather than crossed, and a change
would need an ADR.

### Why the transport gap is carried forward rather than closed

ADR-022 established that the adapter is in-process and that the transport
is not exercised by the tests. This bolt inherits that gap rather than
closing it. The tests prove the domain rules and the in-process adapter's
behaviour; a timeout, a TLS failure and a retry storm live in the
transport, and the transport is untested until a real adapter exists.

The gap is stated in the design, in this ADR and — again — in the Stage 5
test report. It is not an oversight.

## Consequences

### Positive

- **The link state cannot be wrong by being stale.** It is recomputed from
  the observations on every read, so there is no window in which a stored
  status disagrees with reality.
- **The queue cannot double-deliver.** Every delivery goes through the one
  ledger-guarded path, and the key is the entry's own.
- **An outage cannot become a wrong number.** An undeliverable posting is
  enqueued, reported as pending, survives a restart and is delivered later
  — with the same key, in order, without duplication (AC-09).
- **A failed write is visible.** A `FAILED` entry carries its last error,
  attempt count and last attempt time, and can be re-driven. Nothing is
  silently discarded.
- **The station keeps weighing.** No link state refuses a weighing.
- **Every open question is answered and recorded**, with its reasoning, so
  a future agent inherits the reasoning rather than re-deriving it.

### Negative

- **Two freshness value objects now describe the same duration.**
  `FreshnessWindow` (this bolt) and `SnapshotFreshness` (bolt 005). The
  *number* is unified — one env var, read once — but the types are not,
  and unifying them would edit bolt 005's tree. The deferral is recorded
  in OQ-1.
- **The queue grows during a long outage.** It is a table of rows, not a
  memory cache, but it is not pruned. A prune policy would need an ADR,
  because a silent prune is exactly the failure this bolt exists to
  prevent.
- **The retry defaults are operational choices, not requirements.** They
  are configuration, and a mis-sized deployment can hammer the MES or stall
  the queue.
- **The link state is now a first-class concept in the unit.** A future
  change to the derivation touches the read path, the posting path and the
  queue's delivery — deliberately, because those are the three places a
  contact can happen.
- **The transport remains untested.** The bolt's correctness claims stop
  at the adapter boundary, and the Stage 5 report must say so.

### Risks

- **A future agent computes the link state in a second place**, and the two
  disagree. *Mitigation*: one writer, one pure policy, used by both the
  contact path and the scheduled path.
- **A future agent writes a second send path** for the queue, to "avoid"
  the round trip through bolt 006. *Mitigation*: this ADR states that the
  queue calls `ConsumptionPostingService`; a second implementation of the
  idempotency check is the failure ADR-023 exists to prevent.
- **A future agent treats `PERMANENT` as "not worth keeping"** and prunes
  the failed entry. *Mitigation*: this ADR states that the entry is
  retained under **both** dispositions, and the table's constraints make a
  silent disappearance impossible.
- **The MES's write contract stays unknown** (A-02, Q-01, Q-02). This ADR
  assumes the worst case — no deduplication, key unread — and the local
  ledger is the guarantee (ADR-025).

## Related

- **Stories**: `004-report-link-state`, `005-queue-writes-offline-and-sync-on-recovery`
- **Requirements**: FR-19, FR-20, NFR-03, NFR-05, NFR-11, NFR-14, NFR-16, DR-01, DR-02, IR-07, IR-08, AC-09
- **Previous ADRs**: ADR-011 (the link state is a separate axis from the published device status); ADR-012 (the disconnection watchdog is scheduled, not polled — the same split of responsibilities, extended from a reading's receipt time to a contact's success time); ADR-021 (the snapshots are not persisted — the queue is a statement about what *we* did and cannot be re-derived); ADR-022 (the adapter's transport is not exercised by the tests — the gap carries forward); ADR-023 (the ledger's PRIMARY KEY is the idempotency guarantee — the queue reads it and the ledger's presence always wins); ADR-024 (the posting's content is immutable — the queue entry carries an immutable copy); ADR-025 (the local ledger is the guarantee — the same "assume the worst case" reasoning about an unconfirmed external contract); ADR-026 (the rejection disposition is configuration — consumed here, not re-decided)
- **Artifacts**: `memory-bank/bolts/007-005-orgatex-integration/ddd-01-domain-model.md` (the contract source), `memory-bank/bolts/007-005-orgatex-integration/ddd-02-technical-design.md` (the implementation of this decision), `memory-bank/standards/tech-stack.md` § "Database" — DR-01's ≥ 5-year retention and the append-only discipline
