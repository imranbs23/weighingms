---
bolt: 017-003-weighing-station
created: 2026-11-06T04:10:00Z
status: accepted
---

# ADR-040: The record is written before the progression, and the duplicate is refused by a constraint

## Context

Confirming a weighing does two things: it **records** the weighing, and it
**advances** the session to the next component.

The story is explicit that these are **one** thing:

> *"Progression is a domain transition, not a UI navigation. The confirmed
> component's `DONE` state and the next component's activation happen in one
> atomic transition with the record write, so a crash cannot leave two
> `ACTIVE` components or a `DONE` component with no record."*

**And it names the failure precisely.** Two `ACTIVE` components, or a `DONE`
component with no record.

Now, the two obvious implementations each produce one of those failures:

```ts
// WRONG — the record first, then two separate writes.
await records.save(record);
await sessions.save(markDone(componentId));
await sessions.save(activateNext());
// A crash between the saves leaves: a DONE component with no record, or
// two ACTIVE components, or a DONE component and no ACTIVE one.
```

```ts
// ALSO WRONG — the progression first.
await sessions.save(activateNext());
await records.save(record);
// A crash leaves the NEXT component ACTIVE with no record for the one
// that was just confirmed.
```

**And there is a third failure that neither ordering creates but both
permit: two concurrent confirmations for the same component.** The story
names it:

> *"Two confirmations for the same component arrive concurrently → only one
> record is written; the second is refused as a duplicate."*

## Decision

**The record is written FIRST, and the duplicate is refused by a `UNIQUE`
constraint rather than by a check.**

1. **The record write comes first**, and the progression follows in the same
   operation. A confirmed weighing is therefore **durable before the
   response is returned** (BRD NFR-05).

2. **A crash between the two leaves the component `ACTIVE` and unwritten**
   — so the operator **re-confirms**, and the duplicate check refuses the
   second record rather than writing two. **The session is never
   inconsistent**: there is never a `DONE` component with no record, and
   never two `ACTIVE` components.

3. **The duplicate is refused by a `UNIQUE` constraint** on
   `(session_id, component_id)` — **not** by a check-then-write.

4. **The progression follows the RECIPE's order**, and the recipe is
   read-only and never modified (C-01).

5. **The confirmation of the LAST component is `COMPLETED`** — a distinct
   outcome, not a silent "advanced to nothing".

## Rationale

### Why the record goes first

**Because the alternative's failure is a silent loss of evidence, and this
product's whole purpose is evidence.**

Think about what each ordering leaves behind after a power cut:

**Record first, progression second** — the operator's screen says the
component is still being weighed. They re-confirm. The duplicate check
refuses the second record, and the session advances. **Nothing is lost**:
the record is there, and it is the only one.

**Progression first, record second** — the session says the next component
is active. The operator moves on, and the confirmed weighing is **gone**.
The weighing happened; the record of it does not exist.

**And the second failure is the worse one, because it is undetectable.**
A missing record for a weighing that was confirmed is invisible: the batch
looks complete, the consumption posts, and the station's own history says
the component was dispensed — when there is no evidence of what was
dispensed. BRD BR-14 and DR-01 exist so that the business can reconstruct
what was weighed; a record that vanishes is exactly the failure those
requirements exist to prevent.

**So the record goes first**, and the cost — a component that looks
un-confirmed after a crash — is a cost the operator can see and recover
from by pressing the button again. **A visible, recoverable inconsistency
beats an invisible loss of evidence.**

### Why the duplicate is a CONSTRAINT, not a check

**Because a check-then-write is racy, and the race is exactly the case the
story names.**

```ts
// WRONG — racy.
if (await records.existsFor(sessionId, componentId)) {
  return refuse('ALREADY_CONFIRMED');
}
await records.save(record);
```

Two concurrent confirmations both pass the check, and **both write**. The
story's requirement — *"only one record is written"* — is not met.

**The `UNIQUE` constraint closes it atomically**, because the database
serialises the two writes and refuses the second. This is **ADR-006's
argument**, applied here: unit `008`'s idempotency ledger is *"a separate
append-only record whose `UNIQUE` constraint makes single-use atomic under
concurrency"*, and it is the reason the identity unit's ADR-006 exists at
all.

**And the repository needs no update method to say so** — the constraint
is the enforcement, the way the append-only triggers are.

### Why the progression is on the AGGREGATE

**Because the invariants are the session's, and a transition outside the
aggregate is a convention rather than a rule.**

