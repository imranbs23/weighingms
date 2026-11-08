---
stage: model
bolt: 023-006-ticket-printing
created: 2026-11-06T17:20:00Z
---

## Static Model: 006-ticket-printing (bolt 023)

### Entities

- **ToleranceReport**: the report over a period — the period, the failure
  count, the override count, the failure rows, the override rows, and the
  batch progress.

  It is a **read model**, and it is **not stored**. It is computed from
  the immutable records and the append-only trail, and it **mutates
  nothing**.

### Value Objects

| Value object | Shape | Rules |
|---|---|---|
| **ReportPeriod** | `from` + `to` | The period. **An input to the query, not a stored snapshot** — because nothing is snapshotted: the records are already immutable. |
| **ToleranceFailureRow** | the subject weighed, the zone, the quantity, the operator, the time | One weighing whose **recorded** zone was not `OK`. |
| **OverrideRow** | the subject weighed, the actor, the role, the reason, the time | One **supervisor-authorised** override, joined to the weighing it refers to. |
| **BatchProgress** | the batch, the count, the state | The batch weighing progress for the period — so a supervisor can see where batches are without visiting the station (BRD BR-22). |

### THE REPORT IS NEVER RE-DERIVED FROM THE RECIPE

**This is the story's sharpest technical note, and it is the report's whole
trustworthiness:**

> *"The report is never re-derived from the recipe. The tolerance outcome is
> read from the **zone recorded at confirmation** on the weighing record
> (BRD FR-18), not recomputed from the current recipe and the current
> tolerance configuration. **A recipe or tolerance revision after the fact
> must not change what the report says happened.** This is the same
> immutability principle as BRD FR-18 and BRD DR-02, and it is **the reason
> the report is trustworthy after a configuration change**."*

**So the report reads `zoneAtConfirm`** — the zone the record carries — and
**never** recomputes it from the recipe's target and the tolerance in
force.

**And bolt `022` is what makes this matter.** The configuration is
versioned and a tolerance override can change what a weighing means. **So
a report that recomputed the tolerance would tell a different story after
every configuration change** — and the story's edge case is explicit:

> *"The period spans a configuration change to a tolerance override rule →
> Weighings are reported against the zone recorded at their confirmation
> time, not against the configuration in force during the report period."*

**So the zone is read, and the configuration is not consulted at all.**

### A ZERO period is a MEANINGFUL result

**The story, twice:**

> *"Given a specified period in which no tolerance failure and no override
> occurred, When the report is requested, Then the report returns a **count
> of zero for both** and does **not** return an error."*

> *"A zero-failure period is a valid, meaningful result — **the absence of a
> failure is itself reportable** — and must not be reported as an error or
> an empty-but-broken response."*

**And the edge case:** *"the period predates any recorded weighing → the
report returns zero counts and no error."*

**So the report's shape does not change when there is nothing to report.**
The counts are zero, the rows are empty, and the batch progress is still
there. **The report is a report either way** — an empty report is not a
broken one.

### The report MUTATES NOTHING — including its own audit trail

**The story is emphatic:**

> *"A report request must not create, update or delete a record of any
> kind, **including a 'report generated' audit entry** — **the report is not
> a privileged action**."*

**And the acceptance criterion:** *"no weighing record, audit entry or
configuration value has been created, updated or deleted by the request."*

**That last clause is worth reading twice**, because the obvious way to
build a report is to write a row saying "a report was generated" — and
that would be an audit entry created **by a read**.

**So the report path has no write at all.** Not the records, not the
trail, not the configuration. And structurally: the report's collaborators
are the **read** sides of the records and the trail, and the report's own
use case never calls `record`.

### "Overrides" means SUPERVISOR-AUTHORISED overrides, JOINED to the weighing

**The story is precise:**

> *"'Overrides' in this report means **supervisor-authorised overrides**,
> which are the entries in the audit trail where a supervisor authorised an
> out-of-tolerance over-dose. **The report joins those audit entries to the
> weighing record they refer to**; the audit entry alone is not sufficient,
> because **the subject is what makes the row meaningful**."*

**So an override row needs BOTH:** the audit entry (the actor, the role,
the reason, the time) **and** the weighing it refers to (the subject
weighed).

**And the audit entry's SUBJECT is what carries the link** — it names the
component and the session. So the join is on the subject.

**And a print failure is NOT a tolerance failure:**

> *"A period contains a failed print but no tolerance failure → A print
> failure is not a tolerance failure and does not appear in this report."*

**So the report reads the weighing records' zones and the trail's
override entries — and nothing else.** A print job is not a weighing, and
it is not an override.

### Two overrides on the same subject are TWO rows

**The story's edge case:** *"Two overrides refer to the same subject → Both
appear as separate rows, each with its own actor, reason and time."*

**So the report does not group, and does not merge.** Each override is its
own row — because each was a distinct act by a distinct person.

**And the same principle for corrections:**

> *"An override's subject weighing was later corrected by a new record →
> Both the original and the correcting record are visible through their
> reference, and **the report does not merge or overwrite either**."*

**So the report reports what happened, and does not tidy it up.**

