---
stage: model
bolt: 019-006-ticket-printing
created: 2026-11-06T07:40:00Z
---

## Static Model: 006-ticket-printing (bolt 019)

### Entities

- **Ticket**: the batch's weighing ticket — the batch identity, the
  operator identity, the generation moment, the language, the template id,
  the tolerance outcome, and the component lines.

  It is a **read model over the immutable weighing records**, not a second
  copy of the truth. But it **is** a record of its own act — the
  generation — so it is **immutable** and **retained** ≥ 5 years
  (BRD DR-01, DR-02).

- **TicketLine**: one confirmed component's line — the component id, the
  material code, the target, the actual, the unit, the lot, the container,
  the scale, the zone at confirmation, the operator and the timestamp.

  Also immutable, and also a record.

- **PrintJob**: one print attempt — the ticket id, the state, the
  attempted time, the completed time, the error on failure, and whether it
  is a reprint.

  It is **append-only in practice**: each attempt is a new row, and no
  attempt is edited after it settles.

### Value Objects

| Value object | Shape | Rules |
|---|---|---|
| **PrintJobState** | `QUEUED` \| `PRINTING` \| `DONE` \| `FAILED` | The lifecycle. A **closed set of four**, and the transitions are one-directional. |
| **ToleranceOutcome** | `WITHIN_TOLERANCE` \| `OUT_OF_TOLERANCE` | The batch's overall outcome. **Two values** — and it is the ticket's, computed from the lines' zones. |
| **TicketTemplateId** | a bounded string | Which template rendered the ticket. **Recorded on the ticket**, so a reprint months later renders the same template version it originally did. |

### The ticket is a READ MODEL, not a copy of the truth

**This is the story's first technical note, and it decides the whole
shape:**

> *"The ticket is a **read model over the immutable weighing records**, not
> a second copy of the truth. It is rendered from `003-weighing-station`'s
> confirmed records plus the batch identity from `001-batch-management`."*

**And it matters for a specific reason: the quantities must be identical
to the recorded weighing.** The acceptance criteria say so directly:

> *"When any quantity on it is compared with the recorded weighing, Then the
> value is identical and is stored and rendered as a fixed-point decimal
> with no floating-point rounding (NFR-2, BRD NFR-16)."*

**So the ticket's lines carry the record's own quantities — the same
strings, not a re-derivation and not a re-formatting.** A ticket that
recomputed `94.2400 g` as `94.24` would not be identical, and a ticket
that re-summed would be a second truth.

**And the read model is computed ONCE, at generation.** It is then
immutable — so a reprint renders the same content.

### The template is CONFIGURATION, and it is recorded

**This is the sixth acceptance criterion, and it is unusual:**

> *"When the configured template identifier is read, Then the template used
> is recorded on the ticket, and the ticket content and layout are
> determined by configuration rather than by compiled code (BRD FR-17,
> BRD FR-22, BRD IR-16)."*

**And the story's technical note says why the physical format is not
invented here:**

> *"The ticket's physical format is not invented here. The prototype itself
> states that label content is invented (PROTO view 3), so AC-10 is not
> satisfiable in this build and Q-11/Q-12 remain open. The ticket carries
> the weighing record plus batch identity; the **format** — layout, fields
> rendered, symbology, printer language, paper size — is a configuration
> value. **No story, test or seed data may assert a specific physical
> label layout as fact.**"*

**So the ticket records WHICH template rendered it**, and the template's
content is configuration. The story's edge case:

> *"The template configured at generation time is later changed → the
> existing ticket retains its original `templateId` and content; only newly
> generated tickets use the new template."*

**And `Ticket.generatedAt`, `Ticket.language` and `Ticket.templateId` are
captured at generation time** — so a later locale or template change does
not alter an existing ticket.

### Generation is IDEMPOTENT — exactly one ticket per session

**The story's first acceptance criterion:** *"exactly one ticket is
generated for that session"*.

**And the edge case names the trigger:** *"a batch is completed twice (retry
after an ambiguous response) → exactly one ticket per session; generation
is idempotent and the existing ticket is returned."*

**So the generation is guarded by the session id** — and the guard is a
`UNIQUE` constraint, not a check-then-write, for the same reason ADR-040
settled it for the weighing record: **a check-then-write is racy, and the
race admits two tickets.**

