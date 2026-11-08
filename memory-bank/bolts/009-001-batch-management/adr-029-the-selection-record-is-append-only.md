---
bolt: 009-001-batch-management
created: 2026-11-05T15:05:00Z
status: accepted
---

# ADR-029: The selection record is append-only, and the active selection is the newest row

## Context

Unit `001-batch-management` must record the operator's choice of a batch:
**which** batch, **who** chose it, **when**, and **by what method**
(BRD FR-02, FR-34, FR-18).

The record has a second job beyond the audit trail. The workflow needs
*"the batch currently chosen"* — the selection that the topbar crumb shows,
the one the weighing session will run against — and that thing **changes**
when the operator chooses a different batch.

BRD DR-02 requires that records describing something that physically
happened are immutable. A selection is such a record: *"at 08:14:22,
operator OP-001 chose batch B-24187 by scanning its card"* is a fact about
the past, and it does not stop being true when a later selection supersedes
it.

So there are two requirements in tension: the record must be **immutable**,
and the workflow needs a **current** value. The unit brief says
*"Session-scoped; superseded on re-selection"*, and the story says *"the new
selection is recorded and supersedes the previous one; the crumb updates to
the newly selected batch"* — while also saying that the selection *"is
idempotent in effect — one active selection remains, with the latest method
and timestamp recorded"*.

Several shapes could satisfy that:

1. **A mutable row.** One row per batch, updated on every selection.
2. **A row with a `superseded_at` column.** A row per selection, with a
   later process stamping the moment it stopped being current.
3. **A row with an `is_active` flag.** A row per selection, with a flag
   flipped on the old one.
4. **An append-only table with no "current" column at all**, where the
   current selection is the newest row.

## Decision

**Make the selection table strictly append-only. Do not store "which
selection is active" — derive it as the newest row.**

1. **One table, `batch_selections`, with one row per act of choosing.** No
   `superseded_at`, no `is_active`, no `active_batch_id` pointer table.

2. **No `update` and no `delete` in the repository.** There is therefore
   nothing that *could* rewrite a selection. The immutability is enforced by
   the **absence of a path**, and additionally by **`BEFORE UPDATE` and
   `BEFORE DELETE` triggers that `RAISE(ABORT, ...)`** — the same mechanism
   unit 005's `link_transitions` uses.

3. **The active selection is `ORDER BY selected_at DESC, id DESC LIMIT 1`.**
   The ordering is **total** — `selected_at` alone is ambiguous when two
   selections land in the same millisecond, and "the latest" must have one
   answer. The `id` is the tie-breaker, exactly as unit 005's sync queue
   orders by `(queued_at, posting_id)`.

4. **The active selection is read from the record, never cached beside
   it.** There is no in-memory "current batch" field that could disagree
   with the table after a restart.

## Rationale

### Why the mutable shapes are rejected

Every shape that stores "which one is active" **mutates a historical
record**, or stores a second copy of a fact the record already contains.

`superseded_at` is the clearest case, and the precedent is ADR-006: the
identity unit's authorisation consumption was rejected as a `consumed_at`
column on the authorisation, precisely because *"a mutation of a historical
record"* — the moment a record stopped being current would be written by a
**later process**, at a **later time**, for reasons that have nothing to do
with the original act.

The same reasoning applies here with one extra sting: an `is_active` flag is
**worse** than `superseded_at`, because a flag is a boolean — one bit that
can be dropped, and a row with `is_active = 0` and no `superseded_at` says
*when it stopped* nothing at all. Two rows claiming to be active, or none
claiming to be active, are both states the database would happily hold.

### Why "the newest row" is not a loss

The only thing the mutable shapes carry that the append-only one does not is
the **identity of the current selection**, and the newest row gives it
exactly. `selected_at` is a timestamp of the act, and the act is the thing
the workflow cares about.

The subtlety is the **ordering**, and it is why this ADR specifies a total
order rather than "the most recent". A database's default order for a table
without `ORDER BY` is unspecified; "the latest row" without an explicit
`ORDER BY` is a **race**, and a race in the selection path means two
operators at two terminals can read two different "current" batches.

### Why the append-only shape is the *safer* one under failure

The mutable shapes have a failure mode the append-only one does not: a
**partially applied** update. If the process that supersedes the old
selection dies between "clear the old flag" and "set the new one", the
station is left with **no** active selection — and the operator's next
action (scan a card) is refused for a reason that has nothing to do with
their card.

