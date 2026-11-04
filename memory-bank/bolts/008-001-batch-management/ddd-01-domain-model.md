---
unit: 001-batch-management
bolt: 008-001-batch-management
stage: model
status: complete
updated: 2026-11-04T15:30:00Z
---

# Static Model - Batch Queue (bolt 008)

## Bounded Context

**A new bounded context: Batch Management.**

Unit `005-orgatex-integration` owns the **link to OrgaTEX**. This unit owns
what the station **does with the released work** — which batches are on offer,
what they are, and (in bolt 009) which one the operator chose.

The two are separated by a single boundary, and the boundary is the whole
design of this bolt:

> **Unit 005 owns how the queue is obtained. Unit 001 owns what the queue
> means to this station.**

### The one problem this bolt exists to solve

The prototype's batch queue is **hard-coded rows in the client**. The BRD's
FR-1 forbids that outright, and the reason it matters is not tidiness:

> A hard-coded queue is a queue that **cannot be wrong about the upstream**,
> because it never asks. On a shift where OrgaTEX released three batches and
> cancelled one, the operator is shown the prototype's list and starts
> weighing a batch that no longer exists.

So the queue becomes a **station-owned projection**: read through the seam,
projected into this unit's own model, and carried with the time it was
received.

### What this bolt does NOT own

- **The queue read, the adapter and the fallback** → unit 005 (bolts 005,
  007). This bolt **consumes** the reader; it does not re-implement it and it
  does not keep a second copy.
- **The cache and the freshness window** → unit 005 (ADR-021, ADR-027). This
  bolt holds **no** cache of its own.
- **The filtering** → bolt 009 (`002-filter-batch-queue-by-status`).
- **The selection and the eligibility gate** → bolt 009
  (`003-select-batch-and-record-identity`).
- **The recipe's contents** → unit 002.
- **Rendering the queue** → unit 007 (`007-weighingms-ui`).

### The rule that governs every shape in this document

Unit 005's ADR-021 established that a snapshot is a **point-in-time copy of
somebody else's truth**, and that it is immutable once taken. This bolt adds
one thing to that:

> **A projection without its provenance is a guess.**

A queue with no `receivedAt` cannot be distinguished from a queue that is
current. The operator cannot tell whether they are looking at this shift's
work or at a list from an hour ago. So the receipt time is not a display
detail — it is **part of the model's shape**, and the API carries it.

---

## Domain Entities

| Entity | Properties | Business Rules |
|--------|------------|----------------|
| **StationBatch** | `batchId`, `orderRef`, `machineRef`, `fabricDescription`, `shadeCode`, `componentCount`, `weighingStatus` | A batch **as this station sees it**, projected from the MES's own record. The seven fields are exactly the seven columns FR-1 names, and they are carried **verbatim** — this unit derives none of them. `componentCount` is the MES's own count, not a count this unit computed from a recipe it may not have fetched. |
| **StationBatchQueue** | `batches`, `receivedAt`, `source` | The **projection** of the released queue at one moment. Immutable once constructed. `receivedAt` is the moment the queue was **received from the upstream**, not the moment this unit rendered it — because the age that matters to an operator is *"how long has this been on my screen"*. `source` attributes the projection to the adapter that produced it, so a degraded read is **attributable**. |

### Why the projection is not the MES's snapshot

Unit 005's `BatchQueueSnapshot` already holds the MES's batches. This bolt
does **not** re-wrap it, and this is deliberate.

The two differ in **what they are for**:

| | Unit 005's snapshot | This unit's `StationBatchQueue` |
|---|---|---|
| **Question it answers** | "What did the MES say, and is it still current?" | "What work is on offer at this station?" |
| **Carries** | The MES's own fields, plus `eligibility` | The seven display columns, plus `receivedAt` and `source` |
| **Failure vocabulary** | `UNREACHABLE` / `MALFORMED` / `TIMEOUT`, and `STALE` | `AVAILABLE` / `UNAVAILABLE` — the operator's two states |
| **Owner of the cache** | Unit 005 (in memory, disposable) | **Nobody.** This unit holds none. |

