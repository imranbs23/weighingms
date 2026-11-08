---
unit: 001-batch-management
bolt: 009-001-batch-management
stage: design
status: complete
updated: 2026-11-05T14:45:00Z
---

# Technical Design - Batch Management (Bolt 009: Filtering and Selection)

## Architecture Pattern

**Hexagonal (Ports and Adapters) — unchanged from bolt 008, and unchanged from
units 004, 005 and 008.**

This bolt introduces **no new architectural style**. It adds a **pure filter**,
a **write use case**, a **port for the scanner**, and a **repository** — each
in the layer that already owns its kind of thing.

### What is added, and where

| Capability | Layer | New artefact |
|---|---|---|
| The filter, and the statuses it offers | Domain | `services/batch-queue-filter.ts` — **pure** |
| The selection and its refusal | Domain | `entities/batch-selection.ts`, `value-objects/selection-method.ts`, `value-objects/selection-refusal.ts` |
| The scanner's seam | Domain (port) | `ports/batch-scanner.ts` |
| The durable record | Domain (port) | `ports/batch-selection-repository.ts` |
| The filter's use case | Application | `use-cases/filter-batch-queue.ts` |
| The selection's use cases | Application | `use-cases/select-batch.ts` |
| The endpoints | Presentation | `controllers/batch-selection-controller.ts`, `schemas/batch-selection-schemas.ts` |
| The durable record's implementation | Infrastructure | `persistence/batch-selection-database.ts`, `persistence/sqlite-batch-selection-repository.ts` |
| The scanner's dummy | Infrastructure | `adapters/dummy-batch-scanner.ts` |
| The wiring | Infrastructure | `composition-root.ts` — grown |

### The one dependency that crosses a unit boundary

Unchanged from bolt 008, and **no new one is added**. Unit 001 still imports
only **types** from unit 005 — `BatchQueueSnapshot`, `BatchQueueReadOutcome`,
`BatchEligibility`, `BatchWeighingStatus` — and never unit 005's reader
**class**. The port is bound in the composition root and nowhere else
(ADR-028).

The identity unit is touched in exactly one place: the controller reads
`req.currentOperator`, which the identity unit's middleware has already
resolved. That is a **read of the request**, not an import of the identity
unit's code — and it is the same shape the OrgaTEX write path already uses
(ADR-005's clear-text reason, ADR-003's live session).

---

## Layer Structure

```text
┌──────────────────────────────────────────────────────────┐
│  Presentation                                           │
│    batch-queue-controller.ts  — GET /api/batch-queue      │
│    batch-selection-controller.ts — POST /api/selection   │
│    schemas/batch-selection-schemas.ts — Zod boundary     │
├──────────────────────────────────────────────────────────┤
│  Application                                            │
│    use-cases/retrieve-batch-queue.ts   (bolt 008)         │
│    use-cases/filter-batch-queue.ts                       │
│    use-cases/select-batch.ts                             │
├──────────────────────────────────────────────────────────┤
│  Domain                                                 │
│    services/batch-queue-projector.ts — PURE (bolt 008)   │
│    services/batch-queue-filter.ts    — PURE              │
│    entities/station-batch-queue.ts   (bolt 008)          │
│    entities/batch-selection.ts                           │
│    value-objects/selection-method.ts                     │
│    value-objects/selection-refusal.ts                    │
│    ports/batch-queue-source.ts   (bolt 008, grown)        │
│    ports/batch-scanner.ts                                 │
│    ports/batch-selection-repository.ts                   │
├──────────────────────────────────────────────────────────┤
│  Infrastructure                                         │
│    composition-root.ts — binds the ports                 │
│    adapters/dummy-batch-scanner.ts                       │
│    persistence/sqlite-batch-selection-repository.ts       │
└──────────────────────────────────────────────────────────┘
```

**The domain layer has no Express, no SQLite, no timers and no environment.**
The filter is a pure function; the selection use case awaits **ports** and a
clock.

---

## API Design

### The three endpoints this bolt owns

