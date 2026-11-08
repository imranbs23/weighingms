---
stage: design
bolt: 023-006-ticket-printing
created: 2026-11-06T17:40:00Z
---

## Technical Design: 006-ticket-printing (bolt 023)

### Architecture Pattern

**Hexagonal (ports and adapters), with the seam owned by the consumer** — the
same shape as the previous bolts.

**And this bolt adds NO new mechanism.** It is a **read model** over what
already exists.

### Layer Structure

```text
┌──────────────────────────────────────────────────────────────────┐
│ Presentation                                                     │
│   ReportController   GET /api/report/tolerance?from=&to=          │
│                     GET /api/report/tolerance?shift=             │
├──────────────────────────────────────────────────────────────────┤
│ Application                                                      │
│   BuildToleranceReport   the period, the rows, the counts        │
├──────────────────────────────────────────────────────────────────┤
│ Domain                                                           │
│   ToleranceReport       the read model                           │
│   ReportPeriod          the range — or a shift, resolved        │
│   ToleranceFailureRow / OverrideRow / BatchProgress             │
│   WeighingRecordRepository  unit 003's — READ                   │
│   AuditEntryRepository      bolt 020's — READ                   │
│   BatchProgressPort         the station's own batches — READ     │
├──────────────────────────────────────────────────────────────────┤
│ Infrastructure                                                   │
│   (no new table — the report is COMPUTED, not stored)           │
└──────────────────────────────────────────────────────────────────┘
```

### API Design

#### `GET /api/report/tolerance` — the report

| Parameter | Meaning |
|---|---|
| `from`, `to` | The period as a date range — **inclusive** |
| `shift` | The period as a **named shift** — resolved to a range |

**Either form, one query.** The shift is a configuration value, and it
resolves to a range — so the report's implementation is the same either
way.

| Status | Meaning | Body |
|---|---|---|
| **200** | The report | `{ report }` |
| **400** | The period is missing or malformed | `{ error: "VALIDATION_ERROR" }` |
| **401** | No operator session | `{ error: "UNAUTHENTICATED" }` |
| **403** | The operator is not a supervisor | `{ error: "SUPERVISOR_REQUIRED" }` |

**AND A ZERO PERIOD IS A `200` WITH ZERO COUNTS** — not a `404`, and not
an error. *"The absence of a failure is itself reportable."*

### The report's reads — and its ABSENCE of writes

**The report's collaborators are the READ sides only:**

| It reads | Through |
|---|---|
| The weighing records | `WeighingRecordRepository.between(from, to)` |
| The audit trail | `AuditEntryRepository.filter({ from, to, action })` |
| The batch progress | `BatchProgressPort.progressFor(period)` |

**And it writes NOTHING.** Not the records, not the trail, not the
configuration.

**And there is no `record` call anywhere in the report's path** — which is
the structural form of *"the report is not a privileged action"*. There is
no *"report generated"* entry, because a report that created a record would
be creating a record.

**And it publishes NO event** — a report that published an event would need
a subscriber, and the subscriber would write.

### The period — a range, or a shift resolved to one

**The shift is a CONFIGURATION value** — the station's shift pattern. So
the resolution is a **port**, and the report's query is the same either
way:

```text
shift name ──► the shift's start and end ──► from, to ──► the query
```

**And the period is a SELECTION, not content.** The client names a period;
it never names a row.

### The tolerance outcome is READ, not recomputed

**This is the report's trustworthiness, and it is one line:**

```ts
// WRONG — re-derives the tolerance from today's recipe and today's
// configuration, so a revision after the fact rewrites the report.
const zone = evaluate(record.actualQuantity, currentRecipe, currentTolerance);

// RIGHT — the zone the RECORD carries, recorded at confirmation.
const zone = record.zoneAtConfirm;
```

**And bolt `022` is what makes the difference visible.** The configuration
is versioned and a tolerance override changes what a weighing means — so a
recomputed report would tell a different story after every configuration
change, and the story says it must not.

### The override row — the audit entry JOINED to the weighing

**The audit entry carries the actor, the role, the reason and the time.
The weighing carries the subject.**

**And the join is on the audit entry's SUBJECT** — which names the
component and the session. So:

```text
the audit entry's subject  ──►  the weighing it refers to
```

**And an override with no matching weighing is still reported** — with the
subject the entry names — because the entry is the act. **And the row
carries what the entry carries** — the actor, the role, the reason, the
time — plus the subject.

### Which audit entries are overrides

**The report reads the trail's `TOLERANCE_OVERRIDE` action** — the
supervisor's authorisation of an out-of-tolerance over-dose.

**And NOT the `REPRINT` or `CONFIGURATION_CHANGE` actions** — and **not a
print job's failure**, which is not a tolerance failure at all.

### The batch progress — the station's own

**The progress is unit `001`'s released batches and unit `003`'s sessions** —
where the station's batches ARE. **The MES's own status is not the
report's subject.**

### Data Model

**No new table.** The report is **computed**, and the records and the trail
are already there.

**And one addition to unit `003`'s repository** — `between(from, to)` —
because the report needs a **period-scoped** read, and `allFor(sessionId)`
cannot express a period.

### Security Design

| Concern | Approach |
|---|---|
| **Session** | Required (ADR-020). |
| **The role** | From the **session's operator** — the report is a supervisor's act, and the content is the exception history. |
| **A client-supplied row** | There is **no** field for it. Every row is computed. |
| **A client-supplied count** | There is **no** field for it. The counts are computed. |
| **A client-supplied zone** | There is **no** field for it. The zone is **read** from the record. |
| **The period** | It is a **selection** — the only thing the client chooses. |
| **The report's writes** | It has **none**. |

### NFR Implementation

| Requirement | Design approach |
|---|---|
| **BRD FR-23 / FR-21** | The report is a query over the immutable records and the append-only trail. |
| **BRD FR-18** | The tolerance outcome is the **recorded** zone. |
| **BRD DR-02** | The report **mutates nothing**, and it **re-derives nothing**. |
| **BRD BR-22** | The batch progress is reported for the period. |

### Testing Plan

| Suite | What it proves |
|---|---|
| **Unit — the failures** | A weighing whose recorded zone was not `OK` is a failure; one whose zone was `OK` is not. |
| **Unit — the overrides** | The audit entry is joined to the weighing; **two overrides on one subject are two rows**; a `REPRINT` entry is not an override. |
| **Unit — the zero period** | Zero counts, empty rows, **no error** — and the progress is still reported. |
| **Unit — the mutation** | The report **writes nothing** — the records, the trail and the configuration are all unchanged. |
| **Integration — the report** | The `200` carries the counts, the rows and the progress; an **operator** is a `403`; a shift resolves to a range. |
| **Integration — the immutability** | The trail's length and the records are **identical** before and after the report. |
| **Security** | No session → `401`; the role comes from the **session**. |

### Open points carried forward

1. **The supervisor's on-screen progress view** — unit `007`.
2. **A dashboard or a BI export** — **CQ-07 is explicitly NOT answered by
   this story**, and it is *"a new outbound flow, not a new context"*. A
   future dashboard is a **consumer** of this read model.
3. **The presentation format** — not specified by any requirement, and
   therefore left to the consumer.
