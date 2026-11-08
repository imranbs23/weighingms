---
stage: design
bolt: 012-002-recipe-material-management
created: 2026-11-06T01:15:00Z
---

## Technical Design: 002-recipe-material-management (bolt 012)

### Architecture Pattern

**Hexagonal (ports and adapters), with the seam owned by the consumer** — the
same shape as bolts 010 and 011.

This bolt adds **one port** and **one repository**, and it owns **one table
of master data**:

| Port | What it is | Bound to |
|---|---|---|
| `ScaleTarePort` | The tare command to unit `004`'s scale registry | Unit `004`'s `ScaleRegistry` |
| `ContainerAssignmentRepository` | The durable record | This unit's SQLite table |

And the **container master** is a **table in this unit** — BRD §9.3 says
*"Container master: WeighingMS — Master"*, so it is local data rather than a
seam over the MES.

### Layer Structure

```text
┌──────────────────────────────────────────────────────────────────┐
│ Presentation                                                     │
│   ContainerController      POST /api/container                   │
│                            GET  /api/container/:componentId      │
│   (Zod schemas on the boundary)                                   │
├──────────────────────────────────────────────────────────────────┤
│ Application                                                      │
│   AssignContainer           assign + establish the tare           │
├──────────────────────────────────────────────────────────────────┤
│ Domain                                                           │
│   ContainerAssignment       the aggregate — an immutable act      │
│   Container                 the master record                    │
│   ContainerId               the bounded identifier                │
│   ContainerType             DRUM | BUCKET | BAG                   │
│   AssignmentMethod          SCAN | KEYED_IN                        │
│   TareEstablishmentPolicy   master or measured                    │
│   ContainerAssignmentRepository  THE PORT                         │
│   ScaleTarePort             THE PORT (unit 004's registry)        │
├──────────────────────────────────────────────────────────────────┤
│ Infrastructure                                                   │
│   CompositionRoot              binds every port in ONE place       │
│   ContainerDatabase            the tables and migrations           │
│   SqliteContainerAssignmentRepository    append-only              │
│   SqliteContainerMasterRepository        the master                │
└──────────────────────────────────────────────────────────────────┘
```

### API Design

#### `POST /api/container` — assign a container and establish its tare

| Status | Meaning | Body |
|---|---|---|
| **201** | The container was assigned and the tare applied | `{ assignment: {...} }` |
| **400** | The body is not an assignment, or the tare is empty or too long | `{ error: "VALIDATION_ERROR", fields: [...] }` |
| **401** | No operator session | `{ error: "UNAUTHENTICATED" }` |
| **404** | The recipe holds no such component, or the master holds no such container | `{ error: "COMPONENT_NOT_FOUND" }` / `{ error: "CONTAINER_NOT_FOUND" }` |
| **409** | The scale refused the tare | `{ error: "TARE_REFUSED", reason }` |
| **503** | The scale is not reachable | `{ error: "SCALE_UNAVAILABLE" }` |

**The body carries exactly one of `containerId` or `code`:**

```json
{ "componentId": "DYE-4471-Y", "containerId": "C-12" }
```

```json
{ "componentId": "DYE-4471-Y", "code": "C-12" }
```

- A `containerId` means the operator **keyed it in** — the method is
  `KEYED_IN`, derived from the shape.
- A `code` means the **scanner** read it — the method is `SCAN`, derived.

**There is no `assignmentMethod` field, and no `operatorId` field.** The
method is derived and the operator comes from the session — the same rule
ADR-030 and ADR-034 established for every other recorded act in this
product.

**And there is no `tareSource` field.** The source is **derived too**: a
container with a tare in the master gets `CONTAINER_MASTER`, and one without
gets `WEIGHED_EMPTY_CONTAINER` — because the source says **where the value
came from**, and only the station knows that. A client that could claim
`CONTAINER_MASTER` would be claiming the value came from the master when it
was actually measured.

**And no `tareValue` field.** A measured tare is the **scale's** reading,
not the client's number. A client-supplied tare would be a tare the station
did not measure.

#### `GET /api/container/:componentId` — the effective assignment

`200` with the assignment, or `200` with `assignment: null` — **never a
`404`**, because "no container assigned yet" is a **state**, and it is the
rail's first render.

#### Authentication