The second row of that table is the important one. Unit 005's snapshot carries
an `eligibility` value because it answers *"may this batch be worked?"* — a
question that belongs to unit 001 but that unit 005 computes **as the MES
sees it**. This unit's projection carries **what the operator will see**:
the seven columns and nothing else that the operator did not ask for.

The **eligibility is not dropped** — it is simply not *this* bolt's concern.
Bolt 009 consumes the eligibility to gate a selection, and the projection
deliberately does **not** carry it, because a row that carries a gate it does
not enforce invites a reader to assume it does.

### Why there is no `releasedAt` on the row

The unit brief's `Batch` entity lists a `releasedAt` attribute. The MES's
payload does not supply one, and inventing one would be a **fabricated
field**: a plausible-looking timestamp that means nothing.

The receipt time of the **queue** is known and is carried. The release time
of an **individual batch** is not known, and is therefore not carried. If
FCI confirms the MES supplies it (Q-01), it arrives with the next read.

---

## Value Objects

| Value Object | Properties | Constraints |
|--------------|------------|-------------|
| **QueueReceipt** | `receivedAt` (`Instant`), `source` | When the queue was received, and from where. **`source` is a string, not a class**, so a test can prove the attribution without depending on which adapter is bound — the same choice bolt 005 made. The two fields travel together because a receipt time without an attribution is a clock reading with no owner. |
| **QueueAvailability** | — | The closed set `AVAILABLE` \| `UNAVAILABLE`. **Not** `STALE`: staleness is unit 005's vocabulary and unit 005's decision. This unit answers the operator's question — *is there a queue to show?* — and the answer is two-valued, because an operator can act on "here is the queue" and on "there is no queue", and on nothing in between. |

### Why the availability is two-valued and not three

The obvious third value is `STALE` — unit 005 has one, and a projection that
lost it would be strictly less informative than the thing it projects.

It is rejected for one reason: **the operator cannot act on it.** The unit
005 vocabulary answers *"is this the MES's current answer?"* — a question
for the link state and the log. The operator's question is *"can I start
work from this list?"*, and the answer is yes or no. A stale queue that
unit 005 still considers serveable **is** work to act on, with its age
shown; a stale queue that unit 005 refused is **not**.

So `AVAILABLE` covers both a current read and a degraded read that unit 005
decided was serveable, and the **age travels with it** — `receivedAt` is
always present in the payload. The operator sees the age; they are not asked
to interpret a three-valued state.

### The empty queue is not an error

A queue with zero batches is `AVAILABLE`. The MES answered, and the answer
was "nothing is released". That is a fact, and it is rendered as a queue with
zero rows and the receipt time — **never** as an error, and never as a
failure.

This matters because the failure case looks superficially similar: both
produce zero rows on screen. The difference is that one of them is **silent**,
and the operator cannot tell "there is no work" from "the MES is unreachable".
The error state exists precisely to keep those apart.

---

## Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **StationBatchQueue** | the projection's rows | 1. The queue is **immutable** once constructed — it is a point-in-time copy (unit 005's ADR-021 discipline, carried here). 2. Every row carries **all seven** display fields, so no consumer has to ask whether a field is present. 3. `receivedAt` is **always** present. 4. Rows are the **MES's order** — the projection does not re-sort them. |

### There is no aggregate root for a batch

A batch is **not ours**. Unit 005's model says it plainly: *"A batch belongs
to OrgaTEX."*

So `StationBatch` is a **value in a projection**, not an aggregate with an
identity and a lifecycle. It has no invariants of its own to protect — the
MES owns the batch, the MES's own status vocabulary, and the MES's own
consistency. A row that could be edited here would be a row that could
disagree with the MES about what a batch is.

The **queue** is the aggregate, because the queue is the thing this unit
owns: it has a provenance, a moment, and an immutability.

### Why the projection is not persisted

The unit brief says it plainly, and unit 005's ADR-021 explains why:

> *"A snapshot can always be fetched again; an unlanded consumption cannot."*

The queue is in the first category. Persisting it would create a **second
source of truth** for the same queue — and the failure mode of that is
exactly the one this product forbids: a persisted queue that says three
batches are released when the MES says two, with nothing in the read path to
say so.

So the projection is **not** persisted, and this unit contributes **no**
table and **no** repository. The absence is the enforcement.

