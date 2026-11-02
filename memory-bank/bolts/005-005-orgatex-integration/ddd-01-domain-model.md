---
unit: 005-orgatex-integration
bolt: 005-005-orgatex-integration
stage: model
status: complete
updated: 2026-11-02T18:20:00Z
---

# Static Model - OrgaTEX Integration (Bolt 005: Read the Queue and the Recipe)

## Bounded Context

**The OrgaTEX Integration context. The IR-07 seam.**

This is the one place in WeighingMS that talks to the MES. Every other unit
reads the queue, the recipe and the consumption through **this** unit's
published surface, and none of them imports a client for OrgaTEX
(BRD IR-07, C-13).

This context owns **linkage, not meaning**. It answers three questions, and
only three:

> **What did OrgaTEX say?**
> **Has what we sent landed?**
> **Can we carry on if it cannot?**

### What this bolt adds

Bolt `005` is the **read half** of the unit. It adds two capabilities:

1. **The released batch queue** — the operator's list of work, projected
   from the MES.
2. **The batch recipe** — the components, targets, tolerances and demanded
   scale classes for one batch, projected from the MES.

### What this bolt does NOT own

- **Consumption posting** and the **idempotency ledger** → bolt `006`
  (story `003-post-consumption-idempotently`).
- **The link state machine** — the transitions, the consecutive-failure
  counter, the `LINKED`/`DEGRADED`/`OFFLINE` derivation → bolt `007`
  (story `004-report-link-state`).
- **The deferred synchronisation queue** → bolt `007`
  (story `005-queue-writes-offline-and-sync-on-recovery`).
- **Selecting a batch** and the eligibility state machine → unit
  `001-batch-management`. This bolt **reports** eligibility; it does not
  refuse a selection.
- **The dyestuff master and the lot data** → unit
  `002-recipe-material-management` (BRD IR-03, IR-04).
- **Caching the recipe** → unit `002`. See **I-2**.


### The rule that shapes this bolt

This unit inherits the governing rule from the scale unit's context and
extends it to the MES:

> **No failure at any boundary may produce a silently wrong number.**

For the MES that rule has a specific consequence, and it is the reason this
unit exists as a bounded context of its own:

> **A snapshot is either current, or it is marked with its age. It is never
> one thing presented as another.**

The prototype hard-codes `ORGATEX · LINKED` in the status strip. That is the
failure this whole unit exists to make impossible: a link state that is a
constant cannot report an outage, and a snapshot with no age cannot report
that it is stale.

### The risk this bolt carries

`Q-01` — *does OrgaTEX expose a documented REST interface at all, and of what
kind?* — is unanswered. `A-01` assumes it does.

The seam is therefore built so the assumption is **testable rather than
merely stated**. Nothing above the adapter may name an endpoint, a payload
field or a wire format. What crosses the boundary is a **domain snapshot**,
and the only thing that knows the MES's shape is the adapter that produces
it. If FCI answers `Q-01` with "the MES exposes files, not REST", this
unit's **implementation** is replaced and every other unit keeps its
contract.

This is exactly what BRD IR-07 promises: *"All OrgaTEX interaction is
confined to a single adapter component, so a change of interface technology
affects one replaceable part."*

---

## Invariants

Each invariant is expressed as a **type-level constraint** or a **single
chokepoint**, continuing the numbering used by the scale unit (S-1…S-20).

- **S-21 — No quantity ever enters this unit as a JSON number.** Every
  quantity that crosses the adapter seam is a fixed-point decimal **string**
  (BRD NFR-16, ADR-008). The rule is the same one the scale unit follows,
  and it is the same rule for the same reason: a JSON number decodes to an
  IEEE-754 double in every parser, and the tolerance boundary is where that
  error would bite.
- **S-22 — A snapshot always knows its own age.** Every snapshot carries
  `receivedAt` and `source`. A snapshot that cannot say when it was received
  cannot be marked stale, and a snapshot that cannot be marked stale will be
  presented as current.
- **S-23 — A snapshot is never served as current when it is not.** A snapshot
  served from the last known-good cache is served **with its age** and is
  distinguishable in the response from a freshly fetched one. There is no
  code path that returns a stale snapshot indistinguishably from a fresh one.
