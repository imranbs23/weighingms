---
bolt: 012-002-recipe-material-management
created: 2026-11-06T01:25:00Z
status: accepted
---

# ADR-035: The container assignment is a relation, and the tare is recorded twice — once on the device and once on the assignment

## Context

Two facts have to be settled, and they are related but distinct.

**First: how is the container related to the component?**

**Q-10 asks** whether one container holds one component or a whole recipe.
The two answers imply genuinely different data models:

- **1:1** — `containerId` is an **attribute** of the recipe component.
- **1:N** — a container is a **recipe-level** entity and the components
  reference it.

A model built for either answer needs a rewrite of the schema, the records
and the endpoints when the other answer arrives. And Q-10 is **FCI's**
question, not ours — it is asked in the brief's own assumptions register and
it is unanswered.

**Second: where does the tare live?**

The tare is the container's empty weight, subtracted so the reading reflects
only what was dispensed. But there are **two** places it could live, and
they are not the same thing:

- the **device's** current zero reference — the scale's own state;
- the **assignment's** tare — the tare applied to *this component's*
  container, which the weighing record must carry (BRD FR-25).

Unit `004` has already settled the device's side, and it settled it firmly:
**ADR-015 — the tare is never persisted.** A stale tare read back after a
restart would be a **wrong number**, not an inconvenience: the scale would
report the container's full weight as the dispensed quantity. There is no
`TareRepository` and the `scale_devices` table gains no tare column.

So the device's tare is not persisted, and this bolt is about the *other*
one — the assignment's — which **must** be persisted, because the weighing
record carries it (BRD FR-25) and it cannot be re-derived: the MES has no
idea what tare the operator used.

## Decision

**1. The assignment is a RELATION, recorded as its own row — and the model
is built for neither answer to Q-10.**

The assignment is a row linking a component to a container. It holds under
either answer:

- under **1:1**, there is one row per component and the container's id
  happens to be unique;
- under **1:N**, there is one row per component and several rows name the
  same container.

**The physical question is left open.** The station neither forbids a shared
container nor assumes one — the story is explicit: *"whether one physical
container may serve several components is Q-10 and is not decided by this
story."*

**2. The tare is recorded TWICE — on the device (not persisted) and on the
assignment (persisted) — and the two are not the same fact.**

| | The **device's** tare | The **assignment's** tare |
|---|---|---|
| What it is | the scale's **current zero reference** | the tare applied to **this component's** container |
| Owner | unit `004` | unit `002` |
| Persisted? | **No** — ADR-015 | **Yes** — BRD DR-01 |
| Why | a stale tare read back after a restart is a **wrong number** | the weighing record must carry it, and it cannot be re-derived |

**3. The device's tare is RE-ESTABLISHED when a container is assigned.** The
assignment flow asks unit `004`'s registry to apply the tare, and the
registry does the whole device-side job — the reading that proves the device
is there, the gate, the conversion into the device's own unit, and the
mechanism. **This unit re-implements none of it.**

**4. The recorded tare is the same value either way**, and the **source** is
the same — because the source says where the *value* came from (the master
or the empty container), and the **mechanism** (at the indicator or in
software) is unit `004`'s fact.

## Rationale

### Why the relation, and not an attribute

**Because the alternative is a rewrite keyed to an unanswered question.**

A `container_id` column on the recipe component is the 1:1 model, written
down. It says: *"a component has exactly one container."* When FCI answers
"one container serves the whole recipe", that column has to become a table,
every existing record has to be migrated, and every endpoint that read a
component's container has to read a **set** instead of a value.

The relation has **no such cliff**. It is a table either way. The 1:1
answer is a table where the container id happens to be unique; the 1:N
answer is a table where it is not. **Nothing in the schema, the records or
the endpoints changes** — only the interpretation of "may this container be
assigned twice", which is a **rule**, and which the station deliberately
does not have (the story settles it as not-our-decision).

**And the story's own edge case is the observation.** *"A container is
assigned to a second component in the same batch → the assignment is
recorded for both components."* The behaviour is specified **before** Q-10
is answered — and the relation is what makes it expressible without
committing to an answer.

### Why the tare is recorded twice

Because **they answer different questions**, and each has a different
lifetime and a different owner.

- *"What is the scale currently zeroed to?"* is the **device's** question.
  It changes when a container is placed on the scale and when it is
  removed. It is **not persisted** (ADR-015), because a stale one is a
  wrong number.
- *"What tare was applied to this component's container, and where did that
  number come from?"* is the **assignment's** question. It changes when a
  container is assigned. It **is** persisted, because the weighing record
  must carry it (BRD FR-25) and it cannot be re-derived.

**And the failure mode of collapsing them is silent.** If the assignment
read the device's tare to fill in the record, then the record would carry
*"whatever the scale is zeroed to right now"* — which, after the operator
has moved to the next component, is the **next** container's tare. The
weighing record would name the right container and the wrong tare, and
nothing would look wrong.

So the assignment carries its **own copy**, taken at the moment of the
assignment, and the device keeps its own.

### Why the source is part of the record

Because **a claim and a measurement are different facts**, and an
investigation has to be able to tell them apart. A master tare is the
container's *known* weight — a **claim**, and a claim can be wrong. A
weighed tare is a **measurement** — the container was put on the scale and
read — and a measurement cannot be.

Unit `004`'s `TareSource` already carries exactly this distinction, and
already carries it as a **closed set**. So this unit **reuses** it rather
than creating a second vocabulary for the same fact — and the story's
`MASTER`/`MEASURED` names are the same two things in unit `004`'s more
precise words.

