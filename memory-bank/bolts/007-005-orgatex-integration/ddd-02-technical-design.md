---
unit: 005-orgatex-integration
bolt: 007-005-orgatex-integration
stage: design
status: complete
updated: 2026-11-03T17:30:00Z
---

# Technical Design - OrgaTEX Integration (bolt 007)

> The link state and the durable synchronisation queue for unit
> `005-orgatex-integration`.
>
> **Stories**: `004-report-link-state`, `005-queue-writes-offline-and-sync-on-recovery`.
> **Domain model**: `ddd-01-domain-model.md`.
> **Context and constraints**: `adr-027-the-link-state-and-the-durable-sync-queue.md`.

The governing rule is the one the domain model states and the BRD
requires:

> *No failure at any boundary may produce a silently wrong number.*

Everything below is shaped by that sentence. A link state that is guessed,
a queued write reported as posted, a failed entry deleted — each is the
same failure wearing different clothes.

---

## Architecture Pattern

**Hexagonal (ports and adapters), continuing bolt 005's read structure and
bolt 006's write structure.**

Bolt 007 adds **two capabilities** to the existing bounded context. It
does not open a new one, and it does not add a second MES seam (IR-07).

```text
        ┌──────────────────────────────────────────────────────────┐
        │  Presentation                                           │
        │  orgatex-controller.ts  (grows three endpoints)          │
        │  orgatex-write-schemas.ts (grows the response shapes)    │
        ├──────────────────────────────────────────────────────────┤
        │  Application (domain services)                          │
        │  LinkStateService    LinkStatePolicy (pure)             │
        │  SyncQueueService    SyncBackoffPolicy (pure)           │
        │  ConsumptionPostingService (bolt 006 — CALLED)          │
        ├──────────────────────────────────────────────────────────┤
        │  Domain                                                │
        │  LinkState · LinkStatus · FreshnessWindow               │
        │  SyncQueueEntry · SyncQueueEntryState                   │
        │  BackoffSchedule · SyncError · LinkTransition           │
        │  ═══ PORTS ═══                                         │
        │  OrgatexAdapter (bolt 005/006 — UNCHANGED)              │
        │  SyncQueueRepository · LinkContactRepository             │
        │  LinkTransitionRepository · LinkFreshnessScheduler      │
        │  RejectionDispositionReader                             │
        │  IdempotencyLedger · PostingRepository (bolt 006)       │
        │  PostingAttemptRepository (bolt 006)                    │
        ├──────────────────────────────────────────────────────────┤
        │  Infrastructure                                        │
        │  SqliteSyncQueueRepository                              │
        │  SqliteLinkContactRepository                           │
        │  SqliteLinkTransitionRepository                        │
        │  NodeLinkFreshnessScheduler · SyncRetryWorker           │
        │  DummyOrgatexAdapter (bolt 005/006 — UNCHANGED)         │
        │  orgatex-config.ts · composition-root.ts                │
        └──────────────────────────────────────────────────────────┘
```

### Why the same pattern, not a new one

IR-07 says *"All OrgaTEX interaction is confined to a single adapter
component."* A second adapter beside the existing one would be two seams,
and replacing the Dummy with the real MES would touch both.

So bolt 007 adds **no method** to `OrgatexAdapter` and **no second
adapter**. The queue reaches the MES through the port that already
exists, and the link state is derived from the outcomes of calls that
already happen.

### The one structural decision that matters most

**The queue does not implement posting. It reuses bolt 006's
`ConsumptionPostingService`.**

This is the decision that keeps the idempotency guarantee single-sourced.
`ConsumptionPostingService.post()` already:

- derives the key from the weighing's identity (`IdempotencyKeyFactory`),
- refuses a key already in the **ledger** (the atomic PRIMARY KEY guard,
  ADR-023),
- refuses a second enqueue of a key whose posting is still `QUEUED`,
- writes the posting, the attempt and the ledger entry in **one
  transaction** (`SqliteUnitOfWork`),
- reports a definitive rejection as `REJECTED` and an unreachable MES as
  `QUEUED`.

If bolt 007 wrote its own send path, "has this key been consumed?" would
have two implementations, and they would drift. The queue's job is
**when** to send and **what to do when it fails** — not **how** to send.

The consequence is a clean seam: `SyncQueueService` owns the queue's
lifecycle; `ConsumptionPostingService` owns the delivery.

### What stays exactly as it was

**The adapter remains in-process**, and ADR-022's gap carries forward
unchanged: the **transport is still not exercised by these tests**. A
timeout, a TLS failure and a retry storm live in the transport, and the
transport is untested until a real adapter exists. The Stage 5 test
report must say so again.

---

## Layer Structure

### Domain — `src/005-orgatex-integration/domain/`

```text
domain/
├── value-objects/
│   ├── link-status.ts              ← NEW  LinkStatus, LinkStatusCode
│   ├── link-state.ts               ← NEW  LinkState
│   ├── freshness-window.ts         ← NEW  FreshnessWindow
│   ├── sync-queue-entry-state.ts   ← NEW  SyncQueueEntryState
│   ├── backoff-schedule.ts         ← NEW  BackoffSchedule
│   ├── sync-error.ts               ← NEW  SyncError, SyncErrorCode
│   ├── snapshot-freshness.ts       (existing, UNCHANGED — bolt 005)
│   ├── posting-state.ts            (existing, UNCHANGED — bolt 006)
│   ├── idempotency-key.ts          (existing, UNCHANGED — bolt 006)
│   └── rejection-reason.ts         (existing, UNCHANGED — bolt 006)
├── entities/
│   ├── sync-queue-entry.ts         ← NEW  SyncQueueEntry
│   ├── link-transition.ts          ← NEW  LinkTransition
│   ├── postings.ts                 (existing, UNCHANGED — bolt 006)
│   └── snapshots.ts                (existing, UNCHANGED — bolt 005)
├── services/
│   ├── link-state-policy.ts        ← NEW  LinkStatePolicy (pure)
│   ├── link-state-service.ts       ← NEW  LinkStateService
│   ├── sync-queue-service.ts       ← NEW  SyncQueueService
│   ├── sync-backoff-policy.ts      ← NEW  SyncBackoffPolicy (pure)
│   ├── sync-retry-worker.ts        ← NEW  SyncRetryWorker
│   ├── consumption-posting-service.ts (existing — CALLED, not rewritten)
│   └── batch-queue-reader.ts       (existing — MODIFIED: reports contacts)
├── ports/
│   ├── sync-queue-repositories.ts  ← NEW  SyncQueueRepository
│   ├── link-repositories.ts        ← NEW  LinkContactRepository,
│   │                                     LinkTransitionRepository,
│   │                                     LinkFreshnessScheduler,
│   │                                     RejectionDispositionReader
│   ├── orgatex-adapter.ts          (existing, UNCHANGED — the seam)
│   └── posting-repositories.ts     (existing, UNCHANGED — bolt 006)
└── events/
    ├── link-events.ts              ← NEW  LinkStateChanged
    └── sync-queue-events.ts        ← NEW  SyncEntryQueued,
                                          SyncEntryAttempted,
                                          SyncEntryFailed,
                                          SyncEntryDelivered,
                                          SyncQueueFlushed
```

The repository-port grouping follows the repo's existing convention:
repository ports live in `domain/ports/*-repositories.ts` — bolt 006's
`posting-repositories.ts` holds four ports in one file, so bolt 007 uses
one `sync-queue-repositories.ts` and one `link-repositories.ts` rather
than a file per port.

### Infrastructure — `src/005-orgatex-integration/infrastructure/`

```text
infrastructure/
├── adapters/
│   ├── dummy-orgatex-adapter.ts  (existing, UNCHANGED)
│   └── dummy-orgatex-data.ts     (existing, UNCHANGED)
├── config/
│   └── orgatex-config.ts         ← MODIFIED (grows the backoff schedule)
├── persistence/
│   ├── orgatex-database.ts       ← MODIFIED (grows three tables)
│   ├── sqlite-sync-queue-repository.ts        ← NEW
│   ├── sqlite-link-contact-repository.ts      ← NEW
│   ├── sqlite-link-transition-repository.ts   ← NEW
│   └── sqlite-unit-of-work.ts    (existing, UNCHANGED — reused)
└── composition-root.ts           ← MODIFIED (wires the new services)
```

**There is no new adapter directory entry.** The scheduler and the retry
worker are not MES adapters — they are Node timers, and they live with
the other infrastructure.

### Presentation — `src/005-orgatex-integration/presentation/`

```text
presentation/
├── controllers/
│   ├── orgatex-controller.ts     ← MODIFIED (grows three endpoints)
│   └── dummy-orgatex-controller.ts (existing, UNCHANGED)
└── schemas/
    └── orgatex-write-schemas.ts  ← MODIFIED (grows the response shapes)
```

### The three new tables

All three live in the **same database file** as the identity, scale and
OrgaTEX write tables, sharing one `schema_migrations` table — the pattern
`openOrgatexDatabase` already established.

```text
┌──────────────────────────────┐
│ sync_queue_entries           │  the durable record of an unlanded write
├──────────────────────────────┤
│ link_contact_observations    │  ONE row: the observations, never the state
├──────────────────────────────┤
│ link_transitions             │  append-only: the status-change log
└──────────────────────────────┘
```

And the tables bolt 007 does **not** create:

- **No snapshot table.** ADR-021 stands — the batch queue and the recipe
  are projections of a system the station does not own, and a snapshot can
  always be re-fetched.
- **No second idempotency ledger.** The ledger remains bolt 006's
  (`idempotency_ledger`), and its PRIMARY KEY remains the guarantee
  (ADR-023).
- **No queue-attempt history table.** Attempt history stays in bolt 006's
  `posting_attempts`, which carries the five-year retention.

---

## The Three New Tables in Detail

### `sync_queue_entries`

The queue entry is the **durable record of a posting that has not
landed**. It carries an **immutable copy** of the posting's content, so a
flush can deliver it without consulting a mutable posting row (ADR-024).