| Endpoint | Method | Request | Response |
|---|---|---|---|
| `/api/batch-queue` | `GET` | `?status=<WEIGHING_STATUS>` (optional) | `200` `{ batches[], receivedAt, source, freshness, filter, statuses[] }` · `400` · `401` · `503` |
| `/api/selection` | `GET` | none | `200` `{ selection }` or `200` `{ selection: null }` · `401` |
| `/api/selection` | `POST` | `{ batchId?, code? }` | `201` `{ selection }` · `400` · `401` · `409` |

### Why the filter is a **query parameter** and not a second endpoint

The filter is a **view over the same queue**. Two endpoints would mean two
reads of the same seam and two paths that could disagree about the receipt
time — and the story requires that *"the filtered view must not be mistaken
for a separate queue: `receivedAt` remains visible and unchanged while a
filter is applied"*.

One endpoint, one optional parameter. The parameter is **absent** for "All",
and it is **never** the empty string, never `"*"` and never `"ALL"`. Those
would be three spellings of "no filter", and a client that sent one of them
would get a `400` — which is the right answer, because a status the MES does
not have is not a status.

### The query parameter's validation

An unknown status is a **`400`**, not an ignored parameter.

The alternative — ignoring an unrecognised status and returning the whole
queue — is the failure mode the story names explicitly: *"The adapter
rejects a status value it does not recognise → the adapter layer rejects the
payload and the UI shows the error state; no status is silently mapped to
'All'."* A filter that was quietly ignored would show the operator the wrong
rows and tell them nothing.

The validation is against the **MES's closed status set**, which unit 005
owns and re-exports (`isBatchWeighingStatus`). This unit therefore does not
enumerate the statuses — it asks the seam's own guard.

**But the *offered* statuses are the queue's, not the vocabulary's.** The
guard answers *"is this a status?"*; the filter's options answer *"which
statuses are in front of the operator?"*. Two different questions, two
different answers, and the difference is stated in the design because it is
the kind of thing a later implementer gets wrong.

### `GET /api/batch-queue` — 200

```json
{
  "batches": [
    {
      "batchId": "B-24187",
      "orderRef": "SO-9931",
      "machineRef": "JET-04",
      "fabricDescription": "100% CTN knit · 480 kg",
      "shadeCode": "Teal 4C",
      "componentCount": 5,
      "weighingStatus": "WEIGHING"
    }
  ],
  "receivedAt": "2026-11-05T08:12:00.000Z",
  "source": "DUMMY_ORGATEX",
  "freshness": { "kind": "CURRENT" },
  "filter": { "status": "WEIGHING" },
  "statuses": ["QUEUED", "WEIGHING"]
}
```