The append-only shape cannot produce that state. The new row is written and
the old row is untouched; the "active" selection is whichever row is newest.
A crash before the write leaves the **previous** selection active, which is
the correct outcome — the operator's last choice is still the current one.

### Why the database enforces it, not just the repository

A repository with no update method is a **convention**. The triggers are a
**guarantee**: a direct `UPDATE batch_selections ...` from any future code
path — a migration script, a repair script, a future unit — aborts.

This is the same reasoning ADR-020 and ADR-006 applied, and the same
mechanism unit 005 already ships.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|---|---|---|---|
| **A mutable row per batch** | Simplest; one row per batch | Rewrites history; loses every earlier selection; a crash mid-update loses the choice entirely | **Rejected.** It contradicts BRD DR-02 outright, and it destroys the traceability the story asks for. |
| **`superseded_at` on each row** | The history *and* the current value in one table; explicit | A later process mutates an immutable record (ADR-006's exact rejection); a crash between the update and the insert can leave two active rows | **Rejected.** ADR-006 already decided this shape for the identity unit, and the reasoning is general. |
| **An `is_active` flag** | Cheap; one bit per row | One bit can be dropped; two rows can claim to be active; says nothing about *when* it stopped | **Rejected.** It is `superseded_at` with the useful half removed. |
| **A separate `active_selection` pointer table** | The current value is explicit; updating it is one row | A **second source of truth** for the same fact — the pointer and the newest row can disagree after a partial failure | **Rejected.** The same duplication ADR-021 rejected for the MES snapshot. |
| **An in-memory "current batch" beside the table** | Fast; no query | A **second source of truth**, and it is wrong after a restart | **Rejected.** A restart would lose the selection the operator made. |
| **Append-only, active = newest row** *(chosen)* | One source of truth; the history *is* the record; a crash leaves the previous selection active | Requires an explicit total order | **Chosen.** The cost is one `ORDER BY`. |

## Consequences

### Positive

- **The history and the current value are the same table.** There is one
  source of truth, and it cannot disagree with itself.
- **The immutability is enforced twice** — by the absence of an update path
  and by the database's triggers.
- **A partial failure is harmless.** A crash before the write leaves the
  previous selection active, which is the correct outcome.
- **The ordering is deterministic.** Two terminals reading the current
  selection get the same answer.
- **The unit 003 handoff is clean.** Unit 003 owns the weighing session and
  the resume semantics (CQ-02, CQ-03); it needs *"the current selection"*,
  and it gets it from one query.

### Negative

- **The table grows without bound.** Every selection is kept, including the
  ones that were superseded within seconds. A busy station writes a row per
  selection for the life of the database.
  *Mitigation:* the growth is tiny — a selection is a few hundred bytes —
  and BRD DR-01's five-year retention applies to it as it does to every
  other record. **Pruning is explicitly NOT implemented here**, because a
  pruning policy that deleted selections would destroy the very history
  DR-02 protects, and deciding that policy is FCI's.
- **Reading the current selection costs a query** rather than a field
  lookup. *Mitigation:* the table is indexed on `(selected_at DESC, id DESC)`
  and the read is one row.
- **A caller that wants "everything" gets everything.** There is no
  `active_only` flag on the repository, because a flag that is sometimes
  right is a flag that will be wrong.

### Risks

- **A future unit assumes "newest row" means "only row".** *Mitigation:* the
  repository exposes exactly two methods — `save` and `latest` — so no
  caller can accidentally treat the table as a single-row table. The unit
  brief and this ADR both say so.
- **Two selections in the same millisecond.** *Mitigation:* the total order
  includes the `id`, so the answer is deterministic. The tie-break is
  arbitrary but it is *defined*, which is what matters.
- **The queue's read and the selection's read diverge.** *Mitigation:* both
  go through the same port and the same reader, and there is one reader of
  the MES seam (ADR-028).

## Related

- **Stories**: 003-select-batch-and-record-identity
- **Requirements**: FR-2, FR-3 · BRD FR-02, FR-03, FR-34, DR-02 · NFR-16
- **Previous ADRs**: ADR-006 (consumption is a separate append-only record,
  not a flag on the authorisation — the direct precedent for rejecting
  `superseded_at`); ADR-021 (the snapshots are not persisted, and the
  duplication argument); ADR-024 (the posting's content is immutable, and
  only the state transition may move); ADR-028 (the station's own queue
  endpoint and the one reader of the seam)
