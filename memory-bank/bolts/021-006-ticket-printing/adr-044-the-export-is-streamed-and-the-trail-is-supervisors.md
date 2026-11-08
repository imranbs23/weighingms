---
bolt: 021-006-ticket-printing
created: 2026-11-06T13:00:00Z
status: accepted
---

# ADR-044: The export is STREAMED line by line, and reading the trail requires a SUPERVISOR

## Context

Bolt `020` built the audit trail's append-only API — the entry, the
repository with **no update and no delete path**, the database-assigned
`AUTOINCREMENT` sequence, and the filter.

**Bolt `021` completes it: the query and the export.**

Two decisions in it are open.

**The first: how the export is produced.** The story's edge case is
unusually specific:

> *"An export is requested for a multi-year range → the export is produced
> from the store **without loading every entry into memory in one
> buffer**."*

And the format's status is equally specific:

> *"The export format is a training artefact in this build; it must be
> **complete and machine-readable**, but its **exact serialisation is not
> settled by any requirement**."*

**The second: who may read the trail.** The story's actor is *"a dyehouse
supervisor"* — and the reprint, in the same unit, explicitly does **not**
require supervisor authentication:

> *"A reprint is a privileged action but does **not** require supervisor
> authentication in this build — the BRD's supervisor-authentication
> requirement (BRD FR-35) names tolerance override, manual scale
> reselection and calibration bypass. What a reprint requires is attribution
> and a reason."*

**So two reads of the same unit's requirements give opposite answers, and
they have to be reconciled.**

## Decision

**The export is STREAMED — one line at a time, from a cursor — and reading
the trail requires a SUPERVISOR, checked from the session.**

1. **The export is produced by ITERATION.** The repository's `stream`
   yields the matching entries one at a time, and the writer writes each
   as it arrives. **The whole result is never assembled in memory.**

2. **The export's format is `JSONL`** — one JSON object per line — and it
   is a **value**, not a hard-coded literal.

3. **The export carries EXACTLY the matching entries, with all their
   fields intact** — the sequence, the entry id, the action, the actor,
   the role, the subject, the reason and both timestamps.

4. **The query and the export use THE SAME filter** — one filter, one
   implementation, so they agree.

5. **Reading the trail requires a SUPERVISOR**, and the role comes from the
   **session's operator** — never from the request.

6. **An empty export is a VALID export** — not an error.

7. **A refusal is recorded as a DISTINCT action** — the action, plus
   `_REFUSED` — so a query cannot overstate what happened.

## Rationale

### Why the export is STREAMED, and not a filtered array

**Because the requirement is about memory, and a filtered array is exactly
the thing the requirement forbids.**

Look at what bolt `020`'s `filter` returns: **an array**. That is right for
a query — the UI shows a page — and wrong for an export, because:

```ts
// WRONG — every matching entry is in memory before the first byte is
// written. A five-year trail is every entry the product ever recorded.
const entries = await audit.filter(filter);
const body = entries.map(serialise).join('\n');
```

**And the export's own requirement is a *buffer* requirement.** "Without
loading every entry into memory in one buffer" — so the export cannot be
produced from a collection, because a collection *is* one buffer.

**So the export needs a CURSOR** — a repository method that yields entries
one at a time — and the writer writes each as it arrives:

```ts
// RIGHT — the peak memory is ONE entry.
for await (const entry of audit.stream(filter)) {
  res.write(`${JSON.stringify(serialise(entry))}\n`);
}
```

**And this is why the format is line-oriented.** The requirement is that
the artefact be complete and machine-readable — and `JSONL` is both. But
**a JSON array of every entry would have to be assembled before it could
be written**, which is the one-buffer load the story forbids. **The
line-orientation is not incidental — it is what makes the requirement
satisfiable at all.**

### Why the format is a VALUE, and not a hard-coded literal

**Because the requirements deliberately do not settle it — and a literal
would pretend they do.**

> *"its exact serialisation is not settled by any requirement."*

**So the format is a configuration value with a defined default.** A
literal in the code would be a decision presented as a requirement, and the
next agent to read it would treat `JSONL` as mandated — and then a
different training format could not be produced without changing code that
looked fixed.

**And the default is `JSONL`** because it is the one format that satisfies
all three stated properties at once — complete, machine-readable, and
streamable — and the last of those is the one the buffer requirement
demands.

### Why the export carries ALL the fields, intact

**Because the export exists to settle a dispute, and a summary cannot.**

The story's purpose: *"So that a weighing dispute or a compliance review
can be settled **from the record** rather than from recollection."*

**And the acceptance criterion is exact:** *"containing exactly the matching
entries **with all their fields intact**."*

So the export writes the entry's own fields — and **not** a
re-rendering, and **not** a summary. A summary would be the second copy of
the truth that this whole product avoids: a second thing to keep in step
with the trail, and a second thing that can be wrong.

**And "exactly" cuts both ways** — no more and no fewer. The export
applies **the same filter** the query does, so a query and an export of the
same filter **agree**. One filter, one implementation.

### Why reading the trail requires a SUPERVISOR — and why the reprint does not

**Because the trail holds EVERY privileged action, and the reprint holds
one.**

