---
bolt: 005-005-orgatex-integration
created: 2026-11-02T18:57:00Z
status: accepted
superseded_by: null
---

# ADR-021: The snapshots are not persisted, but the last known-good is held in memory

## Context

FR-20 requires that the station keeps working when OrgaTEX is unreachable,
and both stories in this bolt require the same thing in the same words:

> "the read fails loudly with the error, and the last successful snapshot is
> served only when the link state is `DEGRADED`, marked with its age — never
> presented as current."

So the unit must hold **a last successful snapshot**, and hold it in a way
that satisfies a strict requirement: the snapshot served must be
**distinguishable from a current one**, and must carry **its age**.

The question is *where* that snapshot lives. There are three plausible
answers, and each of them is wrong in a different way.

**Persisted (SQLite).** The obvious choice, and the one the unit brief
suggests for durability — "the queue is durable, the snapshots are not" is
not the brief's wording, but the brief does say the sync queue and the
idempotency ledger are SQL while the queue and the recipe are "not
persisted — projected live from OrgaTEX".

**Not held at all.** The brief says the snapshot is a projection that "can
always be re-fetched" — so why keep it?

**In memory.** A bounded, disposable cache that dies with the process.

The tension is that FR-20 asks for a fallback and the brief says nothing is
persisted, and both are right. They are about **different things**, and
collapsing them is the mistake.

The second tension is the harder one. The scale unit has already settled
the general principle twice — ADR-009 (readings are never persisted) and
ADR-015 (the tare is never persisted) — and both were about a **stale value
read back as if it were current**. This unit is about a **stale snapshot
read back as if it were current**, which is the same failure one level up.

## Decision

**Two separate things, with two separate owners and two separate lifetimes.**

| | Owner | Lifetime | Why it exists |
|---|---|---|---|
| **The last-known-good snapshot** | **This unit (`005`)** | **In memory.** Bounded. Disposable. | To serve a `DEGRADED` read with its age (FR-20) |
| **The working copy of the recipe** | **Unit `002`** | Unit `002`'s business | The station's working set while weighing offline (FR-30) |

**This unit persists nothing.** No table, no migration, no repository
interface. The last-known-good lives in a bounded in-memory cache.

**The rule that makes it safe:** a snapshot served from the cache is served
**with its age**, and the response carries a `freshness` field that says
which it is. There is no code path that returns a cached snapshot
indistinguishably from a fresh one.

**And the corollary, which is why the cache is in memory rather than
persisted:** after a restart the cache is empty, so the first read either
succeeds or **fails loudly**. There is no path on which the station shows a
schedule it cannot vouch for.

## Rationale

### Why not persist it

A persisted snapshot would be a **stale-looking-fresh** risk, and the
failure is invisible when it happens.

The mechanism: the snapshot's `receivedAt` is written when the snapshot is
taken. If it is persisted, then it is read back after a restart — and the
age is computed against a clock that has since moved. The age is *correct*
(mathematically), which is exactly the problem: **a correct age on a
snapshot whose content was true in a previous process's world** looks like
a fresh-but-slow response. It would pass every freshness check and be
wrong.

The in-memory cache makes that impossible by construction. A restart empties
it. There is no row to read back, so there is no way to present a
pre-restart snapshot as a post-restart one.

**And there is no loss.** A snapshot is a projection of a system the station
does not own. If it is lost, the MES can produce it again. Nothing about
the station's *record* depends on it — the durable facts (the weighing
record, the sync queue, the idempotency ledger) live in other units, and
they are persisted.

The absence is what makes the rule structural. A `batch_queue` table would
be an **invitation**: a future agent finding it would serve a row from it
as though it were the queue, and the row's age would be a column rather
than a guarantee. This is the same reasoning as ADR-009 and ADR-015.

### Why hold it at all

Because FR-20 requires it, and because the alternative is a station that
loses its work list the moment the MES blinks.

The brief's own framing supports this: the queue *"is owned here and only
here, because only this unit knows whether what it returns is current"*.
This unit is the only place that can serve a stale snapshot **marked with
its age**, so this unit is the only place that can hold it.

### Why the working copy is unit `002`'s

