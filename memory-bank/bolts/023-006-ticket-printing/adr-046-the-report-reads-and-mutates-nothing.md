---
bolt: 023-006-ticket-printing
created: 2026-11-06T18:00:00Z
status: accepted
---

# ADR-046: The report READS the recorded zone and MUTATES NOTHING — including its own audit trail

## Context

Bolt `023` is the operational report: the tolerance failures and the
supervisor-authorised overrides over a period, plus the batch weighing
progress.

**The story has two unusual demands, and both are about what the report
must NOT do.**

**The first: the report is never re-derived.**

> *"The report is never re-derived from the recipe. The tolerance outcome
> is read from the **zone recorded at confirmation** on the weighing record
> (BRD FR-18), not recomputed from the current recipe and the current
> tolerance configuration. **A recipe or tolerance revision after the fact
> must not change what the report says happened.** This is the same
> immutability principle as BRD FR-18 and BRD DR-02, and it is **the reason
> the report is trustworthy after a configuration change**."*

**The second: the report writes nothing at all.**

> *"A report request must not create, update or delete a record of any
> kind, **including a 'report generated' audit entry** — **the report is
> not a privileged action**."*

**And this bolt is not built in a vacuum.** Bolt `022` just made the
configuration **versioned**, and a tolerance override there is *"ultimately
a way to make an out-of-tolerance weight acceptable"*. So the product now
**can** change what a weighing means — which is exactly what makes the
first demand load-bearing.

## Decision

**The report READS the recorded zone, and it MUTATES NOTHING — not the
records, not the trail, not the configuration, and not its own
"report generated" entry.**

1. **The tolerance outcome is the record's `zoneAtConfirm`** — read, never
   recomputed. The recipe and the configuration are **not consulted**.

2. **The report's collaborators are the READ sides only**, and **there is
   no `record` call anywhere in its path.** The absence is structural.

3. **The report publishes NO event** — because a subscriber would write.

4. **A zero period is a VALID report** — zero counts, empty rows, the
   progress still reported, and a `200`.

5. **An override row JOINS the audit entry to the weighing** — the entry
   carries the actor, the role, the reason and the time; the weighing
   carries the subject.

6. **Two overrides on one subject are TWO rows**, and a correction and its
   original are **both** visible.

7. **The report is a SUPERVISOR's act**, and the role comes from the
   session.

## Rationale

### Why the zone is READ, and never recomputed

**Because a report that recomputes is a report that rewrites history every
time a configuration changes.**

Consider the obvious implementation, and think about what it does six weeks
later:

```ts
// WRONG — re-derives the tolerance from TODAY's recipe and TODAY's
// configuration.
const zone = evaluate(
  record.actualQuantity,
  currentRecipe.targetFor(record.componentId),
  currentTolerance.bandFor(record.componentId),
);
```

**Now a supervisor changes the tolerance.** The configuration's version
becomes 2 — and **every historical weighing is silently re-judged**. A
weighing that was `OVER` becomes `OK`, because today's band is wider. The
report now says there were **no failures**, in a period where there were
several, and it says so **with the same confidence** as it would have said
the opposite.

**And that is the specific failure the story names:**

> *"The period spans a configuration change to a tolerance override rule →
> Weighings are reported against the zone recorded at their confirmation
> time, not against the configuration in force during the report period."*

**So the zone is read from the record** — the zone the gate computed at
confirmation, from the band that was in force at that moment (bolt `014`
snapshots the band onto the record for exactly this reason).

**And this is not a subtlety — it is the report's entire value.** A report
that says what the station *believes now* about a weighing is a
*recalculation*; a report that says what the station *decided then* is
**evidence**. And a dispute is settled by evidence.

**Note the parallel with the ticket.** Bolt `019` made the ticket's lines
carry the records' **own** quantity strings, and ADR-042 explained why: a
*line* is a reproduction of one weighing. **A report row is the same kind
of thing** — a reproduction of a weighing that happened — and so it holds
the same rule.

### Why the report writes NOTHING — including its own audit entry

**Because "a report was generated" is not an act worth recording, and
recording it would make the report a write.**

The obvious way to build an auditable report is to write a row saying
"a supervisor asked for the report at 09:41". **And that is exactly what
the story forbids:**

> *"A report request must not create, update or delete a record of any
> kind, **including a 'report generated' audit entry** — **the report is not
> a privileged action**."*

**Why does that matter?** Because a report is **read** often and **decided**
rarely. A supervisor checking the exception history is not making a
decision that alters anything — they are *looking*. **And a trail full of
"report requested" entries drowns the entries that matter**: the
overrides, the configuration changes, the refusals. **The trail's value is
its signal, and a report request is noise in it.**

**And the guard is structural.** The report's collaborators are the
**read** sides of the records and the trail. Its use case calls
`between`, `filter` and `progressFor` — and **never** `record`. So there
is nothing to call.

**And it publishes no event either** — and that is worth stating, because
"publish an event" is the usual way a read model announces itself. **A
report that published an event would need a subscriber, and the subscriber
would write.** So the report publishes nothing, and the trail stays a
record of *privileged actions* — which is what it is for.

