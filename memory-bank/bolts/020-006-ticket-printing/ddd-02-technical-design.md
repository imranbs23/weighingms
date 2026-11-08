---
stage: design
bolt: 020-006-ticket-printing
created: 2026-11-06T10:20:00Z
---

## Technical Design: 006-ticket-printing (bolt 020)

### Architecture Pattern

**Hexagonal (ports and adapters), with the seam owned by the consumer** — the
same shape as the previous bolts.

**And this bolt adds a port over the AUDIT TRAIL — a mechanism that does
not exist yet, and which story `004` will own.** So this bolt **builds**
the append-only API and uses it, and story `004` extends it with the query
and the export.

### Layer Structure

```text
┌──────────────────────────────────────────────────────────────────┐
│ Presentation                                                     │
│   TicketController   POST /api/tickets/:ticketId/reprint         │
├──────────────────────────────────────────────────────────────────┤
│ Application                                                      │
│   ReprintTicket      the reason, then the job, then the audit    │
├──────────────────────────────────────────────────────────────────┤
│ Domain                                                           │
│   PrintJob (extended)   the marking                             │
│   AuditEntry            the append-only privileged-action record │
│   AuditEntryRepository  THE PORT — record, all, filter           │
│   AuditAction           the derived set of privileged actions    │
│   ReprintReason         the mandatory reason                     │
├──────────────────────────────────────────────────────────────────┤
│ Infrastructure                                                   │
│   SqliteAuditEntryRepository   append-only, monotonic sequence   │
│   AuditDatabase                 the table and migration          │
└──────────────────────────────────────────────────────────────────┘
```

### API Design

#### `POST /api/tickets/:ticketId/reprint` — the reprint

| Status | Meaning | Body |
|---|---|---|
| **201** | The reprint job was created | `{ job, auditEntry }` |
| **400** | The reason is absent or empty | `{ error: "REPRINT_REASON_REQUIRED" }` |
| **401** | No operator session | `{ error: "UNAUTHENTICATED" }` |
| **404** | There is no such ticket | `{ error: "TICKET_NOT_FOUND" }` |

**AND THE REASON IS REQUIRED BY THE SCHEMA, NOT ONLY BY THE DOMAIN.**
Zod's `min(1)` on the trimmed reason refuses an empty one at the boundary,
so no print job is created.

**AND THE BODY HAS ONLY ONE FIELD: the reason.** There is no field for
`isReprint`, for `reprintOf`, for the actor or for the actor's role — those
are **derived**:
- `isReprint` from the reason's presence;
- `reprintOf` from the ticket id in the path;
- the actor and the role from the **session**.

### The order: the reason, then the job, then the audit

```text
1. the operator session must be present       ← attribution
2. the reason must be non-empty               ← refused BEFORE any write
3. the ticket must exist                      ← the thing being reprinted
4. the print job is created WITH the marking  ← isReprint, reprintOf, reason, actor
5. the printer is called                       ← bolt 019's order
6. the audit entry is written                  ← the privileged action
```

**And step 2 comes before step 4.** That is the acceptance criterion: *"a
reprint request with an empty or absent reason → the request is refused and
**no print job is created**."*

**And step 6 happens whether the print SUCCEEDED or FAILED.** The
privileged action is the **reprint request** — the attempt — not the
paper's arrival. A reprint that failed to print is still a reprint that was
requested, and the trail must show it.

**Hmm — and that is worth being careful about.** The story says the audit
entry carries *"the subject (the ticket and the original print job)"*. So
the entry is written **after** the job exists, and it names the job.

### The audit entry's sequence — MONOTONIC, and authoritative for order

**The story:** *"Entries carry a `sequence` alongside `occurredAt` so
ordering survives clock skew — the sequence is authoritative for order, the
timestamp for human reading."*

**And the edge case:** *"Two privileged actions occur within the same
millisecond → they are ordered by the monotonic sequence, not by
timestamp."*

**So the sequence comes from the DATABASE, not from the application.** A
counter the application incremented would be racy — two concurrent writes
would read the same value. An `INTEGER PRIMARY KEY AUTOINCREMENT` is
assigned by SQLite under the write lock, so it is **monotonic by
construction**.

**And `AUTOINCREMENT` rather than a plain rowid** — because SQLite's plain
rowid **reuses** a deleted maximum, and the story's edge case says:

> *"The database is restored from an older backup → Entries with a sequence
> above the restored maximum are re-appended with their original timestamps;
> **the trail never silently rewinds**."*

`AUTOINCREMENT` guarantees the counter never goes backwards, even across a
restore — because it remembers the highest value ever used in
`sqlite_sequence`.

### The audit repository has NO update and NO delete

**The story is explicit about the success criterion:**

> *"The success criterion is a test asserting that **no update or delete
> path exists on the repository**, not a convention that callers remember."*

So the interface has `record(entry)`, `all()`, `filter(...)` — and **no
`update` and no `delete`**. There is nothing to call.

