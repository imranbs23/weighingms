---
bolt: 008-001-batch-management
created: 2026-11-04T16:00:00Z
status: accepted
---

# ADR-028: The station owns its own queue endpoint, and reads the MES only through unit 005's reader

## Context

Unit `001-batch-management` must show the operator the released batch queue,
and FR-1 forbids the prototype's hard-coded rows: every row must arrive over
the API from OrgaTEX, through the adapter (BRD IR-07).

Two things already exist that could serve the queue:

1. **Unit 005's `GET /api/orgatex/batches`** — the product's own endpoint over
   the MES seam, which returns the snapshot with its receipt time, its source
   and its freshness.
2. **The Dummy MES's `GET /api/batches`** — the *external system's* surface,
   mounted as a training artefact.

Unit 001 could call either one over HTTP. It could also call the adapter
directly, which is what "read through the OrgaTEX adapter" in the bolt's
objective literally permits.

The third option is the one that needs a decision, because it is the one
that looks most direct and is the most dangerous:

- If unit 001 calls the **adapter** directly, there are now **two readers of
  the MES seam** — unit 005's `BatchQueueReader` and unit 001's own. Two
  readers mean two contacts where one would do, two link-state observations
  for one link, two in-memory caches if each brings its own fallback, and
  therefore **two sources of truth for the same queue**.
- If unit 001 calls **unit 005's HTTP endpoint** over the network, the
  station's own API calls its own API. The queue crosses a socket, gets
  parsed twice, and the "one read path" becomes a distributed system inside
  one process.

There is a fourth question underneath the first three: **whose queue is it?**
Unit 005's endpoint returns *the MES's* queue, in unit 005's vocabulary. The
operator's queue is *the station's* — and by bolt 009 it will carry the
selection state, and by unit 002 the recipe context. The endpoint has to be
somewhere that can grow into that without unit 005's contract changing.

Finally, the path itself is constrained: **`/api/batches` is taken.** The
Dummy MES's router is mounted at `/api` and owns `/api/batches/:batchId`, so
`/api/batches/queue` would be captured silently by the Dummy's batch-detail
route and answered with a batch-not-found.

## Decision

**Give unit 001 its own endpoint, `GET /api/batch-queue`, and read the MES
only through unit 005's reader — in process, over a port unit 001 owns.**

1. **Unit 001 declares its own inbound port**, `BatchQueueSource`, with one
   method, `read(): Promise<BatchQueueReadOutcome>`. Unit 005's
   `BatchQueueReader` satisfies it structurally. The composition root binds
   them — no adapter class, no mapping layer between the two.

2. **The read is in-process.** Unit 001 never calls its own API over HTTP,
   and never holds an `OrgatexAdapter`, a credential or a socket.

3. **Unit 001 holds no cache and persists nothing.** The queue is a
   projection of a system it does not own, and ADR-021 already settled that
   such a projection is re-fetchable and must not be given a second durable
   home.

4. **The endpoint is `/api/batch-queue`**, chosen because no router in this
   product owns a route beginning with `/batch-queue`, and because
   `/api/batches/*` is the Dummy MES's prefix.

5. **The availability is two-valued** — `AVAILABLE` or `UNAVAILABLE` — and
   unit 005's `freshness` is **passed through unchanged** inside the
   `AVAILABLE` case. This unit does not re-decide staleness, and it does not
   hide it either.

## Rationale

### Why the port belongs to the consumer

A port belongs to the unit that *depends* on it. Declaring
`BatchQueueSource` in unit 001 means:

- the dependency runs **inward**, from the application layer to a port this
  unit owns;
- unit 001 never imports unit 005's reader **class**, so unit 005's next
  refactor cannot ripple into a unit that has no reason to know about it;
- the test can bind a **controlled source** that returns a specific
  failure, with no MES, no database and no socket.

This is the same hexagonal shape the codebase already uses — unit 004's
`ScaleAdapter`, unit 008's `SecretHasher`, unit 005's `OrgatexAdapter`. The
pattern is not new; only its first application inside unit 001 is.

### Why the endpoint belongs to unit 001 and not to unit 005

The two answers look identical today. They will not stay identical.

Unit 005's endpoint answers *"what did the MES say?"*. Its payload is the
snapshot: the MES's own fields, plus provenance and freshness. It is
unit 005's public surface, and other units may call it.

Unit 001's endpoint answers *"what work is on offer at this station?"*. Its
payload is the seven display columns, the receipt time, the source and the
freshness. Bolt 009 will add the filter and the selection; unit 007 will
consume it.

Those are different questions with different futures. Sharing one endpoint
would force the two payloads to grow a union — an endpoint whose response
depends on which unit is asking — or force one of the units to own fields
the other does not understand. The seam between them is **one in-process
call**, so separating the *endpoints* costs nothing at runtime.

The cost is one more path in the API surface, and the benefit is that unit
001's surface can evolve without touching unit 005's contract — which unit
005's ADRs have repeatedly said is the point of the seam.

### Why the availability is two-valued and the freshness is passed through

