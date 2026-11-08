---
stage: model
bolt: 021-006-ticket-printing
created: 2026-11-06T12:20:00Z
---

## Static Model: 006-ticket-printing (bolt 021)

### What bolt 020 already built, and what this bolt adds

**Bolt `020` built the append-only API** — the `AuditEntry`, the
`AuditEntryRepository` with **no update and no delete path**, the
`AUTOINCREMENT` sequence, and the filter. **This bolt completes it**: the
**query surface** and the **export**.

| Piece | Built by | Why it belongs there |
|---|---|---|
| The `AuditEntry` | `020` | The shape of a privileged action's record |
| The append-only repository | `020` | The guarantee that history cannot be rewritten |
| The **filter** | `020` | The query's *shape* |
| The **query** | **`021`** | The endpoint, and the paging the export needs |
| The **export** | **`021`** | The artefact |
| The **privileged-action set** | `020` | Derived from the BRD, not invented |

**And the set of privileged actions is COMPLETE** — bolt `020` established
it from the BRD's own constraints, and this bolt does not extend it.

### Entities

- **AuditQuery**: the filter a query carries — the actor, the action, the
  date range, and the **limit**.

- **AuditPage**: one page of entries, and whether there is more.

- **AuditExport**: the export artefact — its format, its filter, the
  entries it carries, and when it was produced.

### Value Objects

| Value object | Shape | Rules |
|---|---|---|
| **AuditExportFormat** | `JSONL` | The training artefact's format. **One value, deliberately** — the story says the exact serialisation *"is not settled by any requirement"*, so the format is a **configuration value with a defined default**, not an open question the code pretends to answer. |
| **AuditPageSize** | a bounded number | How many entries one page carries. **Bounded**, because the story says a multi-year export must be produced *"without loading every entry into memory in one buffer"*. |

### The export is COMPLETE and MACHINE-READABLE, and its serialisation is not settled

**The story is explicit about the format:**

> *"The export format is a training artefact in this build; it must be
> **complete and machine-readable**, but its **exact serialisation is not
> settled by any requirement**."*

**So the export must be complete** — every field of every matching entry,
intact — and **machine-readable**. **And it must not pretend to be
something the requirements do not ask for.**

**And the reason it is `JSONL` — one JSON object per line — is worth
stating.** It is:

- **complete** — every field of every entry, intact;
- **machine-readable** — a parser reads it without a schema;
- **and streamable** — a reader consumes it **line by line**, so a
  multi-year export does not have to be held in one buffer.

**And that last point is the story's own edge case:**

> *"An export is requested for a multi-year range → the export is produced
> from the store **without loading every entry into memory in one
> buffer**."*

**So the export is produced by ITERATION, not by collecting an array and
serialising it.** The repository's filter is **streamed** — a cursor over
the rows — and the writer writes each entry as it arrives.

**And the whole result is never assembled in memory.** That is the
requirement, and it is why the format is line-oriented.

### The export contains EXACTLY the matching entries

**The acceptance criterion:**

> *"Given audit entries exist, When the trail is exported with a filter,
> Then an export artefact is produced containing **exactly the matching
> entries with all their fields intact**."*

**"Exactly"** — no more and no fewer. So the export applies **the same
filter** the query does, and the filter is the same code.

**And "all their fields intact"** — so the export carries the sequence, the
entry id, the action, the actor, the role, the subject, the reason and
both timestamps. **Not a summary. Not a re-rendering.**

### An empty export is an EMPTY export — not an error

**The story's edge case:**

> *"The export filter selects no entries → An empty export is produced; it
> is **not an error** and it does not fail the request."*

**And this is the same discipline as ADR-018's "a refusal is a value, not
an error"** — an empty result is a **fact**, and it is reported faithfully.

**And an empty trail and an unreachable trail are DIFFERENT facts.** The
repository's `filter` returns an empty array for the first; an unreachable
store is a **failure**, and it is reported as one.

### The trail is queried by actor, action or date range

**The acceptance criterion:**

> *"Given audit entries exist, When the trail is queried **by actor, action
> or date range**, Then **only the matching entries are returned**, ordered
> by a **monotonic sequence**."*

**Three filters, and the order is always the sequence** — never the
timestamp, because two privileged actions can occur in the same
millisecond (ADR-043).

**And the filter is COMBINABLE** — an actor **and** an action **and** a
range. A supervisor asking "what did *I* do in March, and were any of them
reprints?" is one query with three terms.

### A refused action is RECORDED as a refusal, and no success entry is written

**The acceptance criterion, and it is subtle:**

> *"Given a privileged action was **attempted with no reason**, When the
> action is refused, Then **no audit entry is written for a successful
> action that did not happen**, and **the refusal itself is recorded with
> its reason**."*

**So there are TWO kinds of entry, and they are not the same thing:**

| | A **successful** action | A **refusal** |
|---|---|---|
| Written when | the action happened | the action was **refused** |
| Its reason | the justification | **the reason for the refusal** |

**And the critical rule: a refusal does NOT produce a success entry.** The
trail must not contain an entry saying a reprint happened when it did not.

**How the two are kept apart** — and this is the design question — is by
the **action** and the **subject**: a success entry names the action that
was performed, and a refusal entry names the action that was **refused**.

