---
unit: 001-batch-management
bolt: 008-001-batch-management
stage: design
status: complete
updated: 2026-11-04T15:45:00Z
---

# Technical Design - Batch Management (Bolt 008: The Released Batch Queue)

## Architecture Pattern

**Hexagonal (Ports and Adapters) — the same pattern units 004, 005 and 008
already use.**

This bolt introduces **no new architectural style**. Unit 001's problem is
not "how do we architect a queue"; it is "how do we stop the client from
hard-coding one". The codebase already has the shape that solves that, and
re-inventing a local style would be one more thing for a reader to learn
before they could change the thing that matters.

### What is added, and where

| Capability | Layer | New artefact |
|---|---|---|
| The station's own model of the queue | Domain | `entities/station-batch-queue.ts` — `StationBatch`, `StationBatchQueue` |
| The availability of a queue | Domain | `value-objects/queue-availability.ts` |
| The projection | Domain | `services/batch-queue-projector.ts` — **pure** |
| The seam this unit reads through | Domain (port) | `ports/batch-queue-source.ts` — `BatchQueueSource` |
| The read use case | Application | `use-cases/retrieve-batch-queue.ts` — `RetrieveBatchQueue` |
| The station's endpoint | Presentation | `controllers/batch-queue-controller.ts` |
| The wiring | Infrastructure | `composition-root.ts` — `buildBatchManagementModule` |

**No new tables. No new repositories. No new database file.** This bolt
persists nothing at all — see **Data Persistence** below for why, and for
the reasoning behind the one cross-unit dependency it does take.

### The one dependency that crosses a unit boundary

`001` imports three things from `005-orgatex-integration`:

| Imported | What it is | Why it is safe |
|---|---|---|
| `BatchQueueSnapshot` | a **type** | The shape of the thing being projected. |
| `BatchQueueReadOutcome` | a **type** | The shape of the outcome being interpreted. |
| `BatchId`, `OrderRef`, `MachineRef`, `ShadeCode` | **value objects** | Unit 005 already re-exports them; they are opaque identifiers with no behaviour that could couple back. |

Unit `001` **never imports** unit 005's `BatchQueueReader` **class** — it
imports the *port* it declares itself, and the composition root binds the
two. That is the whole point of the hexagonal shape, and it is stated here
because the alternative is tempting and wrong: importing the class would
make unit 001 depend on unit 005's *implementation*, so unit 005's next
refactor would ripple into a unit that has no reason to know about it.

The dependency is one-directional (`001 → 005`) and creates no cycle —
`verify:inception` checks that, and the bolt's `requires_units` declares it.

---

## Layer Structure

```text
┌──────────────────────────────────────────────────────────┐
│  Presentation                                           │
│    batch-queue-controller.ts  — GET /api/batch-queue    │
├──────────────────────────────────────────────────────────┤
│  Application                                            │
│    use-cases/retrieve-batch-queue.ts — the read         │
├──────────────────────────────────────────────────────────┤
│  Domain                                                 │
│    services/batch-queue-projector.ts — PURE             │
│    entities/station-batch-queue.ts                      │
│    value-objects/queue-availability.ts                  │
│    ports/batch-queue-source.ts — the seam it reads     │
├──────────────────────────────────────────────────────────┤
│  Infrastructure                                         │
│    composition-root.ts — binds the port to unit 005    │
└──────────────────────────────────────────────────────────┘
```

**The domain layer has no Express, no SQLite, no timers and no
environment.** The projector is a pure function of a snapshot; the use case
is the only thing that awaits anything, and it awaits a **port**.

---

## API Design

### The station's own endpoint

| Endpoint | Method | Request | Response |
|---|---|---|---|
| `/api/batch-queue` | `GET` | none | `200` `{ batches[], receivedAt, source, freshness }` · `401` · `503` |

### Why the path is `/api/batch-queue` and not `/api/batches`

**`/api/batches` is the Dummy MES's prefix**, and it is not free to be
reused. The Dummy OrgaTEX's router is mounted at `/api` and owns:

```
/api/batches
/api/batches/:batchId
/api/batches/:batchId/recipe
/api/batches/:batchId/consumption
/api/batches/:batchId/status
```

