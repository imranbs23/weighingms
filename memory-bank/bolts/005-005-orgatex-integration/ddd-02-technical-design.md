---
unit: 005-orgatex-integration
bolt: 005-005-orgatex-integration
stage: design
status: complete
updated: 2026-11-02T18:40:00Z
---

# Technical Design - OrgaTEX Integration (Bolt 005: Read the Queue and the Recipe)

## Architecture Pattern

**Hexagonal (Ports and Adapters), with the domain in the middle and every
external dependency behind a port — the same pattern the scale unit and the
identity unit already use.**

This bolt introduces **no new architectural style**, because the point of
the unit is to be a **seam**, and a seam that had its own style would be one
more thing for a reader to learn before they could change the thing that
matters.

### Why this pattern, specifically, for this unit

The unit's whole purpose is IR-07: *"All OrgaTEX interaction is confined to
a single adapter component, so a change of interface technology affects one
replaceable part."* Hexagonal is the pattern that makes that **literal**:

- The **port** (`OrgatexAdapter`) is the complete expression of what the
  unit needs from the MES.
- The **adapter** (`DummyOrgatexAdapter` today, a real one later) is the
  only thing that knows the MES's shape.
- Everything between them — the readers, the cache, the eligibility rule —
  speaks in **domain snapshots** and never in MES field names.

When FCI answers `Q-01`, exactly one file changes and one class is
substituted. Every consumer of this unit keeps its contract. That is the
property the pattern buys, and it is the property this unit exists for.

### What is added, and where

| Capability | Layer | New artefact | Extends |
|---|---|---|---|
| The queue snapshot | Domain | `BatchQueueSnapshot`, `ReleasedBatch`, `BatchId`, `OrderRef`, `MachineRef`, `ShadeCode`, `BatchWeighingStatus` | — |
| The recipe snapshot | Domain | `RecipeSnapshot`, `RecipeComponent`, `DyestuffCode`, `DemandedScaleClass`, `Tolerance` | — |
| Eligibility | Domain | `BatchEligibility`, `BatchEligibilityRule` (pure) | — |
| Freshness | Domain | `SnapshotFreshness`, `SnapshotCache` | — |
| The reads | Domain | `BatchQueueReader`, `RecipeReader` | — |
| The seam | Ports | `OrgatexAdapter` | — |
| The training MES | Infrastructure | `DummyOrgatexAdapter` + its seed data | — |
| The endpoints | Presentation | `orgatex-controller.ts` | `createApp` |

**No new tables. No new repositories. No new database file.** Bolt 005
persists nothing at all — see **Data Persistence** below for why, and for
what *is* coming in bolt `007`.

### The one dependency that crosses a unit boundary

`005` imports `WeightValue`, `Instant` and `ComponentId` from
`004-scale-integration` (model I-1). Those are **value objects**, not
behaviour: `005` does not call into the scale unit, and the scale unit does
not know `005` exists. The dependency is one-directional and creates no
cycle.

---

## Layer Structure

```text
┌──────────────────────────────────────────────────────────┐
│  Presentation                                           │
│    orgatex-controller.ts   — GET /api/orgatex/batches    │
│                             GET /api/orgatex/batches/:id │
│                             /recipe                      │
├──────────────────────────────────────────────────────────┤
│  Application                                            │
│    (none — the domain services ARE the use cases,       │
│     matching units 004 and 008)                         │
├──────────────────────────────────────────────────────────┤
│  Domain                                                 │
│    services/batch-queue-reader.ts     — orchestration   │
│    services/recipe-reader.ts          — orchestration   │
│    services/batch-eligibility-rule.ts — PURE            │
│    services/snapshot-cache.ts         — in-memory       │
│    value-objects/*.ts                 — immutable facts │
│    entities/*.ts                       — projections    │
│    ports/orgatex-adapter.ts           — THE SEAM        │
├──────────────────────────────────────────────────────────┤
│  Infrastructure                                         │
│    adapters/dummy-orgatex-adapter.ts  — the training MES│
│    adapters/dummy-orgatex-data.ts     — its seed world  │
│    config/orgatex-config.ts           — configuration   │
│    composition-root.ts                — wiring          │
└──────────────────────────────────────────────────────────┘
```

