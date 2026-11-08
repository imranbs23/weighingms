---
bolt: 019-006-ticket-printing
created: 2026-11-06T08:15:00Z
status: accepted
---

# ADR-042: The print path has no repository for the weighing record, and the job's state is committed before the printer is called

## Context

Bolt `019` generates a batch's weighing ticket and prints it. Two decisions
in it are the kind that are decided by accident and then lived with.

**The first: what happens when the printer fails.** The story is emphatic:

> *"B-7 is the governing failure boundary of this unit: **a printer failure
> must never cost a weighing**. Recording a weighing and printing its
> ticket are therefore two operations with two independent outcomes. The
> implementation must never wrap the weighing write and the print call in a
> single transaction, and the failed-print path must not roll back,
> suppress or hide the confirmed weighing."*

And the acceptance criterion:

> *"the print job's state is `FAILED` with a visible error, **and the
> confirmed weighing record still exists and remains queryable** (BRD
> FR-19, B-7)."*

**The second: the order of the state transitions.** The story's technical
note:

> *"Power-loss durability: the state transition is committed before the
> printer call is made, so a crash mid-print leaves a `PRINTING` job that
> can be reconciled rather than no trace at all (NFR-3, BRD NFR-05)."*

**And the ticket itself is a read model over unit `003`'s immutable
records** — *"not a second copy of the truth"*, with the quantities
**identical** to the recorded weighing.

## Decision

**The print path has NO repository for the weighing record — and the
`PRINTING` state is committed BEFORE the printer is called.**

1. **The print path reads the ticket, writes the print job, and calls the
   printer.** It has **no** weighing-record repository, so it **cannot**
   roll back, suppress or hide a confirmed weighing — there is no path
   from the printer's failure to the record.

2. **The weighing write and the print are two operations with two
   independent outcomes.** No transaction spans both.

3. **The order is `QUEUED` → `PRINTING` → `DONE|FAILED`,** and the
   transition to `PRINTING` is **committed before** the printer is called.

4. **The ticket's lines carry the records' OWN quantity strings** — each
   line keeps **its own unit**, and no conversion happens at render time.

5. **The ticket's generation is guarded by a `UNIQUE` constraint** on the
   session id, and a duplicate **returns the existing ticket**.

6. **A printer failure is the JOB's state, not the response's** — a `201`
   with a `FAILED` job, because the operator needs the job's id and its
   error to reprint.

## Rationale

### Why B-7 is enforced STRUCTURALLY, and not by care

**Because a printer failure that costs a weighing is unrecoverable, and
"be careful" is not a mechanism.**

Look at what is actually at stake. The weighing is the fact: 94.2400 g of
Remazol Yellow went into the container. The ticket is the **paperwork**
for it. So the failure modes are wildly asymmetric:

- **a lost ticket** — the operator prints again, and the reprint is a
  first-class operation with its own story;
- **a lost weighing** — the container is missing material that the MES
  has already been told about, and there is no record of it.

**So the design must make the second impossible, not merely unlikely.**

And the way to make it impossible is to give the print path **no way to
reach the record**:

```text
The print path:
  reads   the ticket          ← its own table
  writes  the print job       ← its own table
  calls   the printer         ← the adapter
```

**There is no weighing-record repository in that path.** So a printer
failure has **no path** to the record — not "we don't roll it back", but
"there is nothing to roll back". A transaction that spans both operations
would be the only way to couple them, and there isn't one.

**And this is the same reasoning as ADR-039 and ADR-041.** The pattern
across this product is that a *structural* absence — no repository, no
second implementation, one interface — enforces a rule that a
*disciplined* implementation would only enforce by convention. B-7 is a
requirement about what must **not** happen, and the cheapest way to
guarantee a "must not" is to remove the capability.

### Why `PRINTING` is committed BEFORE the printer is called

**Because the `PRINTING` state is the only evidence that an attempt was
in flight — and it has to be written before the attempt can be lost.**

The four orders, and what each leaves behind after a power cut:

| Order | After a crash mid-print | What the operator sees |
|---|---|---|
| `QUEUED` → call printer → `PRINTING` → `DONE` | The job is `QUEUED` | "Not started" — but the paper may have come out |
| `QUEUED` → `PRINTING` → call printer → `DONE` | The job is `PRINTING` | **"In flight"** — reconcilable |
| `QUEUED` → `PRINTING` → call printer → `DONE`, committed together | The job is `PRINTING` | **"In flight"** — reconcilable |
| `QUEUED` → call printer → `DONE` (one write) | The job is `QUEUED` | "Not started" — but the paper may have come out |

**The second and third rows are the only ones that tell the truth.** The
first and fourth both lose the fact that the printer was called, and the
paper may have come out of the printer.

**And the false "not started" is the dangerous one.** An operator seeing a
`QUEUED` job will press print again — which is harmless — but an
**automated** reconciliation that sees `QUEUED` and assumes "never
attempted" would **not** reprint, and the container would leave the
station with no ticket. The `PRINTING` state is what lets a reconciler
know the difference between "not attempted" and "attempted, outcome
unknown" — and those two need different actions.

**So the transition to `PRINTING` is committed before the call.** It costs
one extra write, and it buys the difference between a reconcilable
ambiguity and an invisible loss.

### Why the ticket's lines carry the records' OWN strings

**Because the acceptance criterion is that the values are IDENTICAL, and
identity is only guaranteed by not transforming.**

> *"When any quantity on it is compared with the recorded weighing, Then
> the value is identical and is stored and rendered as a fixed-point
> decimal with no floating-point rounding (NFR-2, BRD NFR-16)."*

**And there are three tempting transformations, and every one of them
breaks the identity:**