| Column | Type | Notes |
|---|---|---|
| `posting_id` | TEXT PK | **The idempotency key.** Unique across the queue — the duplicate guard. |
| `batch_id` | TEXT NOT NULL | Immutable content. |
| `component_id` | TEXT NOT NULL | Immutable content. |
| `actual_quantity` | TEXT NOT NULL | **TEXT, never REAL** (NFR-16). |
| `unit` | TEXT NOT NULL | Immutable content. |
| `lot_number` | TEXT NOT NULL | Immutable content. |
| `operator_id` | TEXT NOT NULL | Immutable content. |
| `weighed_at` | TEXT NOT NULL | ISO-8601 instant. Immutable content. |
| `queued_at` | TEXT NOT NULL | ISO-8601 instant. First element of the queue order. |
| `attempts` | INTEGER NOT NULL | `DEFAULT 0`, `CHECK (attempts >= 0)`. Only ever increases. |
| `last_attempt_at` | TEXT | ISO-8601 instant of the last attempt. |
| `next_attempt_at` | TEXT | ISO-8601 instant of the next automatic attempt. |
| `last_error_code` | TEXT | `UNREACHABLE` \| `TIMEOUT` \| `REJECTED` \| `MALFORMED`. |
| `last_error_summary` | TEXT | Bounded summary — safe to return to a client. |
| `last_error_detail` | TEXT | Bounded detail — **log only**, never returned. |
| `state` | TEXT NOT NULL | `CHECK (state IN ('PENDING','FAILED'))`. |

Timestamps are **ISO-8601 TEXT**, matching every other table in the unit
(`consumption_postings.created_at`, `posting_attempts.attempted_at`).
The queue order is `ORDER BY queued_at ASC, posting_id ASC` — the same
shape bolt 006's `findByBatch` already uses (`ORDER BY created_at ASC,
id ASC`), so the two are consistent and the order is total and stable
across processes.

There is **no `DELIVERED` state.** A delivered entry leaves the queue and
the *posting* becomes `ACCEPTED` — two different records answering two
different questions, and a `DELIVERED` row would be a second source of
truth that could disagree with the ledger.

The table-level constraints that carry the invariants:

```sql
CREATE TABLE IF NOT EXISTS sync_queue_entries (
  posting_id         TEXT    NOT NULL PRIMARY KEY,
  batch_id           TEXT    NOT NULL,
  component_id       TEXT    NOT NULL,
  actual_quantity    TEXT    NOT NULL,
  unit               TEXT    NOT NULL,
  lot_number         TEXT    NOT NULL,
  operator_id        TEXT    NOT NULL,
  weighed_at         TEXT    NOT NULL,
  queued_at          TEXT    NOT NULL,
  attempts           INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_attempt_at    TEXT,
  next_attempt_at    TEXT,
  last_error_code    TEXT,
  last_error_summary TEXT,
  last_error_detail  TEXT,
  state              TEXT    NOT NULL CHECK (state IN ('PENDING', 'FAILED')),
  -- invariant 4: a PENDING entry always has a next attempt time
  -- invariant 5: a FAILED entry has none
  CHECK (
    (state = 'PENDING' AND next_attempt_at IS NOT NULL)
    OR (state = 'FAILED' AND next_attempt_at IS NULL)
  )
);
```

Indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_sync_queue_entries_due
  ON sync_queue_entries (next_attempt_at, queued_at, posting_id)
  WHERE state = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_sync_queue_entries_queue_order
  ON sync_queue_entries (queued_at, posting_id);
```

### `link_contact_observations`

**One row.** It holds the **observations** only. The derived status is
never stored — a persisted status would be a second source of truth that
could disagree with the derivation (ADR-027 §3.3 rule 2).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | `CHECK (id = 1)` — the single row. |
| `last_success_at` | TEXT | ISO-8601 instant of the last **successful** contact; null until one occurs. |
| `last_failure_at` | TEXT | ISO-8601 instant of the last failed contact. |
| `last_error_code` | TEXT | The last failure's code. |
| `last_error_summary` | TEXT | Bounded summary. |
| `last_error_detail` | TEXT | Bounded detail — **log only**. |
| `consecutive_failures` | INTEGER NOT NULL | `DEFAULT 0`, `CHECK (consecutive_failures >= 0)`. |

The row is inserted by the migration (`INSERT … VALUES (1, 0)`), so
`read()` never has to special-case a missing row.

### `link_transitions`

**Append-only.** The status-change log R-05 requires.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | The transition's order. |
| `from_status` | TEXT NOT NULL | `CHECK (from_status IN ('LINKED','DEGRADED','OFFLINE'))`. |
| `to_status` | TEXT NOT NULL | `CHECK (to_status IN ('LINKED','DEGRADED','OFFLINE'))`. |
| `occurred_at` | TEXT NOT NULL | ISO-8601 instant. |
| `cause` | TEXT NOT NULL | `CONTACT_SUCCESS` \| `CONTACT_FAILURE` \| `FRESHNESS_DEADLINE` \| `FIRST_OBSERVATION`. |

The append-only rule is enforced at the **storage** level, not by
convention:

```sql
CREATE TRIGGER IF NOT EXISTS trg_link_transitions_no_update
BEFORE UPDATE ON link_transitions
BEGIN SELECT RAISE(ABORT, 'link_transitions is append-only'); END;

CREATE TRIGGER IF NOT EXISTS trg_link_transitions_no_delete
BEFORE DELETE ON link_transitions
BEGIN SELECT RAISE(ABORT, 'link_transitions is append-only'); END;
```

A history that could be rewritten is not a history, and a trigger is
stronger than a convention.

---

## Configuration

Every value here is a **parameter of a rule**, not a constant buried in an
implementation, so an operational question can be answered without a
rebuild (NFR-14).

| Env var | Used for | Default | Existing? |
|---|---|---|---|
| `WEIGHINGMS_ORGATEX_SNAPSHOT_TTL_MS` | `FreshnessWindow.durationMs` — the same window bolt 005's read path uses | `300000` (5 min) | **Yes — reused, not duplicated** |
| `WEIGHINGMS_ORGATEX_REJECTION_DISPOSITION` | `RejectionDispositionReader` — **consumed** from bolt 006, not re-decided | `RETRYABLE` | **Yes — reused** |
| `WEIGHINGMS_ORGATEX_SYNC_BACKOFF_BASE_MS` | `BackoffSchedule.baseMs` — the first retry delay | `1000` | New |
| `WEIGHINGMS_ORGATEX_SYNC_BACKOFF_MAX_MS` | `BackoffSchedule.maxMs` — **the bound** | `300000` (5 min) | New |
| `WEIGHINGMS_ORGATEX_SYNC_BACKOFF_MULTIPLIER` | `BackoffSchedule.multiplier` | `2` | New |
| `WEIGHINGMS_ORGATEX_SYNC_BACKOFF_JITTER_MS` | `BackoffSchedule.jitterMs` — a bounded magnitude | `250` | New |
| `WEIGHINGMS_ORGATEX_SYNC_RETRY_INTERVAL_MS` | The retry worker's tick interval | `5000` | New |
| `WEIGHINGMS_DATABASE_PATH` | The shared SQLite file | `./data/weighingms.sqlite` | **Yes — reused** |
| `WEIGHINGMS_ORGATEX_SOURCE` | The adapter's source name | `DUMMY_ORGATEX` | **Yes — reused** |

### The freshness window is ONE concept, not two

This is the decision OQ-1 asks for, and it is worth stating plainly.

`FreshnessWindow` is a **new value object in this bolt**, built from the
**existing** `WEIGHINGMS_ORGATEX_SNAPSHOT_TTL_MS` — the same number bolt
005's `snapshot-freshness.ts` already uses. **No second env var is
introduced.** `WEIGHINGMS_ORGATEX_FRESHNESS_WINDOW_MS` does not exist and
must not be added.

Two value-object types now describe the same duration:
`SnapshotFreshness` (bolt 005 — a *marker*: `CURRENT` or `STALE` with an
age) and `FreshnessWindow` (this bolt — a *duration*: `durationMs`).
They are **not** the same thing — one is a duration, the other is a
disjunction — so unifying them is not a simplification, it would be a
worse model.

What is unified is the **number**: one configuration key, read once in
`orgatex-config.ts`, handed to both. Unifying the two types into one
class is **deferred** and would require an ADR, because it would edit
bolt 005's tree (ADR-027 §3.2).

### The backoff defaults are safe under a long outage

The delay doubles from 1 s and is clamped at 5 minutes. A multi-day
outage produces at most ~288 attempts per entry per day, and the attempt
count and the last error stay visible to an operator throughout (R-15).

### `orgatex-config.ts` grows

```ts
export interface OrgatexConfig {
  readonly databasePath: string;
  readonly freshnessWindowMs: number;   // existing
  readonly sourceName: string;          // existing
  readonly rejectionDisposition: RejectionDisposition; // existing
  // NEW
  readonly syncBackoff: BackoffSchedule;
  readonly syncRetryIntervalMs: number;
}
```

The existing `readInt` helper falls back to the default on a malformed
value rather than throwing, and it **rejects zero** (`parsed <= 0`).
That is correct for the freshness window and the retry interval, but the
**freshness window of zero is a legal value** per R-06 — so the config
loader needs a second reader, `readNonNegativeInt`, for a value where
zero is meaningful. The backoff's own parameters are all strictly
positive, so they reuse `readInt`.

---

## Domain Model

### Value objects

```ts
// domain/value-objects/link-status.ts
export type LinkStatus = 'LINKED' | 'DEGRADED' | 'OFFLINE';

export const LINK_STATUSES: readonly LinkStatus[] = [
  'LINKED',
  'DEGRADED',
  'OFFLINE',
];

export function isLinkStatus(value: unknown): value is LinkStatus {
  return (
    typeof value === 'string' &&
    (LINK_STATUSES as readonly string[]).includes(value)
  );
}
```