- **S-24 — A malformed record never yields a partially valid snapshot.** The
  whole read fails. A snapshot that is missing one component is a *wrong
  quantity* to the operator, not a partial success.
- **S-25 — The recipe is read-only.** Nothing in this unit can modify a
  component, a target, a tolerance or a scale class. The type system carries
  it: the recipe's components are exposed as an immutable value, and there is
  no write operation on the adapter port at all (BRD BR-04, C-01).
- **S-26 — A missing tolerance is absent, never zero.** A component with no
  tolerance is a component that cannot be confirmed. It is not a component
  with a tolerance of zero.
- **S-27 — The MES owns the batch's weighing status.** WeighingMS reads it;
  it writes it only in bolt `006` (IR-06), and only the status field. Every
  other batch field is read-only (BRD §9.2).
- **S-28 — Eligibility is reported, not enforced.** This unit states whether
  a batch may be selected and why not. It does not refuse a selection — that
  is unit `001`'s state machine (BRD BR-03).
- **S-29 — The adapter is the only route to the MES.** Every MES call goes
  through one port. No other unit may import a client, and no domain service
  may reach past the port (BRD IR-07, C-13).
- **S-30 — The snapshot is not persisted.** A queue or a recipe can always be
  re-fetched; an unlanded consumption cannot. The asymmetry is deliberate and
  is the reason the **sync queue** in bolt `007` *is* persisted.

---

## Domain Entities

| Entity | Properties | Business Rules |
|--------|------------|----------------|
| **ReleasedBatch** | `batchId` (`BatchId`), `orderRef` (`OrderRef`), `machineRef` (`MachineRef`), `fabricDescription` (`string`), `shadeCode` (`ShadeCode`), `componentCount` (`number`), `weighingStatus` (`BatchWeighingStatus`) | One batch as the MES released it. **WeighingMS owns none of these fields** — it reads them and projects them (BRD §9.2). `componentCount` is the MES's own count, not a count this unit computed from a recipe it has not fetched. |
| **BatchQueueSnapshot** | `batches` (`readonly ReleasedBatch[]`), `receivedAt` (`Instant`), `source` (`SnapshotSource`) | The released queue **as last received**. Immutable once constructed. `receivedAt` is the moment the snapshot was received, not the moment the MES generated it — because the age that matters to an operator is "how long has this been on my screen" (S-22). `source` says which adapter produced it, so a `DEGRADED` read is attributable. |
| **RecipeSnapshot** | `batchId` (`BatchId`), `shadeCode` (`ShadeCode`), `components` (`readonly RecipeComponent[]`), `receivedAt` (`Instant`), `source` (`SnapshotSource`) | One batch's recipe **as last received**. Immutable. The components are in **recipe sequence** — the order the MES gave them, which is the order they must be weighed in. |
| **RecipeComponent** | `sequence` (`number`), `componentId` (`ComponentId`), `dyestuffCode` (`DyestuffCode`), `target` (`WeightValue`), `tolerance` (`WeightValue` \| `null`), `scaleClass` (`DemandedScaleClass`) | One component of a recipe, **read-only** (S-25). `tolerance` is **nullable** and `null` means *absent*, never *zero* (S-26). `scaleClass` is what the component **demands**, which is the input to unit `004`'s automatic selection — it is not the class of any device. |

**None of these is an aggregate with behaviour.** That is the point: they are
**projections of a system this unit does not own**. They are immutable
snapshots, not aggregates with invariants that evolve.

---

## Value Objects

