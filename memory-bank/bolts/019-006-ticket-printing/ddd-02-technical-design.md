---
stage: design
bolt: 019-006-ticket-printing
created: 2026-11-06T08:00:00Z
---

## Technical Design: 006-ticket-printing (bolt 019)

### Architecture Pattern

**Hexagonal (ports and adapters), with the seam owned by the consumer** — the
same shape as the previous units.

**And this unit's defining property is that it READS another unit's
records and never writes them.** The ticket is a read model over unit
`003`'s immutable weighing records.

### Layer Structure

```text
┌──────────────────────────────────────────────────────────────────┐
│ Presentation                                                     │
│   TicketController   POST /api/tickets     GET /api/tickets/:id  │
│   PrintJobController POST /api/tickets/:id/print                  │
│                       GET  /api/print-jobs/:id                    │
├──────────────────────────────────────────────────────────────────┤
│ Application                                                      │
│   GenerateTicket       the read model — idempotent               │
│   PrintTicket          the job's lifecycle, and the printer call │
├──────────────────────────────────────────────────────────────────┤
│ Domain                                                           │
│   Ticket               the batch's ticket — immutable             │
│   TicketLine           one confirmed component's line             │
│   PrintJob             one print attempt                         │
│   PrintJobState        QUEUED | PRINTING | DONE | FAILED          │
│   ToleranceOutcome     WITHIN_TOLERANCE | OUT_OF_TOLERANCE       │
│   TicketRepository     THE PORT                                   │
│   PrintJobRepository   THE PORT                                   │
│   PrinterPort          THE PORT                                   │
│   BatchIdentityPort    THE PORT (unit 001's batch identity)       │
├──────────────────────────────────────────────────────────────────┤
│ Infrastructure                                                   │
│   CompositionRoot           binds every port in ONE place        │
│   TicketDatabase            the tables and migrations            │
│   SqliteTicketRepository    append-only                          │
│   SqlitePrintJobRepository  append-only                          │
│   DummyPrinterAdapter       the training printer                 │
└──────────────────────────────────────────────────────────────────┘
```

### API Design

#### `POST /api/tickets` — generate the ticket

| Status | Meaning | Body |
|---|---|---|
| **201** | The ticket was generated | `{ ticket }` |
| **200** | The ticket already existed — **idempotent** | `{ ticket }` |
| **409** | The batch is not complete | `{ error: "BATCH_NOT_COMPLETE" }` |
| **401** | No operator session | `{ error: "UNAUTHENTICATED" }` |

**The `200` on a duplicate is the point.** A retry after an ambiguous
response returns the **existing** ticket rather than failing — which is
what "idempotent" means here.

#### `GET /api/tickets/:ticketId` — the ticket

`200` with the ticket, or `404`.

#### `POST /api/tickets/:ticketId/print` — print it

| Status | Meaning | Body |
|---|---|---|
| **201** | The print job was created and **completed** | `{ job }` |
| **201** | The print job was created and **failed** | `{ job }` — the failure is the job's state, not an error code |
| **404** | There is no such ticket | `{ error: "TICKET_NOT_FOUND" }` |
| **401** | No operator session | `{ error: "UNAUTHENTICATED" }` |

**AND THE FAILURE IS THE JOB'S STATE, NOT THE RESPONSE'S.** A printer that
is out of paper is a **job that failed**, and the operator needs the job —
its id, its error, its times — so they can reprint. A `500` would hide
exactly the thing they need to know.

#### `GET /api/print-jobs/:jobId` — the job's state

`200` with the job. **Retrievable while it is in flight**, so the UI can
show "printing" rather than a dead button.

### The ports

```ts
export interface PrinterPort {
  /** Print the ticket. A failure is a REJECTION, not a thrown error. */
  print(ticket: Ticket): Promise<PrintResult>;
}
```

**And the weighing records are read through unit `003`'s own repository** —
the same one bolt `018` read. The ticket's lines come from the records,
and the ticket **never writes to them**.

### The generation's guard

**A `UNIQUE` constraint on `tickets.session_id`.**

**And not a check-then-write** — for the same reason ADR-040 settled it
for the weighing record: a check-then-write is racy under concurrency, and
the race admits **two tickets**. The constraint is the guarantee.

**And a duplicate is not an error.** The insert's `UNIQUE` violation is
caught and the existing ticket is **read back and returned** — with a
`200`, not a `409`.

### The print job's order — the state is committed BEFORE the printer

