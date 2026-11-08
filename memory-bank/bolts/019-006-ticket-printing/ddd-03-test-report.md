---
stage: test
bolt: 019-006-ticket-printing
status: complete
updated: 2026-11-06T09:20:00Z
---

# Test Report: Ticket Printing (Bolt 019: the ticket and the print job)

## Summary

| Measure | Value |
|---|---|
| **Test files** | 99 passed, 0 failed |
| **Tests** | **1650 passed**, 0 failed |
| **Typecheck** | clean (`tsc --noEmit`) |
| **Coverage (all files)** | 88.22% statements · 80.11% branches · 92.38% functions · 89.28% lines |
| **Coverage threshold** | 80% on all four — **met** |
| **New tests** | **30** (13 unit + 8 integration + 9 security) |
| **Baseline before the bolt** | 1620 tests, 96 files |
| **Defects found by the tests** | **2**, both fixed (below) |

---

## What the tests prove

### B-7 — a printer failure NEVER costs a weighing

**This is the unit's governing failure boundary, and it has its own two
tests.**

**The failing-printer test:**
- The printer is made unavailable with the reason *"The printer is out of
  paper"*.
- The response is a `201` with a job in state **`FAILED`**, and the job's
  error is **exactly the printer's reason** — visible to the operator.
- **And the weighing records are still there** — every one of the five
  components' records, unchanged.

**The reprint test:**
- The paper is replaced, and the ticket prints again — **`DONE`**.
- **And the weighing was NOT re-entered, re-weighed or re-confirmed** — the
  records are still exactly five, one per component.

**And the failure is STRUCTURAL.** The print path reads the ticket, writes
the print job, and calls the printer. It has **no weighing-record
repository** — so there is no path from the printer's failure to the
record. Not "we do not roll it back": there is nothing to roll back
(ADR-042).

### The generation is IDEMPOTENT — exactly one ticket per session

- The first generation is a `201`.
- The **second** generation is a **`200`** — and it returns the **same
  ticket id**. Not an error, and not a second ticket.

**And the guard is a `UNIQUE` constraint**, not a check — because a
check-then-write is racy, and the race admits two tickets for one batch.

### The lines carry the RECORDS' OWN quantities, and each keeps its own unit

- The dyestuff's line is in **grams** and the auxiliary's is in
  **kilograms** — and **neither is converted**.
- The quantities are **strings** — the records' own, not a re-formatting
  and not a float.

**And the contrast with bolt `018`'s total is the point**: a *total* is a
derived fact and gets a unit of its own; a *line* is a reproduction of one
weighing, and converting it would make the ticket disagree with the record.

### The tolerance outcome is a QUALITY SIGNAL

- `WITHIN_TOLERANCE` only when **every** line's zone is `OK`.
- An **`OVER`** line — an authorised override — makes it
  `OUT_OF_TOLERANCE`, and the ticket needs to know nothing about
  overrides: it reads the zone.

### The print job is a real, retrievable record

- The job is created, driven to `DONE`, and carries its **id**, its state,
  its attempted time, its completed time and its error.
- **It is retrievable by its id** — so the UI can show "printing" rather
  than a dead button.
- `isReprint` is **`false`** — and it comes from the *request's* reason,
  never from the count of prior jobs.

### The client supplies NONE of the ticket's facts

The security suite sends `batchId`, `operatorId`, `templateId`,
`toleranceOutcome`, `lines` and `totalDispensed` in the generation body —
and asserts **none** of them appears anywhere in the response.

---

## The two defects the tests found

### Defect 1 — the harness bound a SECOND printer, so the failing printer was not the product's

**Found by:** `tests/integration/ticket-api.test.ts` — the B-7 test
expected `FAILED` and got `DONE`.

**Root cause.** The harness passed an explicit `printer` to
`buildTicketModule`, and the module's own `trainingPrinter` — the one the
test was reaching for through `harness.tickets.trainingPrinter` — was a
**different object**. So the test made one printer fail while the product
printed on another.