A closed set **as a type**, so a caller cannot read a status it has not
proved — the same technique `posting-state.ts` already uses.

```ts
// domain/value-objects/freshness-window.ts
export class FreshnessWindow {
  private constructor(readonly durationMs: number) {}

  /** Zero is legal: it makes DEGRADED unreachable (R-06). */
  static of(durationMs: number): FreshnessWindow {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error(
        'A freshness window must be a non-negative number of milliseconds',
      );
    }
    return new FreshnessWindow(durationMs);
  }
}
```

```ts
// domain/value-objects/sync-queue-entry-state.ts
export type SyncQueueEntryState = 'PENDING' | 'FAILED';

export const SYNC_QUEUE_ENTRY_STATES: readonly SyncQueueEntryState[] = [
  'PENDING',
  'FAILED',
];
```

**There is deliberately no `DELIVERED` state.** A delivered entry leaves
the queue; the *posting* becomes `ACCEPTED`.

```ts
// domain/value-objects/backoff-schedule.ts
export class BackoffSchedule {
  private constructor(
    readonly baseMs: number,
    readonly maxMs: number,
    readonly multiplier: number,
    readonly jitterMs: number,
  ) {}

  static of(
    baseMs: number,
    maxMs: number,
    multiplier: number,
    jitterMs: number,
  ): BackoffSchedule {
    // baseMs > 0, maxMs >= baseMs, multiplier >= 1, jitterMs >= 0
  }
}
```

The **bound** (`maxMs`) is the part that matters: an unbounded backoff is
a queue that never retries, which is a silent discard with extra steps.

```ts
// domain/value-objects/sync-error.ts
export type SyncErrorCode =
  | 'UNREACHABLE'
  | 'TIMEOUT'
  | 'REJECTED'
  | 'MALFORMED';

export const SYNC_ERROR_CODES: readonly SyncErrorCode[] = [
  'UNREACHABLE',
  'TIMEOUT',
  'REJECTED',
  'MALFORMED',
];

/** The longest detail that will be stored or returned. */
export const MAX_SYNC_ERROR_DETAIL_LENGTH = 500;

export class SyncError {
  private constructor(
    readonly code: SyncErrorCode,
    readonly summary: string,
    readonly detail: string,
  ) {}

  static of(code: SyncErrorCode, summary: string, detail: string): SyncError {
    // summary truncated to 120 chars; detail truncated to 500 chars
  }

  /** The client-safe projection: the code and the summary, never the detail. */
  toClient(): { readonly code: SyncErrorCode; readonly summary: string } {
    return { code: this.code, summary: this.summary };
  }
}
```

`SyncError` follows the **existing** `RejectionReason` shape closely —
a closed code set, a bounded detail, a truncation that is **marked** so a
reader can tell the text was cut — because that is the repo's established
pattern for a bounded diagnostic. The difference is that `SyncError`
carries **two** strings: a `summary` that is safe to return to a client
and a `detail` that goes to the log only (NFR-11).

```ts
// domain/value-objects/link-state.ts
export interface LinkState {
  readonly status: LinkStatus;
  /** The last SUCCESSFUL contact; null until one occurs. */
  readonly lastContactAt: Instant | null;
  /** The last failure's bounded diagnostic; null when there is none. */
  readonly lastError: SyncError | null;
  readonly consecutiveFailures: number;
}
```

`LinkState` is **immutable**: a contact outcome produces a *new*
`LinkState`; nothing mutates the current one.

### Entities

```ts
// domain/entities/sync-queue-entry.ts
export class SyncQueueEntry {
  constructor(
    readonly postingId: IdempotencyKey,
    readonly batchId: BatchId,
    readonly componentId: ComponentId,
    readonly actualQuantity: WeightValue,
    readonly lotNumber: LotNumber,
    readonly operatorId: OperatorReference,
    readonly weighedAt: Instant,
    readonly queuedAt: Instant,
    readonly attempts: number,
    readonly lastAttemptAt: Instant | null,
    readonly nextAttemptAt: Instant | null,
    readonly lastError: SyncError | null,
    readonly state: SyncQueueEntryState,
  ) {}
}
```

The class carries the six invariants as **guards in the constructor**, so
an entry that breaks one cannot be built:

1. `postingId` **is** the idempotency key and is unique across the queue.
2. The content (batch, component, quantity, unit, lot, operator,
   weighed-at, queued-at) is **immutable** once written (DR-02, ADR-024).
3. `attempts` only ever **increases**.
4. `nextAttemptAt` is set whenever an attempt fails; a `PENDING` entry
   **always** has a next attempt time.
5. A `FAILED` entry has **no** next attempt time — it is off the
   automatic path.
6. The entry is **never silently discarded**: it leaves the queue only by
   being delivered, and it is never deleted while it is failed.

The class exposes **no mutation methods** — only named transitions that
return a *new* entry, which is the same discipline `ConsumptionPosting`
uses (`accept`, `reject`).

```ts
// domain/entities/link-transition.ts
export interface LinkTransition {
  readonly from: LinkStatus;
  readonly to: LinkStatus;
  readonly occurredAt: Instant;
  readonly cause: 'CONTACT_SUCCESS' | 'CONTACT_FAILURE' | 'FRESHNESS_DEADLINE' | 'FIRST_OBSERVATION';
}
```

A `LinkTransition` is an append-only **record** of one transition, not a
state.

---

## The Derivation Rule

`LinkStatePolicy` is **pure**: no clock, no ports, no database. The
current time is an **argument**, never read from an ambient source — the
same discipline `LinkWatchdog` already follows.

```ts
// domain/services/link-state-policy.ts
export interface LinkStatePolicy {
  derive(
    observations: LinkObservations,
    now: Instant,
    window: FreshnessWindow,
  ): LinkState;
}
```

The rule, in full:

```text
LINKED     consecutiveFailures === 0
DEGRADED   the last contact failed
           AND a last successful contact exists
           AND now − lastSuccessAt ≤ window.durationMs
OFFLINE    otherwise — including "never contacted successfully"
```

Four consequences, each an edge case the story names:

1. **A station that has never contacted the MES is `OFFLINE`**, with no
   last-contact time and no snapshot served. It is not `LINKED` and it is
   not `DEGRADED` — `DEGRADED` requires a *last successful contact*, and
   there is none.
2. **A freshness window of zero makes `DEGRADED` unreachable**, because
   no snapshot is ever fresh enough to serve. `DEGRADED → OFFLINE` then
   happens on the **first** failure (R-06).
3. **A successful contact resets the streak**: the failure count returns
   to zero, the last error is cleared, and the status becomes `LINKED`.
   An **error response from the MES is a failed contact** — the MES
   answered, and the answer was a failure.
4. **A slow MES that answers within the timeout is a success.** The
   timeout, not the latency, is the boundary.

**The boundary is inclusive**, exactly as `LinkWatchdog` is: at
`now − lastSuccessAt === window.durationMs` the state is still
`DEGRADED`; one millisecond later it is `OFFLINE`. A link that was still
degraded at the instant of the deadline would be degraded for one instant
too many.

---

## State Transition Tables

### The link state

| From | Event | To | Records a transition? | Effect |
| --- | --- | --- | --- | --- |
| *(none)* | the first observation | `OFFLINE` | **Yes** — `FIRST_OBSERVATION` | `lastContactAt` stays null |
| `LINKED` | contact success | `LINKED` | **No** | `consecutiveFailures = 0`, `lastError` cleared, `lastContactAt = at` |
| `LINKED` | contact failure, within the window | `DEGRADED` | **Yes** | `consecutiveFailures++`, `lastError` set, freshness deadline scheduled |
| `LINKED` | contact failure, no prior success or window expired | `OFFLINE` | **Yes** | as above |
| `DEGRADED` | contact success | `LINKED` | **Yes** | `consecutiveFailures = 0`, **flush on recovery** |
| `DEGRADED` | contact failure | `DEGRADED` | **No** | `consecutiveFailures++`, `lastError` replaced, deadline rescheduled |
| `DEGRADED` | freshness deadline reached, no contact | `OFFLINE` | **Yes** — `FRESHNESS_DEADLINE` | the snapshot ages out |
| `OFFLINE` | contact success | `LINKED` | **Yes** | `consecutiveFailures = 0`, **flush on recovery** |
| `OFFLINE` | contact failure | `OFFLINE` | **No** | `consecutiveFailures++`, `lastError` replaced, deadline rescheduled |
| `OFFLINE` | freshness deadline reached | `OFFLINE` | **No** | the derived status is unchanged |

Two transitions are **unreachable**, and both unreachable states are
deliberate:

- **`OFFLINE → DEGRADED`** — a successful contact always resets
  `consecutiveFailures` to zero, which derives `LINKED`. The story's
  edge case names this shape ("the first successful contact makes the
  state `DEGRADED` until a subsequent contact succeeds — or `LINKED`
  directly"); the rule answers it: **directly `LINKED`**.
- **`LINKED → LINKED`** — a success that changes nothing records no
  transition (R-05).

### The queue entry state

| From | Trigger | To | `attempts` | `nextAttemptAt` | Stays in the queue? |
| --- | --- | --- | --- | --- | --- |
| *(none)* | enqueue of an undeliverable posting | `PENDING` | `0` | `now` (due immediately) | Yes |
| `PENDING` | delivery accepted by the MES | *(removed)* | `+1` | `null` | No — removed **on delivery only** |
| `PENDING` | retryable failure (`UNREACHABLE`/`TIMEOUT`/`MALFORMED`) | `PENDING` | `+1` | `now + backoff(attempts)` | Yes |
| `PENDING` | definitive rejection under `PERMANENT` | `FAILED` | `+1` | `null` | Yes — visible, never deleted |
| `PENDING` | definitive rejection under `RETRYABLE` | `PENDING` | `+1` | `now + backoff(attempts)` | Yes |
| `FAILED` | re-drive delivered | *(removed)* | `+1` | `null` | No — the re-drive consumed it |
| `FAILED` | re-drive failed | `FAILED` | `+1` | `null` | Yes |
| `FAILED` | scheduled retry tick | `FAILED` | unchanged | `null` | Yes — `FAILED` is off the automatic path |

---

## Services and Ports

### `LinkStateService`

```ts
export interface LinkStateService {
  recordSuccess(at: Instant): Promise<LinkState>;
  recordFailure(error: SyncError, at: Instant): Promise<LinkState>;
  read(): Promise<LinkState>;
}
```

Dependencies: `LinkStatePolicy`, `LinkContactRepository`,
`LinkTransitionRepository`, `LinkFreshnessScheduler`, the `Clock` and the
configured `FreshnessWindow`.

**There is exactly one writer of the observation row** (OQ-5), and it is
this service. Every MES contact outcome — the posting path's, the read
path's, the queue's delivery — reports through it. There is **no separate
health probe**, because a probe would be a second writer and a second
opinion about the same boundary.

### `LinkFreshnessScheduler` (port)

```ts
export interface LinkFreshnessScheduler {
  schedule(deadline: Instant, callback: () => void): void;
  cancel(): void;
  dispose(): void;
}
```

ADR-012's shape, and the same reasoning as `WatchdogScheduler`: the
**scheduler decides when to ask; the policy decides the answer**. There
is **one link**, so there is **one timer** — not one per device, as the
scale unit has. `cancel()` takes no argument because there is nothing to
distinguish.

The production implementation is `NodeLinkFreshnessScheduler`, modelled
directly on `NodeWatchdogScheduler`: one `setTimeout`, replaced on every
failure, disposed on shutdown. The test implementation is a manual
scheduler that fires the deadline when the test chooses, so the
`DEGRADED → OFFLINE` boundary is testable **exactly**.

### `SyncQueueService`

```ts
export type EnqueueResult =
  | { readonly outcome: 'QUEUED'; readonly entry: SyncQueueEntry }
  | {
      readonly outcome: 'REFUSED_DUPLICATE';
      readonly reason: 'IN_LEDGER' | 'ALREADY_QUEUED';
    };

export type RedriveResult =
  | {
      readonly outcome: 'ATTEMPTED';
      readonly entry: SyncQueueEntry | null;
      readonly delivered: boolean;
    }
  | {
      readonly outcome: 'REFUSED';
      readonly reason:
        | 'LINK_NOT_LINKED'
        | 'NOT_FAILED'
        | 'IN_LEDGER'
        | 'NOT_FOUND';
    };

export type SyncAttemptOutcome =
  | { readonly postingId: IdempotencyKey; readonly outcome: 'DELIVERED' }
  | { readonly postingId: IdempotencyKey; readonly outcome: 'RETRYABLE'; readonly error: SyncError }
  | { readonly postingId: IdempotencyKey; readonly outcome: 'FAILED'; readonly error: SyncError };

export interface SyncQueueService {
  enqueue(posting: ConsumptionPosting): Promise<EnqueueResult>;
  retryDue(now: Instant): Promise<SyncAttemptOutcome[]>;
  flushOnRecovery(): Promise<SyncAttemptOutcome[]>;
  redrive(postingId: IdempotencyKey): Promise<RedriveResult>;
}
```

Dependencies: `ConsumptionPostingService` (bolt 006), `SyncQueueRepository`,
`PostingRepository`, `IdempotencyLedger`, `PostingAttemptRepository`,
`LinkStateService`, the `Clock` and the configured `BackoffSchedule`.

### `SyncBackoffPolicy` (pure)

```ts
export interface SyncBackoffPolicy {
  nextAttemptAt(
    attempts: number,
    now: Instant,
    schedule: BackoffSchedule,
    random: () => number,
  ): Instant;
}
```

The delay is:

```text
raw      = baseMs × multiplier^(attempts − 1)
jittered = raw + random() × jitterMs
delay    = min(maxMs, jittered)
```

**The jitter is a bounded magnitude, and the randomness is injected**
(OQ-3), so the policy stays a pure, testable function. An injected
`random` of `() => 0` gives the deterministic base delay, which is what
the tests assert on.

### `RejectionDispositionReader` (port)

```ts
export interface RejectionDispositionReader {
  disposition(): RejectionDisposition;
}
```

Reads bolt 006's `WEIGHINGMS_ORGATEX_REJECTION_DISPOSITION` (default
`RETRYABLE`). **Consumed, not re-decided** (ADR-026).

### Repository interfaces

```ts
// domain/ports/sync-queue-repositories.ts
export interface SyncQueueRepository {
  enqueue(entry: SyncQueueEntry): Promise<void>;
  findByPostingId(postingId: IdempotencyKey): Promise<SyncQueueEntry | null>;
  /** In queue order: queued_at ASC, posting_id ASC. */
  findDue(now: Instant, limit: number): Promise<SyncQueueEntry[]>;
  findAll(): Promise<SyncQueueEntry[]>;
  countUnlanded(): Promise<number>;
  recordAttempt(
    postingId: IdempotencyKey,
    outcome: 'DELIVERED' | 'RETRYABLE' | 'FAILED',
    error: SyncError | null,
    attemptedAt: Instant,
    nextAttemptAt: Instant | null,
    attempts: number,
  ): Promise<void>;
  markFailed(
    postingId: IdempotencyKey,
    error: SyncError,
    attemptedAt: Instant,
    attempts: number,
  ): Promise<void>;
  /** ONLY on delivery. */
  remove(postingId: IdempotencyKey): Promise<void>;
  reschedule(postingId: IdempotencyKey, nextAttemptAt: Instant): Promise<void>;
}
// No `update`. No `delete`.

// domain/ports/link-repositories.ts
export interface LinkContactRepository {
  read(): Promise<LinkObservations>;
  recordSuccess(at: Instant): Promise<void>;
  recordFailure(error: SyncError, at: Instant): Promise<void>;
}

export interface LinkTransitionRepository {
  append(transition: LinkTransition): Promise<void>;
  findAll(): Promise<LinkTransition[]>;
  findMostRecent(): Promise<LinkTransition | null>;
}
// No `update`. No `delete`.
```

**The absent methods are the enforcement** — the technique ADR-006 and
ADR-023 already used. A repository with no `update` cannot be used to
mutate a record, and that is stronger than a convention.

---

## Use-Case Flows

### Flow A — read the link state

1. The client calls `GET /api/orgatex/link-state`.
2. The controller calls `LinkStateService.read()`.
3. The service reads `LinkContactRepository.read()` → the observations
   (`lastSuccessAt`, `lastFailureAt`, `lastError`, `consecutiveFailures`).
4. `LinkStatePolicy.derive(observations, clock.now(), freshnessWindow)` →
   the `LinkState`.
5. The controller additionally asks `SyncQueueRepository.countUnlanded()`
   for the number of un-synchronised records (R-04, R-14).
6. The response body is:

```json
{
  "status": "DEGRADED",
  "lastContactAt": "2026-11-03T09:33:20.000Z",
  "lastError": { "code": "TIMEOUT", "summary": "OrgaTEX did not answer within 5000 ms" },
  "consecutiveFailures": 2,
  "unsynchronisedCount": 3
}
```

`SyncError.detail` is **not** in the response; it is logged only
(NFR-11). The `lastError` is `null` when there is no failure on record.
Rendering belongs to unit `007` (FR-19, OQ-10).

### Flow B — a contact outcome is observed

1. Any MES call completes — the success or the failure mapped to a
   `SyncError`.
2. The caller invokes `LinkStateService.recordSuccess(at)` or
   `recordFailure(error, at)`.
3. The service updates the observation row: `recordSuccess` sets
   `lastSuccessAt` and resets `consecutiveFailures` to `0`; `recordFailure`
   sets `lastFailureAt`, `lastError` and increments `consecutiveFailures`.
4. The service derives the new status with the **same**
   `LinkStatePolicy.derive` the read path uses.
5. If the derived status differs from the previous status, the service
   appends a `LinkTransition { from, to, occurredAt, cause }` and emits
   `LinkStateChanged`. If the status is unchanged, **no transition is
   recorded** (R-05) — only the counter and the error change.
6. On a failure, the service schedules the freshness deadline
   `lastSuccessAt + freshnessWindow.durationMs` through the
   `LinkFreshnessScheduler` (ADR-012). When the callback fires it
   re-derives the status with the **same pure policy**, so the scheduled
   path and the contact path cannot disagree. A change to `OFFLINE`
   records a `FRESHNESS_DEADLINE` transition.
7. On a transition to `LINKED`, the `LinkStateChanged` event triggers
   `SyncQueueService.flushOnRecovery()` (OQ-6).

### Flow C — a weighing cannot be delivered

1. Unit `003` confirms a weighing and the station posts the consumption
   through bolt 006's `ConsumptionPostingService`. The posting carries
   the locally derived idempotency key.
2. The posting path attempts the delivery through the `OrgatexAdapter`
   port. The attempt fails — the link is down, the MES times out, or the
   response is malformed.
3. The failure is reported to `LinkStateService.recordFailure(error, at)`,
   which derives the new status and records a transition if it changed.
4. `ConsumptionPostingService` returns `QUEUED` — the posting exists, is
   `QUEUED`, and its attempt records the ambiguity. **This is the point
   at which the write becomes durable.**
5. `SyncQueueService.enqueue(posting)` runs the **enqueue guard**: it
   reads the **ledger and the queue together**. If the key is in the
   ledger (`IN_LEDGER`) or already in the queue (`ALREADY_QUEUED`), the
   enqueue is refused. The ledger's presence always wins (ADR-023).
6. Otherwise an immutable `SyncQueueEntry` is written with `state =
   'PENDING'`, `attempts = 0`, `queuedAt = now` and `nextAttemptAt = now`.
   The content is copied from the posting once and never changes
   (ADR-024).