| Field | Type | Where it comes from | Why |
|---|---|---|---|
| `batches` | array | the projection | The seven FR-1 columns, unchanged from bolt 008. |
| `receivedAt` | ISO-8601 | unit 005's snapshot | **Unchanged by the filter.** The queue's receipt time is the queue's, not the view's. |
| `source` | string | unit 005's snapshot | Unchanged. |
| `freshness` | object | unit 005's decision | Unchanged. |
| `filter` | object \| null | the request | `null` means **no filter**. The object is `{ status }` so it can grow without changing the shape's meaning. |
| `statuses` | string[] | **the queue's contents** | The statuses **present in the queue as it is displayed**. This is the filter's option set, and it is **data, not code** (the story's rule). |

### Why `statuses` is the **displayed** queue's statuses, not the MES's vocabulary

The story is explicit: *"the available status values are the set of
weighing-status values returned by the adapter for the current queue, and no
status is hard-coded in the client"*.

So `statuses` is derived from the **rows in the response**. If the filter is
`WEIGHING`, the response contains only `WEIGHING` rows, and `statuses` would
be `["WEIGHING"]` — which would then be a useless filter control, because the
operator could not switch to another status.

That is a real problem, and it has a real answer: **`statuses` is derived
from the queue BEFORE the filter is applied.** The operator's filter control
must offer every status that exists in the queue, including the one they are
currently filtering by — otherwise the control is a one-way door.

So:

- `statuses` = the distinct statuses in the **unfiltered** queue.
- `batches` = the rows **after** the filter is applied.

And the response carries **both**, so the UI never has to remember the
unfiltered set from a previous response.

### Why the filter is applied **here**, and not in the seam

The design originally grew the port with a `filter` parameter and pushed
the filter into unit 005's reader. **The implementation reversed that**, and
the reason is worth recording, because the reversal looks like a step
backwards.

Two reasons, and the second one is a **correctness bug**:

1. **The option set.** The statuses the operator may filter to must come
   from the **whole** queue. A read that arrives already filtered can
   satisfy "the rows are narrowed" and not "the control still offers every
   status" — applying a filter would collapse the option set to the one
   status being filtered by, and the control would become a one-way door.

2. **The cache.** Unit 005's reader caches the snapshot it built, and that
   snapshot is the one it was asked for. A filtered read would put a
   **filtered** queue into that cache — and the reader's DEGRADED fallback
   would later serve that partial queue as though it were the whole
   released schedule. The operator would see three `QUEUED` batches and
   believe that was all the work on offer.

So the port has **no filter parameter**, the whole queue is read, and the
filter is applied to this unit's own rows. The port's shape is the
enforcement: a port that offered `read(filter?)` would invite the next
implementer to reintroduce the defect.

Unit 005's own filtering (BRD IR-01) is untouched — the reader still
accepts a filter, passes it to the adapter and re-applies it. This unit
simply does not use that capability, because it needs the whole queue.

### Why the filter is applied **once** here

| Where | What it guarantees |
|---|---|
| The adapter / the MES | The MES is asked for a filtered queue, so the MES may do the work — when the *seam* is asked with a filter, which this unit does not do. |
| Unit 005's reader | The seam does not trust the MES to have honoured it — *"a filter the MES ignored must not silently widen the answer"*. |
| **This bolt** | The **station's** rows are the filtered ones, whatever the seam did. The projection is this unit's model, and the model is filtered here. |

The third application is the one that matters for correctness of the
**product's own view**: unit 001 publishes rows, and the rows it publishes
must be the filtered ones. Relying on the reader alone would make this
unit's correctness depend on a fact about somebody else's implementation.

### `GET /api/selection` — 200

```json
{ "selection": { "batchId": "B-24187", "orderRef": "SO-9931", "machineRef": "JET-04", "operatorId": "OP-001", "selectedAt": "2026-11-05T08:14:22.000Z", "selectionMethod": "SCAN" } }
```

An empty selection is a **`200` with `selection: null`** — never a `404`.
"Nobody has chosen a batch yet" is a **state**, and the operator's first
render is that state. A `404` would make the UI's first render an error
path, which is exactly the shape this product avoids elsewhere (an empty
queue is a `200`, not a failure).

### `POST /api/selection` — 201

The body carries **either** a `batchId` (touch) **or** a `code` (scan).

```json
{ "batchId": "B-24187" }        → touch
{ "code": "B-24187" }           → scan
```

Exactly one of the two must be present. The schema enforces it, and the
**method is derived from which field is present** — the client does not send
`selectionMethod`, because a client that could choose the method could
record a scan that never happened.

**Why the method is derived, not supplied.** The method is a **traceability
fact about what the operator did**. If the client chose it, the record would
be a claim, not a fact — and the claim would be exactly as reliable as the
client. Deriving it from the input shape makes it true by construction: a
`code` came from the scanner, a `batchId` came from a touch.

### The refusals — `409`, with a **code**

| Situation | Status | Body |
|---|---|---|
| The batch is known but not eligible | `409` | `{ "error": "SELECTION_REFUSED", "reason": "<CODE>" }` |
| The scanned code names nothing | `409` | `{ "error": "SELECTION_REFUSED", "reason": "UNRECOGNISED_CODE" }` |
| The scanner could not be read | `503` | `{ "error": "SCANNER_UNAVAILABLE" }` |
| Neither `batchId` nor `code` | `400` | `{ "error": "VALIDATION_ERROR", "fields": [...] }` |
| Both `batchId` and `code` | `400` | `{ "error": "VALIDATION_ERROR", "fields": [...] }` |
| No session | `401` | `{ "error": "UNAUTHENTICATED" }` |

**Why `409` and not `403` for an ineligible batch.** A `403` means *"you are
not allowed to do this"*. The operator **is** allowed to select batches — the
problem is that **this** batch is not in a state where it can be worked, and
that is a **conflict with the batch's current state**, not a permission
problem. `409 Conflict` is the status whose whole meaning is *"your request
is well-formed, and it conflicts with the current state of the thing"*.

A `403` would also be actively misleading in the operator's eyes: it reads
as "you are not authorised", and the operator's correct response to that is
to ask a supervisor for permission — when the actual cause is that the batch
is not released yet.

**Why the reason is a code and not prose.** NFR-11 and FR-22: the API emits
**codes**, and the UI owns the text. The same rule the whole product
follows (ADR-004's uniform refusal body, unit 005's reason codes).

**Why the reason codes are the ones unit 005 already derives.** The
eligibility derivation is unit 005's, and this unit **enforces** it
(ADR-028). The codes are:

- `NOT_RELEASED`
- `BEING_WEIGHED_ELSEWHERE`
- `ALREADY_WEIGHED`
- `CANCELLED`

Plus the two this bolt owns:

- `UNRECOGNISED_CODE` — the scan named nothing the MES knows.
- `UNKNOWN_BATCH` — a touch named a batch that is not in the queue.

### Why an ineligible selection is **`409` and not a silent no-op**

The story says the refusal must be **visible**: *"the reason it cannot be
worked is shown to the operator — the reason names the actual cause ... and
never a generic 'not available' message"*.

A `201` with an empty body, or a `200` with `selected: false`, would both
make the refusal indistinguishable from a success at the HTTP layer. The
operator would see the screen not change and would have no idea why. The
`409` carries the reason; the UI renders it.

### Why the **operator** is never taken from the body

Exactly as ADR-005 and the OrgaTEX write path established: the operator comes
from the **session**, and the schema has **no field for it**. A request that
names an operator is stripped by Zod, not honoured.

The selection is a **traceability record**, so the operator on it must be the
operator who is actually signed in. A client that could name any operator
would let one operator's selection be credited to another — the same
privilege-escalation shape the OrgaTEX write path refuses.

---

## The Domain Model in Code

### The filter — pure

```ts
filter(queue: StationBatchQueue, filter: QueueFilter | null): FilteredQueue
statusesIn(queue: StationBatchQueue): BatchWeighingStatus[]
```

Both are **pure functions** of the queue. Neither holds a clock, an adapter
or a cache.

`statusesIn` returns the **distinct** statuses in the queue, in the **MES's
order** — not alphabetically and not in the order of first appearance. The
MES's order is the order the statuses appear in the queue's rows, and that is
the order the operator already sees. Sorting them would be the domain
inventing an order the MES did not give.

`filter` returns a **new** `StationBatchQueue` with the filtered rows and
**the same `receivedAt`, `source` and `freshness`** — because the filtered
view is a view of the *same* queue, and its age is the queue's age.

### The selection use case

```ts
SelectBatch.executeByTouch(batchId, operatorId): Promise<SelectionOutcome>
SelectBatch.executeByScan(code, operatorId): Promise<SelectionOutcome>
```

The touch path:

1. Read the queue **without a filter** (the filter is a view; it is never a
   gate).
2. Find the batch by id. Not found → `UNKNOWN_BATCH`.
3. Read the **eligibility from the snapshot**, not from the projection
   (ADR-028 — the projection deliberately does not carry it).
4. Ineligible → refuse with the reason. **Nothing is written.**
5. Eligible → build the `BatchSelection` and **save** it.
6. Return `SELECTED`.

The scan path:

1. Ask the **scanner** for a code. No code → `SCANNER_UNAVAILABLE`.
2. Read the queue **without a filter**.
3. Find the batch by the code. Not found → `UNRECOGNISED_CODE`.
4. Same eligibility gate, same write.

**Why the queue is read without a filter on both paths.** The story's edge
case is explicit: *"A scan resolves to a batch in `RELEASED` status that is
not in the currently displayed (filtered) queue → the selection succeeds,
because eligibility is governed by status, not by the current filter; the
queue filter is a view concern only."*

### The scanner's port

```ts
export interface BatchScanner {
  read(): Promise<ScanOutcome>;
}
```

```ts
export type ScanOutcome =
  | { readonly kind: 'CODE_READ'; readonly code: string }
  | { readonly kind: 'NO_CODE'; readonly message: string };
```

**Two outcomes, not three.** The scanner either produced a code or it did
not. A "the code was unreadable" case is the same as "no code" from the
operator's point of view: they may fall back to touching the row (B-6).

The port is **not** "the scanner's HTTP client". The Dummy Scanner's
`POST /api/scan` is a **training contract** behind this boundary, and this
unit asserts nothing about its shape (A-10, Q-03).

### The selection's repository

```ts
export interface BatchSelectionRepository {
  save(selection: BatchSelection): Promise<void>;
  latest(): Promise<BatchSelection | null>;
}
```

**Two methods. No update, no delete.** The active selection is the **newest
row**, and the history is every row.

---

## Data Persistence

**One table. It is this bolt's first durable artefact in unit 001.**

| Table | Columns | Relationships |
|---|---|---|
| `batch_selections` | `id` (PK), `batch_id`, `order_ref`, `machine_ref`, `operator_id`, `selected_at`, `selection_method`, `recorded_at` | none |

| Column | Type | Why |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | A storage identifier, not business identity. |
| `batch_id` | `TEXT NOT NULL` | The batch chosen. |
| `order_ref` | `TEXT NOT NULL` | The crumb's identity **as the operator saw it**. |
| `machine_ref` | `TEXT NOT NULL` | Ditto. |
| `operator_id` | `TEXT NOT NULL` | Who chose it. From the session, never the body. |
| `selected_at` | `TEXT NOT NULL` | **When the act happened** — ISO-8601 TEXT, matching every other table. |
| `selection_method` | `TEXT NOT NULL CHECK (selection_method IN ('SCAN','TOUCH'))` | **The constraint IS the traceability rule.** A third method cannot be written, so the closed set is enforced by the database and not by a convention. |
| `recorded_at` | `TEXT NOT NULL` | When the row was written. Distinct from `selected_at`: the act and the recording are different moments, and a station that was down for a minute would otherwise have to lie about one of them. |

### Why the order and machine are **copied** into the row

The crumb shows *"batch, order, machine"* (BRD FR-34). If the selection
carried only the batch id, the crumb would be re-derived from a queue read at
render time — and the queue might have changed, been filtered away, or be
unreachable. The operator would then see a crumb that disagrees with the
selection they made.

So three identifiers are copied. Nothing else is: the recipe, the status and
the counts are other units' facts and change under other rules.

### Why the table is **append-only**, and how that is enforced

There is no `update` method and no `delete` method in the repository, so
there is nothing that *could* rewrite a selection (BRD DR-02).

And the history is enforced **in the database**, the same way unit 005's
`link_transitions` does it: a `BEFORE UPDATE` trigger and a `BEFORE DELETE`
trigger that `RAISE(ABORT, ...)`. A repository without an update method is a
convention; a trigger that aborts is a guarantee.

### Why there is **no** "active selection" column and **no** `superseded_at`

Both would be a mutation of a historical record, and both were rejected in
the domain model for the same reason ADR-006 rejected a `consumed_at` flag:
the "when it stopped being current" fact would be written by a later process,
for reasons that have nothing to do with the original act.

*"The active selection"* is `ORDER BY selected_at DESC, id DESC LIMIT 1`.

### Why the ordering is **total**

`selected_at` alone is not a total order — two selections in the same
millisecond would have no defined order, and "the latest" would be
ambiguous. The `id` is the tie-breaker, exactly as unit 005's sync queue
does it (`queued_at ASC, posting_id`). A total order is stable across
processes and across a restart.

### The migration

Applied through the **same** `schema_migrations` table the identity, scale
and OrgaTEX units use, so all four units can share one database file without
any of them re-applying the others' tables. The id follows the established
sequence: **`021-create-batch-selections`**.

---

## Security Design

| Concern | Approach |
|---|---|
| **Authentication** | Both endpoints require a **live operator session** — `401` without one (ADR-020). The selection is a write to a business record, and the queue is OrgaTEX's production schedule. |
| **Authorisation** | **Reading** the selection needs an operator session and **no supervisor** — reading authorises nothing. **Writing** a selection needs an operator session and **no supervisor** either: selecting a batch is the operator's ordinary work, not a privileged action (FR-35's list does not include it). |
| **Operator attribution** | The operator comes from the **session**. The schema has **no** `operatorId` field — Zod strips it. A client cannot credit a selection to another operator. |
| **The selection method** | **Derived from the request shape**, never supplied. A client cannot record a scan that never happened. |
| **Information disclosure** | Refusal bodies carry a **code** and nothing else. The MES's error text goes to the **log** (IR-09). The queue's `503` body is unchanged from bolt 008. |
| **Localised text** | The API emits **no prose**. The reason codes, the "no match" state and the filter's labels belong to the UI (NFR-11, FR-22). |
| **Injection — the filter** | The filter value is validated against the MES's **closed status set** before it reaches the seam, and the seam's reader **re-applies** it to already-parsed values. No client string reaches a SQL statement, a log line or a filesystem path — the status is a **compared value**, never an interpolated one. |
| **Injection — the scan code** | The scanned code is **bounded** (64 characters, like every other identifier in this product) and is compared against the queue's ids. It never reaches a query: the comparison is in memory, over a parsed snapshot. |
| **DoS / abuse** | The selection is a **write**, and it is bounded by the session: one selection per request, each a single row insert. The queue read it performs is unit 005's read, which owns the cache — so repeated selections do not multiply the load on the MES beyond what unit 005 already does. |
| **Replay** | The selection is **idempotent in effect**: selecting the same batch twice by touch leaves **one active selection**, with the latest method and timestamp recorded — the story's edge case. Both rows are in the history, which is the point. |