**An operator session is required** (ADR-020). A **supervisor is not** —
assigning a container and taring the scale are not privileged actions. They
are in the identity unit's `PrivilegedAction` set, and neither is in it.

### Data Model

#### `container_assignments` — append-only

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | The **insertion sequence** — the tie-breaker (ADR-034) |
| `component_id` | `TEXT NOT NULL` | The recipe slot |
| `container_id` | `TEXT NOT NULL` | The vessel |
| `container_type` | `TEXT NULL` | `DRUM` \| `BUCKET` \| `BAG` — copied, so the record stays meaningful if the master changes |
| `tare_weight` | `TEXT NOT NULL` | The tare — a **decimal string**, never a float |
| `tare_unit` | `TEXT NOT NULL` | The tare's unit — **carried, not converted** |
| `tare_source` | `TEXT NOT NULL CHECK (tare_source IN ('CONTAINER_MASTER','WEIGHED_EMPTY_CONTAINER'))` | The closed set in the storage layer |
| `assignment_method` | `TEXT NOT NULL CHECK (assignment_method IN ('SCAN','KEYED_IN'))` | The closed set in the storage layer |
| `operator_id` | `TEXT NOT NULL` | From the session |
| `assigned_at` | `TEXT NOT NULL` | The moment of the act |
| `recorded_at` | `TEXT NOT NULL` | The moment of the write |

**No `is_current` column.** The effective assignment is the newest row —
`ORDER BY assigned_at DESC, id DESC` — a **total** order (ADR-034).

**And the container is NOT de-duplicated.** The same container may be
assigned to two components, and both assignments are recorded — Q-10 is not
decided here.

#### `containers` — the master

WeighingMS's **own** master data (BRD §9.3). Unlike the other two tables,
this one **is mutable** — a container's known tare changes when it is
re-weighed, and a container goes out of service. It is therefore the
product's only **updatable** table, and the reason is a fact about the
container rather than about the weighing.

| Column | Type | Notes |
|---|---|---|
| `container_id` | `TEXT PRIMARY KEY` | The vessel |
| `container_type` | `TEXT NOT NULL CHECK (container_type IN ('DRUM','BUCKET','BAG'))` | The closed set |
| `tare_weight` | `TEXT NULL` | The **known** tare, or `null` when the master does not weigh it |
| `tare_unit` | `TEXT NOT NULL` | The tare's unit |
| `in_service` | `INTEGER NOT NULL` | A boolean — `0` or `1` |

**The tare is NULLABLE here, and never in the assignment.** A container with
no known tare is a container the master does not weigh — and the assignment's
tare is always present, because by then it has been *established* by one
route or the other. A measured tare of `0.0000` is **not** null: it is a
real tare, and unit `004` already carries that rule (S-12).

### The tare, and where it is applied

**Unit `004` owns the device.** Its `ScaleRegistry.applyTare` already does
the whole of the device-side work:

- it asks the adapter for a **reading**, which both proves the device is
  there and brings the link up;
- it consults the **same gate** the weighing uses, so a tare is refused for
  exactly the reasons a weighing is refused (S-13);
- it **converts** into the device's own unit, in the domain, so there is
  exactly one place a conversion happens;
- it applies the tare through the adapter, which decides the **mechanism**
  (at the indicator or in software) and reports the state it applied.

**So this unit does not re-implement any of it.** It declares a **port**
over the registry, and the composition root binds the two. The recorded tare
is the same value either way, and the **source** is the same — which is
exactly what the story requires: *"the applied tare value and its source are
shown to the operator either way, and the recorded tare is the same value in
both cases."*