```text
1. create the job in QUEUED     ← committed
2. move it to PRINTING           ← committed
3. call the printer
4. move it to DONE or FAILED     ← committed
```

**A crash between 2 and 3 leaves a `PRINTING` job** — a reconcilable
record that the attempt was in flight (BRD NFR-05, NFR-3).

**And the reverse — committing `DONE` after the printer answers — would
leave a crash looking like a success.** The `PRINTING` state is what
makes the ambiguity visible.

### B-7 — the print path touches the weighing record NOWHERE

**This is the unit's governing failure boundary, and it is structural.**

The print path:
1. **reads** the ticket,
2. **writes** the print job,
3. **calls** the printer.

**It never touches the weighing record** — the record is in unit `003`'s
table, and the print path has no repository for it. So a printer failure
**cannot** roll back, suppress or hide the confirmed weighing: there is
no path from the failure to the record.

**And the weighing write and the print are two operations with two
independent outcomes** — the story forbids wrapping them in one
transaction, and this design has no transaction that spans both.

### The lines' quantities — the records' OWN strings

**The ticket's line carries the record's own quantity string.** Not a
re-derivation, not a re-formatting, not a conversion.

**And the acceptance criterion is that the values are IDENTICAL** — so the
line's `actualQuantity` is the record's `actualQuantity`, the same string.

**And each line keeps its own unit** — no conversion at render time.

### The template is CONFIGURATION

**The template id comes from the configuration, and it is RECORDED on the
ticket.** The template's *content* is configuration's business — this
bolt does not render a layout and does not define one.

**And the recorded id means a reprint months later renders the same
template version it originally did.**

### The printer adapter — the Dummy Printer training contract

**The story is explicit:** *"The print adapter is the only component that
talks to the printer. In this build that is the Dummy Printer training
contract (`POST /api/tickets`); no real printer contract is invented
(BRD IR-16)."*

**And the ticket's physical format is NOT invented** — Q-11 and Q-12
remain open, and *"no story, test or seed data may assert a specific
physical label layout as fact."*

So the adapter's contract is a **success or a rejection**, and the
rejection carries a reason the operator can read.

### Data Model

#### `tickets` — one row per session

| Column | Type | Notes |
|---|---|---|
| `ticket_id` | `TEXT NOT NULL PRIMARY KEY` | A **uuid** |
| `session_id` | `TEXT NOT NULL` | The session it is for |
| `batch_id` | `TEXT NOT NULL` | The batch's identity |
| `order_ref` | `TEXT NOT NULL` | The MES's order reference |
| `machine_ref` | `TEXT NOT NULL` | The MES's machine reference |
| `shade_code` | `TEXT NOT NULL` | The shade |
| `operator_id` | `TEXT NOT NULL` | Who generated it |
| `generated_at` | `TEXT NOT NULL` | When — **captured** |
| `language` | `TEXT NOT NULL` | The language — **captured** |
| `template_id` | `TEXT NOT NULL` | The template — **captured** |
| `tolerance_outcome` | `TEXT NOT NULL` | `WITHIN_TOLERANCE` \| `OUT_OF_TOLERANCE` |
| `line_count` | `INTEGER NOT NULL` | How many lines |

**And the `UNIQUE` on `session_id`** — the idempotency guarantee.

#### `ticket_lines` — one row per confirmed component

| Column | Type | Notes |
|---|---|---|
| `line_id` | `TEXT NOT NULL PRIMARY KEY` | A **uuid** |
| `ticket_id` | `TEXT NOT NULL` | Its ticket |
| `sequence` | `INTEGER NOT NULL` | The **recipe's** order |
| `component_id` | `TEXT NOT NULL` | The component |
| `material_code` | `TEXT NOT NULL` | The material's code |
| `target_quantity` | `TEXT NOT NULL` | The target — **the record's own string** |
| `target_unit` | `TEXT NOT NULL` | Its unit — **the record's own** |
| `actual_quantity` | `TEXT NOT NULL` | The actual — **the record's own string** |
| `actual_unit` | `TEXT NOT NULL` | Its unit — **the record's own** |
| `lot_number` | `TEXT NULL` | The lot |
| `container_id` | `TEXT NULL` | The container |
| `scale_id` | `TEXT NOT NULL` | The device it was weighed on |
| `zone_at_confirm` | `TEXT NOT NULL` | The zone — `OVER` means an override |
| `operator_id` | `TEXT NOT NULL` | Who weighed it |
| `weighed_at` | `TEXT NOT NULL` | When |

