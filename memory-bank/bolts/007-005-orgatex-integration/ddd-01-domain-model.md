---
unit: 005-orgatex-integration
bolt: 007-005-orgatex-integration
stage: model
status: complete
updated: 2026-11-03T13:20:00Z
---

# Static Model - OrgaTEX Link State and Deferred Synchronisation (bolt 007)

## Bounded Context

**The same bounded context as bolts 005 and 006 — OrgaTEX Integration.**
This bolt does not open a new context; it adds two capabilities to the one
that already exists.

It owns **linkage**, not meaning. It answers two questions for every other
unit:

> **Can we reach the MES right now, and what happens to a write we cannot
> deliver yet?**

Everything else — what a batch is, what a recipe means, what a weighing
means — belongs to units 001, 002 and 003.

### The one problem this bolt exists to solve

A consumption posting that cannot be delivered is **not** a consumption
that did not happen. The dye was dispensed. If the station treats an
undelivered posting as a failed write and drops it, the MES's record of
actual consumption is short by a weighing and **nothing says so**. That is
precisely the BRD's governing failure:

> *"no failure at any boundary may produce a silently wrong number."*

So the queue is not a convenience. It is the mechanism that keeps an
outage from becoming a wrong number.

### The rule that governs every shape in this document

Three consequences follow from the rule, and they are the reason the model
has the shapes it has:

1. **A queued write is shown as *pending*, never as *posted*.** The
   operator must never be told a consumption reached the MES when it did
   not.
2. **A stale snapshot is shown with its age, never as *current*.** The
   operator must never be handed yesterday's schedule as though it were
   today's.
