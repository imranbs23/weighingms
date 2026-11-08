---
stage: model
bolt: 012-002-recipe-material-management
created: 2026-11-06T01:05:00Z
---

## Static Model: 002-recipe-material-management (bolt 012)

### Entities

- **ContainerAssignment**: the container a component draws from, and the
  tare applied to it — `componentId`, `containerId`, `containerType?`,
  `tareWeight`, `tareUnit`, `tareSource`, `assignmentMethod`,
  `assignedBy`, `assignedAt`.

  It is a **fact about the past** and therefore immutable (BRD DR-02).

- **Container**: the vessel a material is drawn from — `containerId`,
  `containerType`, `tareWeight?`, `tareSource`, `inService`.

  It is the **master** — the container's known weight, which is a
  **reference value**, not a measurement.

### Value Objects

| Value object | Shape | Rules |
|---|---|---|
| **ContainerId** | bounded, trimmed identifier | `C-12`, `D-03`. **Opaque** — the convention is FCI's (Q-10, CQ-08). |
| **ContainerType** | `DRUM` \| `BUCKET` \| `BAG` | A **closed set of three**, straight from the BRD's `CONTAINER` entity. It is a **property of the vessel**, and it is the one fact about a container that is certainly known — a container is a drum, a bucket or a bag, and that does not change while it is in service. |
| **TareSource** (unit `004`'s) | `CONTAINER_MASTER` \| `WEIGHED_EMPTY_CONTAINER` | **Reused, not redefined.** Unit `004`'s `TareSource` is already exactly this distinction, and it is already a **closed set** there — so this unit does not create a second vocabulary for the same fact. The story calls the sources `MASTER` and `MEASURED`; unit `004`'s names are the ones in the code, and they say the same thing more precisely. |
| **AssignmentMethod** | `SCAN` \| `KEYED_IN` | A **closed set of two**, derived from the request's shape — the same rule ADR-030 established for the batch selection, the material identity and the lot capture. `SCAN` means the container was identified by a scan; `KEYED_IN` means the operator typed the id. CQ-08 interacts here: *"where a container is identified by a scan, the container ID may arrive by scan or by keyed entry, and both routes record the same assignment with the method captured."* |
| **WeightValue** (unit `004`'s) | a fixed-point decimal string + a unit | **Reused, not redefined.** The tare is a weight, and it is stored at **four** decimal places, never as a float (BRD NFR-16, C-11). |
| **ScaleId** (unit `004`'s) | a bounded identifier | **Reused, not redefined.** The tare is applied to a **device**, and the device is unit `004`'s. |

### Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **ContainerAssignment** | the record | 1. **Immutable** once written (BRD DR-02). 2. It names **exactly one** operator and **exactly one** component. 3. Its method is one of two. 4. Its tare source is one of the two, and it **matches** the way the tare was obtained — a measured tare cannot claim the master as its source. 5. The tare's unit is **carried, not converted**: a master tare in kilograms against a component in grams is displayed with both, and no implicit conversion happens here (the story's edge case). |
| **Container** | the master record | 1. The tare is a **reference value** — the container's *known* weight — and it is **nullable**: a container with no known tare is a container the master does not weigh. 2. `inService` is a fact about the container, not about the assignment. |

### Why the assignment is a RELATION, and not an attribute on the component

This is the whole of **Q-10**, and it is the reason the model is shaped the
way it is.

**Q-10 asks:** does one container hold one component, or a whole recipe?

The two answers imply different data models:

- **1:1** — `containerId` is an **attribute** of the component.
- **1:N** — a container is a **recipe-level** entity, and the components
  reference it.

If the model were built for one answer, the other would need a rewrite of
the schema, the records and the endpoints. So the model is built for
**neither** answer specifically: the assignment is a **relation between a
component and a container**, recorded as its own row.

The relation holds under either answer:

- Under **1:1**, there is one assignment row per component, and the
  container's id happens to be unique.
- Under **1:N**, there is one assignment row per component, and several rows
  name the same container.

**And the story settles the observable consequence:** *"A container is
assigned to a second component in the same batch → the assignment is
recorded for both components; whether one physical container may serve
several components is Q-10 and is not decided by this story."*

So the relation is recorded, and **the physical question is left open** — the
station does not forbid a shared container, and it does not assume one.

### Why the tare is **not** persisted on the device, and **is** persisted on the assignment

This is the product's most subtle split, and it is worth stating carefully.

| | The **device's** tare | The **assignment's** tare |
|---|---|---|
| What it is | the scale's **current zero reference** | the tare **applied to this component's container** |
| Owner | unit `004` | this unit |
| Persisted? | **No** — ADR-015 | **Yes** — BRD DR-01 |
| Why | a stale tare read back after a restart would be a **wrong number**: the scale would report the container's full weight as the dispensed quantity | the weighing record must carry the tare and its source (BRD FR-25) |

**ADR-015 already settled the device's side**, and this bolt does not revisit
it. The device's tare is **never persisted**, and the device re-establishes
it when a container is placed on it.

**The assignment's tare IS persisted**, because it is the station's own act —
the same distinction ADR-034 drew for the identity and the lot: **the MES's
truth is not written down; the station's own acts are.**

So the record says *"for component X, container C-12 was used, with a tare of
214 g measured from the empty container"* — and that is what the weighing
record carries.

### Why a measured tare of zero is a valid tare

The story is explicit: *"The measured tare is 0.0000 g → this is a valid
value and is applied and displayed as `0.0000 g`; it is not treated as
missing."*

Unit `004`'s `TareState` already carries this rule (S-12): *"A tare of zero
is a real decision... and 'no tare in force' is a DIFFERENT fact, and it is
represented by the ABSENCE of a tare state — not by a tare whose value
happens to be zero."*

So the **master's** tare is nullable — a container with no known tare — and
the **measured** tare is never nullable. The two are not the same shape, and
collapsing them would make a zero tare indistinguishable from no tare.

### Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **ContainerAssigned** | A container was assigned to a component | `componentId`, `containerId`, `method`, `operatorId`, `at` |
| **TareApplied** | A tare was applied to the component's container | `componentId`, `containerId`, `tareValue`, `tareUnit`, `tareSource`, `scaleId` |
| **TareRefused** | A tare could not be applied | `componentId`, `scaleId`, `reason` — the **reason code** only |

### Domain Services

- **ContainerAssignmentService**: assigns a container to a component, and
  establishes the tare.

  The order is the story's: **assign first, then tare.** A tare without a
  container is a tare of nothing.

- **TareEstablishmentPolicy**: decides **how** the tare is obtained — from
  the master, or by weighing the empty container — and it **consults unit
  `004`'s registry** for the device's verdict.

  The rule is short: if the master holds a tare for this container, that is
  the tare; if it does not, the container must be **weighed empty**. And
  the story's edge case makes the master **losable**: *"The container master
  holds a tare but the operator re-tares → the measured tare replaces the
  master tare and the displayed source changes from `MASTER` to
  `MEASURED`."*

### Repository Interfaces

| Repository | Entity | Methods | Persisted? |
|---|---|---|---|
| **ContainerAssignmentRepository** | `ContainerAssignment` | `save(assignment)`, `latestFor(componentId)` | **Yes** |
| **ContainerMasterSource** | `Container` | `read(containerId): Promise<ContainerLookupOutcome>` | **No.** It is a **port** over the master. |

**The container master is WeighingMS's OWN** — BRD §9.3 says *"Container
master: WeighingMS — Master"*, while the recipe and the dyestuff master are
OrgaTEX's. So the master is **local data**, not a seam over the MES. It is
therefore a **table in this unit**, and it is the one piece of master data
this product owns.

### Ubiquitous Language

- **Container** — the vessel the material is drawn from. A drum, a bucket
  or a bag.
- **Assignment** — the relation between a component and the container it
  draws from. A record, not an attribute.
- **Tare** — the weight of the empty container, subtracted so the reading
  reflects only what was dispensed.
- **Tare source** — where the tare value came from: the **master** (a
  claim) or the **empty container on the scale** (a measurement).
- **Master tare** — the container's *known* weight. A reference value, and
  possibly absent.
- **Measured tare** — the container weighed empty. Evidence. Never absent.
- **In service** — the container is available for use.

---

## Constraints carried into the Technical Design

1. **The tare is a fixed-point decimal**, at four decimal places, never a
   float, in payloads and in storage (BRD NFR-16, C-11).
2. **The stored value is NOT re-quantised for display.** 1 dp for grams and
   3 dp for kilograms is a **presentation** rule, owned by unit `007`. The
   stored value keeps its four places.
3. **The unit is carried, not converted.** A master tare in kilograms against
   a component in grams is displayed with both, and **no implicit
   conversion** happens here — cross-unit arithmetic belongs to unit `003`'s
   fixed-point rules.
4. **The tare may be issued to the indicator or applied in software** (BRD
   IR-12). The **recorded** tare is the same value either way, and the
   source is the same. The mechanism is unit `004`'s.
5. **A re-tare resets the dispense** — it is not a partial update on top of
   an in-progress dispense.
6. **A measured tare of zero is valid** and is never treated as missing.
7. **A failure changes nothing.** A refused tare leaves the previous tare
   in force and writes no assignment — the same rule unit `004`'s registry
   already applies (S-14).
8. **The operator comes from the session**, and the method is **derived**.
9. **The assignment is append-only**, with the same two shapes ADR-034
   settled: no update, no delete, and `BEFORE UPDATE` / `BEFORE DELETE`
   triggers that abort.
10. **No prose crosses the boundary.**

---

## The edge cases, answered

| Scenario | Where it is answered |
|----------|----------------------|
| The master holds a tare but the operator re-tares | The measured tare **replaces** the master tare, and the source changes from `CONTAINER_MASTER` to `WEIGHED_EMPTY_CONTAINER` |
| A container is assigned to a second component | **Both** assignments are recorded — the physical question is Q-10's and is not decided here |
| The tare measurement fails because the scale is disconnected | The tare is **not** applied, the failure is reported, and the component **cannot proceed** (BRD FR-19, BRD IR-13) |
| The measured tare is `0.0000 g` | **Valid.** Applied and displayed as `0.0000 g` — never treated as missing |
| The operator re-tares during a dispense | The dispense is reset, the tare is re-established, and the operator is shown the dispense was cleared |
| The master's tare is in a different unit from the component | The value is shown **with its unit** and **no implicit conversion** is performed |
| The operator assigns a container, then scans a lot code belonging to a different container | The scan is refused with a visible reason and the assignment is **unchanged** |
| A container has no tare in the master | The empty container must be **weighed** — the measured tare applies, with the source `WEIGHED_EMPTY_CONTAINER` |

---

## Open points carried forward

- **The container master's shape** — whether it is OrgaTEX's or WeighingMS's
  is settled by BRD §9.3: **WeighingMS's**. So it is local data, and this
  bolt owns the table.
- **The container identification convention** (Q-10, CQ-08). The id is
  opaque, and the convention is FCI's. The model accommodates a scan, a
  keyed entry, or a barcode on the container.
- **The dispense reset.** *"Re-tare resets the dispense"* is a rule about
  the **session**, and the session is unit `003`'s. This bolt establishes
  the tare and records it; **unit `003` owns the reset.** Carried forward
  explicitly, so neither unit reaches into the other's.