`/api/batches/queue` would be captured by the Dummy's `/batches/:batchId`
route with `batchId === 'queue'` — a **silent** capture, answering with a
batch-not-found instead of the station's queue. The same reason unit 005's
product endpoints live under `/api/orgatex/*` and not under `/api/batches/*`
(bolt 006's design, §"the write endpoints live under `/api/orgatex`").

`/api/batch-queue` cannot collide with anything: no router in this product
owns a route that begins with `/batch-queue`.

**It is the station's queue, not the MES's.** The MES's queue is reachable
at `/api/batches` — and that is the *external system's* surface, not the
product's. This endpoint is what unit 007's UI calls.

### `GET /api/batch-queue`

**200 — the queue.**

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
  "receivedAt": "2026-11-04T15:30:00.000Z",
  "source": "DUMMY_ORGATEX",
  "freshness": { "kind": "CURRENT" }
}
```

**503 — there is no queue.**

```json
{
  "error": "BATCH_QUEUE_UNAVAILABLE",
  "reason": "UNREACHABLE"
}
```

**401 — no operator session.**

```json
{ "error": "UNAUTHENTICATED" }
```

### The response fields, one at a time

| Field | Type | Where it comes from | Why |
|---|---|---|---|
| `batches` | array | the projection | The seven FR-1 columns, in FR-1's order. |
| `batches[].batchId` | string | the MES | |
| `batches[].orderRef` | string | the MES | |
| `batches[].machineRef` | string | the MES | |
| `batches[].fabricDescription` | string \| null | the MES, normalised | **Nullable** — see below. |
| `batches[].shadeCode` | string | the MES | |
| `batches[].componentCount` | number | the MES | A **count**, not a quantity. |
| `batches[].weighingStatus` | string | the MES | One of the five known statuses. |
| `receivedAt` | ISO-8601 string | unit 005's snapshot | **When the queue was received from the upstream.** |
| `source` | string | unit 005's snapshot | Which adapter produced it. |
| `freshness` | object | unit 005's decision | Passed through — see below. |

### Why `componentCount` is a JSON number and not a decimal string

ADR-008 requires every **quantity** on the wire to be a decimal string,
because a JSON number decodes to an IEEE-754 double. `componentCount` is
**not a quantity** — it is a **count** of recipe slots, an integer with no
fractional part and no tolerance. Unit 005's own port says so explicitly:

> *"componentCount is a number because it is a **count**, not a quantity —
> ADR-008's rule is about weights, targets and tolerances."*

The queue carries **no quantity at all**: no target, no tolerance, no
weight. That is the story's own rule — *"No quantity fields are carried in
the queue payload"* — and it is why BRD NFR-16 has nothing to say about
this endpoint's payload.

### Why `fabricDescription` is nullable and the other text fields are not

The story's edge case is explicit:

> *"A batch is missing one of the seven fields → The row renders with an
> explicit placeholder for the missing field; the row is not silently
> dropped."*

Two rules are in tension, and this is where they meet.

**Rule A — unit 005's reader fails the whole read on a malformed record.**
A record with an unknown weighing status or a non-integer component count
fails the entire read (S-24), because a queue missing one batch is a wrong
work list.

**Rule B — a row with a missing field is not dropped.**

They are reconciled by asking what "malformed" means:

| Case | Who decides | Outcome |
|---|---|---|
| An **invalid** value — an unknown status, a non-integer count | unit 005's reader | The **whole read fails** with `MALFORMED`. Rule A applies. |
| An **absent** text value — no fabric description | this bolt's projection | The **row survives**, with the field `null`. Rule B applies. |

The distinction is *wrong* versus *missing*. A status of `RELEASED_TOMORROW`
is the MES saying something this seam does not understand, and guessing at
it would be a guess about the MES's vocabulary. A fabric description that is
absent is the MES saying **nothing**, and "nothing" is a thing the operator
can be shown.

Unit 005's reader already draws exactly this line: it validates the status
and the count, and lets `fabricDescription` through unchecked. This bolt
takes the unchecked field and gives it a **shape** — `null` — so the UI can
render a placeholder.

### Why `null` and not an empty string

Because the placeholder's **text belongs to the UI** (BRD NFR-11, FR-22:
operator-facing text is externalised for translation). The API must be able
to say *"there is no description here"* without saying *what* to put there.

An empty string is ambiguous — `""` is not a legal fabric description, but
a JSON reader cannot tell it from a deliberate blank without a rule. `null`
says it in one token, and the API emits **no prose at all**.

So:

- **`null`** → the UI renders its own localised placeholder.
- **a string** → the UI renders it.

And the row is **never dropped** for a missing description.

### Why `freshness` is carried through

Unit 005 already decided whether a snapshot is current or stale — that
decision is unit 005's, made by its freshness window, and this bolt must
**not** re-decide it (the story says so: *"whether a stale queue is still
usable is a unit 005 concern and is not decided here"*).

So the question is only whether the UI can see the decision. And it must,
because:

1. **A degraded read is still a 200.** The MES is unreachable and unit 005
   served its last known-good; the operator is shown a queue. If the UI
   cannot tell that queue is 40 minutes old, it shows it as though it were
   current — and the prototype's own line, *"Queue received from OrgaTEX at
   06:12"*, is the acknowledgement that the receipt time matters.
2. **`receivedAt` alone forces the UI to re-derive staleness.** The UI
   would have to compare `receivedAt` against *now* with a threshold — and
   that threshold is unit 005's freshness window, which is **configuration**
   (BRD NFR-14). The UI does not have it and must not guess at it.

So unit 001 **passes unit 005's decision through unchanged** — the same
`{ kind: 'CURRENT' }` / `{ kind: 'STALE', ageMs }` shape unit 005's own
endpoint emits. Passing a decision through is not re-deciding it.

### The two failure bodies are distinguishable, and that is the point

The story's hardest acceptance criterion is this one:

> *"the request fails with a distinguishable error state and the UI shows an
> error message rather than an empty queue (FR-1, BRD IR-09)."*

The failure mode it forbids is **silent**: an unreachable MES and an empty
release list both produce zero rows on screen, and an operator cannot tell
"there is no work" from "we cannot see the work". So:

| Situation | HTTP | Body |
|---|---|---|
| The MES answered; nothing is released | **200** | `{ batches: [], receivedAt, source, freshness }` |
| The MES could not be reached | **503** | `{ error: 'BATCH_QUEUE_UNAVAILABLE', reason }` |

The 503 body carries **no `batches` key at all** — not an empty array. A
client that renders whatever is under `batches` must be forced to look at
the status code to know it is in the error state, because a `batches: []`
in an error body is exactly the ambiguity the criterion forbids.

**`reason` is a code, and the detail never reaches the client** (BRD
IR-09: *"Interface failures are logged with enough detail to diagnose
without OrgaTEX-side access"*). The MES's own error text goes to the **log**,
carried by the log line the use case writes. The client gets
`UNREACHABLE` | `MALFORMED` | `TIMEOUT` and nothing else.

### The error code is `BATCH_QUEUE_UNAVAILABLE`, not `ORGATEX_UNAVAILABLE`

Unit 005's endpoint answers `ORGATEX_UNAVAILABLE` because its failure is
the MES seam's. This endpoint's failure is *"there is no queue for this
station"* — which today has exactly one cause (the seam), but which will
grow: unit 009 adds the selection state, and unit 002's recipe cache will
add its own failure modes.

Giving this endpoint its **own** code keeps the two surfaces
distinguishable without changing unit 005's contract, and it leaves room for
the station's queue to fail for a reason that is not the MES's. The
`reason` field carries unit 005's own vocabulary unchanged, so the two
bodies compose.

---

## The Domain Model in Code

### The projection — pure, and the only place the mapping happens

```ts
project(snapshot: BatchQueueSnapshot): StationBatchQueue
```

It maps unit 005's snapshot onto the station's model:

| From (unit 005) | To (unit 001) | Rule |
|---|---|---|
| `snapshot.batches[]` | `StationBatchQueue.batches[]` | The MES's **order** is kept — the projection does not re-sort. |
| `batch.batchId` | `StationBatch.batchId` | Verbatim. |
| `batch.orderRef` | `StationBatch.orderRef` | Verbatim. |
| `batch.machineRef` | `StationBatch.machineRef` | Verbatim. |
| `batch.fabricDescription` | `StationBatch.fabricDescription` | `null` when absent or blank. |
| `batch.shadeCode` | `StationBatch.shadeCode` | Verbatim. |
| `batch.componentCount` | `StationBatch.componentCount` | Verbatim — already validated upstream. |
| `batch.weighingStatus` | `StationBatch.weighingStatus` | Verbatim — already validated upstream. |
| `batch.eligibility` | **dropped** | Unit 005's, and unit 005's consumers' — bolt 009 reads it from the snapshot, not from this projection. |
| `snapshot.receivedAt` | `StationBatchQueue.receivedAt` | Verbatim. |
| `snapshot.source` | `StationBatchQueue.source` | Verbatim. |
| *(the reader's freshness)* | `StationBatchQueue.freshness` | Verbatim. |

**Why `eligibility` is dropped and not carried.** A row that carries a
gate it does not enforce invites a reader to assume it does. Unit 005's
`BatchEligibility` docstring says the same thing in the other direction:
*"The **refusal** belongs to unit `001-batch-management`, which owns the
selection state machine."* Bolt 009 enforces it, on the snapshot. The
projection carries **what the operator sees** — seven columns — and a
selection gate is not one of them.

**Why the projector holds no clock and no adapter.** A projector that
computed the receipt time itself would report the *render* time, not the
*receipt* time — and the story is explicit that `receivedAt` must be *"the
time the list was last received from the upstream system"*, not the time
the client asked. The receipt time is unit 005's fact, and the projector
copies it.

### The use case

```ts
RetrieveBatchQueue.execute(): Promise<QueueAvailability>
```

It does exactly four things:

1. `await source.read()` — the port, not the adapter.
2. Interpret the outcome:
   - `SUCCEEDED` → project → `AVAILABLE`.
   - `SUCCEEDED_STALE` → project → `AVAILABLE`. **The staleness does not
     change the availability** — unit 005 already decided the snapshot is
     serveable, and this unit does not re-decide.
   - `FAILED` → `UNAVAILABLE`, carrying the reason, and **write the detail
     to the log** (IR-09).
3. Log the failure detail.
4. Return.

It holds **no** adapter, **no** cache and **no** database handle. The only
thing it holds is the port.

### The port

```ts
export interface BatchQueueSource {
  read(): Promise<BatchQueueReadOutcome>;
}
```

Declared **in unit 001**, because a port belongs to the consumer. Unit 005's
`BatchQueueReader` satisfies it structurally — its `read(filter?)` accepts a
call with no arguments — so the composition root binds the two with no
adapter class and no mapping layer between them.

**The port takes no filter.** Filtering is bolt 009's story
(`002-filter-batch-queue-by-status`). The port grows a parameter when that
story lands, and not before.

### The availability

```ts
export type QueueAvailability =
  | { readonly kind: 'AVAILABLE'; readonly queue: StationBatchQueue }
  | {
      readonly kind: 'UNAVAILABLE';
      readonly reason: 'UNREACHABLE' | 'MALFORMED' | 'TIMEOUT';
    };