```ts
// WRONG — reformatting. 94.2400 becomes "94.24", which is not the
// recorded value.
line.actualQuantity = record.actualQuantity.toFixed(2);

// WRONG — a float. The record's exact decimal becomes an approximation.
line.actualQuantity = String(parseFloat(record.actualQuantity.text));

// WRONG — converting the unit so the ticket's lines agree with each
// other. 24.0100 kg becomes 24010.0000 g, and the ticket now DISAGREES
// with the record it claims to reproduce.
line.actualQuantity = convert(record.actualQuantity, 'g');
```

**The third is the subtlest, and it is worth being explicit about why it
is wrong — because bolt `018`'s summary *does* convert.**

The difference is what the number **is**:

| | Bolt 018's **total** | Bolt 019's **line** |
|---|---|---|
| What it is | a **derived** quantity — the sum of the weighings | a **reproduction** of one weighing |
| Its unit | chosen by the sum — kilograms | **the weighing's own** |
| Conversion | **required** — a sum needs one unit | **forbidden** — it would change the value |

**A total is a new fact, so it needs a unit of its own. A line is a copy
of a fact, so it must keep the fact's unit.** Converting a line's unit
would make the ticket disagree with the record — and the ticket's whole
purpose is to agree with the record.

**And the story says so in its own edge case:** *"Each line keeps its own
unit; no cross-unit conversion is performed at render time."*

### Why the generation is guarded by a constraint, and a duplicate RETURNS

**Because the ticket must be exactly one per session, and a check-then-write
is racy.**

The same argument as ADR-040: two concurrent completions would both pass
an existence check and both write a ticket. And two tickets for one batch
is worse than one — the operator does not know which to print, and the
reprint story's "which ticket?" question has no answer.

**So the guard is a `UNIQUE` constraint** on `tickets.session_id`.

**And a duplicate is not an error — it returns the existing ticket.** The
story's edge case names the trigger: *"a batch is completed twice (retry
after an ambiguous response) → exactly one ticket per session; generation
is idempotent and the existing ticket is returned."*

**So the response is a `200`, not a `409`.** A retry after an ambiguous
response must **succeed** — the caller cannot tell whether the first
attempt reached the server, so a `409` would make every retry look like a
failure, and the operator would have no way to know whether they have a
ticket.

### Why a printer failure is the JOB's state, not the response's

**Because the operator's next action needs the job, and a `500` hides it.**

When the printer is out of paper, what the operator needs is: *which job
failed, why, and can I print it again?* That is the **job**.

**So the response is a `201` with a `FAILED` job** — the job exists, it
failed, and it carries the error. A `500` would say "something went
wrong" and give them nothing to act on — and would make the failure look
like a *product* fault rather than a *printer* fault.

**And this is the same discipline as ADR-018's "a refusal is a value, not
an error"** — the printer's refusal is a legitimate, expected outcome of
a legitimate request, and the product reports it faithfully.

## Consequences

### Positive

- **A printer failure cannot cost a weighing** — structurally, because the
  print path has no way to reach the record.
- **A crash mid-print leaves a reconcilable job** — the `PRINTING` state
  distinguishes "attempted, outcome unknown" from "never attempted".
- **The ticket's quantities are identical to the recorded weighings** —
  because they are the same strings.
- **Exactly one ticket per session**, guaranteed atomically, and a retry
  succeeds.
- **The operator can always act on a failure** — the job carries the
  error.

### Negative

- **A print attempt costs three writes** instead of one — the `QUEUED`
  row, the `PRINTING` update, and the settle. That is the price of the
  reconcilable ambiguity, and it is cheap: a print is a rare act.
- **The `PRINTING` state needs a reconciler.** Nothing in this bolt
  reconciles it — and nothing should: a `PRINTING` job left behind by a
  crash is a fact for an operator or an operator-tool to see, and
  inventing an automatic reconciliation would risk double-printing.
- **The ticket cannot be corrected.** A wrong ticket is a reprint, not an
  edit — which is story `003`'s business, and which the immutability
  requires anyway (BRD DR-02).

### Risks

- **A future agent adds a weighing-record repository to the print path**
  "so the ticket can be re-read on demand". *Mitigation*: the decision
  index's "Read when" points here; that repository is the path by which a
  printer failure could cost a weighing, and the ticket already carries
  everything the print needs.
- **A future agent commits the job's final state before calling the
  printer** "so a slow printer does not hold a row". *Mitigation*: the
  same index entry; a `DONE` committed before the printer answers records
  a success that never happened.
- **A future agent converts the lines' units** "so the ticket's numbers
  agree with each other". *Mitigation*: the same index entry; a line is a
  reproduction of one weighing, and a total is the only thing that gets a
  unit of its own.

## Related

- **Stories**: `001-generate-weighing-ticket`, `002-print-ticket-and-track-job`
- **Requirements**: FR-17, FR-18, FR-19, FR-22, FR-27, FR-28 · BRD DR-01,
  DR-02 · NFR-2, NFR-3, NFR-5 · IR-16 · B-7
- **Previous ADRs**: ADR-040 (the record is written before the
  progression, and the duplicate is refused by a constraint — the same
  argument, applied to the ticket's one-per-session guard); ADR-041 (the
  write-back's outcome does not gate the completion, and the total sums
  across units — the contrast that explains why a *line* does not);
  ADR-039 (this bolt implements no mechanism of its own — the same rule,
  applied to the ticket's read model); ADR-034 (the station's own facts
  are durable and a record is immutable — the ticket and its lines);
  ADR-018 (a refusal is a value, not an error — the printer's refusal);
  ADR-030 (the method is derived, never supplied — the same discipline,
  applied to the template id)
- **Standards**: `standards/tech-stack.md` § "Database" — append-only rows
  for acts, fixed-point decimal for every quantity, and `synchronous =
  FULL` for durability
