---
bolt: 013-003-weighing-station
created: 2026-11-06T03:00:00Z
status: accepted
---

# ADR-036: The session is the live state and it is persisted; the weighing record is the act and it is not

## Context

Unit `003-weighing-station` owns the session state machine, and it is the
**pivot of the whole product** — the only thing that knows which component
is being weighed, on which scale, and what the scale last said.

That creates a question the product has not answered anywhere else, and
the answer is not obvious because the unit has **two** kinds of data in it:

1. **The session** — the *live state* of the work. It changes as the
   operator works: a component becomes active, the weight updates ten times
   a second, the scale disconnects.
2. **The `WeighingRecord`** — the *record of a completed act*. It is
   written once, when the operator confirms, and it never changes (BRD
   DR-02, C-12).

Everything else in this repository has settled the mutable/immutable
question by analogy, and this unit holds **both** kinds at once. So the
question has to be answered explicitly, rather than inherited.

**And there is a requirement that forces persistence.** Invariant 7: *"a
session is resumable at the component in progress after an interruption"*
(NFR-06). The operator's shift ends, the machine is power-cycled, or the
station crashes — and the operator returns to the component in progress. So
the session's state must survive a restart.

**Which means the session is persisted.** And that is uncomfortable,
because this repository has three ADRs saying that persisting something in
this product is dangerous:

- **ADR-021** — the snapshots are not persisted, because a persisted
  snapshot is a *stale-looking-fresh* risk.
- **ADR-031** — the recipe is not persisted, for the same reason.
- **ADR-015** — the tare is never persisted, because a stale tare is a
  **wrong number**.

A naïve reading of those three would say: *persist nothing, in this unit
either.* And that reading would break the resumption requirement outright.

## Decision

**The session is persisted and MUTABLE. The `WeighingRecord` is persisted
and IMMUTABLE. Two kinds of persistence, two reasons.**

1. **The session is the station's own live state.** It is not a projection
   of anybody's truth — the MES has no idea which component the operator is
   dispensing — and it cannot be re-derived, because only the station knows
   where the operator got to. So it is persisted.

2. **The session is MUTABLE, because it is not a record of a completed
   act.** There is no history of "the session was in `WEIGHING` at 08:14"
   that anyone needs — the session's value is *now*. It is updated in place.

3. **The `WeighingRecord` is IMMUTABLE**, and it is a **different table**
   (bolt `017`). It is the record of something that physically happened,
   and BRD DR-02 forbids revising it.

4. **The session's table carries the last accepted reading's SEQUENCE.**
   The out-of-order guard is therefore **durable**: a reading replayed
   after a restart is still rejected, rather than being accepted because
   the in-memory guard was lost with the process.

5. **The session holds NO quantity that is somebody else's truth.** The
   target, the tolerance and the scale class come from the recipe (unit
   `002`), and the tare from the assignment (unit `002`). The session holds
   only the *live* facts: which component, which scale, what the scale last
   said.

## Rationale

### Why the stale-looking-fresh risk does not apply

ADR-021, ADR-031 and ADR-015 all refuse to persist something, and all
three have the **same** mechanism:

> *A persisted record's `receivedAt` is written when the record is taken.
> Read it back after a restart and the age is computed against a clock that
> has since moved. The age is mathematically correct — which is exactly
> the problem: a correct age on a record whose content was true in a
> previous process's world looks like a fresh-but-slow response. It passes
> every freshness check and it is wrong.*

**The mechanism is about a record of a SNAPSHOT — something that was true
at a moment and is re-read later as though it were true now.**

The session is not a snapshot. It is the **current state of work in
progress**, and it is explicitly *not* current once the process is gone —
the operator's session ended with the power cut. Reading it back after a
restart says *"the session was at component DYE-4471-Y when the station
died"*, which is **exactly the right thing to say** and exactly what
resumption needs.

**And the failure mode is the opposite.** A stale-looking-fresh snapshot
fails by being *indistinguishable from current*. A stale session fails by
being **obviously stale** — the operator returns to a screen that says
*"component DYE-4471-Y was in progress"*, and the weight is either absent
or explicitly marked stale. There is no way to mistake it for live
weighing, because **the scale is not bound to a running session any more**.

**The one number that could be stale-looking-fresh is the weight.** So the
session marks it: `weight_stale`. And the tare — which ADR-015 refuses to
persist — is **not** in the session at all. It is the device's, and the
device re-establishes it when the container is placed on it.

### Why the session is mutable and the record is not

Because **they are different kinds of thing**, and conflating them produces
one of two wrong outcomes.

**If the session were append-only**, every reading would be a row — ten a
second, for every weighing. The table would grow without bound, and the
"current weight" would be a query over a growing history rather than a
field. And a correction to the session's state — the operator re-selects a
component — would be a new row, with a rule about which row is current.
**The session's value is `now`; a history of it has no consumer.**