```

A **two-valued** answer, and the domain model explains why: the operator
can act on *"here is the queue"* and on *"there is no queue"*, and on
nothing in between. Unit 005's three-valued `STALE` is carried inside the
`AVAILABLE` case as `freshness`, because staleness is not a different kind
of queue — it is the same queue with an age.

---

## Data Persistence

**Nothing is persisted. This bolt adds no table, no repository and no
migration.**

| Would be persisted | Why not |
|---|---|
| The queue | A projection of a system we do not own, and re-fetchable. A persisted copy is a **second source of truth** for the same queue — the exact duplication unit 005's ADR-021 and the unit brief both forbid. |
| The receipt | The receipt time travels **with** the projection. A stored receipt with no queue beside it is a timestamp with nothing to date. |
| The selection | **Bolt 009's.** This bolt does not select anything. |

The absence is the enforcement: there is no repository interface to
implement, so there is nothing that *could* grow a second copy.

---

## Security Design

| Concern | Approach |
|---|---|
| **Authorisation** | The endpoint requires an **operator session** — `401` without one. The MES's queue is OrgaTEX's production schedule and is not physically visible at the station, so ADR-020's rule applies to this endpoint exactly as it does to `/api/orgatex/batches`. Reading authorises nothing, so **no supervisor** is required. |
| **Information disclosure** | The 503 body carries a **code** and a **reason code** — never the MES's error text, never a stack, never an internal path. The detail goes to the log (IR-09). |
| **Localised text** | The API emits **no prose**. The placeholder for a missing field is the UI's (NFR-11, FR-22). |
| **No client-side data** | The queue arrives over the API and nowhere else (FR-1, BRD IR-07). This bolt's contribution to that is the endpoint existing at all — the prototype's hard-coded rows are replaced by a fetch. |
| **Seam discipline** | Unit 001 holds no `OrgatexAdapter` and no MES credential. It reads through unit 005's reader, and it cannot reach the MES except by that route. |
| **Injection** | The endpoint takes **no input** — no path parameter, no query parameter, no body. There is no string from a client that reaches a query, a log line or a filesystem path. |
| **DoS / abuse** | The endpoint is a **read** and performs no write. Its cost is one MES contact, and unit 005's reader owns the cache and the link state, so repeated calls do not multiply the load on the MES beyond what unit 005 already does. |

### The injection surface, stated plainly

This endpoint has **no input**. That is unusual for a product API and it is
deliberate: bolt 008 reads a queue and nothing else, and the first bolt
that takes a parameter — bolt 009, with the status filter — is the one that
has to reason about validating it.

---

## NFR Implementation

| Requirement | Design approach |
|---|---|
| **NFR-1 (≤ 3 s to the operator's next screen; AC-01)** | The queue read is **one in-process call** — no socket, no HTTP round-trip to the MES, no second cache lookup. The `receivedAt` it returns is the receipt time, so the UI's "how old is this" is a timestamp it already has. |
| **NFR-16 (no floating point for quantities)** | The queue carries **no quantity**. `componentCount` is a count and is an integer by construction (unit 005's reader refuses anything else). |
| **NFR-7 / FR-22 (externalised text)** | The API emits codes and `null`. Not one sentence of prose crosses this boundary. |
| **NFR-11 (diagnosable without OrgaTEX-side access)** | The failure's **detail** is written to the log by the use case; the client receives the code and the reason. |
| **NFR-14 (configuration over code)** | This bolt introduces **no** configuration. The freshness window it passes through belongs to unit 005 and is already configuration. |

---

## Testing Strategy

| Layer | What is proved | How |
|---|---|---|
| **Unit** | The projector maps every field correctly, keeps the MES's order, drops `eligibility`, and nulls a blank description. The use case maps all three outcomes onto the availability. | Pure functions, no doubles needed. |
| **Integration** | The endpoint's three outcomes: `200` with the seven columns and the receipt time; `200` with zero rows for an empty queue; `503` with no `batches` key; `401` without a session. The data really comes from the Dummy MES through the seam. | The real harness, the real Dummy, the real adapter. |
| **Security** | The session requirement, the absence of the MES's error text in the response body, and the absence of prose in the payload. | The security suite, which is the executable record of this project's security review. |

The tests bind the port to a **controlled source** when they need a
specific failure, and to the **real** reader when they need the real thing.
Both are honest: the first proves the use case's interpretation, the second
proves the seam.

---

## What this bolt does NOT deliver

| Not delivered | Belongs to |
|---|---|
| Filtering by status | bolt 009, story `002-filter-batch-queue-by-status` |
| Selecting a batch, and the eligibility gate's enforcement | bolt 009, story `003-select-batch-and-record-identity` |
| The recipe's contents | unit 002 |
| Rendering the queue, and the placeholder's text | unit 007 |
| The queue's read, the MES contract, the cache, the freshness window | unit 005 |
