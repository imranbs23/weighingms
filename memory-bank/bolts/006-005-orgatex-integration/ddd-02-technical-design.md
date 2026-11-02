---
unit: 005-orgatex-integration
bolt: 006-005-orgatex-integration
stage: design
status: complete
updated: 2026-11-02T21:10:00Z
---

# Technical Design - OrgaTEX Integration (bolt 006)

## Architecture Pattern

**Hexagonal (ports and adapters), continuing bolt 005's structure.**

The write path follows the same shape as the read path, so the seam that
IR-07 requires is a seam in **both** directions:

```text
        ┌──────────────────────────────────────────────┐
        │  Presentation                                │
        │  orgatex-write-controller.ts                  │
        │  dummy-orgatex-controller.ts (the artefact)   │
        ├──────────────────────────────────────────────┤
        │  Application (domain services)                │
        │  ConsumptionPostingService                    │
        │  BatchStatusWriteService                      │
        │  IdempotencyKeyFactory                        │
        ├──────────────────────────────────────────────┤
        │  Domain                                       │
        │  ConsumptionPosting · PostingAttempt          │
        │  BatchStatusWrite                             │
        │  IdempotencyKey · PostingState ·              │
        │  AttemptOutcome · RejectionReason             │
        │  ═══ PORTS ═══                               │
        │  OrgatexAdapter (grows write methods)         │
        │  IdempotencyLedger                            │
        │  PostingRepository                            │
        │  PostingAttemptRepository                     │
        │  BatchStatusWriteRepository                   │
        ├──────────────────────────────────────────────┤
        │  Infrastructure                               │
        │  SqliteIdempotencyLedger                      │
        │  SqlitePostingRepository                      │
        │  SqlitePostingAttemptRepository               │
        │  SqliteBatchStatusWriteRepository             │
        │  DummyOrgatexAdapter (grows write methods)    │
        └──────────────────────────────────────────────┘
```

### Why the same pattern, not a new one

IR-07 says *"All OrgaTEX interaction is confined to a single adapter
component, so a change of interface technology affects one replaceable
part."* A read seam with a write seam beside it would be **two** seams,
and a change of interface technology would touch both. Bolt 005 built one
port with two read methods; **this bolt grows that same port** with two
write methods.

The port's read methods were deliberately narrow — `readQueue`,
`readRecipe`. The write methods are narrow for the same reason:

- `postConsumption(posting)` — carry one consumption, with its key
- `writeBatchStatus(batchId, status)` — change **one** field

`writeBatchStatus` takes a **status**, not a batch. That is the whole of
IR-06 and C-01 expressed in a signature: there is no parameter through
which another OrgaTEX batch field could be altered, so a future caller
cannot alter one by accident.

### What stays exactly as it was

**The adapter remains in-process**, and ADR-022's stated gap carries
forward unchanged: the **transport is still not exercised by the tests**.
The write path inherits that gap rather than closing it, and the test
report will say so again.

---

## Layer Structure

### Domain — `src/005-orgatex-integration/domain/`

```text
domain/
├── value-objects/
│   ├── idempotency-key.ts        ← NEW
│   ├── posting-state.ts          ← NEW
│   ├── attempt-outcome.ts        ← NEW
│   ├── rejection-reason.ts       ← NEW
│   ├── lot-number.ts             ← NEW
│   └── operators.ts              ← NEW  (OperatorReference)
├── entities/
│   ├── snapshots.ts              (existing, unchanged)
│   └── postings.ts               ← NEW
│       ConsumptionPosting · PostingAttempt · BatchStatusWrite
├── services/
│   ├── batch-eligibility-rule.ts (existing, unchanged)
│   ├── snapshot-cache.ts         (existing, unchanged)
│   ├── batch-queue-reader.ts     (existing, unchanged)
│   ├── recipe-reader.ts          (existing, unchanged)
│   ├── idempotency-key-factory.ts    ← NEW
│   ├── consumption-posting-service.ts ← NEW
│   └── batch-status-write-service.ts  ← NEW
├── ports/
│   ├── orgatex-adapter.ts        ← MODIFIED (grows two write methods)
│   ├── idempotency-ledger.ts     ← NEW
│   ├── posting-repository.ts     ← NEW
│   ├── posting-attempt-repository.ts ← NEW
│   └── batch-status-write-repository.ts ← NEW
└── events/
    ├── orgatex-events.ts         (existing, unchanged)
    └── posting-events.ts         ← NEW
```