7. The `SyncEntryQueued` event is emitted.
8. The posting is reported to the operator as **pending**, never as
   posted (R-09, AC-09).
9. **Weighing continues normally.** The link state never refuses a
   weighing (R-07, NFR-03).

### Flow D — the queue survives a restart

1. The station is powered off immediately after the enqueue.
2. On start-up, `SyncQueueService` reads the durable queue from
   `sync_queue_entries`. Every entry is still present, still `PENDING`,
   with its **original idempotency key**, its original content and its
   `queuedAt` (R-10, NFR-05). Nothing is re-derived and no key is
   re-generated.
3. The station continues weighing. If the link is still down, further
   weighings are enqueued the same way (Flow C).

### Flow E — recovery flushes the queue

1. A contact succeeds. `LinkStateService.recordSuccess(at)` derives
   `LINKED`, records a `DEGRADED → LINKED` (or `OFFLINE → LINKED`)
   transition and emits `LinkStateChanged`.
2. The `LINKED` transition triggers `SyncQueueService.flushOnRecovery()`.
3. `findDue(now, limit)` returns the due entries **in queue order**:
   `queued_at` ascending, `posting_id` as the tie-breaker, so the order is
   total and stable across processes (OQ-4).
4. For each entry, in order, the service delivers it by calling
   **`ConsumptionPostingService.post()`** with the entry's content — the
   **same key** it was first created with. No re-keying, no duplication
   (R-11, IR-08, AC-09).
5. Per entry:
   - **`ACCEPTED`** → the ledger has been written by the posting service's
     unit of work, the entry is removed by
     `SyncQueueRepository.remove(postingId)` — the **only** case in which
     an entry leaves the queue — and `SyncEntryDelivered` is emitted.
   - **`QUEUED`** (the MES could not be reached) → `recordAttempt(...)`
     increments `attempts`, replaces `lastError`, sets
     `nextAttemptAt = now + backoff(attempts)` and leaves the entry
     `PENDING` (R-13, R-15). The flush continues with the next entry; the
     failed one comes back later.
   - **`REJECTED`** → the disposition decides. Under `PERMANENT`,
     `markFailed(...)` sets the entry to `FAILED` with its last error,
     attempt count and last attempt time. It stays visible, it is never
     deleted, and it can be re-driven (R-12, ADR-026). Under `RETRYABLE`,
     the entry stays `PENDING` and is retried with a backoff. Under
     **either** disposition the posting is `REJECTED` and the record
     survives.
   - **`DUPLICATE`** → the key is already consumed. The posting is
     `ACCEPTED` in substance; the entry is removed and
     `SyncEntryDelivered` is emitted. A duplicate is not an error.
6. A `SyncQueueFlushed` event is emitted with `attempted`, `delivered`,
   `failed` and `remaining` counts.
7. If entries remain, the scheduled `SyncRetryWorker` calls
   `retryDue(now)` on its bounded interval, which picks up the entries
   whose `nextAttemptAt` has passed, in queue order.

### Flow F — the scheduled retry

1. `SyncRetryWorker` ticks every
   `WEIGHINGMS_ORGATEX_SYNC_RETRY_INTERVAL_MS`.
2. It calls `SyncQueueService.retryDue(now)`.
3. `findDue(now, limit)` returns the `PENDING` entries with
   `nextAttemptAt ≤ now`, in queue order. `FAILED` entries are off the
   automatic path and are never picked up (invariant 5).
4. Each entry is delivered exactly as in Flow E, step 4, with the same
   key.
5. On a retryable failure, `SyncBackoffPolicy.nextAttemptAt(...)` computes
   the next attempt. The bound is configuration (NFR-14) and the delay
   never exceeds `maxMs`.
6. The attempt count and the last error are retained so an operator can
   see *why* a record has not landed (R-15).

### Flow G — an operator re-drives a failed entry

1. The operator sees a `FAILED` entry and calls
   `POST /api/orgatex/sync-queue/:postingId/redrive`.
2. `SyncQueueService.redrive(postingId)` refuses when:
   - the link is not `LINKED` (`LINK_NOT_LINKED`) — and **the refusal
     itself counts as an attempt** (the attempt count increments and the
     last error is updated);
   - the entry is not `FAILED` (`NOT_FAILED`);
   - the key is already in the ledger (`IN_LEDGER`) — the ledger's
     presence always wins, so there is nothing left to send;
   - the entry does not exist (`NOT_FOUND`).
3. Otherwise the entry is delivered through the **same**
   `ConsumptionPostingService.post()` path, **with the same idempotency
   key** — it is never re-derived and never re-keyed, so a re-drive of an
   ambiguous failure cannot double-post (R-17, ADR-025).
4. On delivery the entry is removed and `SyncEntryDelivered` is emitted;
   on failure the entry returns to `FAILED` with the updated attempt count
   and last error, and stays visible (R-12, R13).