**Every quantity is TEXT** — BRD NFR-16. And they are the **records' own
strings**, so the values are identical to the recorded weighing.

#### `print_jobs` — one row per attempt

| Column | Type | Notes |
|---|---|---|
| `job_id` | `TEXT NOT NULL PRIMARY KEY` | A **uuid** |
| `ticket_id` | `TEXT NOT NULL` | The ticket it prints |
| `state` | `TEXT NOT NULL CHECK (state IN ('QUEUED','PRINTING','DONE','FAILED'))` | The lifecycle |
| `is_reprint` | `INTEGER NOT NULL` | From the **request's** reason |
| `reprint_of` | `TEXT NULL` | Reserved for story `003` |
| `attempted_at` | `TEXT NOT NULL` | When the attempt started |
| `completed_at` | `TEXT NULL` | When it settled |
| `error` | `TEXT NULL` | On failure — **visible** |

**AND THE TRIGGERS REFUSE AN UPDATE OF A SETTLED JOB.** The story says
*"each attempt is a new row in the `QUEUED → PRINTING → DONE|FAILED`
lifecycle, and no attempt is edited after it settles."*

**But a `PRINTING` job IS updated** — it moves to `DONE` or `FAILED`. So
the trigger is on the **settled** states: a row in `DONE` or `FAILED` may
not be updated again.

### Security Design

| Concern | Approach |
|---|---|
| **Session** | Required (ADR-020). Generating and printing are the operator's acts. |
| **A client-supplied quantity** | There is **no** field for one. The lines carry the records' own values. |
| **A client-supplied tolerance outcome** | There is **no** field for it. It is computed from the lines' zones. |
| **A client-supplied operator** | There is **no** field for it. The operator comes from the session — and so does each line's operator. |
| **A client-supplied template** | There is **no** field for it. The template comes from the **configuration**, and it is recorded. |
| **A client-supplied batch or session** | There is **no** field for it. The ticket is for the session's batch. |
| **A client-supplied `isReprint`** | There is **no** field for it. It comes from the request's **reason** — and there is no reason field in this bolt, so every print here is a first print. |
| **The printer** | Reached only through the adapter, and its failure is a **value**. |

### NFR Implementation

| Requirement | Design approach |
|---|---|
| **B-7 / BRD FR-19 — a printer failure must never cost a weighing** | The print path has **no repository** for the weighing record — so it cannot roll it back. Two independent outcomes. |
| **NFR-3 / BRD NFR-05 — the job's state survives a power loss** | The `PRINTING` state is **committed before** the printer is called; `synchronous = FULL`. |
| **BRD FR-17 / FR-27 — exactly one ticket per session** | The `UNIQUE` on `session_id`, and a duplicate returns the existing ticket. |
| **NFR-2 / BRD NFR-16 — the quantities are identical and fixed-point** | The lines carry the records' **own strings**; every quantity column is `TEXT`. |
| **BRD FR-19 / FR-28** | The job carries its id, state, times and error; `isReprint` is from the request. |
| **BRD DR-01 / DR-02** | Tickets, lines and jobs are retained ≥ 5 years, and a settled job may not be edited. |

### Testing Plan

| Suite | What it proves |
|---|---|
| **Unit — the ticket** | The lines carry the records' **own** quantities; each keeps its own unit; the outcome is computed from the zones; an `OVER` line makes it `OUT_OF_TOLERANCE`. |
| **Unit — the job's lifecycle** | The state moves forward only; a `FAILED` job carries an error; `isReprint` is from the request, not the count. |
| **Integration — the generation** | The `201` carries the ticket and its lines; a **second** generation returns the **same** ticket with a `200`. |
| **Integration — the print** | The job is created, driven to `DONE`, and **retrievable by its id**; a failing printer gives a `FAILED` job with a visible error, and **the weighing record still exists**. |
| **Persistence** | The `UNIQUE` refuses a second ticket for a session; a settled job may not be updated. |
| **Security** | No session → `401`; a client-supplied quantity, outcome, operator or template is **dropped**; the print path never writes a record. |

### Open points carried forward

1. **The reprint reason** — story `003`. The `reprint_of` column is
   reserved.
2. **The audit trail** — story `004`.
3. **The configuration** — story `005`. The template id and the language
   come from it.
4. **The reporting** — story `006`.
5. **The physical format** — Q-11 and Q-12 remain open. **Not invented
   here.**