Because unit `002` owns the **recipe's contents** as the station's working
set, and the weighing session reads from it. This unit returns the snapshot
it obtained and its age; it does not keep a second copy of the recipe's
*meaning*.

**The two caches hold the same data for different reasons, and they are not
two sources of truth.** The last-known-good is a **fallback copy with a
mandatory age**; the working copy is the **station's working set**. A
reader asking "what does the recipe say?" goes to unit `002`. A reader
asking "can I still show the queue?" goes here.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **Persist the snapshots in SQLite** | Survives a restart; the "durability" argument for anything the station depends on | A snapshot written before a power cut and read back afterwards carries a pre-restart `receivedAt`, and its *correct* age makes it look like a slow-but-live response. Creates a table that invites a future agent to serve a row as the queue | **Rejected.** The failure is invisible when it happens, and the absence of the table is what makes the rule structural (ADR-009, ADR-015) |
| **Hold nothing** | Simplest possible rule; every read either succeeds or fails | FR-20's `DEGRADED` fallback has nothing to serve. The station loses its work list on every MES blink | **Rejected.** The requirement is explicit in both stories |
| **Persist only the queue, not the recipes** | The queue is the operator's primary work list | Same stale-looking-fresh mechanism, applied to the one thing the operator looks at most | **Rejected.** The distinction does not fix the failure; it only limits where it happens |
| **In memory, bounded, disposable, never persisted** (adopted) | The stale-looking-fresh path is impossible by construction; the cache dies with the process; nothing is lost because the MES is the master | A `DEGRADED` read after a restart fails loudly instead of serving the pre-restart queue | **Adopted.** Failing loudly after a restart is correct; serving an unvouchable schedule is not |

## Consequences

### Positive

- **The stale-looking-fresh path is impossible**, not merely guarded
  against.
- The unit has **no tables, no migrations and no repositories** — and
  therefore no schema to migrate, no data to corrupt, and no retention
  obligation.
- The `freshness` field is **load-bearing**: every response carries it, so
  a consumer cannot accidentally treat a stale snapshot as current.
- The cache is **bounded and flat in memory**, regardless of shift length.
- The unit's persistence story stays honest: the **sync queue** (bolt 007)
  and the **idempotency ledger** (bolt 006) are persisted, because an
  unlanded posting cannot be re-derived by asking the MES.

### Negative

- **After a restart, a `DEGRADED` read fails loudly** even though the MES
  may have been reachable a moment ago. The operator sees an error instead
  of a stale list.
- The last-known-good is **lost on every restart**, so the `DEGRADED`
  fallback covers a network outage, not a process restart.
- The cache is **not shared** between processes. If the API ever runs as
  more than one process, each holds its own copy — which is acceptable
  (they are all fallback copies) but means the fallback's contents differ
  per process.
- A future change that needs the snapshot to survive a restart — a
  "show me last week's queue" feature, say — would require revisiting this
  ADR. That is the intended cost.

### Risks

- **A future agent adds a `batch_queue` table** to survive restarts, and
  serves rows as though they were the queue. *Mitigation*: the decision
  index's "Read when" points at exactly this, and this ADR states the
  stale-looking-fresh mechanism by name so a reader can recognise it.
- **A future agent persists the cache "just to be safe"** — which is the
  failure mode this ADR exists to prevent, and which would reintroduce the
  invisible failure. *Mitigation*: the same index entry.
- **Bolt 007's link state and this unit's freshness window disagree** about
  what "recent" means. *Mitigation*: the freshness window is **configuration**
  in this unit's config module, so bolt 007 can align it without a code
  change. This is recorded in the design as a known open point.

## Related

- **Stories**: 001-read-released-batch-queue, 002-read-batch-recipe
- **Requirements**: FR-1, FR-3, FR-20, FR-30, BRD IR-01, BRD IR-02,
  BRD NFR-03, BRD NFR-05, BRD DR-03
- **Previous ADRs**: ADR-009 (weight readings are never persisted) — the
  same reasoning one level up; ADR-015 (the tare is never persisted) — the
  same reasoning for a device's zero reference
- **Standards**: `standards/tech-stack.md` § "Database" — the tech stack
  names SQLite for the product's durable records; this unit has none