3. **A failed write stays visible and re-drivable.** It is never silently
   discarded (FR-33: *"Surface synchronisation failures for manual
   attention"*).

### What this bolt does NOT own

- **The posting, its idempotency key and the ledger** → bolt 006. This
  bolt sends and re-sends postings; it does not design them.
- **The snapshots and the read fallback** → bolt 005 (ADR-021: the
  last-known-good is in memory and disposable). This bolt decides *whether
  a read may be served*, never *what the snapshot contains*.
- **The weighing record and the confirmation** → unit 003.
- **The ticket** → unit 006.
- **Rendering the status strip, the pending count and the failed entries**
  → unit 007 (`007-weighingms-ui`).

### The asymmetry this bolt completes

Bolt 006 established the durable side of the seam. Bolt 005 established
the disposable side. This bolt sits between them:

| | Owner | Persisted? | Why |
|---|---|---|---|
| Batch queue snapshot | bolt 005 | **No** | A projection of a system we do not own |
| Recipe snapshot | bolt 005 | **No** | Same |
| Consumption posting | bolt 006 | **Yes** | A statement about what *we* did |
| Idempotency ledger | bolt 006 | **Yes** | The durable proof that a key has been consumed |
| **Sync queue entry** | **this bolt** | **Yes** | A statement that a posting has **not** landed yet |

The queue is durable **for the same reason** the posting is durable, and
for no other: it cannot be re-derived. A snapshot can always be fetched
again; an unlanded consumption cannot.

---

## Domain Entities

| Entity | Properties | Business Rules |
|--------|------------|----------------|
| **SyncQueueEntry** | `postingId` (the idempotency key), `batchId`, `componentId`, `actualQuantity`, `unit`, `lotNumber`, `operatorId`, `queuedAt`, `attempts`, `lastAttemptAt`, `nextAttemptAt`, `lastError`, `state` | The entry is the **durable record of a posting that has not landed**. It carries the posting's **content** so that the flush can deliver it without consulting a mutable posting row (ADR-024: the posting's content is immutable — so a copy of it is immutable too). `attempts` counts **delivery attempts made through the queue**, starting at 0. `state` is one of `PENDING` \| `FAILED`. **There is no `DELIVERED` state**: a delivered entry is removed from the queue and the *posting* becomes `ACCEPTED` (bolt 006's state). A queue entry's state answers *"has this failed?"*, and the posting's state answers *"did it land?"* — two different questions, two different records. |
| **LinkTransition** | `from`, `to`, `occurredAt`, `cause` | An append-only record of one **transition** of the link state, with the time it happened and what caused it. Written whenever the status changes — never for a status that did not change. This is the story's *"the previous state, the new state and the time of the transition are recorded"* (FR-19). It is a **record**, not a state: the link's *current* status is the `LinkState` value object. |

### Why the queue entry duplicates the posting's content

The obvious alternative is a queue entry that holds only `postingId` and
reads the posting when the flush runs. That would be less data and one
source of truth.

It is rejected for two reasons, and both come from ADR-024:

1. **The posting's state is mutable** — it moves `QUEUED → ACCEPTED` →
   (and the ledger records it). A queue that reads a mutable row at
   delivery time is a queue whose *content* can change underneath it,
   which is precisely what ADR-024 forbids for a consumption record.
2. **The queue must be self-sufficient to deliver.** A flush is the one
   operation that runs while something else may have failed. If it
   depends on a second row being present and consistent, it has two
   failure modes instead of one.

So the entry holds an **immutable copy** of the posting's content, and the
copy is written once, at enqueue time, and never edited. The posting's
row remains bolt 006's record of what was attempted; the queue entry is
this bolt's record of what has not yet landed.

**What is NOT copied** is bolt 006's `state`, `rejection_code` and
`rejection_detail`. Those are the MES's answers, and the queue does not
have them yet.

### Why `state` is `PENDING` \| `FAILED` and nothing else

Three candidate states were considered:

- `PENDING` — queued, will be retried on the backoff.
- `FAILED` — the last attempt failed **permanently** under the configured
  disposition; the entry is visible and re-drivable, but the worker will
  not retry it on its own.
- `DELIVERED` — rejected, because a delivered entry is **not in the
  queue**. It is gone, and the *posting* says `ACCEPTED`.

The third would be a second source of truth about whether a consumption
landed — and the ledger already is that source (ADR-023). A queue row
that says `DELIVERED` and a posting row that says `QUEUED` would be a
silent wrong number waiting to happen.

### The states of a queue entry, and what each one means

```
PENDING  queued; the worker will retry it on the backoff
FAILED   the last attempt failed permanently under the disposition;
         visible, re-drivable, and NOT retried automatically
```

**`FAILED` is not "given up on".** It is "the automatic path has stopped
and a human is now the mechanism". The story is explicit: *"it can be
re-driven — it is never silently discarded."*

---

## Value Objects

| Value Object | Properties | Constraints |
|--------------|------------|-------------|
| **LinkState** | `status` (`LINKED` \| `DEGRADED` \| `OFFLINE`), `lastContactAt`, `lastError`, `consecutiveFailures` | `status` is the closed set of three. `lastContactAt` is the time of the **last successful** contact, and is **null** when the station has never contacted the MES successfully. `lastError` is the **last failure's** diagnostic — the MES's own text, bounded — and is **null** when there is no failure on record. `consecutiveFailures` is a non-negative count of failures **since the last success**; it is reset to 0 on success. The object is **immutable**: a contact outcome produces a *new* `LinkState`, never a mutation. |
| **LinkStatus** | — | The closed set `LINKED` \| `DEGRADED` \| `OFFLINE`. A type, not a string, so a caller cannot read a status it has not proved. |
| **FreshnessWindow** | `durationMs` | The configured window that separates `DEGRADED` from `OFFLINE`. A **value object, not a constant**, because NFR-14 requires configuration rather than code, and because a window of **zero** is a legitimate configured value (the story's edge case: *"The freshness window is configured to zero → the state transitions from `DEGRADED` to `OFFLINE` on the first failure"*). |
| **SyncQueueEntryState** | — | The closed set `PENDING` \| `FAILED`. |
| **BackoffSchedule** | `baseMs`, `maxMs`, `multiplier`, `jitter` | The bounded backoff policy, as **configuration**. The bound (`maxMs`) is the part that matters: an unbounded backoff is a queue that never retries, which is a silent discard with extra steps. |
| **SyncError** | `code`, `detail` | A **code** from a closed set — `UNREACHABLE`, `TIMEOUT`, `REJECTED`, `MALFORMED` — plus the diagnostic detail, bounded to 500 characters, which goes to the **log and never to the client** (IR-09, NFR-11). The code is the contract; the detail is for the diagnosis. |

### The three states, and each one's consequence

The states are not a severity scale. Each one has a **defined consequence**,
and the consequence is what the model is for.

| Status | Meaning | Consequence |
|--------|---------|-------------|
| `LINKED` | The last contact succeeded | **Reads and writes proceed normally.** Nothing is queued. |
| `DEGRADED` | Recent contacts failed, but the last successful snapshot is still within its freshness window | **Reads serve the last snapshot, marked with its age. Writes queue.** |
| `OFFLINE` | The station cannot reach the MES | **Reads fail loudly. Writes queue. Weighing continues.** |

**Weighing continues in every state.** `OFFLINE` is a condition of the
**link**, not of the station (FR-20, NFR-03). The state changes what the
**MES-facing** operations do — reads and writes — and nothing else. No
state of this link can refuse a weighing.

### The link state is a property of the boundary, not of a device

ADR-011 established that **link state is a separate axis from the
published device status**, and that the scale's link state is derived from
*readings stopping*.

**This is a different mechanism, and it must not be modelled as the same
thing.**

| | The scale's link (ADR-011/012) | The MES link (this bolt) |
|---|---|---|
| **What is observed** | A reading with a greater sequence number arrives | A request to the MES returns a **definitive answer** (or does not) |
| **What "down" means** | The watchdog's deadline passed | The **last contact failed** and the last successful snapshot has aged out |
| **How it is detected** | A **scheduled** timer on the last reading's receipt time | The **outcome of each contact**, plus a **scheduled** timer for the freshness deadline |
| **What it gates** | Whether a weighing may be **confirmed** | Whether a **read** may be served and whether a **write** is sent or queued |
| **Who consumes it** | The weighing gate | The MES-facing readers and writers |

The scale's link can **block weighing** — a disconnected scale has no
weight to confirm. The MES's link **cannot**: there is no reading to take
from OrgaTEX, and the BRD requires the shift to continue without it. The
two links are therefore not interchangeable, and a shared "link" abstraction
that carried the scale's semantics would be a trap: it would import
"disconnected means blocking" into a boundary where blocking is forbidden.

The MES is **not a device**. ADR-011's rule — a link state is *what we
conclude* about a boundary, kept apart from a *self-reported status* —
still applies, and it applies more strongly here: there is **no MES-side
status** to report. The MES has no idea it is unreachable. Every word of
the link state is something the station concluded.

### How the state is derived — never hard-coded

The prototype's hard-coded `ORGATEX · LINKED` becomes a real state with
real consequences (C-10). The derivation is a **pure function of observed
contact outcomes**, and it is the only way the status can be set.

The inputs are:

- the **last successful contact time** (`lastContactAt`),
- the **last failure** (its error and the time),
- the **consecutive failure count**,
- the **freshness window**,
- and the **current time**.

The rules:

```text
LINKED    the last contact succeeded (consecutiveFailures = 0)
DEGRADED  the last contact failed, AND a last successful contact exists,
          AND now − lastContactAt ≤ freshnessWindow
OFFLINE   otherwise — including "never contacted successfully"
```

Four consequences worth stating, because each is an edge case the story
names:

1. **A station that has never contacted the MES is `OFFLINE`**, with no
   last-contact time and no snapshot served. It is not `LINKED` and it is
   not `DEGRADED` — `DEGRADED` requires a *last successful snapshot*, and
   there is none.
2. **The freshness window of zero makes `DEGRADED` unreachable**, because
   no snapshot is ever fresh enough to serve. `DEGRADED → OFFLINE` then
   happens on the **first** failure.
3. **A successful contact resets the streak**: the failure count returns
   to zero, the last error is cleared, and the status becomes `LINKED`.
   An **error response from the MES is a failed contact** — the MES
   answered, and the answer was a failure.
4. **A slow MES that answers within the timeout is a success.** The state
   is unaffected; the timeout, not the latency, is the boundary.

**The state changes only when the status changes.** A failure that leaves
the status where it was (`DEGRADED` → `DEGRADED`) updates the count and
the error but records **no transition** — there was no transition.

### The freshness deadline is scheduled, not polled

ADR-012 settled the principle for the scale's watchdog: *"The scheduler
decides when to ask. The policy decides the answer."*

The same principle applies here, and it is not optional, because a polled
link state would be **wrong by up to a poll interval** at exactly the
moment it matters: the snapshot's freshness window expiring. The station
would keep serving a stale schedule for up to a poll interval after the
window closed.

So when a contact fails, the service computes the deadline
`lastContactAt + freshnessWindow` and **schedules** the transition to
`OFFLINE` at that time. The scheduled callback evaluates the **same pure
policy** the contact path evaluates, so the two paths cannot disagree.

This is ADR-012 **extended**, not repeated: the scale's deadline is
computed from a *reading's receipt time*, this one from a *contact's
success time*. The split of responsibilities is identical.

---

## Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **SyncQueueEntry** | the entry itself | 1. The `postingId` **is** the idempotency key, and it is **unique** across the queue — a second enqueue of the same key is refused (the duplicate guard). 2. The **content** — batch, component, quantity, unit, lot, operator, weighed-at, queued-at — is **immutable** once written (DR-02, ADR-024). 3. `attempts` only ever **increases**, and never decreases. 4. `nextAttemptAt` is set whenever an attempt fails; a `PENDING` entry **always** has a next attempt time. 5. A `FAILED` entry has **no** next attempt time — it is not on the automatic path. 6. The entry is **never silently discarded**: it leaves the queue only by being delivered, and it is never deleted while it is failed. |

### The link state is not an aggregate — it is a value with a history

`LinkState` is a **value object**, not an aggregate root, and that is
deliberate.

The reasons:

1. **There is exactly one link.** There is no identity to hold, no set of
   instances to distinguish, and no concurrency question about two agents
   editing it. A singleton with an id would be a fiction.
2. **Its transitions are facts, not mutations.** A `LinkTransition` is
   **append-only** — the same discipline ADR-009 used for the scale's link
   events. A history that could be rewritten is not a history.
3. **The current status is derived**, not stored as the truth. The
   authoritative inputs are the contact outcomes; the status is what the
   policy says they imply.

So the aggregate is the **queue entry**, and the link is a value plus a
transcript.

### There is no aggregate spanning a batch and its queue entries

A batch's `WEIGHED` status write is bolt 006's, and it **queries** the
postings. The same reasoning applies: the MES owns the batch, and an
invariant that spans data we do not control has to be enforced against
data we do not control. The rule is a **precondition on the write**, not
an invariant on a shared aggregate.

---

## Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **LinkStateChanged** | The derived status differs from the previous status | `from`, `to`, `occurredAt`, `cause` (a contact outcome, the freshness deadline, or the first observation) |
| **SyncEntryQueued** | A posting could not be delivered and was written to the queue | `postingId`, `batchId`, `componentId`, `queuedAt` |
| **SyncEntryAttempted** | One delivery attempt was made, whatever its outcome | `postingId`, `attemptedAt`, `outcome` (`ACCEPTED` \| `REJECTED` \| `UNKNOWN` \| `UNREACHABLE`), `attempts` |
| **SyncEntryFailed** | An attempt failed **permanently** under the configured disposition | `postingId`, `lastError` (code + detail), `attempts`, `lastAttemptAt` |
| **SyncEntryDelivered** | The MES definitively accepted the posting | `postingId`, `batchId`, `acceptedAt` |
| **SyncQueueFlushed** | A recovery flush finished | `attempted`, `delivered`, `failed`, `remaining` |

### Why there is no `LinkContactFailed` event

There **is** one — bolt 006's `*ReadFailed` / attempt events cover the
contact side — but it is deliberately **not** one of this bolt's events.
The link's own vocabulary is about the **state**, and the state changes
only when the status changes. A failed contact that leaves the status at
`DEGRADED` is not a state change, and emitting an event for it would make
"the link changed" mean "something happened", which is exactly the
ambiguity the `LinkTransition` record is there to remove.

### Why `SyncEntryAttempted` exists even though `SyncEntryDelivered` does too

They are not redundant, for the same reason bolt 006's attempt event
coexists with its outcome event: the attempt event fires on **every**
attempt, including the ones that establish nothing; the outcome events
fire only on a **definitive** answer. A caller that wants to know "what
happened?" subscribes to the attempt; a caller that wants to know "what is
the state?" reads the entry.

---

## Domain Services

| Service | Operations | Dependencies |
|---------|------------|--------------|
| **LinkStatePolicy** | `derive(lastSuccessAt, lastFailureAt, consecutiveFailures, now, freshnessWindow) → LinkState` | **Pure.** No clock, no ports. The policy decides the answer; the scheduler decides when to ask (ADR-012's split). |
| **LinkStateService** | `recordSuccess(at) → LinkState`; `recordFailure(error, at) → LinkState`; `read() → LinkState` | The `LinkStatePolicy`; the `LinkTransitionRepository`; the `Clock`; the `FreshnessWindow` (configuration) |
| **LinkFreshnessScheduler** *(port)* | `schedule(deadline, callback) → handle`; `cancel(handle)` | The scheduler implementation — ADR-012's shape. The **deadline** is computed by the policy's caller; the **answer** by the policy. |
| **SyncQueueService** | `enqueue(posting) → refused-as-duplicate \| queued`; `retryDue(now) → outcomes`; `flushOnRecovery() → outcomes`; `redrive(postingId) → refused \| attempted` | The `OrgatexAdapter` port; the `SyncQueueRepository`; the `PostingRepository` (to resolve the posting on delivery); the `IdempotencyLedger` (to refuse a key already consumed); the `PostingAttemptRepository`; the `BackoffSchedule` (configuration) |
| **SyncBackoffPolicy** | `nextAttemptAt(attempts, now) → timestamp` | **Pure.** The bound is in the schedule, not in the code. |
| **RejectionDispositionReader** *(port)* | `disposition() → RETRYABLE \| PERMANENT` | The configuration source — bolt 006's `WEIGHINGMS_ORGATEX_REJECTION_DISPOSITION`, default `RETRYABLE` (ADR-026) |

### The two guards, and why they are different checks

Bolt 006 established that "has this key been seen?" is **not one question**
— a key that is `ACCEPTED` must never be sent again, a key that is
`QUEUED` must never be re-enqueued, and a key that is `REJECTED` **may**
be, because the disposition decides.

This bolt **consumes** that rule rather than re-deriving it:

- **On enqueue:** the key is refused if it is already in the **ledger**
  (bolt 006's guarantee) **or** already in the **queue** (this bolt's
  guarantee). The two are read **together**, because a `QUEUED` posting's
  key is deliberately **not** in the ledger — ADR-023 says so explicitly.
- **On delivery:** the posting is sent through bolt 006's posting path,
  which consults the ledger before it sends. The queue does **not** get a
  second opinion on the key; it uses the same path, so there is one
  implementation of "this key was already consumed".

**The boundary with bolt 006's ledger, stated once:**

> The **ledger** is the idempotency guarantee. It holds a key only when a
> posting was **definitively accepted**.
> The **queue** holds the keys the ledger does **not** yet hold — the
> keys of postings that have not landed.
> The queue is therefore **not** a second ledger and never duplicates one:
> a key may be in the queue, in the ledger, or in neither, but the
> **ledger's presence always wins**.

### The rejection disposition is consumed, not re-decided

ADR-026 made the disposition **configuration**, defaulting to
`RETRYABLE`, and explicitly left the decision of *what to do next* to this
bolt:

> *"The disposition decides whether bolt 007's retry machinery re-drives
> it — and that is bolt 007's concern."*

So this bolt **consumes** it:

- `RETRYABLE` (the default): a definitive rejection is a **retryable
  failure**. The entry stays `PENDING`, the attempt count and the last
  error are updated, and the entry returns to the queue with a backoff.
  **The entry is not removed.**
- `PERMANENT`: a definitive rejection makes the entry `FAILED`. It stays
  **visible**, with its last error, its attempt count and its last attempt
  time, and it can be **re-driven** by an operator. It is **not**
  deleted.

**Under either disposition the entry is retained.** The disposition decides
whether the *worker* tries again; it never decides whether the *record
survives*. That is the difference between "the automation stopped" and
"the consumption disappeared", and only the first is acceptable.

### The re-drive path, and what it refuses

A re-drive is an operator asking for one specific failed entry to be tried
again **now**, rather than waiting for the backoff.

It is refused, with a stated reason, when:

- the link is not `LINKED` — there is nothing to drive it with. The entry
  **remains visible as failed**, with its attempt count updated by the
  refused attempt (the story says the attempt count is updated, and the
  refusal is an attempt);
- the entry is not `FAILED` — a `PENDING` entry is already on the
  automatic path, and re-driving it would be a second path to the same
  delivery;
- the key is already in the **ledger** — the posting has landed. There is
  nothing to drive.

**A re-drive uses the same idempotency key.** The key is not re-derived
and not re-keyed, so a re-drive of an ambiguous failure cannot double-post
(IR-08, AC-09).

---

## Repository Interfaces

| Repository | Entity | Methods |
|------------|--------|---------|
| **SyncQueueRepository** | `SyncQueueEntry` | `enqueue(entry) → void`; `findByPostingId(postingId) → entry \| null`; `findDue(now, limit) → entries[] **in queue order**`; `findAll() → entries[]`; `countUnlanded() → number`; `recordAttempt(postingId, outcome, error, attemptedAt, nextAttemptAt, attempts)` → void; `markFailed(postingId, error, attemptedAt, attempts)` → void; `remove(postingId) → void` **only on delivery**; `reschedule(postingId, nextAttemptAt)` → void. **Persisted.** |
| **LinkContactRepository** | **Link observations** — `lastSuccessAt`, `lastFailureAt`, `lastError`, `consecutiveFailures` | `read() → observations`; `recordSuccess(at) → void`; `recordFailure(error, at) → void`. **Persisted — one row.** Holds the **observations**, never the derived status. |
| **LinkTransitionRepository** | `LinkTransition` | `append(transition) → void`; `findAll() → transitions[] **in order**`; `findMostRecent() → transition \| null`. **Persisted, append-only — no `update`, no `delete`.** |

### The methods that are ABSENT, and why their absence is the enforcement

| Repository | Absent on purpose | Why |
|------------|------------------|-----|
| **SyncQueueRepository** | **no `update`** | The entry's content is immutable (ADR-024). Only the attempt bookkeeping may change, and only through the three named methods. |
| **SyncQueueRepository** | **no `delete`** | Nothing is discarded. `remove` exists for exactly one reason — the posting was **delivered** — and it is named for that, not `delete`. |
| **LinkTransitionRepository** | **no `update`, no `delete`** | A transition is a fact about the past. Rewriting history would make the transition record useless for the diagnosis it exists to serve. |

This is the same technique ADR-006 and ADR-023 used: **the absence of a
method is the rule**, and the database's constraints back it up.

### What is NOT persisted

- **No snapshot.** Bolt 005's ADR-021 stands; this bolt adds no table for
  the batch queue or the recipe.
- **No copy of the MES's rejection detail on the queue entry beyond the
  bounded last error.** The full attempt history lives in bolt 006's
  `posting_attempts`; the queue entry carries the **last** error so the
  operator can see why the entry is stuck without a second read.
- **No cached link state.** The link's current status is **derived** on
  read from the last success, the last failure and the failure count. A
  persisted status would be a second source of truth that could disagree
  with the derivation.

---

## Ubiquitous Language

| Term | Definition |
|------|------------|
| **Link state** | How well the station can reach the MES, as one of `LINKED`, `DEGRADED` or `OFFLINE`. A property of the **boundary**, decided here and consumed everywhere else. Never hard-coded. |
| **Link state, Mes** | The MES's link state — this bolt's. Distinct from the **scale's** link state (ADR-011/012): it is derived from **contact outcomes**, and it never blocks a weighing. |
| **Contact** | One attempt to reach the MES and get an answer. A contact is successful, failed or timed out. Every contact is an observation the link state is derived from. |
| **Freshness window** | The configured duration for which the last successful snapshot may still be served. Separates `DEGRADED` from `OFFLINE`. Zero is legal. |
| **Queue entry** | The durable record of a posting that has not landed, with its content, its attempt count and its last error. |
| **Pending** | A queue entry that is queued and will be retried on the backoff. **Never** reported as posted. |
| **Failed** | A queue entry whose last attempt failed permanently under the configured disposition. Visible, re-drivable, **not** retried automatically, **not** discarded. |
| **Un-synchronised record** | One queue entry that has not landed. The count is the number of entries in the queue. |
| **Flush on recovery** | The delivery of every queued entry, in queue order, when the link comes back. It re-uses each entry's original key and never re-keys. |
| **Backoff** | The bounded wait before the next automatic attempt. The bound is configuration, and an unbounded backoff is a discard in disguise. |
| **Re-drive** | An operator asking for one failed entry to be attempted again now. Same key, same content. |
| **Rejection disposition** | Configuration deciding whether a definitive rejection is retried (`RETRYABLE`, the default) or requires manual attention (`PERMANENT`). Owned by ADR-026; **consumed** here. |
| **Unlanded** | A posting that has not been definitively accepted by the MES. It is either queued or failed — never posted, never gone. |
| **Nothing is silently discarded** | The rule behind the failed entry, the re-drive path and the retention. A consumption that cannot be delivered stays visible until a person deals with it. |