### The report is a SUPERVISOR's act

**The story's actor is *"a dyehouse supervisor"*, and the content is the
exception history** — the tolerance failures and the overrides the
supervisors themselves authorised.

**So the read is supervisor-gated**, exactly as the trail's read is
(ADR-044) — and for the same reason: this is the record of what went
wrong and who let it through.

**And the report's period is a SELECTION, not content** — the same rule
the audit query followed.

### The period may be a date range OR A NAMED SHIFT

**The acceptance criterion:** *"Given a specified period (a date range **or
a named shift**)"*.

**So the period has two forms**, and the named shift is a **resolution** of
the range — the shift's start and end.

**And the shift is a CONFIGURATION value** — the station's shift pattern. So
a named shift resolves to a range, and **the report's query is the same
query either way**. One implementation, two ways of naming the period.

### The batch progress comes from the STATION's own batches

**The acceptance criterion:** *"the report also states the **batch weighing
progress** for that period, so a supervisor can see where batches are
without visiting the station (FR-23, BRD FR-23, BRD BR-22)."*

**And the progress is the STATION's own** — unit `001`'s batch queue and
unit `003`'s sessions. The MES's own status is not the report's subject;
**where the station's batches ARE** is.

### Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **ToleranceReport** | the period, the counts, the rows, the progress | 1. Every row is derived from the **immutable records** and the **append-only trail** — never re-derived from the recipe. 2. The tolerance outcome is the **recorded** zone. 3. A zero period is a **valid** report, not an error. 4. It **mutates nothing** — not the records, not the trail, not the configuration. 5. Two overrides on one subject are **two rows**. |

### Domain Events

**None.** The report is not a privileged action, and it does not write an
audit entry — so it publishes **nothing**.

**And that is worth stating as a decision, because "publish an event" is
the usual way a read model announces itself.** A report that published an
event would need a subscriber, and the subscriber would write — and the
report would then be creating a record, which the story forbids.

### Domain Services

- **ToleranceReportService**: the report — the period, the rows, the
  counts, the progress.

### Repository Interfaces

| Repository | Entity | Methods | Persisted? |
|---|---|---|---|
| **WeighingRecordRepository** (unit 003) | `WeighingRecord` | `between(from, to)` | **Yes** — **read** |
| **AuditEntryRepository** (bolt 020) | `AuditEntry` | `filter(...)` | **Yes** — **read** |
| **BatchProgressPort** | — | `progressFor(period)` | **Read** — unit 001's and unit 003's |

### Ubiquitous Language

- **The report** — the read model over a period.
- **A failure** — a weighing whose recorded zone was not `OK`.
- **An override** — a supervisor-authorised exception, joined to its weighing.
- **The period** — a range, or a named shift resolved to one.
- **Progress** — where the station's batches are.

---

## Constraints carried into the Technical Design

1. **Every row is derived from the immutable records and the append-only
   trail** — never by re-deriving the tolerance from the recipe.
2. **The tolerance outcome is the RECORDED zone** — a recipe or
   configuration revision after the fact does not change the report.
3. **A zero period is a VALID report** — zero counts, empty rows, **no
   error**, and the progress still reported.
4. **The report MUTATES NOTHING** — not the records, not the trail, not
   the configuration, **and not its own "report generated" entry**.
5. **An override row joins the audit entry to the weighing** — the subject
   is what makes the row meaningful.
6. **A print failure is NOT a tolerance failure** and does not appear.
7. **Two overrides on one subject are TWO rows** — the report does not
   merge or overwrite.
8. **A correction and its original are BOTH visible** — the report does
   not tidy.
9. **The report is a SUPERVISOR's act**, and the role comes from the
   session.
10. **The period is a SELECTION** — a date range, or a named shift
    resolved to one. **One query, two ways of naming the period.**
11. **The report publishes NOTHING** — it is not a privileged action.

---

## The edge cases, answered

| Scenario | Where it is answered |
|----------|----------------------|
| The period contains only weighings **within** tolerance | Zero failures, zero overrides — and the progress **still reported** |
| The period contains a **failed print** but no tolerance failure | The print failure **does not appear** — it is not a tolerance failure |
| An override's subject weighing was later **corrected** | Both the original and the correction are visible; **neither is merged nor overwritten** |
| The period **spans a configuration change** | Weighings are reported against the zone **recorded at their confirmation time** |
| The period **predates any recorded weighing** | Zero counts and **no error** |
| Two overrides refer to the **same subject** | **Both** appear as separate rows, each with its own actor, reason and time |

---

## Open points carried forward

- **The supervisor's on-screen progress view** — unit `007`. The report is
  the query; the screen is the presentation.
- **A dashboard or a BI export** — **CQ-07 is explicitly NOT answered by
  this story**, and it is *"a new outbound flow, not a new context"*. A
  future dashboard is a **consumer** of this read model.
- **The weighing-history search** — BRD FR-18, unit 003, and out of scope
  here.
- **The presentation format** — *"not specified by any requirement and is
  therefore left to the consumer"*. This story fixes the query, the
  semantics and the zero case, **not the rendering**.