**If the `WeighingRecord` were mutable**, a confirmed weighing could be
edited — and BRD DR-02 forbids it, and the reason is a compliance one: a
confirmed weighing is the evidence in a shade-failure investigation, and
evidence that can be edited is not evidence.

**So the split is not a convenience — it is the whole of DR-02 applied
correctly.** DR-02 protects the **record of an act**. It says nothing
about the state of work in progress, because a state of work in progress
is not a fact about the past.

### Why the sequence is persisted

Because **the out-of-order guard is only a guard if it survives.**

Unit `004`'s readings carry a strictly increasing `sequence` per device
(S-3), and the guard is what rejects a late reading. If the last accepted
sequence lived only in memory, then after a restart the guard's floor
would be zero — and a buffered or replayed reading from before the
restart would be **accepted** as current.

That is precisely the stale-looking-fresh failure, in the one place this
bolt could have introduced it. Persisting the sequence alongside the
weight closes it: the floor is the last accepted sequence **as of the
moment the station died**, and a replayed reading is below it.

**And it is the last accepted sequence, not the highest seen** — because
a reading that was *discarded* (wrong unit, wrong scale) must not move
the floor. A discarded reading was never accepted, so it is not part of
the accepted history.

### Why the session holds no other unit's quantities

Because **a second copy of somebody else's truth is a second source of
truth**, and this repository has refused that four times now (ADR-021,
ADR-031, ADR-032, ADR-034).

The target, the tolerance and the scale class belong to the recipe
(unit `002`); the tare belongs to the assignment (unit `002`); the device's
capability and calibration belong to the device (unit `004`). The session
reads them — through ports — at the moment it needs them, and **does not
copy them into its own row**.

**The one exception is deliberate**: the session holds the *selected scale
id*, because that is the session's own binding decision — not the device's
facts. And the `WeighingRecord` will snapshot the scale's class and
capacity at confirmation (bolt `017`), because that is the record's own
requirement (BRD FR-25).

## Consequences

### Positive

- **The session is resumable** — which invariant 7 requires and nothing
  else could deliver.
- **The out-of-order guard survives a restart**, so a replayed reading
  cannot be accepted as current.
- **No stale-looking-fresh snapshot exists in this unit**, because the
  session is not a snapshot.
- **The tare stays unpersisted** (ADR-015) — it is the device's, and the
  session does not copy it.
- **DR-02 is applied to the right thing.** The record of a completed act is
  immutable; the live state is maintained.
- **One table per kind.** A reviewer can see which is which from the
  schema alone.

### Negative

- **This unit has two kinds of persistence**, and a reader must know which
  table is which. The distinction is the ADR's subject, and the table
  names carry it (`weighing_sessions` versus the weighing record).
- **The session row is written on every reading** — ten times a second.
  That is a write amplification the recipe and the queue do not have, and
  it is the price of resumability. The row is small, the write is a
  single-row update, and SQLite's `synchronous = FULL` is the setting
  that makes it survive a power cut (NFR-05).
- **The session is not a snapshot of the world**, so it cannot be replayed
  as history. It is the *now*, and the history is the `WeighingRecord`.

### Risks

- **A future agent treats the session as a snapshot** — persists it as a
  *log* of states rather than a current state. *Mitigation*: the decision
  index's "Read when" points here, and this ADR states the distinction.
- **A future agent copies the recipe's target into the session's row**
  "so the session is self-contained". *Mitigation*: the same index entry;
  a second copy of the recipe's truth is a second source of truth, and
  ADR-031 and ADR-032 already refused it twice.
- **A future agent persists the tare** in the session, to make the
  resumption complete. *Mitigation*: the same index entry; ADR-015
  refused it, and the device re-establishes the tare when the container is
  placed on it.

## Related

- **Stories**: `001-select-scale-automatically`,
  `002-consume-live-weight-stream`
- **Requirements**: FR-7, FR-8, FR-13, FR-14 · BRD FR-07, FR-12, FR-13,
  FR-14, FR-25 · BRD IR-10, IR-11, IR-13 · NFR-1, NFR-5, NFR-6, NFR-16,
  NFR-14 · C-08, C-11, C-12
- **Previous ADRs**: ADR-021 (the snapshots are not persisted — the
  mechanism this ADR distinguishes the session *from*); ADR-031 (the recipe
  is not persisted — the same distinction for unit `002`'s working copy);
  ADR-015 (the tare is never persisted — and the reason the session holds
  no tare); ADR-034 (the station's own facts are durable — the session is
  one of them); ADR-018 (no device can weigh this is a successful outcome
  — the rule's answer, passed through unchanged); ADR-019 (the threshold is
  configuration — the rule's threshold stays `null` until FCI answers
  `Q-04`)
- **Standards**: `standards/tech-stack.md` § "Database" — SQLite for the
  product's durable records, with append-only rows for acts and mutable
  rows for reference and live state
