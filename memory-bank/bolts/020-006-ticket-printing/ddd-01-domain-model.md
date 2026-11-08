---
stage: model
bolt: 020-006-ticket-printing
created: 2026-11-06T10:00:00Z
---

## Static Model: 006-ticket-printing (bolt 020)

### Entities

- **PrintJob** (extended): a print job gains the **reprint marking** — the
  reason, the reprinting actor, the actor's role, and the `reprintOf` link.

  The job is still **append-only**, and the marking is **part of the job's
  creation** — never a later edit.

- **AuditEntry**: the append-only record of a **privileged action** — the
  action, the actor, the actor's role, the subject, the reason and the
  time.

  **It is append-only in the strongest sense**: the repository has **no
  update path and no delete path**, so there is nothing to call that would
  mutate one. The story is explicit: *"The success criterion is a test
  asserting that no update or delete path exists on the repository, not a
  convention that callers remember."*

### Value Objects

| Value object | Shape | Rules |
|---|---|---|
| **AuditAction** | a bounded string | **Which** privileged action. The set is **derived from the BRD's own constraints** — tolerance override, manual scale reselection, calibration bypass, configuration change, reprint — and **not from an invented taxonomy**. |
| **AuditSubject** | a bounded string | **What** was acted upon. Here: the ticket and the original print job. |
| **ReprintReason** | a bounded string | The reason for the reprint. **Mandatory** — and a reprint without one is **refused at the request boundary**, not recorded as blank. |

### The reason is MANDATORY, and it is REFUSED — not recorded as blank

**The story is explicit, twice:**

> *"Given a reprint request with an empty or absent reason, When it is
> submitted, Then the request is refused and **no print job is created**."*

> *"The reason is **mandatory**. A reprint without one is refused at the
> request boundary, not merely recorded as blank."*

**And this is not merely a validation nicety — it is the requirement's
point:**

> *"The audit entry is written by the same append-only mechanism as every
> other privileged action, so the reason is queryable from the audit trail
> and from the export. This is our **FR-21** — privileged actions are
> recorded — and it is the reason the reprint's reason and actor are
> **mandatory rather than optional metadata**."*

**So the order is: the reason is checked BEFORE the job is created.** A
refused reprint leaves **no trace in the print jobs** — because no print was
attempted.

**And the reason is stored VERBATIM.** The story's edge case: *"The reason
contains non-Latin characters or is long → the reason is stored verbatim;
length is bounded by validation and **the bound is not enforced by
truncating the stored value**."*

### The reprint is a NEW JOB against the EXISTING ticket

**The story's first technical note:**

> *"The reprint is a **new print job against the existing ticket**, never a
> re-generation of the ticket. Regenerating would produce a new ticket
> identity and lose the link to the original print."*

**So the reprint never touches the ticket.** It creates a print job — and
that job points at the ticket it prints.

**And `reprintOf` points at the ORIGINAL TICKET**, not at the original
job. The acceptance criterion says so: *"`reprintOf` pointing at the
original ticket"*.

**And the edge case is precise about what "original" means:**

> *"A reprint is requested for a ticket whose original print failed → The
> reprint is still marked `isReprint` **because it is not the first print
> job for that ticket**; the original failed job remains in the trail."*

**So `isReprint` is not "the first print succeeded" — it is "this is not
the first print attempt for this ticket".** A ticket whose only print failed
has **no first print**, so the next attempt is a **reprint**.

**And that is consistent with bolt `019`'s rule** — the marking is a
property of the **request**, never of the count. Here the request carries a
**reason**, and a reason is what makes it a reprint.

### The marking appears in TWO places

**The story is explicit:**

> *"The marking must appear in two places: on the stored `PrintJob`
> (`isReprint`, `reprintOf`, `reason`) and **on the rendered artefact**, so
> a paper copy in the dyehouse is **self-identifying**."*

**And the rendered marking's WORDING comes from the locale bundle, not
from a literal in code.**

**So this bolt builds:**
1. the **stored** marking — `isReprint`, `reprintOf`, the reason, the
   actor, the actor's role;
2. the **rendered** marking — the artefact says it is a reprint.

**And the wording is configuration's** — story `005`'s business. So this
bolt asks the configuration for the marking's text, and does not write a
literal.

### A reprint is privileged, but does NOT require supervisor authentication

**This is the subtlety, and it is worth stating precisely:**

> *"A reprint is a privileged action but does **not** require supervisor
> authentication in this build — the BRD's supervisor-authentication
> requirement (BRD FR-35) names tolerance override, manual scale
> reselection and calibration bypass. **What a reprint requires is
> attribution and a reason.** The `actorRole` on the audit entry therefore
> records whoever pressed reprint, **which may be the operator**."*

**So the reprint needs:**
- an **operator session** — somebody is accountable;
- a **reason** — the justification;
- an **actor and their role** — the attribution.

**And it does NOT need a supervisor.** Inventing a supervisor requirement
here would be inventing a rule the BRD does not state — and the story puts
*"Deciding whether a reprint requires supervisor approval"* **out of scope**,
saying it is *"not a requirement in the BRD's set"*.

### The reprint changes NOTHING about the weighing

**The acceptance criterion:**

> *"Given a reprint of a ticket, When the reprint job is recorded, Then an
> append-only audit entry is written carrying the actor, the actor's role,
> the subject (the ticket and the original print job) and the reason."*

> *"Given a reprint has been produced, When the original ticket's weighing
> records are read, Then they are **unchanged** — a reprint never creates,
> alters or removes a weighing record (BRD FR-18, BRD DR-02, B-7)."*

