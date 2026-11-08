---
stage: design
bolt: 010-002-recipe-material-management
created: 2026-11-05T16:50:00Z
---

## Technical Design: 002-recipe-material-management

### Architecture Pattern

**Hexagonal (ports and adapters), with the seam owned by the consumer.**

This is not a new pattern for this repository — units `001`, `004`, `005` and
`008` already use it. What is new is **which unit owns the seam**.

Unit `005` owns the MES's *adapter* (`OrgatexAdapter` — the port to the
external system). This unit owns the **port to unit `005`**: `RecipeSource`.
Unit `005`'s `RecipeReader` satisfies it structurally, and the composition root
binds them in process.

The reasoning is ADR-028's, applied to the recipe:

- the port belongs to the **consumer**, so unit `002` never imports unit
  `005`'s reader *class*;
- there is exactly **one** reader of the MES seam, so there is one contact per
  read, one cache and one source of truth for the recipe;
- the read is **in-process** — the station's own API never calls its own API
  over a socket;
- a test can bind a **controlled source** that returns a specific failure,
  with no MES and no network.

### Layer Structure

```text
┌──────────────────────────────────────────────────────────────────┐
│ Presentation                                                     │
│   RecipeController        GET /api/recipe/:batchId               │
│   (Zod schema on the boundary)                                   │
├──────────────────────────────────────────────────────────────────┤
│ Application                                                      │
│   LoadRecipe              the one use case                       │
│   (reads through the port, projects, holds the working copy)      │
├──────────────────────────────────────────────────────────────────┤
│ Domain                                                           │
│   Recipe                  the aggregate — the station's working   │
│                           copy, with the component states        │
│   RecipeComponent         one material to dispense                │
│   ComponentState          PENDING | ACTIVE | DONE                │
│   SwatchColour            a validated colour token               │
│   MaterialName            bounded display text                    │
│   RecipeProjector         snapshot → Recipe (pure)               │
│   RecipeWorkingCopy       the in-memory working set               │
│   RecipeSource            THE PORT (interface)                   │
├──────────────────────────────────────────────────────────────────┤
│ Infrastructure                                                   │
│   CompositionRoot          binds the port to unit 005's reader    │
│   (no persistence — this bolt writes nothing)                    │
└──────────────────────────────────────────────────────────────────┘
```

**There is no persistence layer in this bolt, and that is the design** — see
*Data Model* below.

### API Design

#### `GET /api/recipe/:batchId` — the station's recipe

The unit's own endpoint. It answers *"what must this station dispense for
this batch?"*, which is a different question from unit `005`'s *"what did the
MES say?"* — the same distinction ADR-028 drew for the queue.

**Why not `/api/batches/:batchId/recipe`:** that path is unit `005`'s, and
`/api/batches/*` is the Dummy MES's prefix. A route under it would either
collide with the Dummy's own recipe route or be silently captured by it.

**Why not `/api/recipe`:** the recipe is a property of a batch, so the batch
id belongs in the path. A body or a query parameter would let a caller ask
for a recipe with an empty id.

| Status | Meaning | Body |
|---|---|---|
| **200** | The recipe | `{ recipe: {...} }` — see below |
| **400** | The batch id is empty or malformed | `{ error: "VALIDATION_ERROR" }` |
| **401** | No operator session | `{ error: "UNAUTHENTICATED" }` |
| **404** | The MES was **reached** and has no such batch | `{ error: "BATCH_NOT_FOUND" }` |
| **503** | The MES could not be reached and there is nothing to serve | `{ error: "RECIPE_UNAVAILABLE", reason: "UNREACHABLE" \| "MALFORMED" \| "TIMEOUT" }` |

**The 200 body:**

