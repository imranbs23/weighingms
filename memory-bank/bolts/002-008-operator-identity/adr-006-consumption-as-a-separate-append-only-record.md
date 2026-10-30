---
bolt: 002-008-operator-identity
created: 2026-10-30T18:10:00Z
status: accepted
superseded_by: null
---

# ADR-006: Consumption is a separate append-only record, not a flag on the authorisation

## Context

The story requires that an authorisation be **single-use**: "Given an
authorisation has already been used successfully once, when it is presented
a second time, then the second use is refused."

It also requires, in the same set of criteria, that the authorisation be
**append-only** and that the justification be retained for **at least 5
years** (BRD DR-01, DRD DR-02 — audit records are immutable, corrections
are written as new records referencing the original).

Those two requirements pull in opposite directions on a single obvious
implementation.

The obvious implementation is a flag on the authorisation row:

```text
supervisor_authorisations
  id, session_id, supervisor_id, action, subject, reason,
  authorised_at, expires_at,
  consumed_at      TEXT NULL      ← set to now() when the authorisation is used
```

It is simple, it needs one table, and "is this spent?" is a column read.
It is also the design most developers will reach for first, which is
precisely why the alternative needs recording.

The problem is that **setting `consumed_at` mutates the authorisation
row**, and the authorisation row is a record of a privileged action that
must be immutable. Once consumed, the record of *what was authorised* and
*when* is no longer the record that was created — it is a record with an
extra field, and the extra field is a fact about a **later** event (the
consumption) rather than about the authorisation.

That distinction matters for three reasons.

**1. Immutability (BRD DR-02).** The weighing record, the audit entry
and the authorisation are the three records a compliance review looks at.
If consuming an authorisation mutates it, then the record's content
depends on whether anyone has looked at it since. A reviewer comparing two
copies of the database taken at different times would see different
authorisation rows, and would have no way to tell whether the difference
was a legitimate correction or a consumption.

**2. Two facts, two records.** "This was authorised" and "this was used"
are two distinct facts with two distinct times. Collapsing them into one
row with a nullable timestamp means one record has to carry a fact it did
not hold at creation, and the "when" of each is a column rather than a
value.

**3. The unit's own boundary.** The unit brief says the authorisation
record is "append-only", and Stage 1's aggregate rule states: "It is
**append-only** — never updated, never deleted (BRD DR-01, DR-02)." A
`consumed_at` column is an update by definition.

There is a second design that avoids the mutation and is also tempting:

```text
supervisor_authorisations
  id, ..., consumed BOOLEAN NOT NULL DEFAULT 0   ← a boolean flag
```

It is worse. A boolean cannot record *when* the authorisation was used, or
*by whom*, or *against which action and subject*. It turns "used" into a
piece of the authorisation's identity rather than a fact about the world.

## Decision

**Consumption is recorded as a separate, append-only record.**

```text
authorisation_consumptions
  id               TEXT PRIMARY KEY
  authorisation_id TEXT NOT NULL UNIQUE      ← the single-use rule
  action           TEXT NOT NULL
  subject          TEXT NOT NULL
  consumed_at      TEXT NOT NULL
```

The authorisation table has **no** `consumed_at` column and **no**
`consumed` flag. It is never updated and never deleted.

### The single-use rule becomes an existence question

An authorisation is spent **if and only if** a consumption record exists
for it:

```text
isSpent(authorisationId)  ⟺  exists consumption where authorisation_id = ?
```

This is the direct consequence of the decision, and it is what makes the
rule work at the storage layer as well as in the service.

### The `UNIQUE` constraint is the enforcement, not the check

`authorisation_consumptions.authorisation_id` carries a `UNIQUE`
constraint. The service *also* performs an existence check before
inserting, but the check is not the guarantee.

**The check-then-insert sequence in the service is racy.** Two concurrent
consume requests for the same authorisation can both observe "not spent"
and both proceed to insert. With the `UNIQUE` constraint, the second
insert fails at the storage layer and is reported as a refusal
(`ALREADY_USED`). Without it, both would succeed, and the single-use rule
would be enforced only when requests happen not to overlap.

So:

- **the service's existence check** produces a *good error message* and
  handles the ordinary case;
- **the database's `UNIQUE` constraint** produces the *correct outcome*
  under concurrency.

This mirrors how bolt `001` treats the session token: `token_hash UNIQUE`
guarantees at the storage layer that two sessions cannot share a token,
rather than relying on the generator's discipline.

### The consumption record carries its own scope

The consumption stores `action` and `subject` — the scope it was applied
to. They equal the authorisation's scope (Stage 1's invariant 3 on the
consumption aggregate), and storing them means the consumption record is
self-describing: a reader of the consumption table alone can see what was
applied, without joining back to the authorisation.

This is a small redundancy, and it is deliberate. The same reasoning
appears in bolt `001`'s `OperatorStamp` — an immutable snapshot taken at
the moment of the action so that a later change cannot rewrite history.
The consumption is a snapshot of the application of the authorisation.

### The `AuthorisationRepository` interface has no `update` and no `delete`

The prohibition is at the **interface**, not merely in the SQL. There is
no method to call that would mutate an existing authorisation, so the
prohibition is structural: a future developer cannot add a
"mark consumed" method to the repository without that method not existing
to be called.

## Rationale

**Why the record and not a flag.** Because a flag makes the record's
content depend on whether the record has been acted upon. The audit
question "what was authorised, when, by whom, and why?" must have the
same answer in year five as it had in year one. A separate record answers
it forever, and the answer to "was it used?" is a separate, equally
permanent question.

