---
bolt: 010-002-recipe-material-management
created: 2026-11-05T17:05:00Z
status: accepted
---

# ADR-031: The recipe is not persisted, and the station's working copy is in memory

## Context

Unit `002-recipe-material-management` must load a batch's recipe and hold it
while the operator weighs against it (FR-3, BRD FR-05, FR-06).

The requirement set pulls in two directions, and they have to be separated
before anything can be decided:

- **FR-3** says the recipe is *"loaded into the active weighing session"* and
  *"the component list becomes the source of truth for the components to
  weigh"* — so there is a **working copy**: the recipe the station is
  working, with the component states on it.
- **BRD FR-30** says *"the station continues operating on locally held recipe
  and master data when OrgaTEX is unreachable"* — so there is a
  **local copy** that survives an outage.

And against both of those, the unit brief's own data-storage table says:

> | Recipe | Not persisted — projected from OrgaTEX | — | — |

while FR-3's own acceptance criteria say *"the recipe is fetched from
OrgaTEX **and cached locally**; it is never authored or modified locally"* —
and the story adds a third instruction:

> *"Local caching is permitted but bounded. The recipe may be cached locally
> for use during an upstream outage (BRD FR-20), but the cache is a
> read-through of the adapter's response and is not a second authoring
> source. **Cache policy and staleness ownership sit with unit 005**; this
> story does not define a separate caching scheme."*

So three things are being called "the cache", and they have different owners
and different lifetimes. ADR-021 already separated two of them for unit
`005`; the third is this unit's.

There is also a fourth question, which is the one that is actually hard: if
the recipe is held locally, **what happens across a restart?**

The plausible shapes are:

1. **A `recipes` table** — the recipe row, plus its components.
2. **An in-memory working copy** — one recipe, replaced by the next load.
3. **Both** — a persisted row *and* an in-memory working copy over it.

## Decision

**The recipe is not persisted. Unit `002` holds one in-memory working copy
and defines no cache, no freshness rule and no staleness threshold of its
own.**

1. **No table, no migration, no repository.** Unit `002` writes nothing in
   this bolt. The absence of the table is the enforcement.

2. **The working copy is in memory, and it is one copy** — the recipe the
   station is working — not a map keyed by batch id. The station weighs one
   batch at a time (A-11), and a map would be an unbounded working set with
   no eviction policy and no operator.

3. **The freshness is passed through unchanged** from unit `005`'s reader,
   exactly as unit `001` does with the queue's freshness (ADR-028). This unit
   does not re-decide staleness and does not hide it.

4. **Unit `005`'s `DEGRADED` fallback serves the outage case**, within the
   process's lifetime, and it is always served **with its age**.

5. **After a restart the read fails loudly.** There is no row to read back,
   so there is no path on which the station presents a pre-restart recipe as a
   post-restart one.

## Rationale

### Why not persist it

The mechanism is the same one ADR-021 named, and it is worth restating
because the recipe is *more* tempting to persist than the queue is — a recipe
is a bigger thing, it is referenced by the weighing session, and "the station
must keep working during an outage" sounds like durability.

A persisted recipe's `receivedAt` is written when the recipe is taken. Read
it back after a restart and the age is computed against a clock that has
since moved. The age is *mathematically correct* — which is exactly the
problem. **A correct age on a recipe whose content was true in a previous
process's world looks like a fresh-but-slow response.** It passes every
freshness check and it is wrong. The operator is handed targets they cannot
vouch for, and they weigh against them.

In memory that path does not exist. A restart empties the working copy, so
the first read either succeeds or **fails loudly**. ADR-021 already accepted
that trade: *"failing loudly after a restart is correct; serving an
unvouchable schedule is not."*

### Why the outage requirement is still met

This is the part that looks like a contradiction and is not. FR-30's
requirement is *"the station continues operating on locally held recipe and
master data when OrgaTEX is unreachable"* — and **unit `005`'s last-known-good
is exactly that**. Unit `005`'s reader already holds the last successful
recipe snapshot in a bounded, disposable in-memory cache, serves it when the
contact fails, and marks it with its age.

So the three copies are **three different things**, and the bolt's job is to
keep them apart:

| | Owner | What it is | Lifetime |
|---|---|---|---|
| The **last-known-good** | unit `005` | A **fallback** copy, served only when the contact failed, always **with its age** | The process |
| The **working copy** | unit `002` | The station's **working set** — the recipe the session is working, with the component states on it | The process |
| The **row** | — | **Does not exist** | — |

A reader asking *"what does the recipe say?"* goes to unit `002`. A reader
asking *"can we still see it?"* goes to unit `005`. Neither is a copy of the
other's answer, and **neither re-decides the other's staleness** — which is
why this unit defines no freshness threshold of its own.

### Why the absence of the table matters more than the code

A `recipes` table would be an **invitation**. A future agent finding it would
serve a row from it as though it were the recipe, and the row's age would be
a *column* rather than a guarantee — and a column is exactly what a
stale-looking-fresh read needs in order to look fine. The same reasoning as
ADR-009 (weight readings are never persisted) and ADR-015 (the tare is never
persisted): **the absence of the path is what makes the rule structural.**

### Why one copy and not a map

