---
stage: model
bolt: 010-002-recipe-material-management
created: 2026-11-05T16:20:00Z
---

## Static Model: 002-recipe-material-management

### Entities

- **Recipe**: the set of components one batch requires — `batchId`, `shadeCode`,
  `components[]` (in recipe sequence), `receivedAt`, `source`, `freshness`,
  `counter`. It is **read-only against OrgaTEX** (BRD BR-04, C-01): no method
  changes a target, a tolerance, a code, a sequence, a class, a name or a
  colour. The only thing that changes is the **component state**, and that is
  this unit's own session model (the story: *"Component state (`done` /
  `active` / `pending`) is set by this unit's session model; progression rules
  belong to unit 003"*).
- **RecipeComponent**: one material the operator must dispense — `sequence`,
  `componentId`, `dyestuffCode`, `name?`, `swatchColour?`, `target`
  (`WeightValue`), `tolerance?` (`Tolerance`), `scaleClass?`
  (`DemandedScaleClass`), `state` (`ComponentState`).

  Three of its fields are **nullable**, and each nullability means *absent*,
  never *zero* and never *unknown*:
  `tolerance` absent = the MES expressed no band; `scaleClass` absent = the MES
  supplied no class; `name` / `swatchColour` absent = the MES supplied no
  display facts.

### Value Objects