### Why a zero period is a VALID report

**Because the absence of a failure is itself a finding.**

The story says it twice, and the repetition is the point:

> *"the report returns a **count of zero for both** and does **not** return
> an error."*

> *"A zero-failure period is a valid, meaningful result — **the absence of a
> failure is itself reportable** — and must not be reported as an error or
> an empty-but-broken response."*

**And the operational reason is specific.** A supervisor asks for
yesterday's failures. If yesterday had none, **the answer is "none"** — and
that is a *reassuring* answer that they need to be able to distinguish
from "the report is broken". **An error would leave them unable to tell
the difference between a quiet period and a broken query** — and the
report's whole purpose is to be trustworthy about what did NOT happen.

**So the report's SHAPE does not change when there is nothing to report.**
The counts are zero, the rows are empty, the progress is still there, and
the status is `200`.

### Why an override row JOINS the audit entry to the weighing

**Because the audit entry alone cannot answer the question the row asks.**

The audit entry carries the **actor**, the **role**, the **reason** and the
**time**. The weighing carries the **subject weighed** — which component,
which batch, how much.

**And the story is explicit that the entry alone is not enough:**

> *"The report joins those audit entries to the weighing record they refer
> to; **the audit entry alone is not sufficient, because the subject is what
> makes the row meaningful**."*

**A row that says "OP-SUP-001 authorised an override, because the client
accepted the excess, at 09:41"** is not reportable on its own — the reader
needs to know *what* was authorised. And that is on the weighing.

**And the join is on the entry's SUBJECT**, which names the component and
the session. So the trail and the records are joined by the fact they
share, not by a foreign key invented for reporting.

### Why two overrides on one subject are TWO rows

**Because they were two distinct acts by two distinct people, and a report
that merged them would misrepresent both.**

The story: *"Two overrides refer to the same subject → Both appear as
separate rows, each with its own actor, reason and time."*

**And the same principle for corrections:**

> *"An override's subject weighing was later corrected by a new record →
> Both the original and the correcting record are visible through their
> reference, and **the report does not merge or overwrite either**."*

**So the report does not tidy.** It does not group, does not deduplicate,
and does not resolve. **A report's job is to say what happened, and tidying
is an interpretation** — and an interpretation of an exception history is
exactly the thing an auditor would have to unpick.

### Why the report is a SUPERVISOR's act

**Because its content is the exception history — the failures and the
overrides the supervisors themselves authorised.**

**And it is the same reasoning as ADR-044's for the audit trail**, and for
the same reason: this is the record of what went wrong and who let it
through, and that is a supervisor's business, not an operator's.

**And the report's role check is the session's operator's `isSupervisor()`** —
never a request field.

## Consequences

### Positive

- **The report says what the station DECIDED THEN** — so it is evidence,
  and it survives every configuration change.
- **The report cannot alter history** — not by accident, not by design,
  and not by writing a "report generated" entry that would itself be a
  record.
- **The trail stays signal** — it records privileged actions, not reads.
- **A quiet period is reported as quiet** — distinguishably, and with
  confidence.
- **Each override is its own row** — with its own actor, reason and time.
- **The report is a read model** — so a dashboard can consume it later
  without a second implementation.

### Negative

- **The report needs a period-scoped read** — so unit `003`'s record
  repository gains `between(from, to)`. A small addition to another
  unit's port, and it is a **read**.
- **The report cannot be "signed".** There is no artefact saying who
  asked for it. That is the price of *"the report is not a privileged
  action"*, and it is paid deliberately.
- **The report's content is fixed at what the records say** — so a report
  requested after a correction shows both records, and a reader must see
  the reference. That is the truth, not a defect.

### Risks

- **A future agent recomputes the tolerance** "because the configuration
  changed and the report looks stale". *Mitigation*: the decision index's
  "Read when" points here; a recomputed report rewrites history every time
  a configuration changes, and that is the failure the story names.
- **A future agent writes a "report generated" audit entry** "so the request
  is traceable". *Mitigation*: the same index entry; the report is not a
  privileged action, and the entry would be noise in the trail.
- **A future agent publishes a report event** so the UI can react.
  *Mitigation*: the same index entry; a subscriber would write, and the
  report's whole guarantee is that it does not.

## Related

- **Stories**: `006-report-on-tolerance-failures-and-overrides`
- **Requirements**: FR-21, FR-23 · BRD FR-18, FR-22, FR-23, BR-25, BR-02
  · DR-02
- **Previous ADRs**: ADR-045 (the configuration is versioned, and an
  override is appended to the weighing record — the change that makes a
  recomputed report wrong); ADR-044 (the trail is a supervisor's record —
  the same role check, for the same reason); ADR-042 (the ticket's lines
  carry the records' own values — the same "a reproduction is not a
  recalculation" rule, applied to a report row); ADR-034 (the station's own
  facts are durable, and a record is immutable — the records this report
  reads); ADR-028 (the station owns its own facts — the batch progress is
  the station's, not the MES's)
- **Standards**: `standards/tech-stack.md` § "Database" — append-only rows
  for acts, and read models computed rather than stored
