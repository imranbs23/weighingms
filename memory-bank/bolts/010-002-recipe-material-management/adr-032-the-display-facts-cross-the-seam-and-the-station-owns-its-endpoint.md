---
bolt: 010-002-recipe-material-management
created: 2026-11-05T17:10:00Z
status: accepted
---

# ADR-032: The recipe's display facts cross the seam as optional fields, and the station owns its own endpoint

## Context

The recipe rail must render each component with a **swatch**, a **name**, the
dyestuff code, the scale class, the target and the state (C-04, BRD FR-06).
Unit `005`'s `RecipeSnapshot` today carries the code, the target, the unit,
the tolerance and the scale class — but **not** the name and **not** the
colour.

The BRD puts those two fields on the **DYESTUFF master**, not on the recipe
component (BRD §9.2):

> `DYESTUFF` — sourced from OrgaTEX master data A-01
> `name` · `string` · `colour_hex` · `string` · **Local — operator
> identification aid**

and the recipe's component carries a `dyestuff_id` pointing at it. The MES's
recipe payload as it stands today carries the **dyestuff code** and neither
field.

So the facts have two possible homes, and the choice is not obvious:

1. **On the recipe payload** — the MES repeats the master data per component.
   One contact, one cache, one answer. But the MES's recipe shape changes,
   and the seam carries two representations of one fact.
2. **A separate dyestuff-master read** (BRD IR-03) — the canonical home.
   But it is a **second contact** and, if cached, a **second cache** for one
   recipe.

There is a second question in the same area, and it is the one ADR-028
settled for the queue: **whose endpoint is the recipe?**

Three could answer it:

1. Unit `005`'s `GET /api/orgatex/batches/:batchId/recipe` — *"what did the
   MES say?"*
2. The Dummy MES's own `GET /api/batches/:batchId/recipe` — the **external
   system's** surface, mounted as a training artefact.
3. A new endpoint owned by unit `002` — *"what must this station dispense
   for this batch?"*

Option 2 is not a candidate at all: it is somebody else's contract, and the
station's product API must not be built on the Dummy's training contract.
Between 1 and 3, ADR-028 already answered the same question for the queue —
and the answer was 3, because the two units' answers have different futures.

## Decision

**Two decisions, and they are the same decision seen from two sides.**

1. **The display facts cross the seam as optional fields.** `RawComponent`
   gains `name?: string` and `swatchColour?: string`; the snapshot carries
   them as `string | null`. **The seam is extended, minimally and additively** —
   the reader's outcome kinds, its cache, its link state, its freshness and
   its existing endpoint are untouched.

2. **Unit `002` owns its own endpoint, `GET /api/recipe/:batchId`,** and
   reads the MES only through unit `005`'s reader, in process, over a port
   unit `002` owns.

**And the facts are modelled as optional on both sides.** A component may
carry a name and a swatch, or carry neither. The station works under either
answer to A-01, and neither the seam nor the endpoint asserts that the MES
supplies them.

## Rationale

### Why the seam is extended rather than a second read

A second read for the dyestuff master would mean, for one recipe:

- **two contacts** where one would do — and the link state records one
  observation per contact, so the MES's link state would report two different
  answers about the same link;
- **two caches** — one for the recipe, one for the master — and therefore
  **two sources of truth** for one component's display facts;
- **two failure modes** — the recipe arrives and the master does not, and
  the operator is left with a component that cannot be rendered, which is a
  partial recipe presented as a whole.

That is precisely the duplication ADR-028 refused for the queue: *"two
readers of one seam, two contacts, two caches and therefore two sources of
truth."* The recipe and the master are two halves of one answer about one
component, so they belong in one read.

**But the canonical home is still the master.** The seam does not assert that
the MES's recipe payload is the right place for the name and the colour — it
carries them **if they are there**. If FCI's answer to A-01 puts the master
somewhere else, the shape of the seam's read changes and this ADR is
revisited; the station's product behaviour does not change, because the
fields are optional on both sides.

### Why the facts are optional, and not defaulted

A default would be a fabrication. If the MES supplies no name, the unit must
not invent one — the story is explicit: *"no component, target quantity or
swatch colour is hard-coded in the UI"*, and the swatch colour is *"data
supplied with the component"*.

So a missing name is `null` and a missing swatch is `null`, and the UI
renders its own placeholder. That is different from ADR-030's queue filter,
where the option set was **derived** from the queue's contents — because a
filter option that matches nothing is a **one-way door**, whereas a missing
swatch is a missing *label*, and a label has a correct fallback.

**And the swatch is validated at the boundary.** The prototype builds a CSS
`background` declaration by string concatenation
(`'background:' + c.color`), so an arbitrary string from the MES would be a
style-injection vector. The colour is therefore a **type** that accepts only
`#rgb` and `#rrggbb`, and nothing else can become one.

### Why unit `002` gets its own endpoint

ADR-028's reasoning applies without change, and the reasons are the same:

- **Different questions.** Unit `005`'s endpoint answers *"what did the MES
  say?"* — the snapshot, in unit `005`'s vocabulary, with the MES's own
  fields. Unit `002`'s answers *"what must this station dispense for this
  batch?"* — the component list, the states and the counter, in the
  **station's** vocabulary.
- **Different futures.** Unit `005`'s contract is the seam's contract and is
  frozen by ADRs that say so explicitly. Unit `002`'s endpoint has to grow
  the component states, the counter and — in bolts `011` and `012` — the
  material identity, the lot and the container. Bolting those onto
  `/api/orgatex/*` would force unit `005` to understand fields it does not
  own.