### The injection surface, stated plainly

The two new inputs are a **status** and a **code**.

- The status is checked against a **closed set** before use, and the reader
  compares it against already-parsed values.
- The code is **bounded**, compared in memory, and never interpolated into a
  query.

Neither reaches a database string, a log message or a path. That is the
whole surface.

---

## NFR Implementation

| Requirement | Design approach |
|---|---|
| **NFR-2 (≤ 3 s selection → recipe, AC-01)** | The selection's cost is **one in-process queue read** — no socket, no HTTP round-trip to the MES. The recipe load itself is unit 002's, and unit 001's selection is deliberately **not** the recipe's load: the recipe belongs to unit 002 and unit 003 owns the session. |
| **NFR-16 (no floating point for quantities)** | The selection carries **no quantity** — no target, no tolerance, no weight. `componentCount` is a count. The filter is a status. |
| **NFR-7 / FR-22 (externalised text)** | The API emits codes and data. The refusal reason is a code; the "no match" state is a **zero-row result with the filter echoed**, not a sentence. |
| **NFR-11 (diagnosable without OrgaTEX-side access)** | The **detail** of a failed read goes to the log, as in bolt 008. The client gets the code. |
| **NFR-14 (configuration over code)** | The selection's **retention** is not decided here and is not decided at all — the table has no expiry, and BRD DR-01's five-year retention is a policy that applies to the whole station's records. What **is** configuration is the scanner's presence: the scanner is bound through a port, so a station without one binds a port that always reports `NO_CODE`. |

