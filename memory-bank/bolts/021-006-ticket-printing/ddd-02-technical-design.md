---
stage: design
bolt: 021-006-ticket-printing
created: 2026-11-06T12:40:00Z
---

## Technical Design: 006-ticket-printing (bolt 021)

### Architecture Pattern

**Hexagonal (ports and adapters), with the seam owned by the consumer** — the
same shape as the previous bolts.

**And this bolt adds NO new mechanism** — it completes the one bolt `020`
started: the **query** and the **export**.

### Layer Structure

```text
┌──────────────────────────────────────────────────────────────────┐
│ Presentation                                                     │
│   AuditController   GET  /api/audit/trail                       │
│                    GET  /api/audit/trail/export                │
├──────────────────────────────────────────────────────────────────┤
│ Application                                                      │
│   QueryAuditTrail      the bounded page                         │
│   ExportAuditTrail     the STREAMING export                     │
├──────────────────────────────────────────────────────────────────┤
│ Domain                                                           │
│   AuditQuery           the filter                               │
│   AuditPage            the bounded page                         │
│   AuditExport          the artefact                             │
│   AuditExportFormat    JSONL                                    │
│   AuditEntryRepository THE PORT (bolt 020's — no update/delete)  │
│   AuditStreamRepository THE PORT — the CURSOR, for the export    │
├──────────────────────────────────────────────────────────────────┤
│ Infrastructure                                                   │
│   SqliteAuditEntryRepository   bolt 020's                        │
│   SqliteAuditStreamRepository  a CURSOR over the rows            │
└──────────────────────────────────────────────────────────────────┘
```

### API Design

#### `GET /api/audit/trail` — the query

| Status | Meaning | Body |
|---|---|---|
| **200** | The matching entries | `{ entries, hasMore }` |
| **401** | No operator session | `{ error: "UNAUTHENTICATED" }` |
| **403** | The operator is not a supervisor | `{ error: "SUPERVISOR_REQUIRED" }` |

**AND READING THE TRAIL REQUIRES A SUPERVISOR.** The role comes from the
session's operator — `isSupervisor()` — and **never** from the request.

**And the refusal is `403`, and it is DISTINGUISHABLE from the
unauthorisation's uniform `403`** — because this is not an authorisation
failure. The audit trail is a **supervisor's** record; an operator asking
for it is refused because the **role** is wrong, and the body says so.

**And the query's filters are QUERY PARAMETERS** — `actorId`, `action`,
`from`, `to`, `limit`. They are the *selection*, not the *content* — the
same rule the reprint followed.

#### `GET /api/audit/trail/export` — the export

| Status | Meaning | Body |
|---|---|---|
| **200** | The export artefact | the `JSONL` body |
| **401** | No operator session | `{ error: "UNAUTHENTICATED" }` |
| **403** | The operator is not a supervisor | `{ error: "SUPERVISOR_REQUIRED" }` |

**AND THE EXPORT'S BODY IS THE ARTEFACT ITSELF** — `application/x-ndjson`,
one JSON object per line. **Not** a JSON envelope wrapping it, because the
artefact must be **streamable** — a reader consumes it line by line, which
is what lets a multi-year export avoid one buffer.

**AND THE CONTENT TYPE SAYS SO** — `application/x-ndjson` — so a consumer
knows what it is holding without reading it.

### The port over the trail — and the CURSOR

**Bolt `020`'s `AuditEntryRepository` has `record`, `all` and `filter`.**
And `filter` returns an **array** — which is exactly right for a query, and
**exactly wrong for an export**.

**Because the export's edge case is:**

> *"An export is requested for a multi-year range → the export is produced
> from the store **without loading every entry into memory in one
> buffer**."*

**So the export needs a CURSOR** — a repository method that yields entries
one at a time:

```ts
export interface AuditStreamRepository {
  /**
   * The matching entries, ONE AT A TIME.
   *
   * A cursor, not an array — so a multi-year export never has to be held
   * in one buffer.
   */
  stream(filter: AuditFilter): AsyncIterable<AuditEntry>;
}
```

**And the export writes each entry as it arrives.** The whole result is
never assembled.

### The export's format — `JSONL`, and why

**The story's requirement is precise:**

> *"The export format is a training artefact in this build; it must be
> **complete and machine-readable**, but its **exact serialisation is not
> settled by any requirement**."*

**So the format must be complete and machine-readable — and must not
pretend to be settled.** `JSONL` — one JSON object per line:

- **complete** — every field of every entry, intact;
- **machine-readable** — a parser reads it without a schema;
- **streamable** — a reader consumes it line by line.

**And the line-orientation is not incidental — it is what makes the
requirement satisfiable.** A JSON array of every entry would have to be
assembled before it could be written, which is precisely the one-buffer
load the story forbids.

