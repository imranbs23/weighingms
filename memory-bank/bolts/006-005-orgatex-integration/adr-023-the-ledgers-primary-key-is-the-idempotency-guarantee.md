---
bolt: 006-005-orgatex-integration
created: 2026-11-02T21:40:00Z
status: accepted
superseded_by: null
---

# ADR-023: The ledger's primary key is the idempotency guarantee

## Context

BRD IR-08 requires that consumption posting be **idempotent**: posting
the same consumption twice must not double-count it, and the story names
the failure precisely:

> "The MES accepts the posting but the response is lost | The posting's
> state is unknown. A retry carries the same key and the MES-side effect
> occurs once, not twice."

And the edge case that makes it a real concurrency question:

> "Two postings for the same component and batch are submitted
> concurrently | The local guard admits exactly one; the other is refused
> as a duplicate."

So the mechanism must be **atomic**, not merely *present*. A guard that
reads "has this key been seen?", finds no, and then writes, has a window
between the read and the write in which a second submission gets through.

The unit brief names the fallback: *"the key is generated and tracked
locally and carried on the request. If the real contract does not support
it, the fallback is a local deduplication table, and the behaviour is
unchanged from the caller's point of view."*

A **table**. The brief's word, and it is the right one — because a table
with a unique constraint does not have a read-then-write window. The
constraint *is* the check, evaluated by the database at the moment of the
write.

The question this ADR answers is not "shall we deduplicate" — the story
says we must. It is **where the guarantee lives**, because that decides
what a future agent can break without noticing.

## Decision

**The idempotency ledger is a table whose PRIMARY KEY is the idempotency
key. The uniqueness constraint IS the guard.**

```text
idempotency_ledger
├── idempotency_key   TEXT PRIMARY KEY   ← the guarantee
├── posting_id        TEXT NOT NULL
└── recorded_at       TEXT NOT NULL
```

There is no "check then insert" step. The service attempts the insert;
the database either accepts it or raises a UNIQUE violation; and that
violation **is** the duplicate refusal.

**The ledger is written only when a posting is `ACCEPTED`.** A `QUEUED`
posting's key is not in the ledger — it is in the sync queue that bolt
`007` owns, and the enqueue guard reads **both**.

**The ledger has no delete path.** Not "no delete for now" — the
repository interface has no such method, so there is nothing to call. A
consumed key is consumed forever (BRD DR-01, ≥ 5 years).

### The ledger is a separate table from the postings

They could be one table, and the ledger is the smaller one. They are
separate because they answer **different questions** with different
lifetimes:

- The **ledger** answers *"has this key ever been consumed?"* — a yes/no.
  It is the **deduplication index**.
- The **postings** answer *"what did we try to send, and what happened?"*
  — a history.

Keeping them apart means the dedup check does not have to parse a
posting's state to answer a question about a key.

## Rationale

### Why the constraint, and not a check

A check-then-insert guard has a **race window**. Two concurrent
submissions of the same key both read "not present", both proceed, and
both write. The story's edge case says the guard must "admit exactly
one", and a check-then-insert guard admits two under exactly the
concurrency the story names.

The alternative is to serialise the check — a lock, a transaction with an
explicit isolation level. Both work, and both are more machinery than a
primary key. The constraint is the **database doing the thing the
database is for**.

The argument is the same one ADR-006 used for authorisation consumption:
the single-use rule is expressed by the **database**, because the
database is the only thing that can enforce it under concurrency.

### Why the key is the PRIMARY KEY, and not a UNIQUE column

The distinction is `NOT NULL` plus uniqueness versus uniqueness alone. A
primary key cannot be null, and — more importantly — it makes the key
the table's **identity**. The ledger row *is* the fact "this key was
consumed". A row with a surrogate id and a unique key column says
something slightly different: "there is a ledger row with this key", which
is one indirection away from the fact.

It also makes the lookup free. The dedup check is a primary-key lookup,
not a scan.

### Why the ledger is separate from the postings

The alternative — a `state` column on the postings, and "has this key been
seen?" answered by querying the postings — was rejected for a specific
reason: **the dedup check would have to know which states count**.

An `ACCEPTED` posting's key must never be sent again. A `QUEUED`
posting's key must never be re-enqueued. A `REJECTED` posting's key
**may** be re-driven, because CQ-06's disposition decides that. So the
answer to "has this key been seen?" depends on the posting's state, and
the state **changes** — which means the dedup check is reading mutable
data to make a safety decision.

The ledger removes that dependency. It contains exactly the keys that may
never be used again, and it never changes. The dedup check reads an
immutable set.

### Why there is no delete

DR-01 requires ≥ 5-year retention. A delete method would make retention a
matter of remembering not to call it, and a retention policy that *could*
be defeated is not a retention policy.

The absence is the enforcement — the same reasoning as ADR-006's
append-only authorisations and ADR-009's missing reading repository.

## Consequences

### Positive

- **The duplicate refusal is atomic.** Two concurrent submissions of the
  same key cannot both be admitted. The story's edge case is satisfied by
  construction rather than by careful code.
- **The dedup check is a primary-key lookup** — no scan, no index choice.
- **The guard cannot be forgotten.** There is no code path that skips it,
  because the guard is not a code path; it is a constraint.
- **The key set is immutable.** The dedup decision never reads mutable
  state.
- **Retention is structural.** No delete method exists to be called.

### Negative

- **The ledger and the postings can disagree.** Nothing at the schema
  level forces a ledger row for every accepted posting. The transaction
  that writes them together is what keeps them consistent, and a bug in
  that transaction could produce a posting with no ledger entry.
- **A key in the ledger is a key that can never be re-used** — including
  by a *different* weighing that happens to hash to the same value. That
  is the collision case, and it is a lost consumption. 64 bits makes it
  negligible, but it is not zero.
- **The ledger grows forever.** That is the requirement, but it does mean
  a table that only ever grows.

### Risks

- **A future agent adds an `idempotency_key` column to the postings table
  and treats that as the guard.** The behaviour would look right — the
  column exists, the key is stored — but the **atomicity** would be gone,
  because a `UNIQUE` column on the postings table is checked when the
  posting is written, and a posting is written *before* the send. Two
  concurrent submissions would both create their posting before either
  reached the send. *Mitigation*: this ADR, and the decision index's
  "Read when" points at exactly this.
- **A future agent adds a `delete` to the ledger repository** to "clean
  up old entries" — which would let a five-year-old key be re-used and
  double-count an old consumption. *Mitigation*: the same index entry; the
  absence is the point.
- **A future agent treats the ledger's `find` as sufficient and skips the
  insert's constraint** — reading the key to decide, then posting without
  recording it. *Mitigation*: the same index entry. The write is what
  guards.

## Related

- **Stories**: 003-post-consumption-idempotently
- **Requirements**: FR-16, BRD IR-08, BRD DR-01, BRD DR-02, BRD IR-09
- **Previous ADRs**: ADR-006 (consumption as a separate append-only
  record — the same "the database enforces the rule" argument, applied to
  single-use authorisations); ADR-009 (weight readings are never
  persisted — the same reasoning about what a durable record means, for
  the opposite case); ADR-021 (the snapshots are not persisted — the
  asymmetry this ledger completes)
- **Standards**: `standards/tech-stack.md` § "Database" — SQLite via
  `node:sqlite`, decimal columns as TEXT, migrations in
  `schema_migrations`