**And the source is DERIVED, not supplied.** Only the station knows whether
the value came from the master or from the scale. A client that could
claim `CONTAINER_MASTER` would be claiming a measurement was a reference
value — and the audit trail would then be wrong about which kind of
evidence produced the quantity.

### Why the tare is never a client-supplied number

Because a **measured** tare is the **scale's reading**. The station did not
measure it if the client sent it.

The story's two routes are: the master's known tare, or the empty container
weighed on the scale. In the second route the number comes from unit
`004`'s registry, which reads the device. A client-supplied tare would be a
third route the product does not have — and it would be a route that lets a
caller choose the tare that makes a weight land in tolerance.

So the schema has **no** `tareValue` field, **no** `tareSource` field and
**no** `assignmentMethod` field. All three are derived, and the operator
comes from the session.

### Why the master is WEighingMS's own table

BRD §9.3 says so: *"Container master: WeighingMS — Master"*, while the
recipe, the tolerances and the dyestuff master are OrgaTEX's.

That is worth noticing: this is the **only** master data the product owns,
and it is the reason the bolt's persistence is not entirely append-only.
The container's *known* tare genuinely changes — a container is re-weighed,
or taken out of service — and that is a fact about the **container**, not
about the weighing. So the master table is **updatable**, and the
assignment table is not.

**Two tables with two different mutability rules, for two different
reasons.** That is the point: the assignment is a record of an **act**, and
the master is a **reference**.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|---|---|---|---|
| **`container_id` as a column on the recipe component** | Simple; the 1:1 shape | Commits the model to an answer to Q-10; the 1:N answer needs a schema migration, a data migration and an endpoint change | **Rejected.** Q-10 is FCI's unanswered question, and the relation holds under either answer at no extra cost |
| **A recipe-level container, referenced by the components** | The 1:N shape | Commits to the *other* answer | **Rejected.** The same objection, mirrored |
| **Persist the device's tare too** | The weighing record could read it | A stale tare read back after a restart is a **wrong number** — the scale would report the container's full weight as the dispensed quantity (ADR-015) | **Rejected.** ADR-015 already settled it, and the reason is unchanged |
| **The assignment reads the device's tare to fill in the record** | One copy of the tare | The record would carry *whatever the scale is zeroed to now* — the **next** container's tare. A wrong number that looks right | **Rejected.** The assignment carries its own copy, taken at the moment of the assignment |
| **Let the client supply the tare value and the source** | Simple; no scale contact | A client could choose the tare that makes a weight land in tolerance, and could claim a measurement was a reference value | **Rejected.** The tare is evidence the station produced, and the source is derived from what the station actually did |
| **A relation, with the assignment's own tare, and the source derived** (adopted) | Holds under either answer to Q-10; the weighing record carries the right tare and the right source; the device's tare stays unpersisted | Two copies of a tare exist — the device's and the assignment's — and a reviewer must know they are different facts | **Adopted.** The two copies answer different questions, and the *record* must not be filled from the live device |

## Consequences

### Positive

- **Q-10 can be answered without a rewrite.** The schema, the records and
  the endpoints are unchanged under either answer.
- **The weighing record carries the right tare.** Taken at the moment of
  the assignment, not read from a device that has moved on.
- **The source is evidence, not a claim.** The audit trail can tell a master
  tare from a measured one, and the client cannot mis-state which.
- **The device's tare stays unpersisted** (ADR-015), and the stale-looking-
  fresh risk is impossible there too.
- **The client's inputs are minimal and safe.** No operator, no method, no
  source, no tare value.

### Negative

- **Two copies of a tare exist**, and the difference between them has to be
  understood — they are **not** the same fact, and one of them is not
  persisted.
- **The master table is updatable**, so this unit has two tables with two
  different mutability rules — and the reason is not obvious from the
  schema alone.
- **The tare is applied through unit `004`'s registry**, so this bolt's
  behaviour depends on a unit it does not own. The port is the boundary,
  and the registry's refusal reasons are passed through unchanged.

### Risks

- **A future agent reads the device's tare to fill in the assignment's
  record.** *Mitigation*: this ADR names the failure — the record would
  carry the *next* container's tare — and the decision index's "Read when"
  points here for anyone about to record a tare.
- **A future agent adds a `container_id` column to the recipe component**
  "because it is simpler". *Mitigation*: the same index entry; Q-10 is
  unanswered, and a column commits to an answer.
- **A future agent lets the client supply the tare value.** *Mitigation*:
  the same index entry; a client-chosen tare is a client-chosen tolerance
  boundary.

## Related

- **Stories**: `004-assign-container-and-apply-tare`
- **Requirements**: FR-6, FR-25 · BRD FR-11, FR-16, DR-01, DR-02 · BRD
  IR-12, IR-13 · Q-10, CQ-08
- **Previous ADRs**: ADR-015 (the tare is never persisted — the device's
  side of this ADR, and the reason the assignment keeps its own copy);
  ADR-034 (the identity and the lot are the station's own facts, and they
  are append-only — the rule this bolt's assignment inherits); ADR-030 (the
  method is derived from the request's shape — the rule applied to the
  assignment's method and source); ADR-032 (the display facts cross the
  seam as optional fields — the same "carry what the MES gave, invent
  nothing" reasoning applied to the master's nullable tare)
- **Standards**: `standards/tech-stack.md` § "Database" — SQLite for the
  product's durable records, with append-only rows for acts and mutable
  rows for reference data
