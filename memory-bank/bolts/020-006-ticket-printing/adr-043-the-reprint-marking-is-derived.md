---
bolt: 020-006-ticket-printing
created: 2026-11-06T10:40:00Z
status: accepted
---

# ADR-043: The reprint marking is DERIVED from the reason, and the audit trail is an append-only API with a database-assigned sequence

## Context

Bolt `020` adds the reprint: a second copy of a ticket, visibly marked as
a reprint, with a reason and an attribution.

Two decisions in it are genuinely open.

**The first: how the marking is established.** The story says the marking
must appear in two places — on the stored `PrintJob` and **on the
rendered artefact** — and that *"the rendered marking's wording comes from
the locale bundle, not from a literal in code."*

**The second: the audit entry.** The story requires one:

> *"Given a reprint of a ticket, When the reprint job is recorded, Then an
> append-only audit entry is written carrying the actor, the actor's role,
> the subject (the ticket and the original print job) and the reason."*

And it says the mechanism is shared:

> *"Audit entries are written by the units that perform the action (003 for
> overrides, 005 for configuration, **this unit for reprints**), each
> through **the same append-only API**, so the trail has one shape and one
> ordering."*

**But no audit trail exists in the product yet.** This bolt is the **first
consumer**, and story `004` will own the query and the export.

## Decision

**The marking is DERIVED from the reason — never supplied — and the audit
trail is an append-only API whose sequence the DATABASE assigns.**

1. **`isReprint` is `true` exactly when a reason was supplied.** It is
   **derived**, never a client field.

2. **`reprintOf` is the ticket id in the path** — never a client field.

3. **The actor and the actor's role come from the SESSION** — never a
   client field.

4. **The reason is MANDATORY**, and an empty one is **refused at the
   request boundary** — with **no print job created**.

5. **The reason is stored VERBATIM** — the length bound is validated, never
   enforced by truncation.

6. **The rendered marking's wording comes from the CONFIGURATION** — and
   the locale in force **at reprint time**, not the ticket's captured
   language.

7. **The audit entry's sequence is assigned by the DATABASE** —
   `INTEGER PRIMARY KEY AUTOINCREMENT` — and it is **authoritative for
   order**.

8. **The audit repository has NO update path and NO delete path**, and the
   database's triggers abort both.

9. **The audit entry is written whether the print SUCCEEDED or FAILED** —
   the privileged action is the **request**, not the paper's arrival.

## Rationale

### Why the marking is DERIVED, and not a client field

**Because the marking's whole purpose is to be TRUE, and a client-supplied
marking is a client's claim about the truth.**

The marking says three things: *this is a reprint*, *of this ticket*, and
*for this reason*. All three are **facts the station knows**:

| The marking | How the station knows it |
|---|---|
| `isReprint` | A reason was supplied — and a reason is what makes it a reprint |
| `reprintOf` | The ticket id is **in the path** |
| the actor and the role | The **session** |

**And a client that could assert the marking could assert a reprint
without a reason** — which is precisely what the story forbids: *"a reprint
without one is refused at the request boundary, not merely recorded as
blank."*

So the request body has **exactly one field**: the reason. And
`isReprint` is `true` if and only if that field is present and non-empty.

**And the reason's presence is a better source of truth than a boolean
flag**, because it is *load-bearing*: it is the justification the audit
entry carries, and it is what the rendered artefact shows. A boolean flag
beside a mandatory reason would be a second, weaker statement of the same
fact — and the two could disagree.

**And this is the same discipline as ADR-030's "the method is derived,
never supplied"** — the capture's method is derived from the request's
*shape*, and the reprint's marking is derived from the request's *shape*.

### Why the reason is refused at the BOUNDARY, and not recorded as blank

**Because "no reason" and "a blank reason" are different acts, and the
second one is a way of avoiding the first.**

If the request carried an empty reason and the job recorded `reason: ''`,
then:

- the print job would exist;
- the audit entry would exist, carrying an **empty** justification;
- and the trail would show a privileged action with **no justification**.

**And the story says the reason is what makes the audit meaningful:**

> *"This is our **FR-21** — privileged actions are recorded — and it is the
> reason the reprint's reason and actor are **mandatory rather than
> optional metadata**."*

So an empty reason is refused **before** the job is created, and the
acceptance criterion is explicit: *"the request is refused and **no print
job is created**."*

**And the refusal is a `400`, not a `403`.** It is not an authorisation
failure — nobody was refused permission. It is a **malformed request**: the
justification is missing. And it is distinguished from the reason being
*meaningless* (unit `008`'s `AuthorisationReason` refuses
punctuation-only reasons at the *domain* level) because this reason is
plain text for an auditor, not a credential — so the **schema** owns the
emptiness check and the length bound.

### Why the sequence comes from the DATABASE

**Because a counter the application increments is racy, and the story
requires the order to survive clock skew — and a race.**

The story: *"Entries carry a `sequence` alongside `occurredAt` so ordering
survives clock skew — the sequence is authoritative for order, the
timestamp for human reading."*

**And the edge case:** *"Two privileged actions occur within the same
millisecond → they are ordered by the monotonic sequence, not by
timestamp."*

**Two privileged actions can genuinely occur at the same millisecond** — two
reprints requested from two terminals, or a reprint and a configuration
change. So the timestamp cannot order them, and the sequence must.

**And an application-side counter cannot either:**

```ts
// WRONG — racy. Two concurrent writes read the same counter value.
const sequence = await this.nextSequence();   // SELECT MAX(sequence) + 1
await this.db.prepare('INSERT ...').run(sequence, ...);
```

Two concurrent inserts would both read `MAX + 1` and both write it. The
trail's order would then depend on which insert won — and it would be
**recorded as a tie**, with two entries claiming the same position.