| Value Object | Properties | Constraints |
|--------------|------------|-------------|
| **BatchId** | `value` (string) | The MES's batch identifier (`B-24187`). Trimmed, non-empty, bounded in length — it arrives from a request path or a payload, and an unbounded string is an unbounded thing to log, key and cache. **Opaque** to this unit: it does not parse the `B-` prefix or anything else. |
| **OrderRef** | `value` (string) | The sales/production order reference (`SO-9931`). Trimmed, non-empty, bounded. |
| **MachineRef** | `value` (string) | The target machine (`JET-04`). Trimmed, non-empty, bounded. |
| **ShadeCode** | `value` (string) | The shade (`Teal 4C`). Trimmed, non-empty, bounded. **Carried on both** the queue row and the recipe, because the ticket and the component rail both show it and the two must agree. |
| **DyestuffCode** | `value` (string) | The dyestuff's master code (`DYE-4471`). Trimmed, non-empty, bounded. **Distinct from `ComponentId`** — see **I-4**. |
| **ComponentId** | `value` (string) | The component's identity **within the recipe** (`DYE-4471-Y`). Trimmed, non-empty, bounded. Opaque here. |
| **BatchWeighingStatus** | `kind`: `QUEUED` \| `RELEASED` \| `WEIGHING` \| `WEIGHED` \| `CANCELLED` | The MES's own weighing status for the batch. A **closed set**, so the status is *data* rather than prose assembled at the call site. `RELEASED` is the one value that makes a batch selectable (BRD BR-03). |
| **BatchEligibility** | `kind`: `ELIGIBLE` \| `NOT_RELEASED` \| `CANCELLED` | **The answer to "may this batch be selected?"** — and it is derived, not stored: `RELEASED` → `ELIGIBLE`; `CANCELLED` → `CANCELLED`; every other status → `NOT_RELEASED`. This is the *report* of eligibility (S-28), not the enforcement of it. It carries the **reason**, so a caller can refuse with a stated reason (BRD BR-03) rather than a bare refusal. |
| **DemandedScaleClass** | `kind`: `PRECISION` \| `FLOOR` | The class of scale a component **demands**. This is a **string union, not the scale unit's `ScaleClass` class** — see **I-3**. |
| **SnapshotSource** | `value` (string) | Which adapter produced the snapshot — `DUMMY_ORGATEX` today. It exists so that a `DEGRADED` read is **attributable**: when the operator is shown a stale queue, the record says which adapter's last known-good it was. |
| **SnapshotFreshness** | `kind`: `CURRENT` \| `STALE`, `receivedAt` (`Instant`), `ageMs` (`number`) | **The rule that makes S-23 structural.** A snapshot is either `CURRENT` — freshly fetched, age zero — or `STALE`, carrying the age it actually is. There is **no third state** in which a stale snapshot is indistinguishable from a fresh one. |
| **Quantity** | `value` (`WeightValue`), `unit` (string) | The unit-bearing quantity. **Not a new type** — it is the scale unit's `WeightValue`, reused (see **I-1**). Listed here so the reader can see that every quantity on this seam is one of them. |

---

## Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **None.** | — | **This is a deliberate absence, and it is the architectural statement of this unit.** |

### Why there is no aggregate

Every other unit in this build has at least one. This one has none, and the
reason is worth stating plainly, because a reader looking for the aggregate
will otherwise assume it was missed.

An aggregate root is an entity that **owns** its members' consistency: the
batch owns its recipe, the scale device owns its tare, the session owns its
authorisation. In this unit, **every entity belongs to the MES**. The batch
belongs to OrgaTEX. The recipe belongs to OrgaTEX. The components belong to
the recipe, which belongs to OrgaTEX.

What this unit holds is a **projection** — a point-in-time copy of somebody
else's truth, taken through a read-only seam. It cannot enforce the MES's
invariants, because it does not know them: if a batch in the MES says
`WEIGHED` while its recipe still has five unweighed components, that is
OrgaTEX's inconsistency to own, not this unit's to correct. And the MES will
win regardless, because the MES is the master.

So the consistency boundary here is the **snapshot**: everything inside one
snapshot was true of the MES at one moment, and the snapshot is immutable
once taken. A snapshot is not an aggregate because it has no invariants to
enforce and no lifecycle to protect — it has a **provenance** (when it was
received, from where) and that is what this model gives it.

**The consequence, which matters for the rest of the build:** this unit
cannot be the one that decides whether the MES's data is consistent. If the
queue says a batch has 5 components and the recipe has 4, this unit reports
both facts and does not reconcile them. Reconciliation belongs to unit
`002-recipe-material-management`, which owns the recipe's cache and therefore
owns what it means.

---

## Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **BatchQueueRead** | The queue was successfully fetched from the MES | `batchCount`, `receivedAt`, `source`, `filter` — the *filter* is included because a filtered read and an unfiltered read produce different snapshots, and a reader comparing two snapshots must know which question was asked. |
| **BatchQueueReadFailed** | The queue could not be fetched | `reason` (`UNREACHABLE` \| `MALFORMED` \| `TIMEOUT`), `at`, `message` — **the message is for the log, never for the client** (BRD IR-09). The event is the diagnostic record of a failed contact; it is what feeds the link state's consecutive-failure counter in bolt `007`. |
| **RecipeRead** | A recipe was successfully fetched from the MES | `batchId`, `componentCount`, `receivedAt`, `source` |
| **RecipeReadFailed** | A recipe could not be fetched | `batchId`, `reason`, `at`, `message` — the same closed `reason` set, so the failure vocabulary is one vocabulary. |

**These events are about CONTACT, not about data.** A `BatchQueueRead` says
"we reached the MES and this is what it said"; it does not say "a batch was
created" or "a batch changed". The MES owns that — when a batch was
released, when its status advanced, when its recipe was revised. This unit
observes those facts through a read and reports the contact.

That is why there is no `BatchReleased` event. Inventing one would create a
second source of truth for when a batch was released: the MES's own record,
and this unit's inferred one from the difference between two snapshots. The
inferred one would be wrong whenever a read was missed, and it would be
**invisible** when it was wrong.

The one entity with real behaviour in this bolt is not in the table above
because it is a **value object** — see `SnapshotFreshness` below.


---

## Domain Services

| Service | Operations | Dependencies |
|---------|------------|--------------|
| **BatchQueueReader** | `read(filter?) → BatchQueueReadOutcome` | `OrgatexAdapter` (port), `SnapshotCache`, `Clock`. Orchestrates the read: ask the adapter, decide whether the answer is fresh or stale, record the contact. **The only place the "serve the last known-good in `DEGRADED`" rule lives** (S-23). |
| **RecipeReader** | `read(batchId) → RecipeReadOutcome` | `OrgatexAdapter` (port), `SnapshotCache`, `Clock`. The same shape for the recipe. |
| **BatchEligibilityRule** | `evaluate(status) → BatchEligibility` | `BatchWeighingStatus`. **Pure.** The one-line derivation from status to eligibility and reason (S-28). Pure because it is a rule, and a rule that needs a clock or an adapter is not a rule. |
| **SnapshotCache** | `remember(key, snapshot)`, `recall(key) → CachedSnapshot \| null` | In-memory. **Bounded and disposable** — see below. |
| **OrgatexAdapter** *(port)* | `readQueue(filter?) → RawQueue`, `readRecipe(batchId) → RawRecipe` | The **IR-07 seam**. The whole contract with the MES. Everything above it speaks in domain snapshots; everything below it speaks the MES's language. |

### The read outcome — a discriminated union, not an error

Both readers return a **union**, never a thrown error for an expected
condition:

```text
BatchQueueReadOutcome
  ├── SUCCEEDED  { snapshot, freshness: CURRENT }
  ├── SUCCEEDED_STALE { snapshot, freshness: STALE { ageMs } }
  └── FAILED { reason: UNREACHABLE | MALFORMED | TIMEOUT, message }
```

**Why a union and not an exception.** The three outcomes are three *answers
to a question*, not three kinds of crash. An unreachable MES is a normal
condition of this product — BRD FR-20 requires the station to keep working
through one — and modelling it as an exception would make every caller
handle it, and the caller that forgot would turn a recoverable outage into
an outage with a crash on top.

The `FAILED` branch **carries no snapshot**. That is the expression of the
story's hardest edge case: *"the MES is unreachable and there is no prior
snapshot at all — the read fails loudly with the error and there is no
fallback content — an empty queue is never substituted for 'unknown'."* An
empty queue and an unreachable MES are different facts, and the union keeps
them apart.

### The `DEGRADED` rule, in full

The reader serves a stale snapshot **only** when all of these hold:

1. A previous successful snapshot exists for that key.
2. The last contact with the MES **succeeded** at least once since the
   snapshot was taken.
3. The snapshot's age is within the **freshness window**.

If (2) fails, the link is `OFFLINE`, and the read fails loudly even though a
snapshot exists. The rule is stated here rather than in the reader's
implementation because it is a **business rule**, not a fallback mechanism.