```json
{
  "recipe": {
    "batchId": "B-24187",
    "shadeCode": "Teal 4C",
    "components": [
      {
        "sequence": 1,
        "componentId": "DYE-4471-B",
        "dyestuffCode": "DYE-1180",
        "name": "Remazol Brill. Blue RSPL",
        "swatchColour": "#1f4fa8",
        "target": "1240.0000",
        "unit": "g",
        "tolerance": { "min": "1234.0000", "max": "1246.0000" },
        "scaleClass": "PRECISION",
        "state": "PENDING"
      }
    ],
    "counter": { "weighed": 0, "total": 5 },
    "receivedAt": "2026-11-05T16:00:00.000Z",
    "source": "DUMMY_ORGATEX",
    "freshness": { "kind": "CURRENT" }
  }
}
```

**The rules the body obeys:**

1. **Every quantity is a JSON string.** `target`, `tolerance.min`,
   `tolerance.max`. Never a number — ADR-008, BRD NFR-16.
2. **An absent tolerance is `null`.** Never `0`, never `{min: "0", max: "0"}` —
   a missing tolerance is not a zero tolerance.
3. **An absent name or swatch is `null`.** The MES may supply no display
   facts, and the unit does not invent them.
4. **An absent scale class is `null`.** The story is explicit: the component
   renders with an explicit *"scale class unavailable"* marker and cannot
   proceed to dispensing until the value is supplied. The unit **does not
   guess a scale**.
5. **`freshness` is always present.** `{kind: "CURRENT"}` or
   `{kind: "STALE", ageMs}`. A `STALE` freshness **always** carries its age,
   so a consumer cannot render a stale recipe with an unknown age.
6. **No prose.** Codes and data only; the operator-facing text is unit
   `007`'s (BRD NFR-11, FR-22).

**And the failure body has no `components` key at all.** An unreachable MES
must not be able to look like an empty recipe — a client that renders
whatever is under `components` is forced to look at the status code. This is
unit `001`'s rule (ADR-028) and it is the same rule here.

#### The API surface has exactly one verb

`GET`. The recipe is read-only (BRD BR-04, C-01). There is **no** `POST`,
`PUT`, `PATCH` or `DELETE` on this resource — not a "not yet implemented",
but a surface that does not exist. The route table is one line.

#### Authentication

**An operator session is required** (ADR-020). The recipe is OrgaTEX's
production data, not a physically visible device state, so ADR-013's
exemption does not apply. A supervisor is **not** required: reading
authorises nothing.

### Data Model

**Nothing is persisted by this bolt.**

| Data | Where it lives | Persisted? | Why |
|---|---|---|---|
| The **recipe** | `RecipeWorkingCopy`, in memory | **No** | ADR-021: a persisted snapshot is a *stale-looking-fresh* risk. A row written before a power cut, read back after, carries a pre-restart `receivedAt` — and its age is *mathematically correct*, which is exactly the problem: it passes every freshness check and is wrong. |
| The **component states** | On the working copy, in memory | **No** | They are the station's session state, and unit `003` owns their progression. |
| The **counter** | Derived from the states | **No** | A counter that could disagree with the list it counts is a second source of truth for the list. |