The tempting design is a three-valued availability: `CURRENT`, `STALE`,
`UNAVAILABLE`. It is rejected because it **re-decides unit 005's decision**,
and the story is explicit that staleness is not this unit's concern.

But dropping staleness entirely would be worse: the UI could not tell an
old queue from a current one, and the prototype's own line — *"Queue
received from OrgaTEX at 06:12"* — is the acknowledgement that the receipt
time matters to the operator.

So the staleness is **passed through, not re-derived**. The UI reads
`freshness.kind` and shows the age. It never compares `receivedAt` against
its own clock, because the threshold that decides "stale" is unit 005's
**freshness window**, and that window is **configuration** (BRD NFR-14) which
the UI does not have and must not guess at.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|---|---|---|---|
| **Unit 001 calls the adapter directly** | Simple; no dependency on unit 005's reader | Two readers of one seam; two contacts; two caches; **two sources of truth for the same queue** — the exact duplication ADR-021 and the unit brief forbid | **Rejected.** It is the failure the whole seam exists to prevent. |
| **Unit 001 calls `GET /api/orgatex/batches` over HTTP** | No new endpoint | The station's own API calls its own API over a socket; the queue is parsed twice; a distributed system inside one process | **Rejected.** It adds a network hop and an ownership question, and answers neither. |
| **Unit 001 reuses `/api/orgatex/batches` as its own endpoint** | No new path | Unit 005's contract gains fields it does not understand; unit 001's selection state would have to be bolted onto the MES seam | **Rejected.** Two units, one contract, two futures. |
| **The endpoint at `/api/batches/queue`** | Reads naturally | **Silently captured** by the Dummy MES's `/batches/:batchId` route, which answers with a batch-not-found | **Rejected.** A collision that fails silently is worse than a collision that fails loudly. |
| **A three-valued availability (`CURRENT`/`STALE`/`UNAVAILABLE`)** | Self-contained; the UI needs no other field | Re-decides unit 005's staleness decision, and the UI still has to know unit 005's window to render the age | **Rejected.** Passing the decision through is strictly more informative. |
| **A cache in unit 001** | A faster read; survives a restart | A **second** source of truth for one queue, and a stale-looking-fresh risk on restart (ADR-021) | **Rejected.** Unit 005's cache already answers the question. |

## Consequences

### Positive

- **One MES contact path.** There is exactly one reader of the seam, so the
  link state records one observation per contact and the cache has one
  owner.
- **Unit 005's contract is frozen.** Unit 001's endpoint can grow the
  filter, the selection and the recipe context without touching
  `/api/orgatex/*`.
- **The UI never re-derives staleness.** It reads `freshness` and renders
  the age it is given.
- **The failure is distinguishable.** An empty queue is a `200` with zero
  rows; an unreachable MES is a `503` with no `batches` key at all. The
  operator cannot confuse "no work" with "no sight of the work".
- **The test can control the failure.** A controlled `BatchQueueSource`
  proves the use case's interpretation of every outcome, with no MES.

### Negative

- **One more endpoint in the API surface.** `/api/batch-queue` and
  `/api/orgatex/batches` both return a queue, and a reader of the code may
  wonder why there are two.
- **The station's queue endpoint does not exist yet in unit 005's world.**
  Until unit 007 consumes it, it is a published surface with one caller.
- **The projection duplicates four field names** that unit 005 already
  defines. They are the **station's** names now — and the duplication is
  the point, because the two surfaces are allowed to diverge.

### Risks

- **The two queue endpoints drift.** *Mitigation:* the two have different
  contracts and different owners, and this ADR says so; unit 007 consumes
  only `/api/batch-queue`, and unit 005's own tests keep
  `/api/orgatex/batches` honest.
- **A future unit adds a second reader of the seam.** *Mitigation:* the
  composition root is the single place a `BatchQueueSource` is bound, so a
  second reader is visible there; and the decision index's "Read when"
  points at this ADR for anyone about to add one.
- **The UI reads `freshness` but mishandles it.** *Mitigation:* the shape
  is `{ kind: 'CURRENT' }` or `{ kind: 'STALE', ageMs }` — a `STALE`
  freshness **always** carries its age, so the UI cannot render a stale
  queue with an unknown age; the shape is fixed by unit 005 and passed
  through unchanged.

## Related

- **Stories**: 001-retrieve-released-batch-queue
- **Requirements**: FR-1, FR-2, FR-3 · BRD IR-07, IR-01 · NFR-1, NFR-14
- **Previous ADRs**: ADR-020 (the OrgaTEX reads require an operator session —
  the rule this endpoint follows); ADR-021 (the snapshots are not persisted,
  but the last known-good is held in memory — the rule this unit inherits by
  holding no cache of its own); ADR-022 (the adapter's transport is not
  exercised by the tests — the same "the far side's contract is unconfirmed"
  reasoning); ADR-027 (the MES link state is derived — the link state this
  endpoint's freshness comes from)
- **Standards**: `standards/tech-stack.md` § "API shape" — the Dummy
  OrgaTEX's `/api/batches` prefix, which is the training contract this
  endpoint deliberately does not occupy