**And a duplicate is not an error** — the existing ticket is **returned**.
That is what "idempotent" means here.

### B-7 — a printer failure must NEVER cost a weighing

**This is the governing failure boundary of the unit, and the story says so
in bold:**

> *"B-7 is the governing failure boundary of this unit: **a printer failure
> must never cost a weighing**. Recording a weighing and printing its
> ticket are therefore two operations with two independent outcomes. The
> implementation must never wrap the weighing write and the print call in a
> single transaction, and the failed-print path must not roll back, suppress
> or hide the confirmed weighing."*

**And the acceptance criterion is explicit:**

> *"the print job's state is `FAILED` with a visible error, **and the
> confirmed weighing record still exists and remains queryable** (BRD
> FR-19, B-7)."*

**And the edge case:**

> *"The printer is out of paper → Job ends `FAILED` with the error visible;
> the weighing is recorded; the ticket is offered for reprint."*

**So the print path touches the weighing record NOWHERE.** It reads the
ticket, it writes the job, and it calls the printer. The weighing record is
in a different unit and a different table, and the print failure cannot
reach it.

### The job's state is committed BEFORE the printer is called

**The story's technical note:**

> *"Power-loss durability: the state transition is committed before the
> printer call is made, so a crash mid-print leaves a `PRINTING` job that
> can be reconciled rather than no trace at all (NFR-3, BRD NFR-05)."*

**And the acceptance criterion:** *"the job's recorded state survives,
including a job left in `QUEUED` or `PRINTING`."*

**So the order is:**

```text
1. create the job in QUEUED       ← committed
2. move it to PRINTING             ← committed
3. call the printer
4. move it to DONE or FAILED       ← committed
```

**A crash between 2 and 3 leaves a `PRINTING` job** — which is
*reconcilable*, because it is a record that the attempt was in flight. A
crash before 1 leaves nothing, which is correct: no attempt was made.

**And the reverse — committing `DONE` after the printer answers — would
leave a crash looking like a success**, or a success looking like a
crash. The `PRINTING` state is what makes the ambiguity visible.

### The reprint marking is a property of the REQUEST, not of the count

**The story's edge case:**

> *"The ticket is printed twice by accident (double-tap) → two print jobs
> exist; the second is still a first print unless a reprint reason was
> supplied — the reprint marking is a property of the request, not of the
> count."*

**And the acceptance criterion:** *"Given a print job that completed, When
it is read, Then `isReprint` is `false` and the job is distinguishable
from a reprint (BRD FR-28)."*

**So `isReprint` comes from the request's own `reprintReason`** — and a
reprint reason is story `003`'s business. In this bolt, a print request
with **no** reason is a first print, however many jobs precede it.

**And a `reprintOf` field is reserved on the entity** — story `003`
populates it.

### Each line keeps its OWN unit

**The story's edge case:**

> *"A quantity is in kilograms and another in grams → Each line keeps its
> own unit; **no cross-unit conversion is performed at render time**."*

**And that is right** — because the ticket records **what was weighed**,
and the weighing was of 94.2400 g and 24.0100 kg. Converting them at
render time would make the ticket disagree with the record, and the
acceptance criterion says the values must be **identical**.

**Note the contrast with bolt `018`'s total.** The summary sums across
units, and it converts — because a total is one number. A ticket line is
a **record of one weighing**, and it keeps that weighing's own unit.

### Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **Ticket** | the identity, the lines, the outcome, the template, the language, the generation moment | 1. It is generated **once per session** — the guard is a `UNIQUE` constraint. 2. Its lines carry the records' **own** quantities, unchanged. 3. Each line keeps **its own unit** — no conversion at render time. 4. The template, the language and the generation moment are **captured at generation**. 5. It is **immutable** once generated. 6. Its outcome is computed from its lines' zones. |
| **PrintJob** | the ticket id, the state, the times, the error, the reprint marking | 1. The state moves **forward only**: `QUEUED → PRINTING → DONE\|FAILED`. 2. The `PRINTING` state is **committed before** the printer is called. 3. A `FAILED` job carries a **visible** error. 4. It **never** touches the weighing record. 5. It is append-only — no attempt is edited after it settles. |

### Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **TicketGenerated** | A batch's ticket was generated | `ticketId`, `sessionId`, `batchId`, `lineCount`, `templateId` |
| **PrintJobQueued** | A print was requested | `jobId`, `ticketId` |
| **PrintJobCompleted** | The printer accepted the ticket | `jobId`, `ticketId` |
| **PrintJobFailed** | The printer failed or was unavailable | `jobId`, `ticketId`, the error |

### Domain Services

- **TicketGenerator**: builds the ticket from the confirmed records and the
  batch identity. **Idempotent** — one per session.

- **PrintJobService**: drives the job through its lifecycle, and calls the
  printer.

### Repository Interfaces

| Repository | Entity | Methods | Persisted? |
|---|---|---|---|
| **TicketRepository** | `Ticket` | `save`, `findBySession`, `findById` | **Yes** — immutable, retained ≥ 5 years |
| **PrintJobRepository** | `PrintJob` | `save`, `findById` | **Yes** — append-only |
| **WeighingRecordRepository** (unit 003) | `WeighingRecord` | `latestFor` | **Yes** — **read** here, never written |
| **PrinterPort** | — | `print(ticket)` | The adapter's seam |

### Ubiquitous Language

- **Ticket** — the read model over a batch's confirmed weighings.
- **Line** — one component's entry on the ticket.
- **Template** — the configured format. Recorded, never invented.
- **Print job** — one print attempt.
- **First print** — a print with no reprint reason, whatever the count.
- **Reprint** — a print carrying a reason. Story `003`.
- **Out of tolerance** — at least one line's zone was not `OK`.

---

## Constraints carried into the Technical Design

1. **The ticket is a READ MODEL over the immutable records** — and it is
   generated **once per session**.
2. **The generation is guarded by a `UNIQUE` constraint** on the session
   id — and a duplicate **returns the existing ticket** rather than
   failing.
3. **The lines carry the records' OWN quantities** — identical strings, no
   re-derivation, no re-formatting.
4. **Each line keeps its OWN unit** — no cross-unit conversion at render
   time.
5. **The template id, the language and the generation moment are captured
   at generation** — and the template's content is **configuration**, not
   compiled code.
6. **NO physical layout is asserted.** No test, story or seed data may
   claim a specific label layout as fact (Q-11, Q-12, AC-10).
7. **The print path NEVER touches the weighing record** — and the print
   and the weighing are **two independent outcomes** (B-7).
8. **The `PRINTING` state is committed BEFORE the printer is called** — so a
   crash leaves a reconcilable job (BRD NFR-05).
9. **The job's state moves FORWARD ONLY** — `QUEUED → PRINTING → DONE` or
   `FAILED`.
10. **A `FAILED` job carries a visible error.**
11. **`isReprint` comes from the request's own reason** — never from the
    count of prior jobs.
12. **Tickets, lines and print jobs are retained ≥ 5 years** (BRD DR-01),
    and **none of them is edited after it settles** (DR-02).

---

## The edge cases, answered

| Scenario | Where it is answered |
|----------|----------------------|
| A batch is completed twice | **Idempotent** — the `UNIQUE` on the session, and the existing ticket is returned |
| The template is changed after generation | The ticket retains its original `templateId` and content; only new tickets use the new template |
| A component was abandoned and re-weighed | Only the **confirmed** record is a line; the abandoned attempt appears nowhere |
| A quantity is in kg and another in g | Each line keeps its own unit; no conversion at render time |
| The write-back failed | The ticket is still generated from the local records — the write-back is a separate concern |
| The printer is out of paper | The job ends `FAILED` with the error visible; **the weighing is recorded**; the ticket is offered for reprint |
| The operator retries a slow printer | Each attempt is its own job row; the duplicate does not duplicate the ticket or the weighing |
| Power is lost while the job is `PRINTING` | The job row remains `PRINTING` and is reconcilable; the weighing is unaffected |
| The ticket is printed twice by accident | Two jobs exist; the second is still a **first print** unless a reason was supplied |
| The ticket or template is removed after printing | The printed artefact is unaffected; the ticket and its lines are retained |

---

## Open points carried forward

- **The reprint reason** — story `003`. The `reprintOf` field is reserved
  here.
- **The audit trail** — story `004`, and unit 003's events are published
  for it.
- **The configuration** — story `005`. The template id and the language
  come from it; this bolt records them, it does not define them.
- **The reporting** — story `006`.
- **The physical format** — Q-11 and Q-12 remain open. **Not invented
  here.**