**So the refusal is a distinct `action` value** — `REPRINT_REFUSED` — and
not a successful `REPRINT` with a reason that says "no reason was given".
**Otherwise a query for "reprints" would return the refusals too**, and the
trail would overstate what happened.

**And bolt `020`'s reprint already gets this right by construction**: the
reason is refused **before** any job is created, so no success entry is
written — and the *refusal* is what the trail records.

### The export is a READING, and it writes nothing

**The export reads the trail. It does not modify it, and it does not
create an entry.**

**And that is structural** — the export path has the same repository, and
the repository's only write is `record`. There is no `update` and no
`delete` (ADR-043), so an export cannot disturb the history it reports.

### Who may read the trail

**The trail is the product's record of privileged actions, and its story's
actor is *"a dyehouse supervisor"*.**

**So the reading is a SUPERVISOR's act** — and the role check is the
**caller's own** `isSupervisor()`, from the session's operator. **Not a
field in the request** — the operator comes from the session, and so does
the role.

**And this is deliberately DIFFERENT from the reprint.** A reprint is
privileged but does **not** require supervisor authentication (BRD FR-35
does not name reprints) — so the *action* needs attribution and a reason,
and nothing more. **Reading the whole trail is different**: it exposes
every privileged action to every actor, and it is a supervisor's act.

**So the rule is: the reprint needs a session; the trail's reading needs a
supervisor.** And the reason is worth stating plainly — **the trail is
where every privileged action is recorded, and an operator who could read
it wholesale would learn about every override and every reprint in the
dyehouse.**

### Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **AuditPage** | the entries, whether there is more | 1. The entries are in **sequence order**. 2. The page is **bounded**. 3. The page carries **exactly** the matching entries — no more, no fewer. |
| **AuditExport** | the format, the filter, the entries, the moment | 1. It contains **exactly** the matching entries, **with all their fields intact**. 2. It is **machine-readable**. 3. It is produced by **iteration** — never by assembling every entry in one buffer. 4. An empty export is a **valid** export. 5. It **writes nothing** to the trail. |

### Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **AuditTrailExported** | An export was produced | `format`, `entryCount`, `filter` |

### Domain Services

- **AuditQueryService**: the query — filter, order, and the bounded page.

- **AuditExporter**: the export — **streaming**, and never assembling the
  whole result in memory.

### Repository Interfaces

| Repository | Entity | Methods | Persisted? |
|---|---|---|---|
| **AuditEntryRepository** (bolt `020`) | `AuditEntry` | `record`, `all`, `filter` | **Yes** — append-only |
| **AuditStreamRepository** (this bolt) | `AuditEntry` | `stream(filter)` | **Yes** — a **cursor**, for the export |

### Ubiquitous Language

- **The trail** — the append-only record of privileged actions.
- **A query** — a bounded page of matching entries.
- **An export** — a machine-readable artefact of the matching entries.
- **A refusal entry** — the record of an action that was **refused**.
- **The sequence** — the trail's authoritative order.

---

## Constraints carried into the Technical Design

1. **The query returns ONLY the matching entries**, ordered by the
   **monotonic sequence**.
2. **The filter combines** — actor, action and date range — and the same
   filter serves the query **and** the export.
3. **The page is BOUNDED**, and the export is produced by **iteration** —
   never by loading every entry into one buffer.
4. **The export contains EXACTLY the matching entries, with all their
   fields intact** — the sequence, the entry id, the action, the actor, the
   role, the subject, the reason and both timestamps.
5. **The export format is `JSONL`** — complete, machine-readable, and
   streamable — and the exact serialisation is a **training artefact**,
   not a settled requirement.
6. **An empty export is a VALID export** — not an error.
7. **A refusal is recorded as a REFUSAL** — a distinct action — and **no
   success entry is written for an action that did not happen**.
8. **Reading the trail requires a SUPERVISOR** — the role comes from the
   session's operator, never from the request.
9. **The export writes NOTHING** — the repository has only `record` as a
   write, and the export never calls it.
10. **The trail's entries are retained ≥ 5 years** — there is no deletion
    path at all.

---

## The edge cases, answered

| Scenario | Where it is answered |
|----------|----------------------|
| Two privileged actions occur within the same millisecond | Ordered by the **monotonic sequence**, not the timestamp (bolt `020`) |
| An action is attempted by an **anonymous** actor | The attempt is **refused**, and a **refusal entry** records the subject and the stated reason; no success entry is written |
| The export filter selects **no** entries | An **empty export** is produced — not an error, and the request does not fail |
| The database is restored from an older backup | Entries above the restored maximum are re-appended with their original timestamps — the trail **never silently rewinds** (bolt `020`'s `AUTOINCREMENT`) |
| An export is requested for a **multi-year range** | Produced by **iteration**, without loading every entry into one buffer |

---

## Open points carried forward

- **The configuration** — story `005`. The configuration's changes are
  audited through this same API, and the audit entry carries the key
  changed, the previous value, the new value and the reason.
- **The reporting** — story `006`. The report reads the trail for override
  authorisations.
- **The audit view and the export control** — unit `007`.
- **The export's serialisation** — a training artefact. It is complete and
  machine-readable, and **its exact form is not settled by any
  requirement**.