This is the reconciliation the two stories seem to contradict, and the
resolution is simply **the scope of what is being disclosed**:

| | The **reprint** | The **trail** |
|---|---|---|
| What it touches | **one** ticket, and **one** action | **every** privileged action, ever |
| What it discloses | a copy of a ticket the requester could have had | every override, every reprint, every configuration change, **with their actors and their reasons** |
| What it needs | **attribution and a reason** | a **supervisor's** authority |

**And the trail's content is the reason.** An operator who could read the
whole trail would learn about every exception taken in the dyehouse — who
authorised it, why, and against which weighing. **That is not the
operator's business.** It is the supervisor's, and the compliance reviewer's
— which is exactly what the story's actor is.

**So the check is the session's operator's `isSupervisor()`** — and the
role is **not** a request field, exactly as the actor is not. A client that
could name its own role would be asserting a fact the station knows.

**And the `403` is distinguishable from the authorisation's uniform `403`** —
because this is **not** an authorisation failure. Unit `008`'s ADR-004
requires the authorisation's refusals to be indistinguishable, because
those refusals leak the shape of the defences. **This refusal leaks
nothing of that kind**: it says the role is wrong, and the requester's own
role is not a secret to them. The trail's *existence* is not a secret
either — it is a documented feature of the product.

**And the reprint is deliberately NOT supervisor-gated**, because the BRD's
supervisor list (FR-35) does not name reprints. **Inventing a supervisor
requirement for the reprint would be inventing a rule the BRD does not
state** — and it would be inventing it in the *stricter* direction, which
is the easy direction to get wrong by accident.

### Why a refusal is a DISTINCT action

**Because a query must not overstate what happened.**

The acceptance criterion is careful:

> *"**no audit entry is written for a successful action that did not
> happen**, and the refusal itself is recorded with its reason."*

**Two entries, and they are not the same kind of thing.** A success entry
says *"this action was performed"*; a refusal entry says *"this action was
refused"*.

**And if they shared an action value, the query would overstate.** A
refusal recorded as a successful `REPRINT` — with a reason reading "no
reason was given" — would be returned by `action=REPRINT`, and the trail
would appear to record a reprint that never happened.

**So the refusal's action is the action, plus `_REFUSED`** — `REPRINT` and
`REPRINT_REFUSED`. And that is **derived**, not invented per case: the
privileged-action set is the BRD's own (FR-35, FR-22, FR-28), and a
refusal is the same action, refused.

**And bolt `020`'s reprint already gets this right by construction.** The
reason is refused **before** any job is created — so no success entry is
written at all, and the refusal is what the trail holds.

## Consequences

### Positive

- **The export's peak memory is ONE entry**, whatever the range.
- **The export is complete, machine-readable, and streamable** — and its
  format is a value, so it can change without changing code.
- **A query and an export of the same filter agree** — one filter, one
  implementation.
- **The trail's disclosure is bounded** — a supervisor's record, and the
  operator's role comes from the session.
- **The trail cannot overstate** — a refusal is a refusal, and a query for
  `REPRINT` does not return the refusals.

### Negative

- **A cursor is a second read path** — `filter` for the query and `stream`
  for the export. They must agree, and the agreement is a test's
  responsibility rather than the type system's.
- **The trail is not readable by an operator at all.** An operator who
  wants to know whether *their own* reprint was recorded cannot read the
  trail — which is a real limitation, and the correct one, because the
  trail is not per-actor.
- **`JSONL` is less convenient than JSON** for a consumer that wants to
  parse the whole artefact in one call. It is the right trade here,
  because the alternative is the buffer the story forbids.
- **The refusal's action set doubles.** Five privileged actions become ten
  values. That is the cost of keeping a refusal distinguishable, and it is
  paid in the `CHECK` constraint.

### Risks

- **A future agent builds the export from `filter`** "because it is right
  there". *Mitigation*: the decision index's "Read when" points here; that
  is precisely the one-buffer load the story forbids.
- **A future agent adds the trail's read to the operator role.** *Mitigation*:
  the same index entry; the trail holds every privileged action, and the
  BRD names reprints as *not* supervisor-gated — so the two are different
  acts with different scopes.
- **A future agent records a refusal as a successful action** "with the
  refusal in the reason". *Mitigation*: the same index entry; a query for
  that action would then overstate.

## Related

- **Stories**: `004-record-and-export-audit-trail`
- **Requirements**: FR-21, FR-36 · BRD NFR-13, NFR-05 · DR-01, DR-02 ·
  NFR-3
- **Previous ADRs**: ADR-043 (the reprint marking is derived, and the
  audit trail is an append-only API with a database-assigned sequence —
  the mechanism this bolt completes); ADR-042 (the print path has no
  weighing-record repository — the reason the export writes nothing
  either); ADR-018 (a refusal is a value, not an error — the same
  discipline, applied to an empty export); ADR-005 (the reason is stored in
  clear text — it is a record, not a credential, and the export carries it
  as it is); ADR-030 (the method is derived, never supplied — the same
  discipline, applied to the refusal's action value)
- **Standards**: `standards/tech-stack.md` § "Database" — append-only rows
  for acts, and `synchronous = FULL` for durability