**The domain layer has no Express, no SQLite, no timers and no environment.**
Every rule in it is a pure function or a single chokepoint, and the only
things it knows about the outside world are the port and the clock.

---

## API Design

### The product's own endpoints — what the other units call

These are **WeighingMS's** endpoints, not the MES's. They are the published
surface of unit `005`, and they are what units `001`, `002` and `003` call.

| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| `/api/orgatex/batches` | `GET` | query `?status=RELEASED` (optional) | `200` `{ batches[], receivedAt, source, freshness }` · `503` `{ error, reason }` |
| `/api/orgatex/batches/:batchId/recipe` | `GET` | path `batchId` | `200` `{ batchId, shadeCode, components[], receivedAt, source, freshness }` · `404` · `503` |

#### `GET /api/orgatex/batches`

```json
{
  "batches": [
    {
      "batchId": "B-24187",
      "orderRef": "SO-9931",
      "machineRef": "JET-04",
      "fabricDescription": "100% CTN knit · 480 kg",
      "shadeCode": "Teal 4C",
      "componentCount": 5,
      "weighingStatus": "WEIGHING",
      "eligibility": "ELIGIBLE"
    }
  ],
  "receivedAt": "2026-11-02T18:40:00.000Z",
  "source": "DUMMY_ORGATEX",
  "freshness": { "kind": "CURRENT" }
}
```

**Every quantity is a decimal string** (ADR-008). The queue carries no
weights, but the rule applies to the recipe's targets and tolerances, and
it applies here for uniformity: one convention on every boundary.

**`freshness` is always present**, and its `kind` is `CURRENT` or `STALE`.
A `STALE` response additionally carries `ageMs`:

```json
{ "kind": "STALE", "ageMs": 184_000 }
```

**`ageMs` is a duration, not a quantity.** It is a millisecond count, not a
weight, so it is a JSON number — the ADR-008 rule is about *quantities*
(weights, targets, tolerances), not about durations. Making it a string
would be a different convention for no reason.

#### `GET /api/orgatex/batches/:batchId/recipe`

```json
{
  "batchId": "B-24187",
  "shadeCode": "Teal 4C",
  "components": [
    {
      "sequence": 1,
      "componentId": "DYE-4471-B",
      "dyestuffCode": "DYE-1180",
      "target": "1240.0000",
      "unit": "g",
      "tolerance": { "min": "1234.0000", "max": "1246.0000" },
      "scaleClass": "PRECISION"
    }
  ],
  "receivedAt": "2026-11-02T18:40:00.000Z",
  "source": "DUMMY_ORGATEX",
  "freshness": { "kind": "CURRENT" }
}
```

**`tolerance` is `null` when the MES gives no tolerance** — absent, never
zero (S-26). The JSON mirrors the domain's nullable field rather than
flattening it.

**The quantity scale is 4 decimal places** — BRD §9.2's `decimal(12,4)`.
The `WeightValue` type preserves trailing zeros, so `"94.0000"` stays
`"94.0000"`: the scale is the MES's own precision, and rewriting it would
fabricate a resolution that was not reported.

### Error responses

| Status | Body | When |
|--------|------|------|
| `400` | `{ "error": "VALIDATION_ERROR", "fields": [...] }` | A malformed parameter — an unknown status filter, an empty batch id |
| `404` | `{ "error": "BATCH_NOT_FOUND" }` | **Only from a successful contact.** The MES was reached and said no such batch (BRD FR-03). |
| `503` | `{ "error": "ORGATEX_UNAVAILABLE", "reason": "UNREACHABLE" \| "MALFORMED" \| "TIMEOUT" }` | The MES could not be reached, or answered with something that failed validation |
| `401` | `{ "error": "UNAUTHENTICATED" }` | No operator session (see **Security Design**) |