### Infrastructure — `src/005-orgatex-integration/infrastructure/`

```text
infrastructure/
├── adapters/
│   ├── dummy-orgatex-adapter.ts  ← MODIFIED (grows two write methods)
│   └── dummy-orgatex-data.ts     ← MODIFIED (grows consumption + status)
├── config/
│   └── orgatex-config.ts         ← MODIFIED (grows the disposition)
├── persistence/
│   ├── orgatex-database.ts       ← NEW (four tables + migrations)
│   ├── sqlite-idempotency-ledger.ts ← NEW
│   ├── sqlite-posting-repository.ts ← NEW
│   ├── sqlite-posting-attempt-repository.ts ← NEW
│   └── sqlite-batch-status-write-repository.ts ← NEW
└── composition-root.ts           ← MODIFIED
```

### Presentation — `src/005-orgatex-integration/presentation/`

```text
presentation/
└── controllers/
    ├── orgatex-controller.ts     ← MODIFIED (grows two write endpoints)
    ├── dummy-orgatex-controller.ts ← MODIFIED (grows the MES's write endpoints)
    └── orgatex-write-schemas.ts  ← NEW
```

---

## The Four New Tables

All four live in the **same database file** as the identity and scale
units, sharing one `schema_migrations` table — the pattern bolt 004's
`openScaleDatabase` already established.

```text
┌──────────────────────────┐
│ consumption_postings     │  the posting: content + state
├──────────────────────────┤
│ idempotency_ledger       │  the dedup index: key → accepted
├──────────────────────────┤
│ posting_attempts         │  append-only: one row per attempt
├──────────────────────────┤
│ batch_status_writes      │  one row per status write
└──────────────────────────┘
```

### `consumption_postings`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | **The idempotency key.** The key IS the posting's identity. |
| `batch_id` | TEXT NOT NULL | |
| `component_id` | TEXT NOT NULL | |
| `actual_quantity` | TEXT NOT NULL | **TEXT, never REAL** (NFR-16) |
| `unit` | TEXT NOT NULL | The posted unit |
| `lot_number` | TEXT NOT NULL | |
| `operator_id` | TEXT NOT NULL | Who weighed it |
| `weighed_at` | TEXT NOT NULL | The time of the weighing |
| `created_at` | TEXT NOT NULL | When the posting was made |
| `state` | TEXT NOT NULL | `QUEUED` \| `ACCEPTED` \| `REJECTED` — CHECK constrained |
| `rejection_code` | TEXT NULL | Set only when `state = 'REJECTED'` |
| `rejection_detail` | TEXT NULL | The diagnostic detail |

**The content columns are immutable.** Only `state`, `rejection_code` and
`rejection_detail` may change, and only from `QUEUED`.

**How the immutability is enforced:** the repository exposes **no**
general update. It has one method that transitions the state, and that
method's SQL has `WHERE state = 'QUEUED'`. A second transition affects
zero rows and the repository raises — so a double-accept cannot overwrite
an accepted posting, and a rejected posting's content cannot be edited.

This is the same trick ADR-006 used for authorisation consumption: the
append-only rule expressed by the **absence** of a method, and the
single-use rule expressed by the **database**.

### `idempotency_ledger`

| Column | Type | Notes |
|---|---|---|
| `idempotency_key` | TEXT PK | The key. **The primary key IS the uniqueness guarantee.** |
| `posting_id` | TEXT NOT NULL | FK → `consumption_postings.id` |
| `recorded_at` | TEXT NOT NULL | |

**This is the smallest table and the most important one.** Its primary key
on `idempotency_key` is what makes "posting the same consumption twice
adds nothing" **atomic under concurrency** — two simultaneous submissions
of the same key cannot both be admitted, because one of the two inserts
loses.