**And the database enforces it too** — `BEFORE UPDATE` and `BEFORE DELETE`
triggers that abort. The repository's shape is the first line; the triggers
are the second (ADR-034's rule).

### The rendered marking — and its WORDING comes from the configuration

**The story:** *"The marking must appear in two places: on the stored
`PrintJob` and **on the rendered artefact**, so a paper copy in the dyehouse
is self-identifying. **The rendered marking's wording comes from the locale
bundle, not from a literal in code.**"*

**So the artefact carries the marking, and the wording is configuration's.**

**And the locale in force at reprint time** — the story's edge case: *"The
reprint happens after the locale changed → the reason is stored as entered;
the **reprint marking on the artefact uses the locale in force at reprint
time**."*

**So the ticket's CAPTURED language is NOT used for the marking.** The
ticket captured its language at generation; the marking uses the **current**
one. And that is not a contradiction: the ticket's content is frozen, and
the *marking* is new information added at reprint time.

**So the port is `TicketConfigurationPort` — extended with the marking's
text.** The configuration supplies it; this bolt does not write a literal.

### Data Model

#### `audit_entries` — append-only, with a monotonic sequence

| Column | Type | Notes |
|---|---|---|
| `sequence` | `INTEGER PRIMARY KEY AUTOINCREMENT` | The **monotonic** order — authoritative |
| `entry_id` | `TEXT NOT NULL UNIQUE` | The entry's own id — a **uuid** |
| `action` | `TEXT NOT NULL` | Which privileged action |
| `actor_id` | `TEXT NOT NULL` | Who did it |
| `actor_role` | `TEXT NOT NULL` | Their role — **the operator may be the actor** |
| `subject` | `TEXT NOT NULL` | What was acted upon — the ticket and the original job |
| `reason` | `TEXT NOT NULL` | **In clear text** — it is a record, not a credential |
| `occurred_at` | `TEXT NOT NULL` | The time — for human reading |
| `recorded_at` | `TEXT NOT NULL` | When the row was written |

**AND THE REASON IS IN CLEAR TEXT** — ADR-005's rule, applied again. The
reason is what the audit exists to preserve, and it must be readable by an
auditor five years later.

**AND THE `CHECK` ON `action`** — the derived set of privileged actions, so
the database enforces the same closed set the domain does.

### Security Design

| Concern | Approach |
|---|---|
| **Session** | Required (ADR-020). A reprint is an act, and it needs an author. |
| **A client-supplied actor** | There is **no** field for it. The actor comes from the session. |
| **A client-supplied role** | There is **no** field for it. The role comes from the session's operator. |
| **A client-supplied `isReprint`** | There is **no** field for it. It is derived from the reason's presence. |
| **A client-supplied `reprintOf`** | There is **no** field for it. It is the ticket id in the path. |
| **An absent or empty reason** | Refused at the boundary — **no job created**. |
| **A supervisor requirement** | **Not invented.** The BRD's supervisor list does not name reprints, and the operator's own role is recorded faithfully. |
| **The ticket's records** | Unreachable from the print path (B-7, ADR-042). |

### NFR Implementation

| Requirement | Design approach |
|---|---|
| **BRD FR-21 / FR-28 / FR-36** | The audit entry carries the action, the actor, the role, the subject and the reason. |
| **BRD NFR-13** | The audit repository has no update or delete path, and the triggers abort both. |
| **BRD DR-01** | Entries are retained ≥ 5 years — there is no deletion path at all. |
| **BRD DR-02 / B-7** | The reprint writes a job and an audit entry, and nothing else. The records are unchanged. |
| **NFR-3 / BRD NFR-05** | The entry is committed with `synchronous = FULL`; it survives a power loss. |
| **FR-21** | The reason is mandatory — refused at the boundary, not recorded as blank. |

### Testing Plan

| Suite | What it proves |
|---|---|
| **Unit — the reason** | An empty or whitespace-only reason is refused; a long reason is stored **verbatim**, never truncated; a non-Latin reason survives unchanged. |
| **Unit — the marking** | `isReprint` is `true` exactly when a reason was supplied; `reprintOf` points at the **ticket**; the marking is set at creation and never edited. |
| **Unit — the audit entry** | The sequence is monotonic and authoritative; the reason is never empty; there is **no update path and no delete path** on the repository. |
| **Integration — the reprint** | The `201` carries the job with its marking and the audit entry; an empty reason is a `400` with **no job created**. |
| **Integration — the trail** | The entry is queryable; the ticket's weighing records are **unchanged**. |
| **Persistence** | The triggers refuse an `UPDATE` and a `DELETE`; the sequence never rewinds. |
| **Security** | No session → `401`; a client-supplied actor, role, `isReprint` or `reprintOf` is **dropped**. |

### Open points carried forward

1. **The audit trail's query and export** — story `004`. This bolt builds
   the append-only API; the query, the filter and the export come next.
2. **The configuration** — story `005`. The rendered marking's wording, and
   the locale in force at reprint time.
3. **The reporting** — story `006`.
4. **The reprint control** — unit `007`.