**And the export's format is a VALUE, not a hard-coded choice** — so a
different training format is a configuration value, and this bolt does not
write a literal that pretends to be settled.

### The export carries EXACTLY the matching entries, with all fields intact

**The acceptance criterion:** *"containing exactly the matching entries
with all their fields intact"*.

**So the export writes the entry's own fields** — the sequence, the entry
id, the action, the actor, the role, the subject, the reason and both
timestamps. **Not a summary, and not a re-rendering.**

**And it applies THE SAME filter the query does** — one filter, one
implementation, so a query and an export of the same filter agree.

### The refusal entry — a DISTINCT action, so a query cannot overstate

**The acceptance criterion:**

> *"no audit entry is written for a **successful action that did not
> happen**, and **the refusal itself is recorded with its reason**."*

**So the two are different entries, and they are kept apart by the
`action` value.** A success entry names the action performed; a refusal
entry names the action **refused**.

**And this matters for the query.** If a refusal were recorded as a
successful `REPRINT` with a reason saying "no reason was given", then a
query for `action=REPRINT` would return the refusals too — and the trail
would **overstate** what happened.

**So the set of audit actions gains the refusal variants**, and each is a
distinct value:
- `REPRINT` — a reprint was requested;
- `REPRINT_REFUSED` — a reprint was refused.

**And the set stays DERIVED from the BRD's own constraints** — a refusal is
the same privileged action, refused. So the value is **the action, plus
`_REFUSED`** — and it is derived, not invented per case.

### Who may read the trail — and why it differs from the reprint

**The reprint needs a session; the trail's reading needs a SUPERVISOR.**

**And the reason is worth stating plainly.** The trail holds **every**
privileged action — every override, every reprint, every configuration
change, with its actor and its reason. An operator who could read it
wholesale would learn about **every** exception taken in the dyehouse.

**So the check is the session's operator's `isSupervisor()`** — and the
role is **not** a request field, exactly as the actor is not.

**And this is deliberately DIFFERENT from the reprint**, where the story
says supervisor authentication is **not** required. The distinction is:
- the **reprint** is one action, attributed and justified;
- the **trail** is **all** of them, and it is a supervisor's record.

### Data Model

**No new table.** The trail is bolt `020`'s, unchanged.

**And no new column.** The refusal is an `action` **value** — and the
`CHECK` constraint on `action` gains the refusal variants.

### Security Design

| Concern | Approach |
|---|---|
| **Session** | Required (ADR-020). |
| **The role** | It comes from the **session's operator** — never from the request. And a non-supervisor is refused with a `403`. |
| **A client-supplied filter** | It is a **selection**, not content. The filter can only narrow the trail — it cannot change an entry. |
| **A client-supplied limit** | It is **bounded** — the page cannot be unbounded, and the export is streamed regardless. |
| **The export's content** | Every field of every matching entry — **read only**. The export path never calls `record`. |
| **The refusal body** | It says `SUPERVISOR_REQUIRED` — **not** a distinguishable authorisation reason. The trail's *existence* is not a secret, and the operator's role is their own. |

### NFR Implementation

| Requirement | Design approach |
|---|---|
| **BRD FR-21** | The query returns only the matching entries, ordered by the monotonic sequence. |
| **BRD NFR-13** | The export writes nothing; the repository has no mutator. |
| **BRD DR-01** | The entries are retained ≥ 5 years — there is no deletion path. |
| **BRD NFR-05** | The entries are durable — `synchronous = FULL`. |
| **The multi-year export** | Produced by **iteration** over a cursor. |

### Testing Plan

| Suite | What it proves |
|---|---|
| **Unit — the query** | Only the matching entries come back; they are in **sequence order**; the filter **combines**; the page is **bounded**; an empty result is an **empty array**. |
| **Unit — the export** | It contains **exactly** the matching entries with **all their fields intact**; it is **streamable**; an empty export is **valid**. |
| **Integration — the query** | The `200` carries the entries and `hasMore`; a non-supervisor is a `403`; no session is a `401`. |
| **Integration — the export** | The body is `JSONL`; it parses; it carries every field; an empty filter produces an **empty** export and **not** an error. |
| **Persistence** | The cursor yields the matching entries in sequence order, and it is **bounded**. |
| **Security** | The role comes from the **session**; the export writes nothing; the filter cannot widen the trail. |

### Open points carried forward

1. **The configuration's changes are audited through this same API** — story
   `005`.
2. **The report reads the trail** for override authorisations — story `006`.
3. **The audit view and the export control** — unit `007`.
4. **The export's serialisation** — a training artefact. Complete and
   machine-readable; **its exact form is not settled**.