**The ledger is only written when a posting is `ACCEPTED`.** A `QUEUED`
posting's key is *not* in the ledger — it is in the sync queue, which
bolt 007 owns, and the enqueue guard reads **both**.

### `posting_attempts`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | The attempt's own id |
| `posting_id` | TEXT NOT NULL | FK → `consumption_postings.id` |
| `attempted_at` | TEXT NOT NULL | |
| `outcome` | TEXT NOT NULL | `ACCEPTED` \| `REJECTED` \| `UNKNOWN` \| `UNREACHABLE` |
| `reason_code` | TEXT NULL | For a rejection |
| `reason_detail` | TEXT NULL | For the log — **never for the client** (IR-09) |

**APPEND-ONLY.** The repository has no update and no delete. The
migration is named to say so.

### `batch_status_writes`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `batch_id` | TEXT NOT NULL | |
| `status` | TEXT NOT NULL | The status written — `WEIGHED` |
| `written_at` | TEXT NOT NULL | |
| `state` | TEXT NOT NULL | `QUEUED` \| `ACCEPTED` \| `REJECTED` |

**One row per write attempt.** The MES's batch fields are **never**
mirrored here — the table holds what we *wrote*, not what the MES holds.

### What is NOT in the schema

- **No batch table.** The MES owns the batch; this unit does not mirror
  it (bolt 005's ADR-021, extended).
- **No recipe table.** Same.
- **No snapshot table.** Same.
- **No `idempotency_key` on a MES-side row.** The key is **local**.

---

## API Design

### The product's endpoints — `/api/orgatex`

Both require an **operator session** (ADR-020), and **neither** requires
a supervisor: posting a consumption authorises nothing.

| Endpoint | Method | Request | Response |
|---|---|---|---|
| `/api/orgatex/batches/:batchId/consumption` | POST | `{ componentId, actualQuantity, unit, lotNumber, weighedAt }` | `201` `{ postingId, state, ... }` |
| `/api/orgatex/batches/:batchId/status` | POST | `{ status }` | `202` `{ writeId, state }` |

**The operator id is NOT in the request body.** It comes from the
**session**. A body that carried an operator id would let a caller post
consumption as somebody else, and the MES's consumption record would name
the wrong person. The session is the only source of who weighed it.

**`weighedAt` IS in the body**, because it is a fact about the weighing,
not about the caller. It must be the time of the *weighing*, which may be
earlier than the posting.

#### `POST /api/orgatex/batches/:batchId/consumption`

```json
// request
{
  "componentId": "DYE-4471-Y",
  "actualQuantity": "94.0100",
  "unit": "g",
  "lotNumber": "L-77120",
  "weighedAt": "2026-11-02T08:14:22.000Z"
}

// 201 — accepted by the MES
{
  "postingId": "IDK-7f3a9c21",
  "batchId": "B-24187",
  "componentId": "DYE-4471-Y",
  "state": "ACCEPTED",
  "acceptedAt": "2026-11-02T08:14:23.104Z"
}

// 201 — queued, because the link is down. NEVER reported as posted.
{
  "postingId": "IDK-7f3a9c21",
  "batchId": "B-24187",
  "componentId": "DYE-4471-Y",
  "state": "QUEUED",
  "pending": true
}

// 200 — a duplicate. The second post adds nothing.
{
  "postingId": "IDK-7f3a9c21",
  "state": "ACCEPTED",
  "duplicate": true
}

// 422 — the MES rejected it. The reason CODE is in the body.
{
  "error": "CONSUMPTION_REJECTED",
  "reason": "BATCH_NOT_POSTABLE",
  "detail": "the MES's own diagnostic text"
}
```

**Every quantity is a decimal STRING** (ADR-008). A JSON number would
undo the guarantee in transit.

**A `QUEUED` posting is a `201` with `state: 'QUEUED'` and
`pending: true`** — it is not a `202`, because the posting was created and
persisted. The `pending` flag is explicit so a consumer cannot read
`state` and assume the MES has it.

#### `POST /api/orgatex/batches/:batchId/status`

```json
// request
{ "status": "WEIGHED" }

// 202 — the status write is queued
{ "writeId": "BSW-2c81e04", "batchId": "B-24187", "state": "QUEUED", "pending": true }

// 200 — written
{ "writeId": "BSW-2c81e04", "batchId": "B-24187", "state": "ACCEPTED", "writtenAt": "..." }

// 409 — the batch's postings are not all resolved
{ "error": "POSTINGS_UNRESOLVED", "unresolved": 2 }
```

**The `409` is the precondition, and it is a `409` rather than a `422`.**
The request is well-formed; the *state* of the world is what refuses it.
A batch whose second component has not landed is not a malformed request.

**Only `WEIGHED` is writable** through this endpoint. The BRD says the
status is advanced to `WEIGHED` on batch completion (IR-06), and every
other status transition belongs to a different moment in the workflow —
one this unit does not own. The endpoint's schema is a **literal**, not a
free string.

### The Dummy MES's endpoints — `/api/batches`

The **training artefact** — the MES's own surface. Open, because the MES
is the external system and the product's adapter would reach it without a
WeighingMS session (bolt 005's ADR-022 reasoning).

| Endpoint | Method | Request | Response |
|---|---|---|---|
| `/api/batches/:batchId/consumption` | POST | the MES's own payload shape | `202` `{ received: true, idempotencyKey }` |
| `/api/batches/:batchId/status` | POST | `{ status }` | `202` `{ received: true }` |

The tech stack's API shape lists `POST /api/batches/:batchId/consumption`
already — so this bolt **fills in an endpoint the standards already
named**, rather than inventing one.

**The MES's idempotency support is unknown** (Q-02), so the Dummy MES
**does** honour the key — it records it and refuses a repeat with the
same key. That is the **training** behaviour, and it is explicitly a
**training** behaviour: the real MES may not. The local ledger is what
makes the product safe either way.

### The Dummy MES's training controls

Added alongside the write endpoints, so the whole write path is
demonstrable in the running product:

| Endpoint | Method | Request | Effect |
|---|---|---|---|
| `/api/orgatex/control` | POST | `{ state: 'REACHABLE' \| 'UNREACHABLE' }` | Makes the MES unreachable — **already exists** from bolt 005 |
| `/api/orgatex/control/reject` | POST | `{ enabled: boolean }` | Makes the MES **reject** the next consumption — **new** |

The rejection control is needed because a rejection is a distinct path
with a distinct outcome, and a training artefact that cannot produce it
cannot demonstrate it.

---

## The Idempotency Key

### Its derivation

```text
IDK-<hash of the weighing record's identity>
```

The weighing record's identity is `batchId + componentId + operatorId +
weighedAt`. **Not** the component alone.

The story's edge case is explicit: *"The operator confirms the same
component twice | The second confirmation is a distinct weighing record
with a distinct key; the key is derived from the weighing record's
identity, not from the component."*

Deriving from the component alone would make the second confirmation a
duplicate of the first, and the second weighing would never be posted.
That is a **lost consumption** — the opposite failure from a double-post,
and just as wrong.

### Its shape

`IDK-` followed by 16 hex characters — a truncated SHA-256 of the
identity string.

**Why truncated to 16 hex characters (64 bits).** A collision would mean
two different weighings share a key, and the second would be refused as a
duplicate — a lost consumption. 64 bits gives a birthday bound of about
**4 billion** postings for a 50% chance of one collision; a dyehouse
doing a few thousand postings a year is nowhere near it. A full 256-bit
key would be longer to store, carry and log for no operational gain.

**Why the hash at all, rather than the identity in plain text.** The
identity contains an operator id and a timestamp. Putting it in a key
that is **carried on the request** and **written to the MES** and **logged**
means the operator's id and the weighing time would be spread across
every system the posting touches. The hash is one-way, so the key leaks
nothing — and the posting itself still carries the operator id and the
weighed-at, which is where they belong.

**The key is not a secret.** It is carried on the request so the MES can
dedupe. But it is **not guessable** either — a guessable key would let a
third party replay a posting and double-count a consumption. The hash
gives that property for free.

### Why it is a value object and not a string

`IdempotencyKey` validates on construction: non-empty, bounded (64
characters), and matching the `IDK-` shape. A malformed key cannot be
constructed, so it cannot be persisted, sent or logged.

### The derivation is a **domain service**, not a helper

`IdempotencyKeyFactory.derive(weighingRecord)` — because the derivation
encodes a **business rule** (the key is the weighing's identity, not the
component's), and a business rule belongs in the domain where it can be
tested without a database.

---

## Data Persistence

| Table | Columns | Relationships |
|---|---|---|
| `consumption_postings` | `id` PK, `batch_id`, `component_id`, `actual_quantity`, `unit`, `lot_number`, `operator_id`, `weighed_at`, `created_at`, `state`, `rejection_code`, `rejection_detail` | Referenced by the other three |
| `idempotency_ledger` | `idempotency_key` PK, `posting_id`, `recorded_at` | `posting_id` → `consumption_postings.id` |
| `posting_attempts` | `id` PK, `posting_id`, `attempted_at`, `outcome`, `reason_code`, `reason_detail` | `posting_id` → `consumption_postings.id` |
| `batch_status_writes` | `id` PK, `batch_id`, `status`, `written_at`, `state` | — |

### Every quantity is TEXT

`actual_quantity` is TEXT. SQLite's `REAL` is an IEEE-754 double, which
is exactly what NFR-16 forbids. The tech stack's database section already
records this for `capacity` and `resolution`; this table follows the
same rule.

### Every value is BOUND

Every value is a bound parameter. **No SQL is built by string
concatenation anywhere.** The repository's only dynamic SQL is a
`WHERE state = 'QUEUED'` predicate, which is a **literal in the source**,
not a value from a caller.

### The migration ids

```
011-create-consumption-postings
012-create-idempotency-ledger
013-create-posting-attempts
014-create-batch-status-writes
015-index-postings-by-batch
016-index-attempts-by-posting
```

They continue the identity unit's `008`/`009`/`010` and bolt 004's
`008`/`009`/`010` numbering — the ids are **unique strings**, so the
overlap in numbering is harmless, but continuing the sequence reads
better. `verify-frontmatter` does not check migration ids, and the
`schema_migrations` table is keyed by id, so uniqueness is what matters.

### The repository methods, and what is ABSENT

| Repository | Methods | **Absent on purpose** |
|---|---|---|
| `IdempotencyLedger` | `has(key)`, `record(key, postingId, at)`, `find(key)` | **no `delete`** — a key is consumed forever (DR-01, ≥ 5 years) |
| `PostingRepository` | `save(posting)`, `findById`, `findByBatch`, `findByKey`, `markAccepted`, `markRejected` | **no general `update`** — only the two state transitions |
| `PostingAttemptRepository` | `append(attempt)`, `findByPosting` | **no `update`, no `delete`** — append-only |
| `BatchStatusWriteRepository` | `save(write)`, `markAccepted`, `markRejected`, `findByBatch` | **no general `update`** |

The absent methods are the enforcement. A repository with no `update`
cannot be used to mutate a posting's content.

---

## Security Design

| Concern | Approach |
|---|---|
| **Authentication** | An **operator session**, exactly as bolt 005's ADR-020. Both write endpoints require one. |
| **Authorization** | **No supervisor authorisation.** Posting a consumption authorises nothing — it records a fact that already happened. Requiring a supervisor would mean a supervisor must be present for every weighing, which is absurd for an operation performed dozens of times a shift. |
| **The operator id is not client-supplied** | Taken from the **session**, never the body. A body-supplied operator id would let a caller post consumption as somebody else. **The schema does not have the field**, so a client cannot send it. |
| **SQL injection** | Every value is a bound parameter. No string concatenation. |
| **Idempotency key guessability** | The key is a truncated SHA-256 of the weighing's identity — not guessable, so a third party cannot replay a posting. |
| **Information disclosure** | The MES's rejection **detail** is logged, and the **code** is returned. The detail is the MES's own text and may name internal MES state, so it does not go to the client — **except** for a rejection, where the operator needs it to act, and where the alternative is an unactionable error. **The detail is length-bounded** before it is stored or returned. |
| **Error detail** | `detail` is bounded to 500 characters on the way in and on the way out. A MES that returns a megabyte of text cannot fill the log or the response. |
| **Replay** | The key is one-way and the ledger refuses a second use. |

### The operator-id-from-session rule, and why it is in the schema

It is worth stating as a design decision rather than a detail. If the
operator id were a body field:

1. Any authenticated operator could post a consumption naming any other
   operator.
2. The MES's consumption record would name the wrong person — a
   **traceability** failure (FR-18, IR-10), and the BRD requires the
   operator to be traceable on every consumption.
3. The audit trail and the MES would disagree.

So the field does not exist. A client that sends it is ignored by Zod's
default `strip` behaviour — and the value that lands is the session's.

---

## NFR Implementation

| Requirement | Design Approach |
|-------------|-----------------|
| **NFR-16** — no floating point for quantities | `WeightValue` with a string-only constructor; `actual_quantity` is TEXT; the API takes and returns strings; Zod's schema rejects a JSON number for a quantity field. |
| **NFR-03** — weighing continues during an outage | A posting during an outage is **queued** and reported as **pending**. The weighing is not lost; the posting is not discarded. |
| **NFR-05** — a confirmed weighing survives power loss | The posting and the ledger are persisted. A restart finds the posting `QUEUED` and the key in the queue; the retry reuses the key. |
| **DR-01** — ≥ 5-year retention | The ledger has no delete. The postings and the attempts are append-only. Retention is the absence of a purge path, not a scheduled job. |
| **DR-02** — records are immutable | The posting's content is immutable; the state transitions are the only mutation and they are guarded by `WHERE state = 'QUEUED'`. The attempts are append-only. |
| **IR-09** — failures diagnosable without MES access | Every attempt appends its outcome, its reason code and its detail. The detail is **bounded** but **present**. |
| **IR-08** — posting is idempotent | The key is derived from the weighing's identity, carried on every attempt, and recorded in the ledger. The ledger's primary key makes the refusal atomic under concurrency. |
| **IR-06** — the status advances to `WEIGHED` | `BatchStatusWriteService.advanceToWeighed` checks that every posting for the batch is resolved, then writes through the adapter's single-field method. |
| **C-01** — no other OrgaTEX batch field is altered | `writeBatchStatus(batchId, status)` — a signature with no parameter through which another field could be changed. |
| **NFR-14** — configuration, not code | The **rejection disposition** (CQ-06) is a configuration value: `REJECTED` postings are either retryable or permanent, and answering CQ-06 is a config change. |
| **Performance** | The dedup check is a **primary-key lookup**. The batch's postings are an indexed query. No N+1 in the posting path. |
| **Reliability** | Every write is a **transaction**: the posting, the ledger entry and the attempt are written together, so a crash cannot leave a ledger entry without its posting. |

### The transaction boundary — and why it matters

The posting, the attempt and (on acceptance) the ledger entry are three
writes that must not disagree:

- A ledger entry without its posting → a retry is refused as a duplicate
  and the consumption is **never sent**.
- A posting without its attempt → the attempt history has a hole, and
  IR-09's diagnosis is weaker.
- An attempt without its posting → a dangling reference.

So all three go in **one transaction**. SQLite's `node:sqlite` driver
gives this directly, and the repository methods accept a transaction
handle rather than opening their own.

---

## Error Handling

| Error type | Code | Response |
|---|---|---|
| No session | `UNAUTHENTICATED` | `401 { error }` |
| Malformed body | `VALIDATION_ERROR` | `400 { error, fields }` |
| Unknown batch | `BATCH_NOT_FOUND` | `404 { error }` |
| A quantity sent as a JSON number | `VALIDATION_ERROR` | `400 { error, fields }` |
| The MES refused the posting | `CONSUMPTION_REJECTED` | `422 { error, reason, detail }` |
| The MES refused the status write | `BATCH_STATUS_REJECTED` | `422 { error, reason, detail }` |
| The batch's postings are not all resolved | `POSTINGS_UNRESOLVED` | `409 { error, unresolved }` |
| The MES is unreachable | `ORGATEX_UNAVAILABLE` | `503 { error }` — **or** `201` with `state: 'QUEUED'` |
| The MES is unreachable and the posting cannot be queued | `ORGATEX_UNAVAILABLE` | `503 { error }` |
| A duplicate key | — | `200 { postingId, state, duplicate: true }` — **not** an error |

### The duplicate is a 200, not a 409

A duplicate posting is a **successful outcome of an idempotent request**,
not a conflict. The caller asked "post this consumption"; the answer is
"it is posted, and it was already posted — here is the same posting".

The alternative — a 409 — would make an honest retry look like a failure,
and a client that retries on a 409 would retry forever.

This is the same reasoning as ADR-018: *"no device can weigh this" is a
successful outcome, not an error*. A business answer is not a failure.

### The unreachable MES is a 201, not a 503

**When the posting can be queued**, it is queued and the response is
`201 { state: 'QUEUED', pending: true }`. The station keeps weighing
(NFR-03) and the consumption is not lost.

**When the posting cannot be queued** — the database is unavailable, say —
the response is `503`. The consumption is genuinely not recorded, and the
caller must know.

The distinction is what stops "queued" and "lost" from being reported the
same way, which is the system context's governing rule: *no failure at any
boundary may produce a silently wrong number*.

### The `detail` field is bounded

500 characters, on the way in and on the way out. A MES that returns a
megabyte of diagnostic text cannot fill the log, the row or the response.

---

## External Dependencies

| Service | Purpose | Integration |
|---------|---------|-------------|
| **OrgaTEX MES** | Accept the consumption posting; accept the batch status write | **The adapter seam.** The write methods are added to the existing `OrgatexAdapter` port. The far side's shape is **assumed, not confirmed** (A-01, A-02, Q-01, Q-02). |
| **The weighing record** | The source of the posting's identity | Unit 003's weighing record, passed **in**. This bolt does not read unit 003's tables — it is given the record's identity, so the dependency is a **parameter**, not a query. |

### Why the weighing record is a parameter, not a dependency

This bolt needs the weighing's identity to derive the key. It does not
need the weighing's *content* — the consumption is what the caller posts.

Reading unit 003's table would make this unit depend on that unit's
**schema**, and a change to a column would break this unit. Passing the
identity in keeps the dependency at the **interface** level, which is
where it belongs.

### The MES's idempotency support is unknown

Q-02 asks whether OrgaTEX accepts external consumption postings at all.
The answer shapes the adapter's write method — and it is **unknown**.

So the design assumes the **worst case**: the MES does **not** dedupe.
The local ledger is what makes the product safe. If the MES *does* dedupe,
the key is carried on the request and the MES's own dedupe is a second
line of defence.

**No claim is made that OrgaTEX understands the key.** The key is local
(Q-02).

---

## The Configured Disposition — CQ-06

CQ-06 asks: *is a rejected posting permanent or retryable?*

The design answers it with a **configuration value**:

```text
WEIGHINGMS_ORGATEX_REJECTION_DISPOSITION = RETRYABLE | PERMANENT
```

**The default is `RETRYABLE`**, and the reason is worth stating. A
rejection the station treats as permanent is a **consumption that is never
sent** — a lost consumption on a real order. A rejection the station
treats as retryable is a posting that stays visible and keeps failing
loudly. The first is a **silent wrong number**; the second is a **visible
problem**. Between the two, the loud one is the safer failure.

**But the disposition does not change the posting's state.** A rejected
posting is `REJECTED` either way. The disposition decides whether bolt
007's retry machinery re-drives it — and **that** is bolt 007's concern.
This bolt records the rejection faithfully and exposes the disposition.

### The default is a DEFAULT, not an answer

CQ-06 is **unanswered**. The default is the safer of the two behaviours,
not a resolution of the question. It is stated as a configuration value
so that answering CQ-06 is a config change and not a code change — which
is the story's own instruction.

---

## The Write Flow

```text
POST /api/orgatex/batches/:batchId/consumption
        │
        ▼
  validate the body (Zod — a quantity must be a string)
        │
        ▼
  derive the key from the weighing's identity
        │
        ▼
  ┌─────────────────────────────────────────────┐
  │ the ledger already has the key?              │
  │   → 200 { state: ACCEPTED, duplicate: true } │  ← the send-path guard
  └─────────────────────────────────────────────┘
        │ no
        ▼
  ┌─────────────────────────────────────────────┐
  │ is a posting with this key already QUEUED?   │
  │   → 200 { state: QUEUED, duplicate: true }   │  ← the enqueue-path guard
  └─────────────────────────────────────────────┘
        │ no
        ▼
  create the posting (QUEUED) + persist
        │
        ▼
  ┌─────────────────────────────────────────────┐
  │ is the MES reachable?                        │
  │   no → the posting stays QUEUED             │
  │        → 201 { state: QUEUED, pending: true }│
  └─────────────────────────────────────────────┘
        │ yes
        ▼
  post through the adapter, with the key
        │
        ├── ACCEPTED → the ledger records the key
        │              → 201 { state: ACCEPTED }
        │
        ├── REJECTED → the reason is recorded
        │              → 422 { error, reason, detail }
        │
        └── UNKNOWN / UNREACHABLE → the attempt records the outcome
                                   → the posting stays QUEUED
                                   → 201 { state: QUEUED, pending: true }
```

**The attempt is recorded on EVERY path**, including the accepted one. The
attempt history is the diagnostic record, and it is only complete if it
records the successes too.

**The ledger entry and the attempt are written in the same transaction** as
the state transition — so a crash cannot leave a ledger entry without its
posting, or an accepted posting without its attempt.

---

## What This Bolt Deliberately Does Not Build

| Not built | Why | Owner |
|---|---|---|
| The offline sync queue | Story 005. This bolt persists a posting and can enqueue it; the queue's *mechanics* — backoff, flush, ordering — are bolt 007's. | bolt 007 |
| The link state machine | Story 004. This bolt emits contact events; the machine that turns them into `LINKED`/`DEGRADED`/`OFFLINE` is bolt 007's. | bolt 007 |
| The retry loop | Story 005. This bolt makes a posting and records what happened. It does not retry. | bolt 007 |
| The weighing record | Unit 003 owns it. This bolt is given the identity. | unit 003 |
| The ticket | Unit 006. | unit 006 |
| The MES's batch mirror | The MES owns the batch. | — |

**One exception, and it is a small one.** The `BatchStatusWriteService`
checks that the batch's postings are all resolved before writing
`WEIGHED` — so it needs to *read* the postings. That is a read of **this
unit's own table**, not of the MES's, and it is a precondition on a
write, not a shared aggregate (the domain model's reasoning, carried
through).

---

## Deviations from the Standards — and why

| Deviation | Reason |
|---|---|
| The write endpoints live under `/api/orgatex`, not under the Dummy MES's `/api/batches` | The Dummy MES's paths are the **MES's** surface. The product's own endpoints are the ones other units call, and they live under the product's namespace. Bolt 005 established this split. |
| The Dummy MES's write endpoints are added **without** a session | The MES is the external system. The product's adapter reaches it without a WeighingMS session. |
| The idempotency key's format is **ours**, not the MES's | The BRD requires the *mechanism* (IR-08) and does not specify the shape. Q-02 means no shape can be confirmed. |
| The postings are persisted in the **shared** database file | The tech stack names one SQLite file for the product, and bolt 004 already extends it. A second file would split the transactional boundary across two databases. |

---

## The Known Gaps This Design Carries Forward

1. **The transport is still untested.** ADR-022's gap is inherited
   unchanged — the adapter stays in-process, so no test in this bolt sends
   a request over a socket. The write path inherits it.
2. **The MES's real write contract is unknown** (A-02, Q-02). The
   adapter's write methods are the seam; what is behind them is not
   asserted as fact.
3. **CQ-06 is unanswered.** The disposition is a configuration value with
   a stated default, not a resolution.
4. **The posting's quantity is converted before it is posted** — the
   conversion from the recipe's unit to the posted unit is the caller's
   job, and this bolt records the unit it was given. A mismatch between
   the recorded unit and the intended unit is a caller error, and the
   unit mismatch is caught by `WeightValue`.