The station weighs **one batch at a time** (A-11 — one station, one site in
V1). A map keyed by batch id would be a working set with no eviction policy,
no bound and no operator — a memory leak with an operational purpose
attached to it. And the story's own edge case settles the rest: *"the
already-loaded recipe for the active session is unchanged"* — the working copy
is replaced by an **explicit load**, never by a background re-read.

### Why the freshness is passed through and not re-derived

Unit `005` owns the **freshness window** — it is unit `005`'s configuration
(BRD NFR-14), and unit `005`'s reader is the thing that decides whether a
snapshot is `CURRENT` or `STALE`. If this unit re-decided staleness, there
would be two thresholds for one question, and they would eventually disagree
— the same failure ADR-028 refused for the queue.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|---|---|---|---|
| **A `recipes` table** | Survives a restart; the session can reference a row | A pre-restart `receivedAt` makes a correct age on a pre-restart world look like a fresh-but-slow response; creates a table that invites a future agent to serve a row as the recipe | **Rejected.** The failure is invisible when it happens, and the absence of the table is what makes the rule structural (ADR-009, ADR-015, ADR-021) |
| **A map of recipes keyed by batch id** | The operator could switch back to a previous batch without a re-read | An unbounded working set with no eviction policy and no operator; contradicts one-batch-at-a-time (A-11) | **Rejected.** YAGNI on a scope the product does not have, and the story says the active session's recipe is unchanged |
| **This unit defines its own freshness window and its own cache** | Self-contained; would survive an MES outage even if unit `005`'s cache were evicted | A **second** answer to "how old may a recipe be"; two caches for one recipe; two sources of truth | **Rejected.** The story says cache policy and staleness ownership sit with unit `005`, and this story does not define a separate caching scheme |
| **Persist the recipe but recompute the age on read** | The age would always be "now" | Destroys the age, which is the only thing that distinguishes a fallback from a current read | **Rejected.** It makes the failure undetectable |
| **In memory, one copy, freshness passed through** (adopted) | The stale-looking-fresh path is impossible by construction; no schema, no migrations, no retention obligation; the outage case is served by unit `005`'s fallback with its age | After a restart the recipe read fails loudly rather than serving a pre-restart recipe | **Adopted.** Failing loudly after a restart is correct; serving an unvouchable target is not |

## Consequences

### Positive

- **The stale-looking-fresh path is impossible**, not merely guarded
  against.
- **Unit `002` has no tables, no migrations and no repositories** — so no
  schema to migrate, no data to corrupt, and no retention obligation for
  data the station does not own.
- **One freshness answer.** The threshold that decides "stale" lives in one
  place, and the recipe's freshness is the queue's freshness.
- **The seam has one reader.** Unit `002` reads through unit `005`'s reader,
  so there is one contact per read and one cache for the recipe.
- **The recipe is provably read-only.** With nothing persisted and no write
  verb in the API, there is no path by which a target could be edited — the
  read-only rule (BRD BR-04, C-01) is structural rather than a convention.

### Negative

- **After a restart, a recipe read fails loudly** even though the MES may
  have been reachable a moment ago. The operator sees an error instead of a
  recipe.
- **The working copy is lost on every restart**, so the outage fallback
  covers a **network** outage, not a **process** restart.
- **The working copy is not shared between processes.** If the API ever runs
  as more than one process, each holds its own — acceptable while it is the
  working set, and the reason it must not become a second source of truth.
- **A future requirement to survive a restart with a recipe** — *"resume the
  batch after the machine was power-cycled"* — would require revisiting this
  ADR. That is the intended cost. The right answer to that requirement is
  probably a **session** record (unit `003`'s), not a persisted recipe: a
  session is the station's own fact and may be written down; a recipe is the
  MES's.

### Risks

- **A future agent adds a `recipes` table** to survive restarts, and serves
  rows as though they were the recipe. *Mitigation*: the decision index's
  "Read when" points at exactly this, and this ADR names the
  stale-looking-fresh mechanism so a reader can recognise it.
- **A future agent gives unit `002` its own freshness window** because the
  recipe "needs a longer window than the queue". *Mitigation*: the same
  index entry, and the story's own instruction that the staleness ownership
  sits with unit `005`.
- **Unit `003` needs the recipe after a restart** and reaches for this
  ADR's in-memory copy. *Mitigation*: the requirement is a **session**
  record, and unit `003` owns sessions; this ADR's consequences name that
  explicitly.

## Related

- **Stories**: `001-retrieve-recipe-and-component-list`
- **Requirements**: FR-3, FR-30 · BRD FR-05, FR-06, FR-20, BR-04 · NFR-3,
  NFR-14, NFR-16
- **Previous ADRs**: ADR-021 (the snapshots are not persisted, but the
  last known-good is held in memory — the same reasoning, and the source of
  the two-cache distinction this ADR extends to unit `002`); ADR-028 (the
  station owns its own endpoint and passes unit `005`'s freshness through
  unchanged — the rule this ADR applies to the recipe); ADR-009 (weight
  readings are never persisted) and ADR-015 (the tare is never persisted) —
  the same absence-is-the-enforcement argument, one level down
- **Standards**: `standards/tech-stack.md` § "Database" — the stack names
  SQLite for the product's durable records; this unit has none