**And the offline requirement is still met.** FR-30 (*"the station continues
operating on locally held recipe data when OrgaTEX is unreachable"*) is served
by **unit `005`'s `DEGRADED` fallback** — the last-known-good, served **with
its age**, within the process's lifetime. After a restart the read fails
loudly, which ADR-021 accepts as correct: *"failing loudly after a restart is
correct; serving an unvouchable schedule is not."*

**The absence of a table is the enforcement.** A `recipes` table would be an
*invitation*: a future agent finding it would serve a row from it as though it
were the recipe, and the row's age would be a column rather than a guarantee.
The same reasoning as ADR-009 (readings are never persisted) and ADR-015 (the
tare is never persisted).

**The seam's cache and the working copy are not two sources of truth:**

| | Owner | What it is |
|---|---|---|
| The **last-known-good** | unit `005` | A **fallback** copy, served only when the contact failed, always **with its age**. |
| The **working copy** | unit `002` | The station's **working set** — the recipe the session is working. |

Unit `005` keeps its cache; unit `002` holds one working copy and **never**
re-decides staleness. The freshness is **passed through unchanged**, exactly
as unit `001` does with the queue (ADR-028).

### The seam's contract — and the one change this bolt makes to unit `005`

Unit `005`'s `RecipeReader` already returns a `RecipeSnapshot` with the
components' `sequence`, `componentId`, `dyestuffCode`, `target`, `unit`,
`tolerance` and `scaleClass`.

**The recipe rail also needs a name and a swatch** (C-04: *"The recipe rail
renders components with swatch, name, code, scale class, target and state"*).
The BRD puts `name` and `colour_hex` on the **DYESTUFF** master (BRD §9.2),
and the recipe's component carries a `dyestuff_id`. The MES's recipe payload
as it stands today carries the **dyestuff code** and no name or colour.

Two answers are available, and the choice matters:

1. **Extend the MES's recipe payload** with `name` and `swatchColour` per
   component, and have unit `005` carry them through the seam.
2. **Read the dyestuff master separately** (BRD IR-03) and join it here.

**Answer 2 is bolt `011`'s scope** — the dyestuff master and lot data are
separate reads in the same direction, and unit `005`'s own story says so
explicitly: *"The dyestuff master data and lot data are separate reads in the
same direction (BRD IR-03, IR-04) and are owned by unit 002."*

**So this bolt takes answer 1's shape but not its ownership:** the **fields
are modelled as optional**, and the payload is **optional** about them. The
station works under either answer:

- if the MES supplies them, the component carries them and the rail renders
  a name and a swatch;
- if it does not, the fields are `null` and the rail renders its own
  placeholder — and the story's rule holds: *"no component, target quantity
  or swatch colour is hard-coded in the UI"*.

**And the seam is extended to carry the optional fields, because the seam is
where the MES's shape lives.** This is a **minimal, additive** change to
unit `005`: two optional fields on `RawComponent` and `RecipeComponent`,
validated and carried, with **no change** to the reader's outcome kinds, its
cache, its error handling or its freshness rules.

**The alternative — a second MES read for the master — is rejected here**
because it would create a second contact and a second cache for one recipe,
which is the duplication ADR-028 exists to prevent. It stays available as
bolt `011`'s option if FCI answers A-01 with a contract that puts the master
somewhere else.

### Security Design

| Concern | Approach |
|---|---|
| **Session** | Required (ADR-020). The controller reads `req.currentOperator`, exactly as unit `005`'s and unit `001`'s controllers do. |
| **Read-only** | The surface has one verb. There is no write path to protect. |
| **Unbounded identifiers** | `BatchId` (unit `005`'s) bounds the id at 64 characters and trims it. A malformed id is a `400`, not a `500`. |
| **Style injection through the swatch** | `SwatchColour` accepts **only** `#rgb` and `#rrggbb`. The prototype builds a CSS `background` declaration by string concatenation, so an arbitrary string from the MES would be a style-injection vector. The type is the enforcement. |
| **Unbounded display text** | `MaterialName` is bounded at 200 characters. It travels into a payload and a log line. |
| **Diagnostics leaking to the client** | The failure body carries the **reason code** and nothing else. The message goes to the log (BRD IR-09). The operator sees a code; unit `007` owns the wording. |
| **Error payload size** | The app's `express.json` limit is 16 KB and the recipe is a `GET` with no body. A 32 KB body on this route is a `413`/error from the shared middleware — the product's established contract. |

### NFR Implementation

| Requirement | Design approach |
|---|---|
| **NFR-1 — recipe displayed ≤ 3 s of selection (AC-01)** | One contact, in process, no network hop, no second reader. The read is a single `await` on the seam. The 3 s budget is met by construction; the test asserts the path does not cross a socket. |
| **NFR-16 / C-11 — fixed-point, never float** | `WeightValue`'s constructor accepts a **string** and nothing else, so a `number` is a type error. The seam already carries the target as a decimal string; this unit never converts it to a number. |
| **NFR-3 / FR-20 — available during an outage** | Unit `005`'s `DEGRADED` fallback, passed through with its age. This unit adds no cache and no freshness rule of its own. |
| **NFR-11 / FR-22 — no prose at the boundary** | Codes and data only. |
| **NFR-2 — decimal with 4 places** | Enforced at the boundary of the seam: a target with more than four decimal places is **refused**, not truncated. The story is explicit: *"the adapter layer rejects the payload as invalid rather than silently truncating precision."* |

### Integration Plan

**What is bound, and where:**

```text
src/api/server.ts
  └── buildRecipeModule({
        source: orgatex.recipeReader,   // unit 005's reader, in process
        clock,
      })

src/002-recipe-material-management/infrastructure/composition-root.ts
  └── the ONLY place the port is bound
```

**No HTTP call to unit `005`'s endpoint.** The station's own API does not call
its own API over a socket — ADR-028's rule, and the same one that keeps the
queue's read a single contact.

**What this bolt adds to unit `005`** (minimal and additive):

| File | Change | Why |
|---|---|---|
| `src/005-orgatex-integration/domain/ports/orgatex-adapter.ts` | `RawComponent` gains `name?: string` and `swatchColour?: string` | The MES's optional display facts have to cross the seam. |
| `src/005-orgatex-integration/domain/entities/snapshots.ts` | `RecipeComponent` gains `name: string \| null` and `swatchColour: string \| null` | The snapshot carries them. |
| `src/005-orgatex-integration/domain/services/recipe-reader.ts` | The reader validates and carries the two optional fields | The validation lives in the reader, where it can be tested without a MES (S-24's rule). |
| `src/005-orgatex-integration/infrastructure/adapters/dummy-orgatex-data.ts` | The seed recipe gains the prototype's names and colours | The training artefact teaches the right thing (Rule 5). |

**Nothing else in unit `005` changes** — not the outcome kinds, not the cache,
not the link state, not the freshness, not the existing endpoint.

**What this bolt adds to the API surface:** one path, `GET /api/recipe/:batchId`.

### Testing Plan

| Suite | What it proves |
|---|---|
| **Unit — the projector** | The snapshot becomes a `Recipe`: the order is by sequence, the states are `PENDING`, the counter is derived, the display facts are optional, a duplicate sequence is refused, a five-decimal-place target is refused. |
| **Unit — the value objects** | `SwatchColour` accepts `#abc` and `#aabbcc` and refuses everything else; `MaterialName` is bounded; `ComponentState` is the closed set of three. |
| **Unit — the working copy** | A load replaces the copy; the copy carries its provenance; there is one copy, not a map. |
| **Integration — the endpoint** | `200` with the components in sequence; every quantity a **string**; an absent tolerance is `null`; an absent name/swatch is `null`; the counter is `0 of 5`; a `404` for an unknown batch; a `503` for an unreachable MES with **no `components` key**; a `400` for a malformed id; a `401` without a session. |
| **Integration — the seam is the real one** | The test drives the **real** `RecipeReader` over the Dummy MES — no stub — so the contact, the validation and the cache are all exercised. |
| **Security** | No session → `401`; the diagnostic never reaches the client; the swatch cannot carry a style injection; the recipe cannot be edited by any verb. |
| **Composition root** | The source the module was given **is** the source the use case reads through — the same assertion unit `001` makes, so a second reader of the seam would be visible in one place. |

### Open points carried forward

1. **The dyestuff master's shape** — whether `name` and `colour_hex` arrive on
   the recipe payload or need a separate master read is **bolt `011`'s**
   question. This bolt works under either answer.
2. **`ACTIVE`'s progression** — which component becomes active is unit
   `003`'s rule. This bolt sets every component to `PENDING` at load.
3. **The `Recipe`'s identity in the weighing session** — the BRD's
   `WEIGHING_SESSION` references a `recipe_id`, and the MES's recipe is
   versioned (*"Recipes are versioned; the batch pins a version"*, BRD §9.2).
   The current seam carries no recipe id or version. This bolt records what
   the seam gives and does not invent a version; the question is carried to
   unit `003`, which owns the session.