| Value object | Shape | Rules |
|---|---|---|
| **ComponentState** | `PENDING` \| `ACTIVE` \| `DONE` | A **closed set of three**, because the three are the rail's states (C-04) and nothing else. `DONE` is the only state that counts towards the counter. `ACTIVE` is *at most one* at a time — the prototype's rail has exactly one active row and a second one would mean two components are being dispensed at once. |
| **SwatchColour** | a hex token — `#rgb` or `#rrggbb` | **Never an arbitrary string.** The colour ends up in a CSS `background` declaration, and the prototype builds that declaration by string concatenation. A free-form string from the MES is a style-injection vector, so the only thing that can become a `SwatchColour` is a token that matches this shape. |
| **MaterialName** | bounded text (≤ 200 characters) | The MES's display name for the material. Bounded because it travels into a payload and a log line. |
| **RecipeCounter** | `weighed`, `total` | **Derived**, never stored independently: `total` = the component count, `weighed` = the number of `DONE` components. A counter that could disagree with the list it counts is a second source of truth for the list. |
| **WeightValue** (unit `004`'s) | a fixed-point decimal string + a unit | **Reused, not redefined** (ADR-008). A `number` cannot be passed to its constructor, so BRD NFR-16 is enforced by the type. |
| **Tolerance** (unit `005`'s) | `min` + `max`, same unit | **Reused, not redefined.** A band, not a deviation; `min ≤ max`; the bounds are inclusive. |
| **DemandedScaleClass** (unit `005`'s) | `PRECISION` \| `FLOOR` | **Reused, not redefined.** What the component *demands* — not the class of any device. |
| **BatchId**, **ComponentId**, **DyestuffCode** (unit `005`'s) | bounded, trimmed identifiers | **Reused, not redefined.** `ComponentId` is *this slot in this recipe*; `DyestuffCode` is *what the material is*. They must not collapse. |

### Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **Recipe** | `components[]`, `counter`, the MES-owned facts | 1. **Read-only** against the MES — no mutation path for a target, a tolerance, a code, a sequence, a class, a name or a colour exists. 2. The components are in **recipe sequence**, and two components may not share a sequence. 3. `counter.total` = the component count; `counter.weighed` = the count of `DONE`. 4. At most one component is `ACTIVE`. 5. Every quantity is a fixed-point decimal with **at most four decimal places** (BRD §9.2 `decimal(12,4)`) — and a violation fails the whole recipe rather than truncating it. 6. The MES's answer must be about the batch that was asked for. |

#### Why `Recipe` is an aggregate, and why the seam's snapshot is not

Unit `005` already has a `RecipeSnapshot`, and it is **not** an aggregate —
it is a point-in-time copy of somebody else's truth, taken through a
read-only seam, with no invariants to enforce and no lifecycle to protect.
That reasoning still holds and is not restated here.

What this bolt adds is the **station's working copy**: the recipe *as the
station works it*, holding the component states and the counter. That copy
has invariants — the sequence is unique, the counter agrees with the list,
one component is active — and a lifecycle, so it is the aggregate. The two
are different objects with different owners: the snapshot is the MES's truth,
the aggregate is the station's.

#### Why the working copy is in memory, and not persisted

ADR-021 settled this for unit `005`'s fallback copy, and the same reasoning
applies here with one addition: a **persisted** recipe is a
*stale-looking-fresh* risk — a row written before a power cut and read back
afterwards carries a pre-restart `receivedAt`, and its age is *mathematically
correct*, which is exactly the problem. The station would present a schedule
it cannot vouch for.

The requirement that appears to demand persistence — FR-30, *"the station
continues operating on locally held recipe data when OrgaTEX is unreachable"* —
is served by **unit `005`'s `DEGRADED` fallback** within a process's
lifetime. After a restart the read fails loudly, which ADR-021 accepts as
correct: *"failing loudly after a restart is correct; serving an unvouchable
schedule is not."*

And this bolt adds a reason of its own: the story is explicit that **cache
policy and staleness ownership sit with unit `005`**, and that *"this story
does not define a separate caching scheme."* Unit `002` therefore defines
**no cache and no freshness rule of its own** — it passes unit `005`'s
freshness through **unchanged**, exactly as unit `001` does with the queue
(ADR-028). A second freshness decision would be a second answer to a
question that already has one.

#### The seam's cache and the working copy are not two sources of truth

ADR-021 says this of unit `005`'s two caches, and the same distinction holds
here:

| | Owner | What it is |
|---|---|---|
| The **last-known-good** | unit `005` | A **fallback** copy, served only when the contact failed, and always **with its age**. |
| The **working copy** | unit `002` | The station's **working set** — the recipe the session is working, with the component states on it. |

A reader asking *"what does the recipe say?"* goes to unit `002`. A reader
asking *"can we still see the queue?"* goes to unit `005`. Neither is a copy of
the other's answer, and neither re-decides the other's staleness.

### Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **RecipeLoaded** | A recipe was read and became the working copy | `batchId`, `shadeCode`, `componentCount`, `receivedAt`, `source`, `freshness` |
| **RecipeLoadFailed** | A recipe read did not produce a recipe | `batchId`, `reason`, `at` — the **reason code only**; the diagnostic goes to the log (BRD IR-09) |

### Domain Services

- **RecipeProjector**: turns unit `005`'s `RecipeSnapshot` into this unit's
  `Recipe`. It is where the read is **interpreted**: the sequence is checked
  for duplicates and the list is ordered by it; the display facts are
  validated; the decimal-place bound is enforced; every component starts
  `PENDING`; the counter is derived.

  It is a **pure** function of the snapshot. It contacts nothing, reads
  nothing and decides nothing about freshness.

- **RecipeWorkingCopy**: the station's in-memory working set — at most **one**
  active recipe, replaced by the next load. It holds the recipe together with
  the provenance it was loaded with (`receivedAt`, `source`, `freshness`), so
  the copy can always say when it was taken and how fresh it was.

  One copy, not a map: the station weighs **one batch at a time** (A-11), and
  a map keyed by batch id would be an unbounded working set with no eviction
  policy and no operator.

### Repository Interfaces

| Repository | Entity | Methods | Persisted? |
|---|---|---|---|
| **RecipeSource** | — (a read) | `read(batchId): Promise<RecipeReadOutcome>` | **No.** It is a **port**, not a store. |

**`RecipeSource` is the seam, and it is owned by this unit.** Unit `005`'s
`RecipeReader` satisfies it structurally, and the binding happens in the
composition root — in process, never over the network. This is the same
decision, and the same reasoning, as ADR-028's `BatchQueueSource`:

- the port belongs to the **consumer**, so unit `002` never imports unit
  `005`'s reader *class*, and unit `005`'s next refactor cannot ripple into a
  unit with no reason to know about it;
- there is exactly **one** reader of the MES seam, so there is one contact
  per read, one cache and one source of truth;
- a test can bind a **controlled source** that returns a specific failure,
  with no MES and no socket.

**And there is no persistence port in this bolt, because there is nothing to
persist.** The working copy is in memory. A `RecipeRepository` here would be
an invitation to write the recipe down, and ADR-021 says why not to.

### Ubiquitous Language

- **Recipe** — the set of components one batch requires, in recipe sequence.
- **Component** — one material the operator must dispense. *This slot in this
  recipe*, not the material itself.
- **Dyestuff code** — the material's FCI article code (`DYE-1180`). *What the
  material is* — not the slot.
- **Target** — the quantity the MES says to dispense. Fixed-point, with its
  unit.
- **Tolerance band** — the MES's inclusive `min`/`max` around the target.
  Absent means the MES expressed none.
- **Demanded scale class** — what the component requires of a scale
  (`PRECISION` or `FLOOR`) — a **requirement**, not a device fact.
- **Scale class** — what a device *is*. A different thing, and the two are
  allowed to disagree (ADR-017).
- **Working copy** — the recipe as the station works it, with the component
  states on it. This unit's own.
- **Last known-good** — unit `005`'s fallback copy, served with its age.
- **Component state** — `PENDING` \| `ACTIVE` \| `DONE`. This unit's session
  model; the **progression rules** are unit `003`'s.
- **Counter** — the components weighed so far, against the total. Derived.
- **Swatch** — the colour chip beside a component's name. Data, never
  hard-coded (the story: *"the swatch colour is data supplied with the
  component"*).

---

## Constraints carried into the Technical Design

1. **Every quantity is a fixed-point decimal string**, never a JSON number,
   never a float (ADR-008, BRD NFR-16). The type is `WeightValue`, and its
   constructor accepts a string and nothing else.
2. **Every quantity is stored and carried at four decimal places or fewer.**
   A target with five decimal places is **refused**, not truncated — the
   story: *"the adapter layer rejects the payload as invalid rather than
   silently truncating precision."*
3. **Units are never converted implicitly.** A component's quantity keeps the
   unit the recipe supplied. Cross-unit arithmetic belongs to unit `003`.
4. **The recipe is read-only.** No write endpoint, no edit path, no
   add/remove. The API surface of this unit has exactly one verb: `GET`.
5. **No prose crosses the boundary.** The payload carries codes and data; the
   operator-facing text is unit `007`'s (BRD NFR-11, FR-22).
6. **A failure is distinguishable and never a partial recipe.** An empty
   recipe is a `200` with zero components; an unreachable MES is a `503` with
   **no `components` key at all**; a batch the MES does not know is a `404`.
   A partially valid recipe is never served (S-24, inherited from unit `005`).
7. **The freshness is passed through unchanged.** This unit does not
   re-decide staleness, and it does not hide it either (ADR-028's rule, by
   analogy).
8. **The component state is this unit's, but the progression is unit `003`'s.**
   This bolt sets every component to `PENDING` at load. It does not advance
   one, and it does not decide which is next.

---

## The three edge cases, answered

| Scenario | Where it is answered |
|----------|----------------------|
| The adapter returns a recipe with zero components | The recipe loads; `counter` is `0 of 0`; the component list is empty. **Not an error.** The recipe is the MES's answer and an empty one is a valid answer. |
| A component is missing a scale class | The component renders with an explicit *"scale class unavailable"* marker and **cannot proceed to dispensing** until the value is supplied. This unit **does not guess a scale** — the story is explicit. The component is still listed, because a recipe is read-only and the station does not alter it (the story's own edge-case row, and unit `005`'s). |
| Two components have the same dyestuff code but different targets | Both are listed as **separate components in recipe sequence**. The recipe is **not de-duplicated**. The dyestuff code identifies the *material*; the component id identifies the *slot* — and two slots may draw on one material. |

## The one that is **not** this bolt's

The story's fifth edge case — *"the upstream recipe changes while the operator
is working"* — is answered by the **session**, not by the recipe: the
already-loaded recipe for the active session is unchanged, and the recipe is
**not hot-reloaded mid-session**. This bolt therefore loads a recipe and
**keeps it**; a later read is a *new load*, and whether it may replace the
working copy is a question this bolt answers **no** — the working copy is
replaced only by an explicit load, never by a background re-read.

---

## Open points carried forward

- **The component counter's `ACTIVE` rule.** This bolt makes `ACTIVE` a state
  a component can hold, and holds that at most one is active. **Which**
  component becomes active is unit `003`'s progression rule, and this bolt
  does not decide it.
- **The name and swatch's source.** The BRD puts `name` and `colour_hex` on
  the **DYESTUFF** master (BRD §9.2), and the recipe's component carries a
  `dyestuff_id`. The MES's recipe payload as it stands today carries the
  **dyestuff code** and no name or colour. So this bolt models both display
  facts as **optional**, and the Technical Design must decide where they come
  from — the recipe payload, or a dyestuff-master read (BRD IR-03) that is
  **bolt 011's** scope. Carried forward explicitly; the answer is not
  invented here.
