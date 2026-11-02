---
bolt: 006-005-orgatex-integration
created: 2026-11-02T21:42:00Z
status: accepted
superseded_by: null
---

# ADR-024: The posting's content is immutable, and the state transition is the only mutation

## Context

BRD DR-02 says confirmed records are immutable, with corrections written
as new records referencing the original. Every record in this product so
far has been fully append-only — ADR-006's authorisations, ADR-009's
link events, ADR-002's session digests.

But a **consumption posting has a lifecycle**, and that is the problem.
It is created `QUEUED`, and then it becomes `ACCEPTED` or `REJECTED`. It
cannot be append-only in the way the other records are, because the state
is the whole point — the story says a posting must be reported as
*accepted*, *rejected* or *queued*, and never as something else.

So the tension is real: DR-02 wants immutability, and the posting needs
to change.

And there is a second force. The story says:

> "Given the same consumption is posted twice, When the second post
> completes, Then exactly one consumption exists for that batch and
> component — the second post adds nothing."

And the edge case:

> "The MES rejects the posting as invalid | The rejection is recorded
> with its reason and the posting is retained as a failed entry; it is
> never silently discarded."

So the posting must be **retained** — not deleted — and its rejection
**recorded**. Which means the rejection's reason is *attached* to the
posting. A purely append-only record would put the rejection in a
separate row and leave the posting saying nothing about how it ended.

The naive resolution — a general `update` on the posting — breaks
DR-02 in the worst way, because a general `update` can change **anything**
on the posting: the batch, the component, the quantity, the operator, the
time of the weighing. A posting whose quantity was edited after the fact
is a consumption record that disagrees with the weighing it claims to
describe, and nothing in the schema would say so.

## Decision

**The posting's content is immutable. Only the outcome may change, and
only once, and only from `QUEUED`.**

The content — `batch_id`, `component_id`, `actual_quantity`, `unit`,
`lot_number`, `operator_id`, `weighed_at`, `created_at` — is written once
and never again.

The mutable part is exactly three columns: `state`, `rejection_code` and
`rejection_detail`.

### The repository exposes no general update

There is no `update(posting)`. There are exactly two methods that change
anything:

- `markAccepted(postingId, at)`
- `markRejected(postingId, reason, at)`

**No method exists that could write a quantity.** A caller that wanted to
change the amount would have to reach past the repository interface and
write SQL by hand — which is a deliberate act, not an accident.

### The transition is guarded by the database, not by a check

Both methods issue a `UPDATE ... WHERE id = ? AND state = 'QUEUED'`.

If the update affects **zero** rows, the posting is not in `QUEUED` — it
has already been resolved — and the repository **raises**. A double
accept cannot overwrite an accepted posting, and a rejection cannot
overwrite an acceptance.

### The attempt history is separately append-only

The attempts are a different record with a different rule: they are
**never** updated and **never** deleted. Each attempt is a new row.

The distinction is worth stating: the **posting** has a lifecycle and one
terminal transition; the **attempts** have no lifecycle at all, only a
sequence.

## Rationale

### Why partial immutability, and not full append-only

A fully append-only posting would put the outcome in a separate row and
leave the posting itself saying `QUEUED` forever. Every consumer would
have to join the two to answer "was this accepted?" — and every consumer
would have to remember to join them.

That is exactly the failure ADR-011 recorded for the scale unit: *"link
state is separate from device status"* was a **correct** separation of
two facts, but it produced a system where a consumer could read a status
without reading the state that gave it meaning.

Here, "the posting" and "the posting's outcome" are **one fact**, not
two. The outcome is what the posting *is*, not a separate observation
about it. So it belongs on the posting.

### Why the content is immutable rather than "usually immutable"

There is no `updated_at`, no "last write wins", no optimistic-concurrency
version column.

The reason is that a consumption posting describes **something that
physically happened** — 94.01 g of DYE-4471 was dispensed at 08:14:22 by
operator OP-001. That event does not change. If the quantity on the row
disagrees with the weighing record it claims to describe, then one of the
two is wrong, and the system has a genuine correctness problem.