---

## Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **BatchQueueProjected** | A queue was obtained from the seam and projected | `batchCount`, `receivedAt`, `source` |
| **BatchQueueUnavailable** | The seam could not produce a queue to project | `reason` (`UNREACHABLE` \| `MALFORMED` \| `TIMEOUT`), `at` |

### Why there is no `BatchQueued` per row

A projection is a **read**. The moment it was taken is the fact worth
recording; the individual rows are the content of that moment and are
recoverable by taking the projection again.

Emitting an event per row would produce a log that grows with the queue and
says nothing the projection event does not already say — and it would create
a second, event-sourced copy of the MES's truth, which is the thing this
design refuses to have.

---

## Domain Services

| Service | Operations | Dependencies |
|---------|-----------|--------------|
| **BatchQueueProjectionService** | `project(snapshot) → StationBatchQueue`; `projectUnavailable(reason) → unavailable` | **Pure.** It maps unit 005's outcome onto this unit's model. It holds **no** adapter, **no** clock and **no** cache — it is handed the snapshot and it projects it. |

### Why the service is pure and holds no adapter

The obvious design is for this unit to call the adapter itself. It is
rejected because it would create **two readers of the MES seam** — unit
005's and this unit's — and two readers mean:

1. **Two contacts** where one would do, and the link state would record
   them as separate observations of the same link.
2. **Two caches** if each brings its own fallback, and therefore **two
   sources of truth** for the same queue — the exact duplication the unit
   brief forbids.

So this unit depends on unit 005's **reader** — the `BatchQueueReader` — and
the reader remains the **only** thing that talks to the adapter. The
projection service is a pure mapping, and the use case below is the only
place the two units meet.

---

## Ports (inbound)

| Port | Operation | Meaning |
|------|-----------|---------|
| **BatchQueueSource** | `read() → BatchQueueReadOutcome` | *"Give me the released queue."* The station's own question, expressed over unit 005's reader. It is declared **here**, in the consuming unit, because a port belongs to the consumer. |

### Why the port exists when unit 005's reader already does this job

Because the **direction** of the dependency matters. If this unit imports
unit 005's `BatchQueueReader` **class**, then unit 001 is coupled to unit
005's implementation, and unit 005's next refactor ripples here.

Declaring the port **in this unit**, satisfied by unit 005's reader, means:

- the dependency runs **inward**, from the application layer to a port this
  unit owns;
- the test can bind **any** source — including one that returns a
  controlled failure — without a MES, a database or a socket.

This is the same hexagonal shape every other unit in this codebase already
uses: unit 004's `ScaleAdapter`, unit 008's `SecretHasher`, unit 005's
`OrgatexAdapter`.

---

## Repository Interfaces

**None.**

This bolt introduces **no repository and no table**, and that is the design
rather than an omission:

| Would be persisted | Why not |
|--------------------|---------|
| The queue | A projection of a system we do not own. Re-fetchable. A persisted copy is a second source of truth (ADR-021). |
| A receipt record | The receipt time travels **with** the projection. A stored receipt with no queue beside it is a timestamp with nothing to date. |

---

## Ubiquitous Language

| Term | Definition |
|------|------------|
| **Station batch** | A batch as **this station** sees it: the seven display columns, carried verbatim from the MES. Not an entity with its own identity. |
| **Station batch queue** | The projection of the released queue at one moment, with its receipt time and its source. Immutable. |
| **Projection** | A point-in-time copy of somebody else's truth, taken through a seam. Unit 005 owns the snapshot; this unit owns the projection of it. |
| **Receipt time** | When the queue was **received from the upstream**. Not when it was rendered. The age the operator cares about. |
| **Source** | Which adapter produced the projection. Makes a degraded read attributable. |
| **Available** | There is a queue to show. It may be current, or it may be old — **the age is always shown**. |
| **Unavailable** | There is **no** queue to show. The MES could not be reached, or answered unusably. Distinct from an empty queue. |
| **Empty queue** | A queue with zero batches. **Not** an error, and **not** the same as unavailable. |
| **The seam** | Unit 005's `OrgatexAdapter` port — the whole contract with the MES. This unit never crosses it directly. |