**And the ORDER is the story's: assign first, then tare.** A tare without a
container is a tare of nothing, so the assignment is recorded only after the
tare has been applied — and if the tare is refused, **nothing is written**
and the previous assignment stands (the same refusal rule unit `004` applies
to the device's tare, S-14).

### The re-tare

The story: *"the operator re-tares → the dispense is reset and the tare is
re-established, and the displayed tare reflects the new value and source."*

**The DISPENSE RESET is unit `003`'s** — the dispense is the session's, and
the session is unit `003`'s. This bolt establishes the tare and records the
assignment; **unit `003` owns the reset.** That boundary is stated in both
units' designs so neither reaches into the other's.

**And the re-tare is a NEW assignment, not an update.** The old one is
retained — the same append-only rule as every other recorded act here.

### Security Design

| Concern | Approach |
|---|---|
| **Session** | Required (ADR-020). The operator comes from `req.currentOperator` — never from the body. |
| **Client-supplied method** | There is **no** `assignmentMethod` field. It is derived from the body's shape. |
| **Client-supplied tare** | There is **no** `tareValue` field. A measured tare is the **scale's** reading; a client-supplied tare would be a tare the station never measured. |
| **Client-supplied source** | There is **no** `tareSource` field. The source is derived from whether the master held a tare. |
| **Client-supplied operator** | There is **no** `operatorId` field. It comes from the session. |
| **Unbounded identifiers** | `ContainerId` and `ComponentId` bound at 64 characters. A longer id is refused, **not truncated**. |
| **A float tare** | The tare is a **decimal string** in the schema, so a JSON number is a `400` before it reaches the domain. |
| **Immutability** | The assignment table is append-only, with the triggers. |
| **Diagnostics leaking** | The refusal bodies carry **codes**. The `409` names the tare's refusal reason — a closed set unit `004` already owns. |

### NFR Implementation

| Requirement | Design approach |
|---|---|
| **NFR-16 / C-11 — fixed-point, never float** | The tare is a **decimal string** at four places, and `WeightValue`'s constructor accepts a string and nothing else. |
| **NFR-2 — 4 places stored, 1 dp / 3 dp displayed** | The **stored** value keeps four places; the display precision is unit `007`'s rule and is not applied here. |
| **BRD IR-12 — the tare may be at the indicator or in software** | The **mechanism** is unit `004`'s and is not recorded; the **value** and the **source** are the same either way. |
| **DR-01 — retained ≥ 5 years** | The assignment table is append-only, with no pruning path. |
| **DR-02 — immutable** | Append-only, with the triggers. |
| **FR-19 / IR-13 — a disconnected scale** | The tare is refused, nothing is written, and the component cannot proceed. |

### Integration Plan

**Bound in the composition root, and nowhere else:**

```text
src/api/server.ts
  └── buildRecipeMaterialModule({
        source: orgatex.recipeReader,
        scanner,                                  // the SAME device
        master: new OrgatexDyestuffMasterAdapter(...),
        scaleTare: scales.registry,               // unit 004's registry
        assignments: new SqliteContainerAssignmentRepository(...),
        containers: new SqliteContainerMasterRepository(...),
        identities: ..., lots: ...,
      })
```

**What this bolt adds to unit `004`: nothing.** Its registry already applies
a tare. This unit declares the **port** and binds it — the same
consumer-owned-port rule as ADR-028 and ADR-032.

**What this bolt adds to unit `005`: nothing.** The container master is
**WeighingMS's own** (BRD §9.3), so it is a table here rather than a seam
over the MES.

**What this bolt adds to the API surface:** one path, `/api/container`.

### Testing Plan

| Suite | What it proves |
|---|---|
| **Unit — the policy** | The master holds a tare → `CONTAINER_MASTER`; it does not → `WEIGHED_EMPTY_CONTAINER`; a re-tare replaces the master's value and changes the source. |
| **Unit — the aggregate** | The assignment refuses a source that does not match its route; the tare is a `WeightValue`, never a float. |
| **Integration — the endpoint** | `201` with the assignment; the operator from the session; the method derived; the source derived; a `409` when the scale refuses; a `404` for an unknown container or component. |
| **Integration — the master** | A container with a tare in the master is assigned `CONTAINER_MASTER`; one without is assigned `WEIGHED_EMPTY_CONTAINER` with the **measured** value. |
| **Persistence** | The triggers abort an update and a delete on the assignments; the closed-set `CHECK` refuses a third method or source; the newest-row ordering is total; the master **is** updatable, because a container's known tare changes. |
| **Security** | No session → `401`; no client-supplied operator, method, source or tare value; the tare value is the scale's reading, not the client's. |
| **Composition root** | Every port is bound to the one it was given — including the **same** scanner instance unit `001` uses. |

### Open points carried forward

1. **The container identification convention** (Q-10, CQ-08). The id is
   opaque, and the convention is FCI's. The model accommodates a scan, a
   keyed entry, or a barcode on the container.
2. **The dispense reset on a re-tare** is unit `003`'s, and this bolt's
   design says so explicitly.
3. **Whether one container may serve several components** is Q-10, and the
   station neither forbids nor assumes it.