**Why condition (2) is there.** A snapshot taken before the link went down
is still the best information available, and serving it — marked with its
age — is exactly what FR-20 asks for. But a snapshot taken *before a
different* MES outage, an hour ago, from a link that had already been
failing, is not "the last successful snapshot"; it is an old one. The
freshness window (condition 3) bounds how old that may be, and it is
**configuration**, because how long a queue may be trusted is an operational
question, not a developer's (BRD NFR-14).

**What is deliberately NOT here:** a `DEGRADED` read never *writes* anything
to the MES and never advances a batch's status. A stale snapshot is a
read-only fact.

### The snapshot cache — bounded, in-memory, disposable

The cache holds the **last known-good** snapshot per key (the queue, and
each recipe read recently).

- It is **in memory**, not in SQLite. A snapshot is a projection of a system
  the station does not own; if the station restarts, it re-reads (S-30).
  Persisting it would create a *stale-looking-fresh* risk: a snapshot
  written before a power cut and read back afterwards would carry a
  `receivedAt` from the previous run, and the age would be computed against
  a clock that has since moved. The in-memory cache makes that impossible by
  construction — a restart empties it, and the first read after a restart
  either succeeds or fails loudly.
- It is **bounded** — a fixed number of recipes and one queue. An unbounded
  cache of recipes read over a shift would be a memory leak with no
  operational purpose: the recipe's own cache belongs to unit `002`
  (see **I-2**).
- It is **disposable**. Nothing is lost when it is evicted: the MES is the
  master and the snapshot can be re-read.

---

## Repository Interfaces

| Repository | Entity | Methods |
|------------|--------|---------|
| **SnapshotCache** | `BatchQueueSnapshot` \| `RecipeSnapshot` | `remember(key, snapshot)`, `recall(key)` — **in memory**, not a persistence port. Listed here because it is the unit's only store, and because the *absence* of a persistence port is a decision. |
| **BatchQueueRepository** | — | **Does not exist.** The queue is projected live from the MES (S-30). |
| **RecipeRepository** | — | **Does not exist**, in this unit. The recipe's cache belongs to unit `002` (see **I-2**). |

**The absent repositories are decisions, not omissions.** They are the same
reasoning as the scale unit's absent tare repository (ADR-015) and its
absent reading repository (ADR-009): **the absence of a place to write
something down is what makes the rule structural.** If there were a
`batch_queue` table, some future agent would find it and serve a row from it
as though it were the queue — and the row's age would be a column, not a
guarantee.

The contrast with bolt `007` is the point. There, the **sync queue** *is*
persisted, because an unlanded consumption posting is a fact about work the
station believes it did, and that fact cannot be re-derived by asking the
MES. Here, a snapshot can always be re-derived by asking the MES. **The
queue is durable; the snapshots are not.**

---

## Ubiquitous Language

| Term | Definition |
|------|-------------|
| **Adapter** | The single component through which this unit talks to OrgaTEX (BRD IR-07). The Dummy OrgaTEX is bound to it in training; the real MES replaces it without anything above it changing. |
| **Snapshot** | A point-in-time projection of the MES's truth, carrying the time it was received. Immutable. Never persisted. |
| **Snapshot age** | How long ago the snapshot was received. **Always knowable** (S-22) — it is the difference between "the queue" and "the queue as of 06:12". |
| **Current** | A snapshot fetched in this call. Age zero. |
| **Stale** | The last known-good snapshot, served because the MES could not be reached, **marked with its age**. Never presented as current (S-23). |
| **Freshness window** | How old a snapshot may be and still be served as stale rather than discarded. Configuration, not code. |
| **Released batch** | A batch the MES has released for this station. `BatchWeighingStatus.RELEASED`. |
| **Eligibility** | Whether a batch may be selected, and why not. **Reported** by this unit; **enforced** by unit `001`. |
| **Weighing status** | The MES's own record of where a batch is: `QUEUED`, `RELEASED`, `WEIGHING`, `WEIGHED`, `CANCELLED`. Read here; written only in bolt `006`. |
| **Recipe** | The components, in sequence, that make up a batch. Owned and authored in OrgaTEX; consumed here **read-only**. |
| **Recipe sequence** | The order the MES gave the components in, and the order they are weighed in. Preserved exactly. |
| **Target** | The quantity the MES says to weigh for a component. A fixed-point decimal. |
| **Tolerance** | The band around the target the MES allows. **Nullable** — absent is not zero (S-26). |
| **Demanded scale class** | The class of scale a component *requires*. The input to unit `004`'s automatic selection. Not a device's class. |
| **Link state** | `LINKED` \| `DEGRADED` \| `OFFLINE`. **Not owned by this bolt** — bolt `007` owns the machine. This bolt only *reports contacts* to it. |
| **Contact** | One attempt to reach the MES, successful or not. The unit's unit of observation. |
| **Currentness** | The fact that a snapshot knows its own age, and that a stale one is visibly stale. |