*"Exactly one component is `ACTIVE` at a time"* and *"the confirmed
component's `DONE` state and the next component's activation happen in one
atomic transition"* are properties of the **session**. If the transition
lived in the use case, then:

- a caller could advance the session without the aggregate's checks;
- the "exactly one `ACTIVE`" invariant would be enforced in one place and
  assumed in another;
- and the two would drift — the same failure ADR-034 refused for the
  identity and the record.

**So `WeighingSession.confirm(...)` is a method**, it enforces the
invariants, and the use case is the orchestration around it: read the
recipe's order, write the record, call the transition, save the session.

### Why the recipe's ORDER is read, never written

**Because the recipe is the MES's, and C-01 says WeighingMS never modifies
it.**

The story is explicit: *"The recipe order comes from the recipe loaded at
session start; it is read-only and is never modified by WeighingMS."*

So the progression **reads** the working copy for the order and writes
nothing to it. The session holds the **states**; the recipe holds the
**order**. Two facts, two owners — and the same separation ADR-036 drew
between the session's live state and the recipe's truth.

### Why `COMPLETED` is distinct from `NO_NEXT`

**Because "the batch is finished" and "there is nothing to go on to" are
different facts, and the second one means something is wrong.**

The story: *"the last component in the recipe is confirmed → no component
becomes `ACTIVE`; the session moves to `COMPLETE`."*

So the last component's confirmation is `COMPLETED` — a **defined**
outcome, and the one that starts bolt `018`'s batch summary. `NO_NEXT`
would be the case where a `PENDING` component exists but the recipe does
not list it, which is a malformed recipe rather than a finished batch.

**Collapsing them would leave the session in an ambiguous state** — and the
ambiguity would sit exactly where the batch summary begins.

## Consequences

### Positive

- **A confirmed weighing is durable before the response** (BRD NFR-05), and
  a crash leaves a state the operator can see and recover from.
- **The session is never inconsistent** — never a `DONE` component with no
  record, never two `ACTIVE` components.
- **One record per component per session**, guaranteed atomically.
- **The progression follows the MES's order**, and the MES's recipe is
  never modified.
- **The transition is on the aggregate**, so the invariants are enforced
  wherever the transition is called from.

### Negative

- **A crash between the two writes leaves the component looking
  un-confirmed.** The operator re-confirms and the duplicate check refuses
  the second record. That is a **visible** recovery, and it is the price of
  never losing a record.
- **The duplicate refusal needs a `UNIQUE` constraint**, so the record's
  table gains one. A correction — a new record referencing the original —
  would conflict with it, and so the constraint must be on the
  **component's own confirmation** and not on the component at all. That
  means the correction needs its own column to distinguish it, and this
  ADR leaves that to the bolt that builds the correction workflow — which
  the story puts **out of this unit's scope**.
- **The progression reads the recipe** on every confirmation, so the
  use case has a dependency on the working copy. That is correct — the
  order is the MES's — and it is one read per confirmation, not per
  reading.

### Risks

- **A future agent reverses the order** "so the session advances first and
  the UI updates sooner". *Mitigation*: the decision index's "Read when"
  points here, and this ADR names the failure — a confirmed weighing that
  vanishes.
- **A future agent replaces the `UNIQUE` constraint with an existence
  check**, which reads more clearly. *Mitigation*: the same index entry;
  ADR-006 settled the argument for the identity unit's ledger, and the
  check-then-write race is the case the story names.
- **A future agent lets the client name the next component.** *Mitigation*:
  the same index entry; the order is the MES's and is read-only.

## Related

- **Stories**: `008-advance-to-next-component`
- **Requirements**: FR-14, FR-18, FR-19 · BRD FR-05, FR-06, FR-14,
  DR-01, DR-02 · NFR-3, NFR-5, NFR-6 · C-01, C-08, C-12
- **Previous ADRs**: ADR-036 (the session is the live state and it is
  persisted — the aggregate this transition belongs to); ADR-034 (the
  station's own facts are durable, and a record is immutable — the record
  this transition writes); ADR-006 (consumption is a separate append-only
  record whose `UNIQUE` constraint makes single-use atomic — the argument
  for the duplicate constraint); ADR-031 (the recipe is not persisted and
  the working copy is the station's — the order this transition reads);
  ADR-018 (no device can weigh this is a successful answer — the same
  refusal-is-a-value discipline)
- **Standards**: `standards/tech-stack.md` § "Database" — append-only rows
  for acts, and SQLite's `synchronous = FULL` for durability