An optimistic-concurrency column would let the row be edited and would
make the *edit* detectable — but it would also make the edit **possible**,
and it would not tell anyone which of the two disagreeing records is the
true one. The weighing record is the source of truth; the posting is a
copy of it. The copy must not be edited.

### Why the guard is `WHERE state = 'QUEUED'`

A check-then-update in the repository — read the state, decide, update —
has a race window between the read and the write. Two concurrent accepts
of the same posting would both read `QUEUED` and both write.

The guarded `UPDATE` has no window: the database evaluates the predicate
and the write atomically. One of the two updates affects a row; the other
affects zero rows and raises.

This is the same argument as ADR-023's, applied to the transition rather
than to the key — and the same argument as ADR-006's single-use
consumption record. **The database enforces the rule**, because the
database is the only thing that can enforce it under concurrency.

### Why the rejection's reason is on the posting

The story requires the rejection to be "recorded with its reason", and
the posting to be "retained as a failed entry". Recording the reason on
the posting is what makes the retained entry **self-describing** — an
operator looking at the failed posting sees why it failed, without
joining to another table.

The attempt history holds the same reason too, and that is not
redundancy: the attempt records **what happened at that attempt**, and
the posting records **how the posting ended**. A posting rejected on the
third attempt has two `REJECTED` attempts and one final rejection — and
the count of the attempts is diagnostic information that the story's
edge case about a permanently failed posting needs.

### Why the outcome is on the posting but the *detail* is bounded

The reason **code** is a closed set — it is the contract, and a consumer
branches on it. The reason **detail** is the MES's own diagnostic text,
and it is bounded to 500 characters.

The bound is not cosmetic. The MES is an external system whose behaviour
is unconfirmed (A-01, A-02), and an unbounded diagnostic string is an
unbounded row and an unbounded log line. The bound keeps the record
readable and the log parseable, and 500 characters is enough to diagnose
a rejection.

## Consequences

### Positive

- **A posting's content cannot drift from its weighing.** There is no
  method that could do it.
- **A double-resolution is impossible.** The `WHERE state = 'QUEUED'`
  predicate makes the second transition a zero-row update, and the
  repository raises.
- **The retained failed entry is self-describing** — its reason is on it.
- **The attempt history is complete and uncorrupted.** Append-only, and
  it records successes as well as failures.
- **The `QUEUED → ACCEPTED | REJECTED` transition is the whole state
  machine**, and it is expressed in two SQL statements.

### Negative

- **The posting is not fully append-only**, so it does not follow the
  pattern of every other record in the product. A reader comparing the
  tables will notice, and the reason needs to be findable — which is what
  this ADR is for.
- **A correction to a posting cannot be made in place.** It would have to
  be a new posting with a new key, which means the old one stays
  `REJECTED` forever. That is DR-02's price, and it is the right one.
- **The repository raises on a double-resolution**, so a caller must
  handle an exception for what is logically a no-op. The alternative —
  returning a boolean — would make a double-accept look like a success.

### Risks

- **A future agent adds a general `update` to the posting repository**
  because the interface looks incomplete without one. That single method
  would make every quantity editable, and no behavioural test of the
  posting's *content* would catch it. *Mitigation*: this ADR, and the
  decision index's "Read when" points at exactly this.
- **A future agent adds an `updated_at` column** to make the row
  "traceable". It would then look reasonable to update it, and the
  guard would be relaxed to accommodate. *Mitigation*: the same index
  entry.
- **A future agent implements the transition with a read-then-write**
  instead of the guarded `UPDATE`, because the read-then-write reads more
  clearly. *Mitigation*: this ADR names the race window explicitly.

## Related

- **Stories**: 003-post-consumption-idempotently
- **Requirements**: FR-16, BRD DR-01, BRD DR-02, BRD IR-06, BRD IR-09,
  BRD FR-33
- **Previous ADRs**: ADR-006 (consumption as a separate append-only record
  — the same "the database enforces it" argument); ADR-023 (the ledger's
  primary key is the idempotency guarantee — the same argument applied to
  the key rather than to the transition); ADR-011 (link state is separate
  from device status — the counter-example this ADR avoids)
- **Standards**: `standards/tech-stack.md` § "Database" — append-only
  records and immutable confirmed records, with corrections written as new
  records