---

## The adapter seam — in full

This is the most important section of the model, so it is stated in full
rather than summarised.

```text
        ┌──────────────────────────────────────────────┐
        │  Units 001, 002, 003, 006, 007              │
        │  read the queue / recipe through THIS unit   │
        └───────────────────────┬──────────────────────┘
                                │  domain snapshots
                                │  (BatchQueueSnapshot,
                                │   RecipeSnapshot)
        ┌───────────────────────▼──────────────────────┐
        │  BatchQueueReader · RecipeReader             │
        │  ─ freshness, eligibility, cache, events     │
        └───────────────────────┬──────────────────────┘
                                │  OrgatexAdapter (PORT)
                                │  readQueue / readRecipe
        ┌───────────────────────▼──────────────────────┐
        │  DummyOrgatexAdapter   ──or──  RealAdapter   │
        │  the MES's language    │      (unconfirmed)  │
        └──────────────────────────────────────────────┘
```

### The port

```ts
interface OrgatexAdapter {
  readQueue(filter?: BatchStatusFilter): Promise<RawQueue>;
  readRecipe(batchId: BatchId): Promise<RawRecipe>;
}
```

**There is no write method.** Bolt `005` is read-only, and the port says so
structurally rather than by convention (S-25). Bolt `006` adds the write
methods — `postConsumption`, `writeBatchStatus` — and that is when the port
grows. A read-only port that already had a write method would be a port
whose discipline rested on nobody checking.

**The port returns RAW records, not domain entities.** The adapter's job is
to translate the MES's shape into this unit's shape — which means parsing,
validating and mapping field names. What it returns is a **raw** structure:
the MES's own fields, still untyped by this domain. The **reader** then
validates and constructs the domain snapshot.

The split matters. If the adapter returned domain entities, then every
change to the domain's model would ripple into the adapter, and — worse —
**the adapter would be where the validation lives**, which is the one place
whose shape is about to change when FCI answers `Q-01`. Keeping the raw
boundary means the raw types change and the domain does not.

### The three outcomes and the one that is a 404

A read that **reaches** the MES and is told *"no such batch"* is a different
thing from a read that **cannot reach** the MES. The first is a `404`; the
second is a `FAILED` outcome (BRD FR-03's *"a scan of an unknown identifier
is rejected with a visible reason"*). The rule is:

> **A 404 may only come from a successful contact.**

It is stated here because the alternative — mapping "not found" onto the
same failure path as "unreachable" — would tell an operator that the MES is
down when it is up, and would make the `DEGRADED` fallback serve a stale
recipe for a batch that never existed.

### What the adapter does NOT do

- It does **not** decide whether a snapshot is fresh or stale. That is the
  reader's rule (it involves the clock and the cache, both of which the
  adapter must not know about).
- It does **not** derive eligibility. That is a domain rule.
- It does **not** cache. The cache belongs to the reader, so that the
  "last known-good" is decided by domain policy and not by whichever
  adapter happened to succeed last.
- It does **not** retry, back off or queue. That is bolt `007`'s territory
  (and this bolt does not write at all, so there is nothing to queue).

---

## Story Coverage

### Story `001-read-released-batch-queue`