**An `INTEGER PRIMARY KEY AUTOINCREMENT` is assigned by SQLite under the
write lock**, so it is **monotonic by construction**. The database is the
only thing that can serialise the writes, so the database is the only thing
that can number them.

**And `AUTOINCREMENT` rather than a plain rowid** — because SQLite's plain
rowid **reuses** a deleted maximum. The story's edge case is explicit:

> *"The database is restored from an older backup → Entries with a sequence
> above the restored maximum are re-appended with their original
> timestamps; **the trail never silently rewinds**."*

`AUTOINCREMENT` keeps the highest value ever used in `sqlite_sequence`, so
the counter never goes backwards — even across a restore.

### Why the repository has NO update and NO delete

**Because the story says the success criterion is the shape of the
interface, not a convention:**

> *"The success criterion is a test asserting that **no update or delete
> path exists on the repository**, not a convention that callers remember."*

**And this is the same rule the rest of the product follows** — the
weighing record's repository, the override record's repository, the
authorisation's repository, the material identity's repository. Each has
`save` and reads, and **no mutator**.

**And the triggers are the second line.** The interface's shape stops a
well-meaning caller; the `BEFORE UPDATE` / `BEFORE DELETE` triggers stop
**everyone** — including a buggy one, or a compromised one (BRD NFR-13).

### Why the audit entry is written even when the PRINT FAILED

**Because the privileged action is the REQUEST, and the request happened.**

The story's wording is careful: *"When the reprint job is **recorded**, Then
an append-only audit entry is written."* — the job is recorded, and then the
entry is written. The entry follows the **job's creation**, not the
print's success.

**And think about what the trail is for.** The trail answers *"who asked
for a second copy of this ticket, and why?"* — and that question is
answered by the **request**, whatever the printer did afterwards.

**A reprint that failed to print is MORE interesting to an auditor than
one that succeeded**, not less: it is a second copy of a weighing ticket
that was requested, and it may or may not have reached a dyehouse. If the
entry were only written on success, the trail would show *no* reprint where
the dangerous case is — a requested second copy that did not arrive.

**And the failed job is still in the trail** — the print job's own row says
`FAILED` with the printer's reason. So the two facts sit side by side:
*reprint requested* and *paper did not arrive*.

### Why the rendered marking uses the CURRENT locale, not the ticket's captured one

**Because the marking is NEW information added at reprint time, and the
ticket's content is frozen.**

The ticket captured its language at generation — bolt `019`'s rule, so a
locale change does not alter an existing ticket.

**But the marking was not part of the ticket.** It is added now, and it
must be readable by whoever reads the reprinted copy — which is whoever
works in the dyehouse **now**, not whoever did when the batch was weighed.

The story's edge case is explicit: *"The reprint happens after the locale
changed → the reason is stored as entered; the reprint marking on the
artefact uses the **locale in force at reprint time**."*

**And the reason is stored as ENTERED** — the operator's own words, in
whatever language they wrote them. The station does not translate a
human's reason; it records it.

## Consequences

### Positive

- **The marking cannot be forged** — every part of it is derived from
  something the station knows.
- **A privileged action with no justification is impossible** — the reason
  is refused before anything is written.
- **The trail's order is authoritative** — the sequence is assigned under
  the write lock, so it cannot tie or reorder.
- **The trail never rewinds**, even across a restore.
- **The trail cannot be mutated** — the interface has no mutator, and the
  triggers abort both.
- **The trail records what it should** — a requested reprint is recorded
  whether or not the paper arrived.

### Negative

- **The audit table exists before its story does.** Bolt `020` builds the
  append-only API and the entry's shape; story `004` adds the query, the
  filter and the export. The trail is therefore **write-only** for now —
  and that is a deliberate, temporary state, not an omission.
- **The reason's emptiness is checked by the schema, and its meaningfulness
  is not.** A punctuation-only reason passes the schema here. That is
  consistent with unit `008`'s split — a reason for an *audit* is plain
  text for a human, not a credential — but it does mean the trail can hold
  a technically-empty-looking reason.
- **The marked artefact's wording waits for story `005`.** Until the
  configuration lands, the marking's text comes from the configuration's
  default, and **no literal is written in this bolt's code**.

### Risks

- **A future agent adds an `isReprint` field to the request** "so the
  client can be explicit". *Mitigation*: the decision index's "Read when"
  points here; it would be a client-supplied claim about a fact the station
  derives, and it could contradict the reason's presence.
- **A future agent numbers the audit entries from an application counter.**
  *Mitigation*: the same index entry; a counter the application increments
  is racy, and the tie would be recorded rather than resolved.
- **A future agent writes the audit entry only on a successful print.**
  *Mitigation*: the same index entry; the privileged action is the request,
  and the failed case is the one an auditor most needs to see.

## Related

- **Stories**: `003-reprint-ticket-with-reason`
- **Requirements**: FR-17, FR-18, FR-21, FR-28, FR-36 · BRD DR-01, DR-02,
  FR-21, FR-28, FR-35, FR-36 · NFR-3, NFR-13 · B-7
- **Previous ADRs**: ADR-042 (the print path has no weighing-record
  repository, and the job's state is committed before the printer is called
  — the guarantee this bolt extends with the marking); ADR-030 (the method
  is derived, never supplied — the same discipline, applied to the
  reprint's marking); ADR-005 (the reason is stored in clear text — it is a
  record, not a credential); ADR-034 (the station's own facts are durable,
  and a record is immutable — the audit entry's shape); ADR-039 (this bolt
  implements no mechanism of its own — the same rule, applied to the audit
  API, which story `004` owns)
- **Standards**: `standards/tech-stack.md` § "Database" — append-only rows
  for acts, fixed-point decimal for every quantity, and `synchronous =
  FULL` for durability