- **The cost is zero at runtime.** The seam between them is **one in-process
  call**, so separating the endpoints costs nothing but a path in the API
  surface.
- **The path is free.** `/api/recipe` cannot collide: the Dummy MES's router
  is mounted at `/api` and owns `/api/batches/*`, and no router in this
  product owns a route beginning with `/recipe`.

**And the read is in process.** Unit `002` never calls its own API over HTTP
and never holds an `OrgatexAdapter`, a credential or a socket. There is
exactly **one** reader of the MES seam, so there is one contact per read, one
cache and one source of truth — and a second reader would be visible in the
composition root, in one line.

### Why the port belongs to the consumer

`RecipeSource` is declared by unit `002`, not by unit `005`, for the same
reason ADR-028 declared `BatchQueueSource` in unit `001`:

- the dependency runs **inward**, from the application layer to a port this
  unit owns;
- unit `002` never imports unit `005`'s reader *class*, so unit `005`'s next
  refactor cannot ripple into a unit with no reason to know about it;
- the test can bind a **controlled source** that returns a specific failure,
  with no MES, no database and no socket.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|---|---|---|---|
| **A separate dyestuff-master read (BRD IR-03)** | The canonical home of the name and the colour | A **second contact**, a **second cache** and **two sources of truth** for one component's display facts; a partial answer — recipe without master — is a partial recipe | **Rejected** in this bolt. It is bolt `011`'s scope, and it stays available if FCI's A-01 answer puts the master elsewhere |
| **The recipe's fields are required, and a missing name fails the read** | Loud; no nullable display facts | A missing *label* would fail the whole recipe — a component that cannot be weighed because its **name** is absent | **Rejected.** A missing label has a correct fallback; a missing *target* does not. The two are not the same kind of absence |
| **Unit `002` reuses unit `005`'s endpoint as its own** | No new path | Unit `005`'s contract gains fields it does not understand; the states and the counter would have to be bolted onto the MES seam | **Rejected.** Two units, one contract, two futures (ADR-028) |
| **Unit `002` calls `GET /api/orgatex/...` over HTTP** | No new endpoint | The station's own API calls its own API over a socket; the recipe is parsed twice | **Rejected.** It adds a network hop and answers neither question |
| **The endpoint at `/api/batches/:batchId/recipe`** | Reads naturally | **Silently captured** by the Dummy MES's own recipe route | **Rejected.** A collision that fails silently is worse than one that fails loudly |
| **Extend the seam minimally; unit `002` owns its own endpoint; the facts are optional** (adopted) | One contact, one cache, one source of truth; the station's endpoint grows its own vocabulary; the station works under either answer to A-01 | The seam's `RawComponent` shape changes, so unit `005`'s tests are touched | **Adopted.** The change is additive and bounded, and the alternatives each cost a contact, a cache or a correctness property |

## Consequences

### Positive

- **One contact, one cache, one source of truth** for a component's display
  facts.
- **The link state sees one observation per recipe read**, so it describes
  the MES's health truthfully rather than twice.
- **Unit `005`'s contract is frozen.** Unit `002`'s endpoint can grow the
  states, the counter, the identity, the lot and the container without
  touching `/api/orgatex/*`.
- **The station works under either answer to A-01.** The fields are optional
  on both sides, so a real adapter that supplies them and one that does not
  are both supported.
- **A missing swatch cannot inject CSS.** The colour is a validated type.
- **The recipe's read-only-ness is structural** — one verb, nothing
  persisted.

### Negative

- **Unit `005`'s `RawComponent` and `RecipeSnapshot` change**, so unit
  `005`'s own tests and the Dummy's seed data are touched by this bolt. The
  change is additive and every existing assertion still holds.
- **The name and the colour are duplicated on the wire** if the MES's real
  contract repeats them per component. That is the MES's choice, and the
  seam's job is to carry what it is given.
- **One more endpoint in the API surface.** `/api/recipe/:batchId` and
  `/api/orgatex/batches/:batchId/recipe` both return a recipe, and a reader
  of the code may wonder why there are two.

### Risks

- **A future agent adds the dyestuff-master read to bolt `010`** "while we
  are here", creating a second contact and a second cache. *Mitigation*: this
  ADR names the duplication mechanism, and the decision index's "Read when"
  points here for anyone about to add a second read of the seam.
- **A future agent makes the display facts required**, so a recipe without a
  name fails the whole read. *Mitigation*: the same index entry, and this ADR
  distinguishes a missing *label* from a missing *target*.
- **The seam's shape drifts from the real MES's contract.** *Mitigation*:
  the seam's fields are **optional**, so a real adapter that supplies neither
  works unchanged; and ADR-022 already records that the transport is untested
  until a real adapter exists.

## Related

- **Stories**: `001-retrieve-recipe-and-component-list`
- **Requirements**: FR-3, FR-4 · BRD FR-06, BR-04, IR-02, IR-03, C-01, C-04,
  C-13
- **Previous ADRs**: ADR-028 (the station owns its own queue endpoint and
  reads the MES only through unit `005`'s reader — the rule this ADR applies
  to the recipe); ADR-030 (the filter's options are derived from the queue,
  not from a fixed vocabulary — the contrast case for why the *display* facts
  are optional rather than derived); ADR-022 (the adapter's transport is not
  exercised by the tests — the seam's optional fields are what keep the
  untested transport from being a problem); ADR-021 (the snapshots are not
  persisted — the rule the working copy inherits)
- **Standards**: `standards/tech-stack.md` § "API shape" — the Dummy
  OrgaTEX's `/api/batches` prefix, which the new endpoint deliberately does
  not occupy