| # | Acceptance criterion | Covered by |
|---|----------------------|-----------|
| 1 | The snapshot contains batch id, order ref, machine ref, fabric description, shade code, component count and weighing status, with the time received | `ReleasedBatch` — all seven fields; `BatchQueueSnapshot.receivedAt` |
| 2 | The snapshot records the time it was received and the source it came from | `BatchQueueSnapshot.receivedAt`, `.source`; `SnapshotSource` (S-22) |
| 3 | A filter by status returns only batches with that status | `OrgatexAdapter.readQueue(filter)`; `BatchStatusFilter` |
| 4 | An unreachable MES fails loudly; the last successful snapshot is served only when `DEGRADED`, marked with its age | `BatchQueueReader.read`; `SnapshotFreshness`; the `DEGRADED` rule (S-23) |
| 5 | A batch not in `RELEASED` state reports its eligibility so the caller can refuse with a stated reason | `BatchEligibilityRule.evaluate`; `BatchEligibility` (S-28) |

### Story `002-read-batch-recipe`

| # | Acceptance criterion | Covered by |
|---|----------------------|-----------|
| 1 | The snapshot contains the components in recipe sequence, each with dyestuff identity, target, unit, tolerance and scale class, plus shade code and received time | `RecipeSnapshot` — all fields; `RecipeComponent` — all six; `sequence` preserved (FR-3) |
| 2 | The snapshot records its received time and source | `RecipeSnapshot.receivedAt`, `.source` (S-22) |
| 3 | An unreachable MES fails loudly; the last successful snapshot is served only when `DEGRADED`, marked with its age | `RecipeReader.read`; `SnapshotFreshness`; the `DEGRADED` rule (S-23) |
| 4 | The recipe snapshot is read-only — no component, target or tolerance can be modified through this unit | No write method on the port; immutable snapshot; `RecipeComponent` has no mutator (S-25, BRD BR-04, C-01) |
| 5 | Every quantity is a fixed-point decimal; no floating-point value appears | `WeightValue` — string-only constructor; the adapter parses into it (S-21, NFR-2, BRD NFR-16) |

---

## Open interpretations

Three readings of the source material are ambiguous. All three are resolved
here **explicitly** rather than silently, and all three are raised at the
Stage 1 checkpoint.

### I-1 — The shared value objects live in the scale unit's folder

The quantity type (`WeightValue`), the time type (`Instant`) and the
component id (`ComponentId`) already exist, in
`src/004-scale-integration/domain/value-objects/`. The recipe needs all
three, and it needs them to be **the same types** — a target of `"94.0"` and
a tolerance of `"0.5"` must be comparable with a weight the scale unit
produced, and two different quantity types would make that comparison a
runtime question instead of a type-level one.

**Reading adopted:** **reuse them by import.** Unit `005` imports
`WeightValue`, `Instant` and `ComponentId` from `004`.

**Why, and what it costs.** The alternative — moving them to a shared
`src/shared/` kernel — is the textbook answer and was rejected for a
concrete reason: **it would be a drive-by refactor of a completed, tested
bolt.** Moving `WeightValue` means touching fourteen source files and ten
test files in unit `004`, re-verifying its 144 tests, and changing the
import paths of a bolt that was reviewed and approved. The cost of that is
real and immediate; the benefit is aesthetic.

The dependency that results — `005 → 004` — is **acceptable and is not a
cycle**: unit `004` (scale integration) does not import anything from unit
`005`, and the unit map already places both at the same dependency level.
`005` depends on `004` only for *value objects*, not for behaviour.

**The rule this sets:** a value object that two units genuinely share is
**not** duplicated. When a third unit needs it, or when the first two are
both complete and a refactor can be done as its own reviewed change, it
moves to a shared kernel. Doing it mid-construction would mean changing an
approved bolt's internals without its own review.

**The exception, and why it is one:** `DemandedScaleClass` is **not** the
scale unit's `ScaleClass`. See **I-3**.

### I-2 — Who caches the recipe?

The story says the recipe *"is cached locally"* (FR-3) and also says the
cache *"is owned by unit `002`, not by this unit, so that there is one source
of truth for the recipe's contents. This unit returns the snapshot it
obtained and its age; it does not keep a second copy."*

Those two sentences are in tension, and the resolution is a **distinction
between two different caches** that the story does not name:

| Cache | Owner | Purpose | Lifetime |
|-------|-------|---------|----------|
| **Last-known-good cache** | **This unit** (`005`) | Lets a `DEGRADED` read serve the last snapshot with its age (S-23, FR-20) | In memory, bounded, disposable |
| **Working cache** | **Unit `002`** | The station's working copy of the recipe, used for weighing while offline (FR-30) | Unit `002`'s business |

**Reading adopted:** this unit keeps the **last-known-good cache** — the one
that exists to serve a stale read. Unit `002` keeps the working cache. The
two hold the same data for different reasons and are **not** two sources of
truth: the first is a fallback copy with a mandatory age, the second is the
station's working set. The unit brief says "the queue is owned here and only
here" — that is about the **queue** and about not duplicating it in units
`001`/`002`; it does not forbid this unit from holding the fallback it is
required to serve.

**Consequence if reversed:** if this unit kept no fallback, then the
`DEGRADED` read — which FR-20 and both stories require — would have nothing
to serve, and the station would lose the queue the moment the MES blinked.

### I-3 — The demanded scale class is a string union, not the scale unit's class

The recipe's per-component scale class is exactly the input to unit
`004`'s automatic selection, which takes a `ScaleClass` —
`'PRECISION' | 'FLOOR'` — as a **type imported from the scale unit**.

**Reading adopted:** the recipe declares its own **`DemandedScaleClass`**
value object with the same two kinds, and the **reader maps** between them
at the boundary.

**Why, when importing `ScaleClass` would have been simpler.** Two reasons,
and the second is the important one.

1. **The semantics differ.** The scale unit's `ScaleClass` is a property of
   a **device** — "this indicator is a precision scale". The recipe's class
   is a **demand** — "this component requires precision". Unit `004`'s
   selection rule exists precisely because these two can **disagree**
   (ADR-017: a 4 kg component demanding precision). Sharing one type would
   invite a consumer to read a demand as a device fact.

2. **The dependency direction.** If the recipe's class were the scale unit's
   class, then unit `005` (the MES seam) would depend on unit `004`'s
   **domain vocabulary**, and the scale unit's `ScaleClass` would become a
   contract that the MES adapter must honour — the MES's classification of a
   component would have to match FCI's classification of a *device*. It does
   not, and it should not.

The mapping is one line, at one chokepoint, and it is **lossless** because
both sets have exactly two members today. If FCI later defines a third
class, the mapping refuses the unknown value rather than silently dropping
it — which is the same refusal discipline the scale unit uses for an unknown
weight unit.

### I-4 — `ComponentId` and `DyestuffCode` are different things

The prototype's component rows carry **both**: an id (`DYE-4471-B`) and a
dyestuff code (`DYE-1180`). Three of the five rows have a dyestuff code
equal to the id's prefix; the two auxiliaries have `AUX-0101` as both.

**Reading adopted:** they are **separate fields** with separate value
objects, because they answer different questions. `DyestuffCode` is *what
the material is* — the master-data identity that unit `002` resolves against
the dyestuff master (BRD IR-03). `ComponentId` is *this component in this
recipe* — the thing the scale selection is attributed to and the thing the
weighing record references.

**Consequence if merged:** the identity verification in unit `002` (FR-9,
BRD BR-10) compares a scanned barcode against the **dyestuff**, not against
the component slot. Merging them would make a component that is merely
*named* after a dyestuff look like the dyestuff itself.

---

## What this bolt deliberately does NOT decide

Three things are left to later bolts or other units, and naming them here
prevents them being smuggled in.

- **The link state's machine.** `LINKED`/`DEGRADED`/`OFFLINE`, the
  consecutive-failure counter, the freshness window's effect on the state —
  all bolt `007`. This bolt produces **contacts** (success/failure events)
  and the reader *consults* the current state to decide whether a stale
  snapshot may be served; it does not own the state.
- **The freshness window's value.** It is **configuration** in this bolt's
  config module, with a default, and it is deliberately not specified here
  because no requirement states one. Bolt `007` may need to align it with
  the link state.
- **The Dummy OrgaTEX's own data shape.** The seed data comes from the
  prototype (four batches, the five-component Teal 4C recipe). It is a
  **training artefact**, and its shape is the MES's shape *for training
  only* — it is not a claim about the real contract.