**Why the consumption is not a child of the authorisation.** If the
consumption were owned by the authorisation — deleted with it, or
constrained to its lifetime — then deleting an authorisation would delete
the evidence that it was used. The authorisation is retained ≥ 5 years
(DR-01), but the reasoning holds independently: the audit trail's account
of an exception must remain verifiable, and "verifiable" means the
evidence of use must not be destroyable by removing the thing that was
used. Two independent aggregates with independent retention is what makes
that true.

**Why not a separate table with a non-unique foreign key.** Because the
single-use rule must be atomic. Without `UNIQUE`, the table would record
*that* a consumption happened, but not *that at most one* did — and the
rule would be enforced only by the service's check, which is racy. The
constraint is what turns "at most one consumption" from a hope into a
property of the schema.

**Why not delete the consumption after use, or mark it.** Same reasoning
as the authorisation: it is a fact about what happened, and facts about
what happened are not deleted.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **`consumed_at` column on the authorisation** | One table; simple; "is it spent?" is a column read | **Mutates the authorisation**, breaking BRD DR-02's immutability; the record's content depends on whether it has been used; the consumption's own time and scope have nowhere to live | Violates the append-only requirement the same story set states |
| **`consumed BOOLEAN` flag on the authorisation** | One table; simplest | Mutates the authorisation; a boolean cannot record when, by whom, or against what; no useful error message can distinguish "used at 14:32" from "used at 09:15" | The same mutation problem, with less information retained |
| **A separate consumption table with a non-unique FK** | The authorisation is not mutated; the record is separate | Single-use is enforced only by a racy service check; concurrent double-consume can both succeed | The constraint is the guarantee; without it the rule has a hole |
| **A separate consumption table with `UNIQUE` on `authorisation_id` (chosen)** | The authorisation is never mutated; the rule is atomic under concurrency; the consumption is self-describing and retains its own time and scope | One extra table; an extra insert on the consume path | The cost is one table and one insert, against a correctness hole and an immutability breach |
| **Delete the authorisation row when it is consumed** | The spent authorisation cannot be replayed at all; one table | **Destroys the record of what was authorised** — the justification, the supervisor, the time — which is exactly what DR-01 requires retained for 5 years and what FR-24 requires the record to carry | The retention requirement is not negotiable |
| **Store consumption as a field on the audit trail's event** | No new table | The audit trail belongs to unit 006; unit 008 creating or depending on audit-trail state gives the trail two owners, and the single-use check would then depend on a unit that does not exist yet | Architectural boundary violation; also makes the rule depend on another unit's storage |

## Consequences

### Positive

- **The authorisation record is immutable in fact, not just in intent.**
  There is no column that changes and no method that changes it.
- **"What was authorised" and "was it used" are independently permanent.**
  Both answers survive for the full retention period.
- **Single-use is atomic under concurrency.** Two simultaneous consume
  requests produce exactly one success and one `ALREADY_USED` refusal,
  enforced by the schema rather than by a racy check.
- **The consumption is self-describing.** It carries its own action,
  subject and time, so the table can be read on its own.
- **The rule is testable in isolation.** "Is this authorisation spent?" is
  an existence query against one table — no authorisation load, no join,
  no policy evaluation.
- **The consumption aggregate is a domain fact, not a flag**, so the
  domain model, the schema and the API all describe the same thing.

### Negative

- **One more table and one more insert** on the consume path. The consume
  path goes from one write to two (the consumption insert; the
  authorisation itself is not written at consume time).
- **"Is this spent?" costs a lookup.** With a flag on the authorisation it
  would be free — the row would already be loaded. Now it is a separate
  query, or a join.
- **A developer reading the schema alone may not see the single-use
  rule.** It is expressed as a `UNIQUE` constraint rather than as a
  boolean, which is less obvious at a glance. This ADR and the migration
  comment are the remedy.

### Risks

- **Risk: a future developer adds a `consumed_at` column "for convenience"
  or for a reporting query**, reintroducing the mutation. *Mitigation*:
  this ADR; the repository interface has no update method, so the column
  would have to be written by raw SQL outside the port; and the Stage 5
  test suite asserts that consuming an authorisation leaves its row
  byte-for-byte unchanged.
- **Risk: a future developer adds a `consumed` boolean to the
  `AuthorisationRepository` interface** to make the check cheaper, and
  implements it by writing to the authorisation. *Mitigation*: the same
  test — the authorisation row must be unchanged after consumption —
  catches it, because the two would disagree.
- **Risk: the extra insert is forgotten, so consumption is recorded but
  the authorisation is not marked spent**, allowing a replay. *Mitigation*:
  the consume operation performs both operations as a unit; the Stage 5
  test suite asserts that a second consume of a successfully consumed
  authorisation is refused.
- **Risk: a future "clean up old authorisations" job deletes rows in a
  cascade that takes the consumption with it.** *Mitigation*: the
  consumption is a separate aggregate with its own retention, and no
  cascade from the authorisation is declared on the foreign key.

## Related

- **Stories**: `002-authorise-privileged-action-as-supervisor` ·
  `007-escalate-non-compensable-overdose` (unit 003 — consumes the
  authorisation)
- **Requirements**: FR-13, FR-21, AC-06 · BRD FR-35, BRD FR-36, BRD
  NFR-13, BRD DR-01, BRD DR-02
- **Standards**: `memory-bank/standards/tech-stack.md` — the Database
  section already states the append-only rule ("Records are append-only:
  DR-02 requires confirmed records to be immutable, with corrections
  written as new records referencing the original"). This ADR is that rule
  applied to the authorisation's consumption.
- **Previous ADRs**: ADR-002 (the same "the schema guarantees it, not the
  generator's discipline" reasoning, applied to session token
  uniqueness)
