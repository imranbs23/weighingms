---
bolt: 009-001-batch-management
created: 2026-11-05T15:05:00Z
status: accepted
---

# ADR-030: The filter's offered statuses come from the queue, and the method is derived from the request

## Context

Bolt 009 adds two things to unit `001-batch-management`'s surface: a
**status filter** over the queue, and the **selection** it enables. Two
decisions inside that work are worth recording, because both have a
plausible alternative that would look right in a code review and would be
wrong in the product.

### Decision one — where the filter's *option set* comes from

The story is explicit:

> *"Given a filter is applied, **When** the filter control is inspected,
> **Then** the available status values are the set of weighing-status values
> returned by the adapter **for the current queue**, and no status is
> hard-coded in the client (FR-1)."*

The MES's status vocabulary is a **closed set of five** — `QUEUED`,
`RELEASED`, `WEIGHING`, `WEIGHED`, `CANCELLED` (BRD §9.2) — and the code
already knows it: `isBatchWeighingStatus` in unit 005, and the `CHECK`
constraint that enforces it in the database.

So there are two obvious ways to build the filter control's options:

1. **Publish the MES's five statuses** — the vocabulary is closed, the
   guard already exists, and the control then always offers every option.
2. **Publish the statuses present in the current queue** — which is what the
   story says.

They differ in what the operator sees. Option 1 offers `CANCELLED` on a
queue with no cancelled batch, and the operator picks it and gets an empty
list — with no explanation of whether "cancelled" means "none right now" or
"the filter is broken".

### Decision two — where the `selectionMethod` comes from

The story requires the selection to record *"the selection method"* — `SCAN`
or `TOUCH` — because *"the two have different traceability meaning"*.

The client knows which it did: it scanned a card, or it touched a row. So
the obvious implementation is a body field:

```json
{ "batchId": "B-24187", "selectionMethod": "SCAN" }
```

## Decision

**1. The filter's option set is derived from the queue, not from the
vocabulary — and from the queue *before* the filter is applied.**

**2. The `selectionMethod` is derived from the shape of the request, and the
client cannot supply it.**

### On the filter's option set

1. The API publishes `statuses`: the **distinct statuses present in the
   queue**, in the order they appear in the queue's rows.

2. They are derived from the queue **before** the filter is applied. If they
   were derived from the *filtered* rows, a filter applied would shrink the
   option set to the one status being filtered by, and the control would
   become a one-way door — the operator could narrow the queue and then have
   no way to widen it again.

3. The **MES's vocabulary is still used** — for the opposite job. An
   incoming `?status=` value is validated against `isBatchWeighingStatus`,
   and an unknown status is a **`400`**, not an ignored parameter.

So the two sets answer two different questions, and both are needed:

| Set | Question | Where it comes from |
|---|---|---|
| `statuses` | *"Which statuses can I filter to?"* | The **queue's contents** |
| The vocabulary | *"Is this a status the MES knows?"* | The **seam's closed set** |

### On the selection method

1. The body carries **either** `batchId` (touch) **or** `code` (scan).
   Exactly one, enforced by the schema.
2. The method is **derived**: a `code` came from the scanner, so the method
   is `SCAN`; a `batchId` came from a row the operator touched, so the
   method is `TOUCH`.
3. There is **no `selectionMethod` field in the schema**. A client that
   sends one has it **stripped** by Zod — not ignored, not honoured.
4. The derived method is written to the record, and the database's `CHECK`
   constraint keeps the set closed at the storage layer as well.

## Rationale

### Why the option set comes from the queue

**Because the option set is a view of what is in front of the operator, not a
catalogue of the MES's vocabulary.**

The MES's five statuses are a *vocabulary*. The filter's options are a
*list of things to look at*. Publishing the vocabulary would mean the
operator is offered a filter for a status that matches nothing — and, on a
station whose queue is entirely `QUEUED`, four options that cannot be
chosen.

