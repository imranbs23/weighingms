---
unit: 001-batch-management
bolt: 009-001-batch-management
stage: model
status: complete
updated: 2026-11-05T14:20:00Z
---

# Static Model - Batch Filtering and Selection (bolt 009)

## Bounded Context

**The same bounded context as bolt 008: Batch Management.**

Bolt 008 gave this unit the **queue** — the seven columns, the receipt time,
the source, the freshness. Bolt 009 gives it two things the queue alone does
not answer:

1. **Which rows the operator wants to see** (the filter), and
2. **Which batch the operator has chosen** (the selection).

Both are **this station's** questions. The MES owns the queue's contents; this
unit owns the operator's view of it and the act of choosing.

### The one problem this bolt exists to solve

The prototype's queue rows are **decorative**: the operator can look at them
and nothing happens. Two requirements say that is not enough —

> **BRD FR-02** — *"Select a batch by barcode scan, or by touch from the
> displayed queue"* (BR-02)
>
> **BRD FR-03** — *"Reject selection of a batch not in a released state, with
> the reason shown"*

— and the failure they guard against is not a missing button. It is a
**silently wrong selection**: an operator who starts work on a batch that
OrgaTEX has not released, or that another station is already weighing, will
post a consumption against the wrong order. Two stations weighing the same
batch is a quantities error (ADR-028's note on `WEIGHING`).

So the selection is a **recorded act with a recorded cause**, and the refusal
is a **specific reason** rather than a shrug.

### What this bolt does NOT own

- **The queue's read, the adapter, the cache, the freshness window** → unit
  005 (bolts 005, 007). This bolt reads through the reader; it does not
  re-implement it and it does not keep a second copy.
- **The eligibility derivation** → unit 005. Unit 005 **reports** whether a
  batch may be worked; this unit **enforces** it (ADR-028, bolt 008's design).
- **The recipe's contents** → unit 002. This unit triggers the recipe load
  and does not own a single component.
- **The weighing session** → unit 003. A selection is *not* a session; the
  resume semantics belong to unit 003 (CQ-02, CQ-03).
- **The scanner seam** → the scanner is a device, and unit 002 owns
  material identification. This unit resolves a **batch** code, which is a
  different identification (B-6's fallback is unit 002's).

### The rule that governs every shape in this document

> **A view is not a queue, and a choice is not a session.**

Both halves of that sentence are load-bearing. The filter must not become a
second queue with its own receipt time and its own truth; and the selection
must not become a weighing session with a tolerance band and a scale.

---

## Domain Entities

| Entity | Properties | Business Rules |
|--------|------------|----------------|
| **StationBatch** | *(from bolt 008, unchanged)* `batchId`, `orderRef`, `machineRef`, `fabricDescription`, `shadeCode`, `componentCount`, `weighingStatus` | Carried **verbatim** from the MES. This bolt derives none of them, and it does not add a field to the row. |
| **BatchSelection** | `batchId`, `orderRef`, `machineRef`, `operatorId`, `selectedAt`, `selectionMethod` | **The operator's chosen batch, as a recorded act.** Immutable once written. It carries the batch's identity **at the moment of selection** — because the crumb shows *that* batch's order and machine, and a later change in the MES must not rewrite what the operator was shown when they chose. It carries the **method** (`SCAN` or `TOUCH`) because a scanned selection and a touched one have different traceability meaning (B-6). |
| **ActiveSelection** | `selection` | **The one selection currently in force.** A **superseding** record, not a mutable one: a new selection replaces it, and the old one stays in the history. |

### Why `BatchSelection` carries the order and machine

The story's acceptance criterion says the selection record contains *"the
batch ID, the operator ID, the selection timestamp and the selection
method"*, and the batch, order and machine identity are shown in the topbar
crumb.

The crumb is a **snapshot of what the operator saw**. If the selection carried
only the batch id, the crumb would have to be re-derived from a queue read at
render time — and the queue might have changed, been filtered away, or be
unreachable. The operator would then see a crumb that disagrees with the
selection they made. So the identity travels with the selection.

It is a **copy of three identifiers**, not a copy of the MES's batch. The
order and machine are attributes of the *order*, and they are carried because
the crumb must not depend on a second read. Nothing else about the batch is
copied — the recipe, the status and the counts are **not** part of a
selection, because they belong to other units and change under other rules.

### Why the selection is immutable, and why there is a *separate* active record

BRD DR-02 requires that records describing something that physically
happened are immutable. A selection is such a record: *"at 08:14:22,
operator OP-001 chose batch B-24187 by scanning its card"* is a fact about
the past.

But the workflow also needs *"the batch currently chosen"* — and that
**changes**. Making the selection mutable would put the two requirements in
direct conflict, and the mutable version is the one the requirements forbid.

So there are two things:

- `BatchSelection` — **append-only**. One row per act of choosing.
- `ActiveSelection` — a **pointer** to the latest one. It is the only thing
  that moves, and it moves by being *replaced*, not by being edited.

A new selection **supersedes** the previous one; the previous one is still in
the record. That is exactly what the story's edge case asks for: *"The new
selection is recorded and supersedes the previous one; the crumb updates to
the newly selected batch."*

### Why the selection is NOT the weighing session

CQ-02 asks whether operator identity is established per shift or per weighing,
and CQ-03 asks whether a batch can be split across shifts or operators. If a
batch *can* be split, then **"selecting a batch" is not "starting a batch"**,
and a selection may be *resumed* rather than created.

The story settles the split: **this unit stores the selection; the resume
decision belongs to unit `003-weighing-station`**, which owns the session.
So the selection record carries enough information to be resumed — batch,
operator, time, method — and nothing that would let it *be* the session. In
particular it carries **no scale, no weight, no tolerance and no component
state**, because those are unit 003's and unit 002's.

---

## Value Objects

| Value Object | Properties | Constraints |
|--------------|------------|-------------|
| **QueueFilter** | `status` (a `BatchWeighingStatus`) or **absent** | **Two states, not a set of statuses.** The filter is *one* status, or no filter at all. A filter that could hold several statuses would be a different product decision — "show me everything released *or* queued" is a query the operator did not ask for, and the story asks for "narrow by weighing status". The absence is modelled as `null`, **never** as an empty string and never as a wildcard — because an empty string is a value that a client could send and the server would have to interpret, and "the filter is off" is not a status the MES knows. |
| **FilterableStatuses** | the statuses **present in the current queue** | Derived from the queue, **never hard-coded**. The story is explicit: *"the available status values are the set of weighing-status values returned by the adapter for the current queue, and no status is hard-coded in the client"*. The set is therefore a **function of the queue**, computed by the domain, and it changes when the queue changes. |
| **SelectionMethod** | `SCAN` \| `TOUCH` | A **closed set of two**, and the closure is the point: it is the traceability distinction (B-6), and a third value would have to be named by somebody who has not thought about what it means. `SCAN` means the operator presented the batch's card to the scanner; `TOUCH` means the operator selected the row in the displayed queue. |
| **SelectionRefusal** | `reason` (a code) | The **refusal**, not the selection. A closed set of reasons, each naming a **distinct cause**. Never a generic "not available" — the story forbids it in as many words: *"the reason names the actual cause (not yet released, already weighed, on hold, or belonging to another station) and never a generic 'not available' message"*. |

### The refusal reasons, and where they come from

The story names four causes. Unit 005's `IneligibilityReason` already derives
three of them from the MES's own status vocabulary, and it is unit 005's
**job** to derive them — it holds the MES's status vocabulary and the rule
that maps it. So this unit **consumes** those reasons rather than inventing
a parallel set:

| Reason | Meaning | Source |
|---|---|---|
| `NOT_RELEASED` | Not yet released for this station. | unit 005's derivation of `QUEUED` |
| `BEING_WEIGHED_ELSEWHERE` | Another station is working it. | unit 005's derivation of `WEIGHING` |
| `ALREADY_WEIGHED` | The work is finished. | unit 005's derivation of `WEIGHED` |
| `CANCELLED` | The order was cancelled. | unit 005's derivation of `CANCELLED` |

**Why this unit does not re-derive them.** ADR-028's design already settled
this: unit 005's snapshot carries the eligibility, and bolt 009 reads it
**from the snapshot**, not from the projection — because the projection
deliberately does not carry it. A unit that both derived and enforced the
rule would have two copies of the rule, and two copies of a rule eventually
disagree. The **enforcement** is this unit's; the **derivation** is unit
005's.

The story's "on hold" is the one that is **not** in the BRD's status
vocabulary. The MES's five statuses are `QUEUED`, `RELEASED`, `WEIGHING`,
`WEIGHED`, `CANCELLED` (BRD §9.2). There is no `ON_HOLD`. So "on hold" is
**not** a fifth reason invented here — it is `NOT_RELEASED`'s meaning when
the MES withholds a release, and the BRD's own wording covers it: *"not yet
released"*. Inventing an `ON_HOLD` status would be inventing a fact about
the MES's vocabulary, which is exactly what unit 005's reader refuses to do
when it meets an unknown status (it fails the whole read).

### The refusal also carries a second kind of reason: the code was not recognised

A scan of a code that is in no queue is a **different failure** from a scan of
a code naming a batch that cannot be worked. The first is *"I do not know
that code"*; the second is *"I know that batch, and it is not available"*.
Collapsing them into one refusal would tell the operator their batch is on
hold when it was never in the queue at all.

So the refusal set has **two axes**:

| Axis | Values |
|---|---|
| **Recognition** | `RECOGNISED` — the code names a batch the MES knows. `UNRECOGNISED` — the code names nothing. |
| **Eligibility** (only when recognised) | `ELIGIBLE` — may be selected. Or one of the four ineligibility reasons. |

And the two are **separate refusals**: an unrecognised code is refused
*before* eligibility is even asked, and it carries **no eligibility reason**,
because there is no batch to be ineligible.

### Why the status in a row is normalised for comparison

The story's edge case: *"Status strings differ only by case or whitespace
between upstream responses → the value is normalised for comparison and
display so one logical status does not split into two filters."*

The MES's statuses are an **upper-case closed set** — `QUEUED`, `RELEASED`,
`WEIGHING`, `WEIGHED`, `CANCELLED` — and unit 005's reader **refuses** any
status outside that set (it fails the whole read, S-24). So a row carrying
`released` in lower case never reaches this unit: the reader has already
rejected it.

Which means the normalisation this unit performs is **trimming only** — the
reader's own comparison is exact, and this unit's must be too, or the same
logical status would split into two filters *here* while the reader treats
them as one. The normalisation is therefore **not** case folding; it is the
refusal to treat a whitespace-padded status as a different status than the
same status without the padding — a difference the reader would have
rejected anyway.

This is worth stating plainly, because the story's wording invites a case-
folding implementation and a case-folding implementation would be **wrong
here**: `RELEASED` and `released` are different strings, and only one of them
is in the MES's vocabulary. Unit 005 is the place that decides which
strings are statuses; this unit decides which of the ones it was given are
the *same* status.

---

## Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **BatchSelection** | the record | 1. **Immutable** once written (BRD DR-02). 2. It names **exactly one** operator and **exactly one** batch. 3. Its method is one of two. 4. Its timestamp is the moment of the act, not the moment it was written. |
| **ActiveSelection** | a pointer to the latest `BatchSelection` | 1. At most **one** active selection at a time. 2. A new selection **supersedes** — it never edits. 3. There is no "clear" that erases history: the operator can choose a different batch, but the act of choosing is recorded. |

### Why `ActiveSelection` is not persisted as a mutable row

The obvious implementation is a `batch_selections` table with a
`superseded_at` column, updated when a new selection arrives. It is rejected
for the same reason ADR-006 rejected a `consumed_at` flag on an
authorisation: **a mutation of a historical record**. The record that says
*"operator OP-001 chose B-24187 at 08:14"* would gain a column saying when
it stopped being current, and the "when it stopped" fact would be written by
a later process, at a later time, for reasons that have nothing to do with
the original act.

So the history is **append-only**: one row per selection, ordered by time,
and *"the active selection"* is simply **the latest row**. No update path
exists, so there is nothing that *could* rewrite a selection.

### Why the queue is still NOT an aggregate here

Bolt 008's model is unchanged and is not restated: the queue is a
**projection** of a system this station does not own, it is immutable once
taken, and it is **not persisted**. This bolt adds a *view* over it and a
*record beside* it. The queue's own consistency boundary is unchanged.

---

## Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **BatchQueueFiltered** | A filter was applied to a queue | `status` (or absent), `matchedCount`, `totalCount` |
| **BatchSelected** | A batch was chosen, by scan or by touch | `batchId`, `operatorId`, `selectionMethod`, `selectedAt` |
| **BatchSelectionRefused** | A choice was refused | `reason` (the recognition or eligibility code), `batchId` (when known) |
| **BatchSelectionSuperseded** | A new selection replaced the previous one | `previousBatchId`, `batchId` |

### Why there is no event per filtered row

A filter is a **view**. The fact worth recording is *"the operator was
looking at three released batches out of seven"* — which is one fact about
one moment. An event per row would produce a log that grows with the queue
and says nothing the single event does not already say.

### Why the refusal is an event, and not merely a return value

A refusal is the case where a **record was NOT made** — and that is exactly
why it needs to be visible. If the operator scanned a card and nothing
happened, the station has no evidence that it happened at all. The refusal
event is the **evidence that an attempt was made and why it did not
succeed**, which is the difference between a traceability gap and a
non-event.

It carries a **code**, never prose (NFR-11, FR-22) — the same rule every
other boundary in this product follows.

---

## Domain Services

| Service | Operations | Dependencies |
|---------|------------|--------------|
| **BatchQueueFilter** | `filter(queue, filter) → FilteredQueue`; `statusesIn(queue) → FilterableStatuses` | **Pure.** Holds no clock, no adapter, no cache. It maps a queue and a filter onto a view. |
| **BatchSelectionService** | `selectByTouch(...)`, `selectByScan(...)`, `resolve(code)` → a `BatchId` or an unrecognised outcome | Depends on the **queue source** (to resolve a code against the MES's own records) and on the **eligibility** carried by the snapshot. It holds a **clock** (the selection is timestamped) and the **selection repository**. |

### Why the filter is a separate pure service

The filter is a **pure function of two inputs**: a queue and a filter. It has
no state, no persistence and no external contract, so it cannot fail on its
own — which is the same argument that kept the tolerance engine inside unit
003 rather than making it a unit.

But it **does** deserve to be named and isolated, because the interesting
part is not the `Array.filter` — it is the **set of filterable statuses**,
which is a function of the queue's *contents* and changes with it. A client
that hard-coded the five statuses would show a filter option for a status
that is not in the queue, and the operator would pick it and get an empty
list with no explanation.

### Why the statuses come from the queue, and not from the MES's vocabulary

The tempting answer is to publish the MES's five statuses — they are a
closed set, the code already knows them, and the filter would then always
offer every option.

It is rejected because the story says the filter's values are *"the set of
weighing-status values returned by the adapter for the current queue"*, and
because the MES's vocabulary is **not this unit's to publish**. Unit 005's
reader is the thing that knows the MES's vocabulary; a status that is not in
the current queue is a filter that will match nothing. The operator's filter
control is a **view of the queue in front of them**, so it is derived from
that queue.

The consequence is deliberate and worth stating: **a filter value can
disappear.** If the last `WEIGHED` batch leaves the queue, `WEIGHED` leaves
the filter's options — and a filter that was already applied stays applied,
showing zero rows with the explicit "no batches match this filter" state.
That is the story's edge case, and it is why the "All" option must always
exist.

### Why the scan resolves against the MES's own records, and not against the queue

A scan is a **code**, not a queue row. The operator walks up to the station
with a card for a batch that may not be in the queue currently displayed —
and the story says so explicitly:

> *"A scan resolves to a batch in `RELEASED` status that is not in the
> currently displayed (filtered) queue → the selection succeeds, because
> eligibility is governed by status, not by the current filter; the queue
> filter is a view concern only."*

So the scan is resolved against the **MES's records** — the unfiltered
queue — and **not** against the filtered view. The filter is a view; it is
never a gate.

That is also why the selection path reads the queue **without a filter**,
while the queue endpoint honours one. Two reads, two purposes: one is
"what is the operator looking at", the other is "what does this code mean".

---

## Ports (inbound)

| Port | Operation | Meaning |
|------|-----------|---------|
| **BatchQueueSource** | `read(filter?) → BatchQueueReadOutcome` | Bolt 008's port, **grown with a parameter** — the filter travels with the read, so the MES may apply it and the reader re-applies it. The reader already honoured a filter and re-applied it itself (belt and braces), so this is the seam being opened rather than a new behaviour. |
| **BatchSelectionRepository** | `save(selection)`, `latest() → BatchSelection \| null` | The **durable** record of the act. Append-only: there is no update and no delete. |
| **BatchScanner** | `read() → ScanOutcome` | *"What code did the operator present?"* The device is reached through a port, so a test can present a code without a scanner, and a real scanner can replace the dummy without touching the domain. |

### Why the scanner is a port and not a call to the device's HTTP endpoint

The scanner is an **external device with an undocumented contract** — the
same position the scale and the MES are in (A-05, A-10, Q-03). The Dummy
Scanner's `POST /api/scan` is a **training contract** behind a boundary, and
this unit asserts nothing about its shape.

More importantly: the scanner's failure is a **device failure**, and it is
not this unit's to resolve. B-6 says the scanner may be disconnected or
return an unreadable code, and that *"the affected step is not silently
skipped; the operator may fall back to touching the row"*. So the port's
outcome has to distinguish **"no code was read"** from **"a code was read
and it means this batch"**, and this unit turns the first into a refusal the
operator can see — never into a silent skip.

### Why there is no port for "the eligibility"

The eligibility is **not** a service this unit calls. It is a **field** on
unit 005's snapshot — a value unit 005 computed. This unit reads it. A port
would imply a call, and a call would imply a second place where the rule
could live.

---

## Repository Interfaces

| Repository | Entity | Methods |
|------------|--------|---------|
| **BatchSelectionRepository** | `BatchSelection` | `save(selection)` · `latest()` |

**One table. One method that writes. One method that reads the newest row.**

There is deliberately **no** `update`, no `delete` and no `markSuperseded`.
The "active selection" is the newest row, and the history is every row.

### Why the selection IS persisted, when the queue is not

Bolt 008 refused to persist the queue, and that refusal stands: the queue is
re-fetchable and a second durable copy would be a second source of truth.

A selection is the **opposite** case. It cannot be re-derived — the MES has
no idea the operator chose a batch, and asking it again would not produce
the choice. And it is a **traceability** record: *"who chose this batch,
when, and how"* is the question BRD FR-34 asks the crumb to answer, and it
is a question about a fact that happened at the station.

So the selection is **durable**, and the queue is **not**. Same unit, two
opposite decisions, and the reason is the same in both directions: *persist
what cannot be re-derived; do not persist what can.*

---

## Ubiquitous Language

| Term | Definition |
|------|------------|
| **The filter** | The operator's narrowing of the queue by weighing status. **One** status, or none. It is a **view** and never a gate. |
| **All** | The absence of a filter. Always available, whatever the queue contains — it is the operator's way back. |
| **Filterable statuses** | The statuses **present in the queue being displayed**. Derived from the queue, never hard-coded. |
| **No match** | A filter that matches no batch. An **explicit state with zero rows** — never an error, and never an empty queue presented as though it were filtered. |
| **The selection** | The operator's chosen batch, recorded: batch, order, machine, operator, time, method. Immutable. |
| **Selection method** | `SCAN` or `TOUCH`. How the operator chose. Recorded because the two have different traceability meaning. |
| **The active selection** | The **latest** selection. What the crumb shows. |
| **Supersede** | A new selection replaces the previous one. The previous record remains. |
| **Recognised** | The scanned code names a batch the MES knows. |
| **Unrecognised** | The scanned code names nothing. Refused **before** eligibility is asked. |
| **Ineligible** | The batch is known but may not be worked. Carries a **specific** reason. |
| **The seam** | Unit 005's `OrgatexAdapter` — the whole contract with the MES. This unit never crosses it directly. |