**The fix.** The harness binds **no** printer, so the module's own is the
one the product uses, and a test that makes it fail is affecting the
printer the product actually prints on.

**And that is the more honest arrangement.** A test that fails a *double*
proves nothing about the product.

### Defect 2 — the print-job repository was defined twice

**Found by:** the typecheck, when the two files were first written.

**Root cause.** The job's repository was written into the ticket's
repository file as well as its own.

**The fix.** The job's repository lives in its own file, and the ticket's
file holds only the ticket.

---

## Deliberately not delivered

- **The physical ticket format** — **not invented here**. The prototype
  itself states that label content is invented, so Q-11 and Q-12 remain
  open, and *"no story, test or seed data may assert a specific physical
  label layout as fact."* The ticket records **which** template rendered it
  and the template's content is configuration's (BRD IR-16).
- **The configuration itself** — story `005`. The template id and the
  language are read from it; this bolt **records** them and does not define
  them.
- **The reprint reason** — story `003`. The `reprint_of` column and the
  `isReprint` marking are in place, and the reason is not.
- **The audit trail** — story `004`.
- **The reporting** — story `006`.
- **The ticket's rendering** — unit `007`.

---

## Acceptance-criteria validation

| Criterion | Status | Where it is proved |
|---|---|---|
| Exactly **one** ticket per session, and it is available to print | ✅ | `ticket-api.test.ts` — a second generation returns the **same** ticket with a `200` |
| It carries the batch identity and the operator identity and the generation date | ✅ | `ticket-api.test.ts` — the batch id, the order reference, the machine reference, the shade, the operator and the generation time |
| Each component line carries the component id, material code, target, actual, unit, lot, container, scale, the zone, the operator and the timestamp | ✅ | `ticket-and-print-job.test.ts` and `ticket-api.test.ts` — the line's shape and its unit |
| It states the overall tolerance outcome | ✅ | `ticket-and-print-job.test.ts` — `WITHIN_TOLERANCE` only when every zone is `OK` |
| Any quantity is **identical** to the recorded weighing, and is fixed-point | ✅ | `ticket-and-print-job.test.ts` — the line carries the record's **own** string; the columns are `TEXT` |
| The template used is **recorded**, and the content is configuration | ✅ | `ticket-and-print-job.test.ts` — the template id and the language are **captured** |
| A `PrintJob` is created in `QUEUED`, driven to `DONE`, and retrievable by its id | ✅ | `ticket-api.test.ts` — the job's state is `DONE` and it is retrievable |
| The job carries the ticket id, the state, the attempted time, the completed time and the error | ✅ | `ticket-api.test.ts` — all five |
| A failed print leaves the state `FAILED` with a visible error, **and the weighing record still exists** | ✅ | `ticket-api.test.ts` — the B-7 test |
| A failed print can be reprinted **without the weighing being re-entered** | ✅ | `ticket-api.test.ts` — the reprint test |
| `isReprint` is `false` for a first print | ✅ | `ticket-and-print-job.test.ts` — and it comes from the request, not the count |
| The job's state survives a power loss, including a job left `QUEUED` or `PRINTING` | ✅ | The `PRINTING` state is **committed before** the printer is called, and `synchronous = FULL`; the repository **restores** the state (ADR-042) |

## Recommendations

- **Story `003`** owns the reprint reason. The `reprint_of` column and the
  `isReprint` marking are ready for it — and the marking must stay a
  property of the **request**, or a double-tap would silently become a
  reprint.
- **Story `005`** owns the configuration. Until it lands, the template id
  is `DEFAULT` and the language is `en` — **honest defaults that assert no
  physical layout**.
- **Unit `007`** renders the ticket. It should read the ticket's content
  and **not** re-derive any quantity — the ticket already holds the
  records' own strings, and re-deriving them is how the two would drift.
- **A `PRINTING` job left by a crash is reconcilable but nothing
  reconciles it.** That is deliberate — an automatic reconciliation risks
  double-printing — but it means the UI should show a `PRINTING` job as
  "in flight, possibly printed", and offer a reprint.