There is a second reason, and it is the sharper one: **a status that is not
in the queue is a filter that will match nothing**, and an empty filtered
view is a state the operator must be told about explicitly ("no batches
match this filter"). If the control offers statuses that will always match
nothing, then *every* option can produce that state, and the state stops
being informative — it becomes the default experience of the control rather
than an exception.

The story's edge case confirms the design: *"Filter value matches a status
that has since disappeared from the queue → the filter remains selected and
shows zero rows with the explicit no-match message; the operator can return
to 'All'."* — a status that **disappears** is only possible if the option
set is derived from the queue. With a published vocabulary, no status ever
disappears, and that edge case could not exist.

**"All" is always available**, whatever the queue contains. It is the
absence of a filter, and it is the operator's way back from a filter that
matches nothing.

### Why the vocabulary is still consulted

Because **validating an incoming status is a different job from offering a
filter option**, and the two must not be confused.

An unknown status must be a **`400`**, and the story says why: *"The adapter
rejects a status value it does not recognise → the adapter layer rejects the
payload and the UI shows the error state; **no status is silently mapped to
'All'**."*

The alternative — accepting any string and letting it match nothing — would
turn a client bug into an empty queue with no explanation. So the vocabulary
is the **gate on input**, and the queue is the **source of the options**. A
status may be a valid MES status and still not be offered, because it is not
in this queue.

### Why the method is derived and not supplied

**Because the method is a fact about what the operator did, and a client that
supplies it can record something that did not happen.**

The scenario is not hypothetical: a client — or a bug in the UI, or a
script — sends `{ "batchId": "B-24187", "selectionMethod": "SCAN" }` for a
batch that was chosen by touch. The record now says the operator scanned the
card. And it says so **permanently**, because the selection is an immutable
traceability record (ADR-029) — a false claim written into an audit trail
cannot be corrected, only contradicted by another record.

Deriving the method from the request's shape makes the claim true **by
construction**:

| Request body | Method | Why it cannot be otherwise |
|---|---|---|
| `{ "code": "..." }` | `SCAN` | A code is what the scanner produces. There is no other way a client obtains one. |
| `{ "batchId": "..." }` | `TOUCH` | A batch id is what a touched row carries. |

The derivation is a **type-level** distinction — the schema admits one field
or the other and the method follows from which one — so a future caller
cannot get it wrong without failing to compile.

### Why the schema has no `selectionMethod` field at all

This is the same shape as ADR-005 and the OrgaTEX write path's refusal to
carry an `operatorId` in the body: **the field does not exist in the
schema, so it cannot be sent.**

Zod's default object behaviour is to **strip** unknown keys, so a client
that sends `selectionMethod` gets it dropped. It is not "the field is
ignored" — the field is not there.

That is the enforcement. A convention ("the client should not send
`selectionMethod`") is a thing a future client can forget; a schema without
the field is a thing it cannot express.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|---|---|---|---|
| **Publish the MES's five statuses** | Simple; the vocabulary is closed and known; the control never changes shape | Offers filters that match nothing; makes the "no match" state the default rather than the exception; contradicts the story's rule that the options are "the set of weighing-status values returned by the adapter for the current queue" | **Rejected.** It publishes a vocabulary where the story asks for a view of the queue. |
| **Publish the filtered queue's statuses** | Simple derivation | The option set collapses to the one filtered status — the control becomes a one-way door | **Rejected.** The operator could narrow the queue and never widen it again. |
| **Hard-code the statuses in the client** | The UI needs no API support | The story forbids it outright: *"no status is hard-coded in the client"*; and the list would go stale when the MES's vocabulary changes | **Rejected.** Forbidden by the story, and wrong on its own terms. |
| **Accept any `?status=` string** | No validation needed | An unknown status silently matches nothing — a client bug becomes an unexplained empty queue | **Rejected.** The story forbids silently mapping an unrecognised status to "All". |
| **Take `selectionMethod` from the body** | Simple; the client knows | A client can record a scan that never happened, **permanently**, in an immutable traceability record | **Rejected.** A traceability fact must be derived, not claimed. |
| **Take `selectionMethod` from a header** | Same as the body | Identical problem, with an extra place to forget | **Rejected.** The same argument, and a header is harder to see in a log. |
| **Derive the method from the request shape** *(chosen)* | The record is true by construction; impossible to express a false claim | The client cannot choose how its own action is described | **Chosen.** The traceability meaning of a method is not the client's to assert. |

## Consequences

### Positive

- **The filter control only offers filters that can match something.**
- **The "no match" state stays meaningful**, because it is an exception
  rather than the default experience of the control.
- **A disappearing status is handled**, and the story's edge case for it
  exists.
- **The selection's method is true by construction** — a false claim cannot
  be written.
- **The schema is the enforcement**, for both the operator and the method:
  neither has a field the client can fill.

### Negative

- **Two sets of statuses exist** — the vocabulary and the queue's — and a
  reader could confuse them. *Mitigation:* the design states which question
  each answers, and the two are used in different places (input validation
  versus the published options).
- **The `statuses` array changes as the queue changes.** The UI must
  refresh its control when the queue refreshes. *Mitigation:* the array
  travels **with every response**, so the UI never has to remember it.
- **A client cannot record a touch as a scan** even with good reason.
  *Mitigation:* there is no good reason — a touch that claims to be a scan
  is a traceability defect, and the story requires the distinction.

### Risks

- **A future implementer uses the vocabulary for the options.** *Mitigation:*
  this ADR's "Read when" points at it, and the two sets are named in the
  design's API table.
- **A future client sends `selectionMethod` and believes it was honoured.**
  *Mitigation:* Zod strips it, and the integration test asserts the derived
  method — a test that would fail if the field were ever honoured.
- **The queue is empty, so `statuses` is empty, so the control has nothing
  to offer but "All".** *Mitigation:* that is **correct** — there is nothing
  to filter — and "All" is always present.

## Related

- **Stories**: 002-filter-batch-queue-by-status, 003-select-batch-and-record-identity
- **Requirements**: FR-1, FR-2, FR-3 · BRD FR-01, FR-02, FR-03, IR-01 ·
  NFR-7, NFR-11
- **Previous ADRs**: ADR-005 (store the reason in clear text — a record is
  not a credential); ADR-028 (the station's own queue endpoint, and the
  eligibility read from the snapshot); ADR-029 (the selection record is
  append-only — the reason a false method claim could never be corrected)