5. The re-drive is an **ordinary operator action** for this bolt — it
   re-sends work the operator themselves produced. It does not require
   supervisor authorisation (unit `008`'s authorisation flow); the seam
   is recorded here and is not crossed (OQ-8, NG-08).

### Flow H — the online path's own rejection (no queue entry)

A definitive rejection that happens on the **online** path is recorded on
the posting in bolt 006 (`REJECTED`) and does **not** create a queue
entry: a queue entry is created **only** when a posting could not be
delivered — the offline path (OQ-7). The online rejection is still
visible to the operator through the same failure-disposition reader, so
nothing is silently lost: the posting's own record and its
`posting_attempts` history survive with the five-year retention (OQ-9,
R-16).

---

## The Endpoints

Three new endpoints on the product's own router, mounted at
`/api/orgatex`. They are **WeighingMS's** endpoints, not the MES's —
IR-07's separation.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/orgatex/link-state` | The derived link state and the un-synchronised count. |
| `GET` | `/api/orgatex/sync-queue` | The queue: the count and each entry's state. |
| `POST` | `/api/orgatex/sync-queue/:postingId/redrive` | Re-drive one failed entry. |

### `GET /api/orgatex/link-state`

```json
{
  "status": "LINKED",
  "lastContactAt": "2026-11-03T09:33:20.000Z",
  "lastError": null,
  "consecutiveFailures": 0,
  "unsynchronisedCount": 0
}
```

### `GET /api/orgatex/sync-queue`

```json
{
  "count": 2,
  "entries": [
    {
      "postingId": "IDK-4f3a2b1c9d8e7f60",
      "batchId": "B-24187",
      "componentId": "DYE-4471-B",
      "actualQuantity": "1240.0000",
      "unit": "g",
      "lotNumber": "L-77120",
      "queuedAt": "2026-11-03T08:14:22.000Z",
      "state": "PENDING",
      "attempts": 2,
      "lastAttemptAt": "2026-11-03T08:19:22.000Z",
      "nextAttemptAt": "2026-11-03T08:21:22.000Z",
      "lastError": { "code": "UNREACHABLE", "summary": "The Dummy OrgaTEX is unreachable" }
    }
  ]
}
```

The `lastError` carries the **code and the summary only**. The `detail`
is not returned (NFR-11).

### `POST /api/orgatex/sync-queue/:postingId/redrive`

The body is **empty**. There is no `operatorId` field, no
`idempotencyKey` field and no `state` field — the same three absences
`orgatex-write-schemas.ts` already enforces for the consumption posting.
The operator comes from the **session**; the key is the entry's own.

| Status | Meaning |
|---|---|
| `200` | The entry was attempted. `delivered: true` or `false`. |
| `400` | The `postingId` is malformed. |
| `401` | No session. |
| `404` | No such queue entry. |
| `409` | The re-drive was refused: `LINK_NOT_LINKED`, `NOT_FAILED` or `IN_LEDGER`. The body carries the reason code. |

A refused re-drive is a `409`, not a `403` and not a `500` — the request
was well-formed and understood, and the **state** made it inapplicable.
A supervisor authorisation would be a `403` (ADR-004's uniform
refusal), and this endpoint does not require one (OQ-8).

**Every endpoint requires an operator session** (ADR-020), exactly like
the existing OrgaTEX routes: the queue and the link state are business
records, not physically visible device states.

---

## Error Handling and Edge Cases

### The refusal matrix

| # | Condition | Behaviour | Resulting state | HTTP |
|---|---|---|---|---|
| E1 | No session on any endpoint | Refuse | unchanged | `401` |
| E2 | A malformed `postingId` on the redrive | Refuse | unchanged | `400` |
| E3 | The MES is unreachable on a **read** | Fail loudly — no snapshot is served unless one is cached and within its window | `DEGRADED` or `OFFLINE` | `503` (existing behaviour) |
| E4 | The MES is unreachable on a **write** | The posting stays `QUEUED`; the queue entry is created | `PENDING` | `201` with `state: 'QUEUED'` (existing behaviour) |
| E5 | The MES is unreachable during a **flush** | The entry's attempt count increments, the last error is set, and the entry stays `PENDING` | `PENDING` | n/a (background) |
| E6 | The MES rejects a posting under `RETRYABLE` | The entry stays `PENDING` with a backoff | `PENDING` | `422` on the online path |
| E7 | The MES rejects a posting under `PERMANENT` | The entry becomes `FAILED`, visible and re-drivable | `FAILED` | `422` on the online path |
| E8 | The same key is enqueued twice | Refused — the ledger and the queue are read together | unchanged | n/a |
| E9 | A re-drive while the link is not `LINKED` | Refused; **the refusal counts as an attempt** | `FAILED`, `attempts` incremented | `409` |
| E10 | A re-drive of an entry that is not `FAILED` | Refused — a `PENDING` entry is already on the automatic path | unchanged | `409` |
| E11 | A re-drive of a key already in the ledger | Refused — the ledger's presence always wins | unchanged | `409` |
| E12 | A re-drive of a key with no queue entry | Refused | unchanged | `404` |
| E13 | The station restarts with entries queued | Every entry is still present, still `PENDING`, with its original key | `PENDING` | n/a |
| E14 | The freshness window is zero | `DEGRADED` is unreachable; the first failure moves to `OFFLINE` | `OFFLINE` | n/a |

### Boundary, null and empty cases

| Value | Behaviour |
|---|---|
| `freshnessWindowMs = 0` | Legal. `FreshnessWindow.of(0)` succeeds; `DEGRADED` is unreachable. |
| `freshnessWindowMs < 0` | `FreshnessWindow.of` throws — the window is not a negative duration. |
| `lastSuccessAt = null` | The station has never succeeded → `OFFLINE`, whatever the failure count. |
| `lastError = null` | No failure on record → `lastError: null` in the response. |
| `consecutiveFailures = 0` | `LINKED`, whatever the timestamps say. |
| `attempts = 0` | A freshly enqueued entry; `lastAttemptAt` is null. |
| `nextAttemptAt = null` on a `PENDING` entry | Refused by the constructor and by the table's CHECK. |
| `nextAttemptAt != null` on a `FAILED` entry | Refused by the constructor and by the table's CHECK. |
| An empty queue | `count: 0`, `entries: []`; a flush with nothing to deliver reports zero deliveries. |
| A flush with nothing to deliver | `SyncQueueFlushed` with `attempted: 0, delivered: 0, failed: 0, remaining: 0`. |
| A malformed configuration value | Falls back to the default rather than refusing to start — the existing `readInt` behaviour. |
| A `SyncError.detail` over 500 characters | Truncated **and marked**, so a reader can tell the text was cut. |

### The failure paths that matter most

**The link drops again mid-flush.** The entries already delivered are
resolved and are **not** re-delivered — the ledger holds their keys. The
undelivered entries remain queued with their attempt counts incremented.
The flush does not reorder or lose the remainder.

**One bad posting does not block the queue.** If the MES rejects one
posting and accepts the rest, the accepted ones are resolved and removed;
the rejected one stays visible as a `FAILED` entry. The flush continues.

**The MES accepted it but the response was lost.** The retry carries the
**same key**, so the local ledger's guard admits exactly one copy and the
MES-side effect occurs once.

**The posting was accepted but the queue write failed.** The posting is
`ACCEPTED` and the ledger holds the key; the queue entry was never
created. On the next attempt the posting path's ledger guard returns
`DUPLICATE`, and the queue's guard refuses the enqueue with `IN_LEDGER`.
No duplicate consumption, and nothing is lost.

**A database write fails mid-flush.** The flush aborts with an error, the
entry stays in the queue, and the attempt count is **not** incremented —
because the attempt bookkeeping and the outcome are committed together.
An attempt that is not recorded is an attempt that will be repeated, which
is the safe direction.

---

## Security and Validation Notes

### Validation at each boundary

**The HTTP boundary.** The redrive's `postingId` is parsed with
`IdempotencyKey.of()`, which enforces the `IDK-` + 16 lowercase hex shape
and the 64-character bound. A malformed key is a `400`, not a `500`.
Every body is parsed by a Zod schema, and **the redrive's schema has no
fields at all** — so there is nothing a caller can smuggle in.

**The configuration boundary.** Every numeric setting is read through a
reader that validates and falls back to the default. A mistyped
environment variable produces a visibly-default behaviour, not a
misbehaving station.

**The persistence boundary.** Every column that carries a value the MES
or an operator supplied is `NOT NULL` or a `CHECK`-constrained `TEXT`.
The quantity is `TEXT`, never `REAL` — a float is never persisted
(NFR-16). The identifiers are bounded at 64 characters by the value
objects before they reach the row.

### The queue's own security properties

**The key cannot be forged.** The re-drive endpoint takes a `postingId`
in the **path**, and the key that is actually sent is the **stored
entry's** key. A caller cannot substitute a different key: the service
loads the entry by the id and sends the entry's content. There is no
`idempotencyKey` field in any schema.

**The operator cannot be forged.** The queue entry's `operatorId` was
captured from the **session** when the consumption was first posted, and
it is immutable (ADR-024). A re-drive re-sends that captured operator —
it does not re-attribute the weighing to whoever happens to be driving it.

**The MES's internals stay internal.** `SyncError.detail` is logged, never
returned. The response carries the code and the bounded summary only
(NFR-11).

**Nothing is silently discarded.** The `remove` method exists for exactly
one reason — the posting was delivered — and it is named for that, not
`delete`. A `FAILED` entry is never deleted; the table's CHECK constraints
make the illegal states unrepresentable.

**The history cannot be rewritten.** `link_transitions` has triggers that
abort any UPDATE or DELETE. A transition is a fact about the past.

**The transport gap is explicit.** ADR-022's gap carries forward: these
tests prove the domain rules and the in-process adapter's behaviour, not
that a request can be sent, received, timed out or retried over a socket.

### On the security review of this bolt

This project's security review is **manual**, performed against the
requirements and the ADRs. The Aikido MCP scanner is **not** used for
this repository, and no scan result is claimed, cited or implied.

---

## Testing Strategy

**Vitest**, as the rest of the product uses (`npm test` → `vitest run`),
with **Supertest** for the API tests and the `node:sqlite` in-memory
database for persistence.

The suite's shape follows the repo's existing convention: `tests/unit/`
for pure rules, `tests/integration/` for the API and the persistence,
`tests/security/` for the security properties.

### New test files

| File | What it proves |
|---|---|
| `tests/unit/orgatex-link-state.test.ts` | The derivation rule in full: every state, every boundary, the inclusive edge, the zero window, the unreachable transitions. |
| `tests/unit/orgatex-sync-backoff.test.ts` | The backoff formula: the doubling, the clamp at `maxMs`, the jitter bound, the determinism under an injected `random`. |
| `tests/unit/orgatex-sync-queue.test.ts` | The enqueue guard, the attempt bookkeeping, the disposition behaviour, the re-drive refusals, the queue order — against an in-memory repository. |
| `tests/unit/orgatex-sync-queue-persistence.test.ts` | The table's constraints: the PENDING/FAILED CHECK, the `attempts >= 0` CHECK, the PRIMARY KEY refusing a duplicate key, the append-only triggers. |
| `tests/unit/orgatex-link-transitions.test.ts` | The transition log: a transition is recorded on a change and **not** on an unchanged status. |
| `tests/integration/orgatex-link-state-api.test.ts` | The three endpoints' shapes and status codes, with a real session. |
| `tests/integration/orgatex-sync-queue-api.test.ts` | The end-to-end outage → queue → recovery → flush sequence against the Dummy MES's outage switch. |
| `tests/security/orgatex-sync-queue-security.test.ts` | The key cannot be forged, the operator cannot be forged, the MES's detail does not leak, the failed entry is never deleted. |

The existing `tests/support/orgatex-harness.ts` grows the new options it
needs: a controllable `syncBackoff`, a `syncRetryIntervalMs`, and a
manual freshness scheduler.

### The scenarios that must be covered

**Link state.** `LINKED` after a success; `DEGRADED` after a failure
within the window; `OFFLINE` after a failure outside it; `OFFLINE` when
the station has never contacted the MES; the **inclusive** boundary at
exactly `window.durationMs`; the zero window; the reset of
`consecutiveFailures` on a success; the transition recorded on a change
and **not** on an unchanged status; `DEGRADED → OFFLINE` via the
scheduled deadline; and `OFFLINE → LINKED` on recovery.

**Queue.** The enqueue guard refusing a key already in the ledger and a
key already in the queue; the entry's content being immutable; the
attempt count increasing and never decreasing; a failed retry leaving
the entry in the queue; the disposition deciding `PENDING` versus
`FAILED`; the `FAILED` entry staying visible with its last error, attempt
count and last attempt time; the re-drive's three refusals; the re-drive
delivering with the **same** key; the queue order being stable across a
restart.

**Durability.** A queue written and then read back from a **fresh
connection to the same file** — not the same in-memory handle — with every
entry present, still `PENDING`, and still carrying its original key.

**End to end.** The MES made unreachable → a consumption is posted → the
response is `201` with `state: 'QUEUED'` → the queue shows one entry →
the MES is reachable again → the entry is flushed → the response is
`ACCEPTED` → the queue is empty → the ledger holds the key → a second
post of the same weighing is refused as a duplicate.

### The harness's clock

The freshness boundary and the backoff are tested with the **existing**
`TestClock` from `tests/harness.ts`, not with real timers. The freshness
deadline is fired by a **manual scheduler**, so the `DEGRADED → OFFLINE`
transition is tested at an exact instant rather than approximately.

### The coverage threshold

`vitest.config.ts` enforces an **80% threshold** on statements, branches,
functions and lines, over `src/**/*.ts`. This bolt's new code must meet
it. The `domain/ports/*.ts` files are excluded from coverage as
TypeScript interfaces only — the same exemption bolt 006's ports have.

---

## Implementation Plan

Eighteen ordered steps. Each names its target file and its done-when
criterion.

1. **`domain/value-objects/link-status.ts`** — `LinkStatus`, the closed
   set, `isLinkStatus`. *Done when* an unknown status is refused by the
   guard and the set has exactly three members.

2. **`domain/value-objects/freshness-window.ts`** — `FreshnessWindow.of`.
   *Done when* zero is accepted and a negative value is refused.

3. **`domain/value-objects/sync-queue-entry-state.ts`** — the closed set
   `PENDING | FAILED`. *Done when* the set has exactly two members and no
   `DELIVERED` exists.

4. **`domain/value-objects/sync-error.ts`** — `SyncError`, the code set,
   the bounded detail with a marked truncation, `toClient()`. *Done when*
   a 600-character detail is truncated to 500 and marked, and `toClient()`
   carries no detail.

5. **`domain/value-objects/backoff-schedule.ts`** — `BackoffSchedule.of`
   with its four bounds checked. *Done when* `maxMs < baseMs` and
   `multiplier < 1` are refused.

6. **`domain/value-objects/link-state.ts`** — the `LinkState` interface.
   *Done when* it carries the four fields the story names.

7. **`domain/entities/sync-queue-entry.ts`** — `SyncQueueEntry` with its
   six invariant guards and its named transitions. *Done when* an entry
   that breaks an invariant cannot be constructed.

8. **`domain/entities/link-transition.ts`** — the `LinkTransition`
   interface. *Done when* it carries `from`, `to`, `occurredAt` and
   `cause`.

9. **`domain/services/link-state-policy.ts`** — the pure derivation.
   *Done when* all three states are reachable from the rule and the
   boundary is inclusive.

10. **`domain/services/sync-backoff-policy.ts`** — the pure backoff.
    *Done when* the delay is clamped at `maxMs` and the jitter is
    bounded.

11. **`domain/ports/sync-queue-repositories.ts`** and
    **`domain/ports/link-repositories.ts`** — the five ports.
    *Done when* neither file has an `update` or a `delete` method.

12. **`domain/events/link-events.ts`** and
    **`domain/events/sync-queue-events.ts`** — the six events.
    *Done when* the event union is closed and every payload is named.

13. **`infrastructure/persistence/orgatex-database.ts`** — migrations
    `018`, `019`, `020` for the three tables, the two indexes and the two
    append-only triggers, plus the observation row's seed insert.
    *Done when* a fresh database has all three tables and a restart does
    not re-apply them.

14. **`infrastructure/persistence/sqlite-sync-queue-repository.ts`**, and
    the two link repositories. *Done when* the queue order is
    `queued_at ASC, posting_id ASC` and the `remove` method is reachable
    only on the delivery path.

15. **`infrastructure/config/orgatex-config.ts`** — grow with
    `syncBackoff` and `syncRetryIntervalMs`; add `readNonNegativeInt` for
    the freshness window's legal zero. *Done when* the freshness window
    may be zero and a malformed backoff value falls back to the default.

16. **`domain/services/link-state-service.ts`** and
    **`domain/services/sync-queue-service.ts`** — the two services.
    *Done when* the enqueue guard reads the ledger and the queue
    together, and the delivery goes through `ConsumptionPostingService`.

17. **`domain/services/sync-retry-worker.ts`** and the
    **`NodeLinkFreshnessScheduler`** — the two timers. *Done when* both
    are disposed on shutdown and the scheduler can be driven manually in
    a test.

18. **`infrastructure/composition-root.ts`**,
    **`presentation/controllers/orgatex-controller.ts`**,
    **`presentation/schemas/orgatex-write-schemas.ts`**, and
    **`domain/services/batch-queue-reader.ts`** (modified to report its
    contacts) — the wiring and the three endpoints. *Done when* the three
    endpoints require a session, the redrive's body schema has no
    fields, and the link state is derived from the real read path's
    outcomes.

---

## Risks, Assumptions, and Open Questions

### Risks

| # | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| K1 | The MES's write contract is unknown, and it may neither deduplicate nor read the key (ADR-025, Q-01/Q-02) | A retry could double-count a dye batch | Low — the local ledger prevents it | Every delivery goes through `ConsumptionPostingService`'s ledger-guarded path; the key is carried on the request as a second line of defence only. **No claim is made that the MES deduplicates.** |
| K2 | The transport is untested (ADR-022) | A real timeout, TLS failure or retry storm would not be caught by these tests | Medium | The gap is stated in this design, in the ADR and in the Stage 5 test report. The domain rules are proven independently of the transport. |
| K3 | The retry interval and backoff defaults are not derived from any requirement | A mis-sized default could hammer the MES or stall the queue | Medium | Every parameter is configuration with a safe default, and the bound (`maxMs`) is the part that protects the queue. |
| K4 | The queue grows unbounded during a long outage | Memory and database growth | Low — the queue is on disk | The entries are rows, not objects; a dyehouse's throughput is thousands a year. A prune policy is out of scope and would need an ADR. |
| K5 | A second implementation of "has this key been consumed?" creeps in | A duplicate consumption | Medium | The queue **calls** `ConsumptionPostingService` rather than re-implementing posting. The ledger's PRIMARY KEY remains the single atomic guard. |
| K6 | The link state is computed in more than one place and the two disagree | A wrong badge, and possibly a wrong send/queue decision | Low | One writer (`LinkStateService`), one pure policy, used by both the contact path and the scheduled path. |
| K7 | The freshness window's zero is rejected by the existing config reader | `DEGRADED` would be unreachable by accident rather than by configuration | Medium | Step 15 adds `readNonNegativeInt`; the config test asserts that zero is accepted. |
| K8 | A re-drive is later reclassified as a privileged action | A seam opens into unit 008's authorisation flow | Low | OQ-8 and NG-08 state the decision explicitly; a change requires an ADR. |

### Assumptions

| # | Assumption | Basis | If invalid |
|---|---|---|---|
| A1 | Bolt 006's `ConsumptionPostingService` can be called with the **entry's** content to re-deliver a queued posting | It derives the key from the weighing's identity, and the entry carries the same batch/component/operator/weighed-at | The queue would need its own send path, and K5 becomes real |
| A2 | The MES's write contract is unknown — assume it does not deduplicate and does not read the key | ADR-025, A-02, Q-02 | Nothing changes locally; the ledger is the guarantee either way |
| A3 | The transport gap carries forward — the tests exercise the domain rules and the in-process adapter only | ADR-022 | The Stage 5 report would be wrong, which is why the gap is stated in three places |
| A4 | `SyncError.detail` never reaches a client | NFR-11, IR-09 | The MES's internal text would reach the operator — a diagnostic leak, not a correctness failure |
| A5 | The freshness window is **one number**, read from `WEIGHINGMS_ORGATEX_SNAPSHOT_TTL_MS` and shared with bolt 005 | ADR-027 OQ-1; bolt 005's `freshnessWindowMs` already exists | A second env var would mean two freshness concepts, and a snapshot served under one window while the link was judged under another |
| A6 | The backoff's defaults (1 s base, 5 min bound, ×2, 250 ms jitter, 5 s tick) are operational choices, not requirements | The Product Brief states none | The values are configuration; a deployment changes them without a rebuild |
| A7 | A re-drive is an ordinary operator action and needs no supervisor authorisation | OQ-8; the story describes it as an operator action | A seam opens into unit 008's authorisation flow, and the endpoint's `409` would become ADR-004's uniform `403` |
| A8 | The MES's write contract is unknown — assume the worst case (no deduplication, key not read) | ADR-025, A-02, Q-02 | Nothing changes locally; the ledger is the guarantee either way |
| A9 | The queue's retention is satisfied by bolt 006's `consumption_postings` and `posting_attempts`; the queue itself holds only unlanded entries | DR-01, OQ-9 | A prune policy would be needed, and it would need an ADR — a silent prune is the failure this bolt exists to prevent |

### Open questions

Each of these was carried in from the Stage 3 context artifact (ADR-027
§5) and is **answered here**. None remains blocking.

| # | Question | Answer in this design |
|---|---|---|
| OQ-1 | The freshness window's name and owner | **One number, one env var.** `WEIGHINGMS_ORGATEX_SNAPSHOT_TTL_MS` feeds both bolt 005's read path and this bolt's `FreshnessWindow`. `WEIGHINGMS_ORGATEX_FRESHNESS_WINDOW_MS` is **not** introduced. Unifying `FreshnessWindow` and `SnapshotFreshness` into one type is deferred and needs an ADR, because it would edit bolt 005's tree. |
| OQ-2 | The backoff schedule's configuration surface | `WEIGHINGMS_ORGATEX_SYNC_BACKOFF_BASE_MS` / `_MAX_MS` / `_MULTIPLIER` / `_JITTER_MS`, defaults 1000 / 300000 / 2 / 250, plus `WEIGHINGMS_ORGATEX_SYNC_RETRY_INTERVAL_MS` at 5000. |
| OQ-3 | `jitter` as a value or a function | A **bounded magnitude** (`jitterMs`), with the randomness **injected** as a `random: () => number` source. The policy stays pure and testable. |
| OQ-4 | What "queue order" means durably | `queued_at ASC, posting_id ASC` — a total order that is stable across processes and across a restart, and that matches the shape bolt 006's `findByBatch` already uses. |
| OQ-5 | Which contact outcomes update the link state | **All** of them report through `LinkStateService` — the posting path's, the read path's and the queue's delivery. There is one writer of the observation row and **no separate health probe**. |
| OQ-6 | The retry worker's trigger | **Both.** The flush on recovery is **event-driven** from the `LINKED` transition; the periodic retry is a **scheduled** task with a bounded interval. |
| OQ-7 | Does an online `REJECTED` posting get a queue entry | **No.** A queue entry exists only for the **offline** path — a posting that could not be delivered. An online rejection is recorded on the posting (bolt 006) and surfaced through the same disposition reader. |
| OQ-8 | The re-drive entry point | An **ordinary operator action** at `POST /api/orgatex/sync-queue/:postingId/redrive`. No supervisor authorisation in this bolt; the seam with unit `008` is recorded, not crossed. |
| OQ-9 | Retention mechanics | A delivered entry leaves the **queue**. The five-year durable history stays in bolt 006's `consumption_postings` and `posting_attempts`. The queue is never pruned. |
| OQ-10 | Presentation scope | This bolt exposes the link state, the un-synchronised count and the queue entries as **data** through the controller. Unit `007` renders them. |

---

## Traceability

### Story `004-report-link-state`

| Requirement | Design element | Test file | Status |
|---|---|---|---|
| R-01 — three-valued link state, derived from contact outcomes | `LinkStatus`, `LinkStatePolicy.derive` | `tests/unit/orgatex-link-state.test.ts` | Covered |
| R-02 — the derivation is a pure function | `LinkStatePolicy` — no clock, no ports; `now` is an argument | `tests/unit/orgatex-link-state.test.ts` | Covered |
| R-03 — the read returns `status`, `lastContactAt`, `lastError`, `consecutiveFailures` | `LinkState`, `GET /api/orgatex/link-state` | `tests/integration/orgatex-link-state-api.test.ts` | Covered |
| R-04 — the un-synchronised count is reported while degraded or offline | `SyncQueueRepository.countUnlanded()`; the endpoint's `unsynchronisedCount` | `tests/integration/orgatex-link-state-api.test.ts` | Covered |
| R-05 — a status change records `from`, `to` and the time; an unchanged status records nothing | `LinkTransition`, `link_transitions`, `LinkStateService.recordSuccess`/`recordFailure` | `tests/unit/orgatex-link-transitions.test.ts` | Covered |
| R-06 — the freshness window is configuration, and zero is legal | `FreshnessWindow.of`, `readNonNegativeInt` in `orgatex-config.ts` | `tests/unit/orgatex-link-state.test.ts`, `tests/unit/orgatex-config.test.ts` | Covered |
| R-07 — weighing continues in every link state | The link state gates only the MES-facing reads and writes; unit 003 owns the confirmation gate | `tests/integration/orgatex-sync-queue-api.test.ts` | Covered |
| R-08 — the link state is decided here and consumed elsewhere | `LinkStateService` is the only writer; no other unit computes it | `tests/unit/orgatex-link-state.test.ts` | Covered |

### Story `005-queue-writes-offline-and-sync-on-recovery`

| Requirement | Design element | Test file | Status |
|---|---|---|---|
| R-09 — an undeliverable posting is enqueued and reported as pending | `SyncQueueService.enqueue`, `sync_queue_entries`, the `QUEUED` response | `tests/integration/orgatex-sync-queue-api.test.ts` | Covered |
| R-10 — the queue is durable across an immediate restart, with the original key | `sync_queue_entries` with `posting_id` as the PRIMARY KEY | `tests/unit/orgatex-sync-queue-persistence.test.ts` | Covered |
| R-11 — the flush delivers in queue order, with the same key | `findDue`'s `ORDER BY queued_at ASC, posting_id ASC`; the delivery through `ConsumptionPostingService` | `tests/unit/orgatex-sync-queue.test.ts` | Covered |
| R-12 — a permanently failed posting stays visible and can be re-driven | `state = 'FAILED'`, `markFailed`, `SyncQueueService.redrive` | `tests/unit/orgatex-sync-queue.test.ts` | Covered |
| R-13 — a failed retry updates the attempt count and the last error and leaves the entry in the queue | `recordAttempt`; the `remove` method is reachable only on delivery | `tests/unit/orgatex-sync-queue.test.ts` | Covered |
| R-14 — the queue view exposes the count and each entry's state | `GET /api/orgatex/sync-queue` | `tests/integration/orgatex-sync-queue-api.test.ts` | Covered |
| R-15 — a bounded backoff, with the retry count and last error retained | `SyncBackoffPolicy`, `BackoffSchedule.maxMs`, `attempts`, `last_error_*` | `tests/unit/orgatex-sync-backoff.test.ts` | Covered |
| R-16 — SQLite storage with a five-year retention | `node:sqlite` via `orgatex-database.ts`; the history stays in bolt 006's tables | `tests/unit/orgatex-sync-queue-persistence.test.ts` | Covered |
| R-17 — the disposition is configuration; a re-drive uses the same key | `RejectionDispositionReader`; the redrive loads the entry and sends its stored key | `tests/unit/orgatex-sync-queue.test.ts`, `tests/security/orgatex-sync-queue-security.test.ts` | Covered |
| R-18 — the queue is owned here and only here | No cache is added in units 001 or 002 | `tests/unit/orgatex-sync-queue.test.ts` | Covered |

### Upstream requirements and ADRs

| Anchor | Design element | Where it is honoured |
|---|---|---|
| FR-19 — peripheral status and failure handling | The link state as data; the rendering is unit 007's | §The Endpoints |
| FR-20 — offline operation and deferred synchronisation | The whole bolt | §Use-Case Flows |
| NFR-03 — availability during an outage | Weighing is never gated by the link state (R-07) | §Use-Case Flows, Flow C |
| NFR-05 — the queue is durable; the snapshots are not | `sync_queue_entries`; no snapshot table | §The Three New Tables in Detail |
| NFR-11 — externalised text; `SyncError.detail` never reaches a client | `SyncError.toClient()`; the log-only detail | §Security and Validation Notes |
| NFR-14 — the freshness window and the backoff are configuration | `orgatex-config.ts` | §Configuration |
| NFR-16 — fixed-point decimals; no floating point | `WeightValue`; `actual_quantity` is `TEXT` | §The Three New Tables in Detail |
| DR-01 — five-year retention | The history in bolt 006's tables; the queue is never pruned | §Assumptions (A9) |
| DR-02 — confirmed records are immutable | `SyncQueueEntry`'s immutable content; ADR-024's partial resolution | §Domain Model |
| IR-07 — one MES adapter | No new adapter; no new method on `OrgatexAdapter` | §Architecture Pattern |
| IR-08 — idempotent consumption posting | The ledger's PRIMARY KEY; the delivery through bolt 006's path | §Architecture Pattern |
| AC-09 — reconnection transmits without re-keying and without duplication | Flow E, step 4 | §Use-Case Flows |
| ADR-011 — link state is a separate axis from device status | The MES link is derived from contacts and never blocks a weighing | §The Derivation Rule |
| ADR-012 — the deadline is scheduled, not polled | `LinkFreshnessScheduler`; the callback evaluates the same pure policy | §Services and Ports |
| ADR-021 — the snapshots are not persisted | No snapshot table is added | §The Three New Tables in Detail |
| ADR-022 — the transport is not exercised by the tests | The gap is stated in three places | §Risks (K2) |
| ADR-023 — the ledger's PRIMARY KEY is the guarantee | The enqueue guard reads the ledger and the queue together | §Use-Case Flows, Flow C |
| ADR-024 — the posting's content is immutable | `SyncQueueEntry`'s immutable copy; no `update` on the port | §Domain Model |
| ADR-025 — the local ledger is the guarantee | Every delivery goes through bolt 006's ledger-guarded path | §Risks (K1) |
| ADR-026 — the disposition is configuration | `RejectionDispositionReader`, consumed not re-decided | §Services and Ports |

---

## Acceptance Checklist

Every item is a testable statement about the running product.

### Link state

- [ ] A successful contact derives `LINKED` and resets the failure count to zero.
- [ ] A failure within the freshness window derives `DEGRADED`.
- [ ] A failure outside the window — or a station that has never succeeded — derives `OFFLINE`.
- [ ] The freshness boundary is **inclusive**: at exactly `window.durationMs` the state is still `DEGRADED`.
- [ ] A freshness window of **zero** is accepted by the configuration and makes `DEGRADED` unreachable.
- [ ] The link-state read returns the status, the last successful contact time, the last error and the consecutive failure count.
- [ ] The last-contact time is `null` until a contact has succeeded.
- [ ] A status change appends a transition carrying `from`, `to`, the time and the cause.
- [ ] A contact that leaves the status unchanged appends **no** transition.
- [ ] The scheduled freshness deadline moves a degraded link to `OFFLINE` at the exact instant.
- [ ] The un-synchronised count is reported while the link is degraded or offline.

### The queue

- [ ] An undeliverable consumption is enqueued and reported as **pending**, never as posted.
- [ ] The response for a queued posting is `201` with `state: 'QUEUED'` and `pending: true`.
- [ ] A second enqueue of the same key is refused — the ledger and the queue are read together.
- [ ] The queue entry's content is immutable; only the attempt bookkeeping moves.
- [ ] The attempt count increases and never decreases.
- [ ] A failed retry leaves the entry in the queue, with its attempt count and last error updated.
- [ ] A definitive rejection under `PERMANENT` makes the entry `FAILED`, visible and re-drivable.
- [ ] A definitive rejection under `RETRYABLE` leaves the entry `PENDING` with a backoff.
- [ ] A `FAILED` entry is **never** deleted by the automatic path.
- [ ] The queue survives a restart: every entry is present, still `PENDING`, with its original key.
- [ ] The flush delivers in `queued_at ASC, posting_id ASC` order.
- [ ] Every delivery carries the key the entry was first created with.
- [ ] A re-drive is refused when the link is not `LINKED`, and the refusal counts as an attempt.
- [ ] A re-drive is refused when the entry is not `FAILED`, and when the key is already in the ledger.
- [ ] A re-drive of a delivered entry does not create a second consumption.
- [ ] The queue view exposes the count and each entry's state.

### Boundaries

- [ ] No link state ever refuses a weighing.
- [ ] The link state is derived in one place, and no other unit computes it.
- [ ] `SyncError.detail` never appears in a response body.
- [ ] The redrive's request body has no `operatorId`, no `idempotencyKey` and no `state` field.
- [ ] The quantity is persisted as `TEXT`, never as a float.
- [ ] A second MES adapter does not exist, and `OrgatexAdapter` gains no method.
- [ ] The link-state and sync-queue endpoints require an operator session.
- [ ] A transition log cannot be updated or deleted.

### Out of scope — deferred, not forgotten

- **The transport.** ADR-022's gap carries forward: no test proves that a request can be sent, received, timed out or retried over a socket. The Stage 5 test report must state it again.
- **The MES's write contract.** Q-01 and Q-02 are unanswered. The design assumes the worst case — no deduplication, key unread — and the local ledger is the guarantee.
- **The rendering.** Unit `007` (`028-007-weighingms-ui`) renders the status strip, the pending count and the failed-entries list. This bolt supplies the data only.
- **A queue prune policy.** The queue is never pruned. A policy would need an ADR, because a silent prune is exactly the failure this bolt exists to prevent.
- **Supervisor authorisation on the re-drive.** OQ-8 decides it is an ordinary operator action. A change needs an ADR and a seam into unit `008`.
- **Unifying `FreshnessWindow` with bolt 005's `SnapshotFreshness`.** Deferred, because it would edit bolt 005's tree.