**The detail goes to the log, never to the client** (BRD IR-09). The
`reason` is a closed set of codes, not prose — NFR-11 requires the API to
emit codes and the UI to own the text.

**Why `503` and not `500`.** A `500` says *the product is broken*. This one
says *the MES is not reachable and the station is coping* — which is a
defined, expected operating condition of this product (BRD FR-20). A `5xx`
is correct; `503 Service Unavailable` is the specific one that says "the
dependency is down", and it is the one a monitoring system should alert on
differently from a crash.

### The Dummy OrgaTEX's own endpoints — the training contract

**These are NOT part of the product's API.** They are the Dummy MES's
surface — a separate Express router, mounted separately, and the thing a
real OrgaTEX would replace.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/batches` | `GET` | The MES's queue. `?status=` filters. |
| `/api/batches/:batchId` | `GET` | The MES's batch detail. |
| `/api/batches/:batchId/recipe` | `GET` | The MES's recipe. |
| `/api/batches/:batchId/consumption` | `POST` | **Bolt 006.** Declared now, implemented later — the workbook lists it as part of the Dummy OrgaTEX. |
| `/api/orgatex/control` | `POST` | **Training control** — makes the Dummy MES unreachable, so the `DEGRADED` and `OFFLINE` paths are demonstrable in the running product. |

**The training control is the mechanism that makes FR-20 demonstrable.**
Without it, the outage path would exist only in tests — and the workbook's
Rule 5 says the Dummy integrations are real development artefacts that the
UI is driven through. The scale unit has the same pattern (its
`POST /api/scales/:scaleId/link` control).

**The Dummy MES's payload shape is the MES's shape.** It is a *training*
shape, drawn from the prototype. It is explicitly **not** a claim about the
real contract, and the product's own endpoints do not mirror it — they
expose domain snapshots. That is what keeps the seam real: if the product's
API mirrored the Dummy's, replacing the Dummy with the real MES would mean
changing every consumer.

### The adapter's internal contract

The adapter is called **in-process** in training, not over HTTP. It is a
port bound to a class, and the Dummy adapter holds its world in memory.

**This is deliberate, and it is worth being explicit about why.** The
workbook's Dummy OrgaTEX API is a *training artefact* that must be
independently exercisable (the story says so: *"It is independently
exercisable (for example over curl)"*). So the Dummy MES **exists** as an
HTTP router with its own endpoints. But the **adapter** does not call it
over HTTP — it holds the same seed world directly.

Why: an in-process adapter means the read path has **no network in it**,
so the tests exercise the domain rules without a socket, a port, a timing
dependency or a flaky server. The Dummy MES's HTTP router is mounted
alongside so the training artefact is real and curl-able, and so the
`POST /api/orgatex/control` outage switch can be flipped through the API.

**The consequence to state plainly:** the adapter's transport is *not*
exercised by the unit's tests. When the real MES arrives, a real HTTP
adapter is added and **that** adapter's transport is where a timeout, a
retry or a TLS problem would live. The domain rules this bolt builds do not
change; the risk is contained in the transport, exactly where it belongs.

---

## Data Persistence

**This bolt persists nothing. There are no tables, no migrations and no
repository interfaces.**

That is a decision, not an omission, and it is the same reasoning the scale
unit applied to its tare (ADR-015) and its readings (ADR-009).

| Data | Persisted? | Why |
|------|-------------|-----|
| Batch queue | **No** | A projection of a system the station does not own. It can always be re-fetched. |
| Recipe | **No** | The same. Unit `002` owns the working cache; this unit holds only the last-known-good fallback, in memory. |
| Last-known-good snapshots | **No** | In memory, bounded, disposable. A restart empties it, and the first read after a restart either succeeds or fails loudly — there is no "stale-looking-fresh" path. |
| Contact log | **No** | Bolt `007` owns the link state's machine. This bolt **emits contact events**; bolt `007` decides what to persist about them. |
| Sync queue | **No — yet** | **Bolt `007`.** A consumption posting the station believes it sent but cannot prove is a *correctness* problem, so it is persisted (NFR-05, DR-01). |
| Idempotency ledger | **No — yet** | **Bolt `006`.** The ledger is persisted because a duplicate posting is a quantities error on a real order (IR-08). |

**The asymmetry is the point.** The queue is durable; the snapshots are not.
An unlanded consumption posting cannot be re-derived by asking the MES.
A snapshot can.

**Why no database at all, rather than "not yet".** Because a table is an
invitation. A future agent finding a `batch_queue` table would serve a row
from it as though it were the queue, and the row's age would be a column
rather than a guarantee. The absence is what makes the rule structural.

---

## Security Design

| Concern | Approach |
|---------|----------|
| Authentication | **An operator session is required** for both endpoints. Unlike the scale unit's telemetry (ADR-013), the MES queue is **not** physically visible at the station — it is a business record, and a batch queue is the operator's list of work. **This is a deliberate departure from ADR-013, and it is the reason ADR-020 exists.** |
| Authorization | No **supervisor** is required. Reading the queue and the recipe authorises nothing; it is not a privileged action (BRD NFR-12). |
| Data exposure | The endpoints return only what the MES said. No credentials, no internal URLs, no stack traces. The error handler's generic body applies unchanged. |
| Input validation | Every parameter is validated by **Zod at the boundary** before it reaches the domain. The batch id is bounded in length; the status filter is a closed enum. |
| The adapter | The adapter is **not** exposed over HTTP. It is an in-process port. Only the Dummy MES's own router is mounted, and it is the training artefact. |
| Transport | Not applicable in training — the adapter is in-process. The real adapter's transport (TLS, authentication, timeouts) is **bolt 006's** concern when the write path arrives, and it is where the real contract's unknowns land. |

### Why the session requirement differs from ADR-013

ADR-013 left the scale's read endpoints open, on the grounds that *"a
scale's current weight and calibration state are physically visible to
anyone at the station, and the UI needs the status strip before anyone signs
in."*

Neither premise holds for the MES queue:

- The queue is **not** physically visible. It is OrgaTEX's record of what
  production released, and it is the operator's list of work.
- The UI does **not** need it before anyone signs in. The batch queue is
  screen 1 of a three-screen workflow that begins with an operator.

Opening it would mean that anyone who could reach the API could read the
production schedule. The requirement is therefore **an operator session, not
a supervisor authorisation** — the same distinction ADR-013 drew for the
scale's write endpoints.

**The cost, stated plainly:** the queue is no longer available before
sign-in, so the UI must sign in before it can show the batch list. That is
the correct trade for a business record, but it *is* a change to the
prototype's flow, and it is why this belongs in an ADR rather than in a
code comment.

### The Dummy MES's own router

The Dummy MES's endpoints are **training controls over a training world**.
They are mounted on the same origin as the product's API, and they are
reachable without a session — because the Dummy MES *is* the external
system, and the product's own adapter would reach it without a WeighingMS
session either.

**This is stated as a known property of the training build, not as a
recommendation.** A real deployment removes the Dummy router entirely. The
risk in the training build is that the Dummy's endpoints look like product
endpoints; the mitigation is that they live under a distinct path
(`/api/batches`, the Dummy MES's own prefix) and are removed with the
Dummy.

---

## NFR Implementation

| Requirement | Design Approach |
|-------------|-----------------|
| **NFR-16 (no floating point for quantities)** | `WeightValue`'s string-only constructor, reused from unit `004` (S-21). Every quantity on the wire is a decimal string (ADR-008). The adapter parses the MES's string into a `WeightValue`; it never constructs one from a `number`. The Dummy MES's own payloads also use strings, so the training world is honest about the rule. |
| **FR-20 (weighing continues during an outage)** | The reader serves the last-known-good snapshot, marked with its age, when the link is `DEGRADED`. Reads never **write**, so an outage cannot block the weighing itself. Bolt `007` owns the write-side queue. |
| **NFR-01 (≤ 200 ms lag)** | **Not binding on this unit.** The queue read is a once-per-screen operation, not a 10 Hz path. The in-process adapter means the read is a memory operation plus validation — well inside the budget. The recipe read is also once-per-batch. |
| **NFR-05 (survives immediate power loss)** | **Not binding on this bolt.** Nothing is persisted, so nothing can be lost. The bolt `007` queue and the bolt `006` ledger *are* bound by this requirement, and both live in SQLite with `synchronous = FULL`. |
| **NFR-14 / FR-22 (configuration without redeployment)** | The **freshness window** is configuration (`WEIGHINGMS_ORGATEX_SNAPSHOT_TTL_MS`), not a constant. The MES's base URL is configuration, so the real MES can be pointed at without a rebuild. |
| **BRD NFR-11 (externalised text)** | Every error the API returns is a **code** (`ORGATEX_UNAVAILABLE`, `VALIDATION_ERROR`, `BATCH_NOT_FOUND`). The UI's text lives in unit `007`'s locale bundle. No prose crosses the boundary. |
| **BRD IR-09 (failures logged with enough detail)** | Every failed contact emits a `*ReadFailed` event carrying the reason, the time and the **message** — which goes to the log and never to the client. |
| **DR-01 (≥ 5-year retention)** | **Not binding on this bolt.** Nothing is retained. Bolt `006`'s postings history and bolt `007`'s failed queue entries carry the obligation. |
| **DR-03 (cached master data refreshed on a schedule, never authoritative)** | The snapshots are **never authoritative** — they are the MES's own words at a moment. Unit `002`'s cache is the one that must be refreshed on a schedule, and it is unit `002`'s to build. |
| **Performance** | The adapter is in-process. A queue read is a filter over an in-memory array plus validation. The cache is bounded (one queue, N recipes), so memory is flat regardless of shift length. |
| **Scalability** | **Not applicable at V1 scope.** One station, one MES (BRD A-11). The port is the point: a station-fan-out adapter would replace the Dummy without changing the domain. |

---

## Error Handling

| Error Type | Code | Response | Where it is decided |
|------------|------|----------|---------------------|
| Invalid parameter | `VALIDATION_ERROR` | `400` | Zod, at the boundary |
| Batch not found | `BATCH_NOT_FOUND` | `404` | The reader, **only on a successful contact** |
| MES unreachable | `ORGATEX_UNAVAILABLE` | `503` | The reader, on a failed contact |
| MES answered malformed | `ORGATEX_UNAVAILABLE` + `reason: MALFORMED` | `503` | The adapter's validation |
| MES timed out | `ORGATEX_UNAVAILABLE` + `reason: TIMEOUT` | `503` | The adapter |
| No session | `UNAUTHENTICATED` | `401` | The existing middleware |
| Anything unexpected | `INTERNAL_ERROR` | `500` | The existing error handler — the detail goes to the log |

### The failure vocabulary is one vocabulary

The reader's `reason` set is **closed**: `UNREACHABLE` \| `MALFORMED` \|
`TIMEOUT` \| `NOT_FOUND`. The same set appears in the API response, in the
domain event, and in the log. One set, one meaning, three places — so an
operator's report of "it said MALFORMED" and the log's `MALFORMED` are
provably the same fact.

**`NOT_FOUND` is a reason, but it is not a failure.** It produces a `404`,
not a `503`, because the MES was reached. It is in the same vocabulary
because it is the same *kind* of question — "what did the MES say?" — with
a different answer.

### The malformed case deserves its own note

A malformed MES response is a **`503` with `reason: MALFORMED`**, not a
`500`. It is not a product defect: the product correctly detected that
something it cannot use arrived. A `500` would page someone for a bad
payload from an external system, which is the wrong response and trains
the team to ignore the alert.

**And it fails the WHOLE read** (S-24). A snapshot missing one component is
a wrong quantity to the operator. The adapter validates the whole payload
before the reader constructs anything.

---

## External Dependencies

| Service | Purpose | Integration |
|---------|---------|-------------|
| **OrgaTEX MES** | The queue, the recipe, the batch's weighing status | **REST/JSON over HTTPS — an ASSUMED shape, not a confirmed one.** `A-01`, `A-02`, `Q-01`, `Q-02` are all open. The port is the whole contract. |
| **Dummy OrgaTEX** | The training substitute | In-process adapter + an HTTP router for independent exercisability |
| **Unit `004-scale-integration`** | `WeightValue`, `Instant`, `ComponentId` — value objects only | A TypeScript import. No runtime dependency, no behavioural coupling. |

### The assumption, stated once, in the place it can be checked

`A-01` assumes SETEX provides a documented, licensed REST API over HTTPS
returning JSON. The BRD's own endpoint list is marked *"assumed endpoint
shape — illustrative, for FCI/SETEX to correct"*.

**Nothing in this design asserts that shape as fact.** The product's own
endpoints are **not** the Dummy MES's endpoints, and the adapter's port is
defined in the product's vocabulary. If the real interface is OPC-UA, a
direct database, or file exchange, **this unit's adapter is replaced and
nothing else in the product changes.** That is the property IR-07 promises,
and it is the reason this unit exists as a bounded context.

---

## Testing Approach

The unit brief requires the seam to be *"exercised by the test suite"* and
the stories require specific behaviours to be provable. The split:

| Layer | What is tested | How |
|-------|-----------------|-----|
| Domain | Eligibility derivation; snapshot construction; the freshness rule; the `DEGRADED` fallback; the malformed-refusal | **Pure unit tests**, no I/O |
| Adapter | The Dummy MES's payloads parse into valid snapshots; a malformed payload is refused; a batch that does not exist is `NOT_FOUND`; the outage control makes the adapter fail | **Integration tests** against the adapter |
| Presentation | Every status code; the body shape; the decimal-string rule; the `freshness` field's presence; the session requirement | **Integration tests** with Supertest |

**The cases the stories name explicitly**, and where each is proven:

| Case | Proven by |
|------|-----------|
| An empty queue returns an empty snapshot with its received time — not an error | A domain test |
| A batch not in `RELEASED` reports its eligibility with a reason | A domain test |
| A malformed record fails the whole read | An adapter test |
| A released batch after the last snapshot does not appear until the next read | A reader test |
| The MES unreachable with `DEGRADED` → the last snapshot, marked with its age | A reader test with an injected clock |
| The MES unreachable with `OFFLINE` → the read fails loudly | A reader test |
| The MES unreachable with **no** prior snapshot → the read fails, and **no empty queue is substituted** | A reader test |
| Every quantity is a decimal string | A presentation test asserting the raw JSON text |

**The clock is injected**, as it is in the scale and identity units. A
freshness test that waits five minutes is not a test.

---

## Open questions for the ADR stage

Three decisions this design surfaced that are worth an ADR:

1. **The session requirement for the MES reads** — a deliberate departure
   from ADR-013's "the UI needs it before sign-in" reasoning, because the
   MES's queue is a business record rather than a physically visible device
   state.
2. **The snapshots are not persisted, but the last-known-good is held in
   memory** — the boundary between "the queue is durable" and "the snapshots
   are not", and what that means for the `DEGRADED` read across a restart.
3. **The adapter's transport is not exercised by the tests** — the in-process
   design, and the consequence that the real transport's failure modes are
   untested until a real adapter exists.

The first is a **departure from a recorded standard** and the other two are
**trade-off decisions** — all three fit the ADR type's criteria.