**So the reprint path writes two things — a print job and an audit entry —
and touches nothing else.** The ticket is read; the records are not
reachable from here (bolt `019`'s structural guarantee, ADR-042).

### The audit entry is written BY THE UNIT THAT PERFORMS THE ACTION

**Story 004's technical note:**

> *"Audit entries are written by the units that perform the action (003 for
> overrides, 005 for configuration, **this unit for reprints**), each
> through **the same append-only API**, so the trail has one shape and one
> ordering."*

**So the audit trail is ONE mechanism with ONE shape, and this unit uses
it.** Bolt `020` builds the append-only API that story `004` will extend
with the query and export.

**And the entries carry a `sequence` alongside `occurredAt`** — *"so
ordering survives clock skew — the sequence is authoritative for order, the
timestamp for human reading."*

**And the sequence is MONOTONIC.** The story's edge case: *"Two privileged
actions occur within the same millisecond → they are ordered by the
monotonic sequence, not by timestamp."*

### Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **PrintJob** (extended) | the marking: `isReprint`, `reprintOf`, the reason, the actor, the actor's role | 1. The marking is set at **creation** — never edited. 2. `isReprint` is **`true`** exactly when a reason was supplied. 3. `reprintOf` points at the **original ticket**. 4. The reason is **verbatim** — never truncated. 5. It still never touches the weighing record (B-7). |
| **AuditEntry** | the action, the actor, the role, the subject, the reason, the time, the sequence | 1. **The reason is never empty.** 2. The **sequence is monotonic** and authoritative for order. 3. There is **no update path and no delete path**. 4. It is **append-only** in the database too — the triggers abort. 5. It is retained ≥ 5 years (DR-01). |

### Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **PrintReprinted** | A reprint was requested and the job created | `jobId`, `ticketId`, `actorId`, `reason` |
| **AuditEntryRecorded** | A privileged action was recorded | `sequence`, `action`, `actorId`, `subject`, `reason` |

### Domain Services

- **ReprintService**: validates the reason, creates the marked job, and
  records the audit entry.

### Repository Interfaces

| Repository | Entity | Methods | Persisted? |
|---|---|---|---|
| **PrintJobRepository** (bolt `019`) | `PrintJob` | `save`, `findById` | **Yes** — append-only |
| **AuditEntryRepository** | `AuditEntry` | `record(entry)`, `all()`, `filter(...)` | **Yes** — append-only, **no update, no delete** |

### Ubiquitous Language

- **Reprint** — a print of an existing ticket, carrying a reason.
- **First print** — a print with no reason. However many jobs precede it.
- **Original ticket** — the ticket the reprint prints. **Not** the first
  job.
- **Attribution** — who pressed reprint, and their role.
- **Privileged action** — one the BRD names: tolerance override, manual
  scale reselection, calibration bypass, configuration change, reprint.
- **Sequence** — the trail's authoritative order.

---

## Constraints carried into the Technical Design

1. **The reason is MANDATORY**, and an empty or absent one is **REFUSED at
   the request boundary** — with **no print job created**.
2. **The reason is stored VERBATIM** — the length bound is validated, never
   enforced by truncation.
3. **The reprint is a NEW print job against the EXISTING ticket** — never a
   re-generation, which would lose the link to the original print.
4. **`reprintOf` points at the original TICKET**, not at the original job.
5. **`isReprint` is `true` exactly when a reason was supplied** — and it is
   **`true` even when the ticket's only prior print FAILED**, because it is
   not the first print *attempt*.
6. **The marking appears in TWO places** — the stored job **and** the
   rendered artefact, so a paper copy is self-identifying.
7. **The rendered marking's WORDING comes from the configuration**, not
   from a literal in code.
8. **An operator session is required**, and the actor and their **role** are
   recorded — but **supervisor authentication is NOT required**, because the
   BRD's supervisor list does not name reprints (BRD FR-35).
9. **An audit entry is written** — with the actor, the role, the subject
   (the ticket and the original print job) and the reason.
10. **The audit repository has NO update path and NO delete path**, and the
    database's triggers abort both.
11. **The audit entry's sequence is MONOTONIC** and authoritative for order.
12. **The reprint changes NOTHING about the weighing** — the records are
    unchanged (B-7, BRD DR-02).
13. **Audit entries are retained ≥ 5 years** (BRD DR-01).

---

## The edge cases, answered

| Scenario | Where it is answered |
|----------|----------------------|
| A ticket is reprinted three times | **Three** reprint jobs, each `isReprint`, each with its own reason, actor and time, all pointing at the same original ticket |
| A reprint is requested for a ticket whose original print FAILED | Still `isReprint` — it is not the **first print job** for that ticket; the failed job remains in the trail |
| The reason has non-Latin characters, or is long | Stored **verbatim**; the bound is validated, never enforced by truncation |
| The reprint happens after the locale changed | The reason is stored **as entered**; the rendered marking uses the locale **in force at reprint time** |
| The operator signs out between requesting and completing | The job is attributed to the actor who **requested** it, by their identity **captured at request time** |

---

## Open points carried forward

- **The audit trail's query and export** — story `004`. This bolt builds
  the **append-only API** and the entry's shape; the query, the filter and
  the export come next.
- **The configuration** — story `005`. The rendered marking's **wording**
  comes from it, and the locale in force at reprint time.
- **The reporting** — story `006`.
- **The reprint control** — unit `007`.