---

## Testing Strategy

| Layer | What is proved | How |
|---|---|---|
| **Unit** | The filter keeps the MES's order, keeps the receipt time and the freshness, and offers the **unfiltered** queue's statuses. The selection's method is derived, its refusal carries the right code, and nothing is written on a refusal. | Pure functions and a controlled repository. |
| **Integration** | The three endpoints against the **real** Dummy MES through the **real** reader: the filter's `200`, its `400`, the selection's `201`, its `409` with the reason, its `401`, and the selection's `GET` after a `POST`. The data really comes from the Dummy. | The real harness, the real Dummy, the real adapter. |
| **Security** | The session requirement on every new endpoint, the operator's attribution coming from the session and not the body, the method not being client-supplied, and the refusal body carrying no prose. | The security suite, which is the executable record of this project's security review. |

The tests bind a **controlled scanner** when they need a specific code, and
the **real** dummy when they need the real thing. Both are honest: the first
proves the use case's interpretation, the second proves the seam.

---

## What this bolt does NOT deliver

| Not delivered | Belongs to |
|---|---|
| The recipe's contents, and the load that follows a selection | unit 002 |
| The weighing session, and the resume semantics of a selection | unit 003 |
| The scanner's device protocol | unit 002's material identification, and the device contract itself |
| Rendering the queue, the filter control, the crumb and the refusal message | unit 007 |
| The queue's read, the MES contract, the cache, the freshness window | unit 005 |
| The audit trail for privileged actions | unit 006 |
