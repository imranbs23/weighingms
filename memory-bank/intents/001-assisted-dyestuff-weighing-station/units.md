---
intent: 001-assisted-dyestuff-weighing-station
phase: inception
status: units-decomposed
created: 2026-10-30T04:05:00Z
updated: 2026-10-30T04:05:00Z
---

# Assisted Dyestuff Weighing Station - Unit Decomposition

## Inception Progress

```
- [x] Intent created
- [x] Requirements gathered
- [ ] Generating artifacts...
    - [x] System Context
    - [x] Units  ← this artifact
    - [ ] Stories
    - [ ] Bolt Plan
- [ ] Artifacts reviewed (Checkpoint 3)
- [ ] Ready for Construction
```

## How this decomposition was derived

The units are **capabilities**, not screens and not layers. A unit is a
cohesion boundary with a reason to be separable, an interface that others can
depend on, and a failure mode that does not cascade.

Three rules were applied, in order:

1. **Start from the requirement set, not from the prototype's three views.**
   The prototype has three screens because a mockup needs three screens to
   show a flow. It does not mean three deployable things. A unit that maps
   1:1 onto a screen would be a screen, and the Weighing Station is plainly
   more than a screen.

2. **A unit is separated when it has its own failure mode, its own change
   rate, or its own external contract.** "Separated because it is a different
   file" is not a reason. "Separated because it speaks to a system we do not
   own and whose contract is undocumented" is.

3. **Every FR lands in exactly one unit.** No FR may be shared or orphaned;
   the mapping below is exhaustive and non-overlapping.

The workbook suggested six candidate capabilities. All six were evaluated.
**Four were kept as units, two were deliberately not**, because the
requirements place them elsewhere. The reasoning is recorded rather than
silently applied.

---

## Units Overview

This intent decomposes into **six units** — five backend capability units and
one frontend unit.

| # | Unit | Unit type | Bolt type | FRs | Stories |
|---|------|-----------|-----------|-----|---------|
| 001 | `001-batch-management` | backend | ddd-construction-bolt | FR-1, FR-2 | 3 |
| 002 | `002-recipe-material-management` | backend | ddd-construction-bolt | FR-3, FR-4, FR-5, FR-6 | 4 |
| 003 | `003-weighing-station` | backend | ddd-construction-bolt | FR-7, FR-8, FR-9, FR-10, FR-11, FR-12, FR-13, FR-14, FR-15, FR-18 | 9 |
| 004 | `004-scale-integration` | backend | ddd-construction-bolt | FR-19 (scale half) | 4 |
| 005 | `005-orgatex-integration` | backend | ddd-construction-bolt | FR-16, FR-19 (orgatex half), FR-20 | 5 |
| 006 | `006-ticket-printing` | backend | ddd-construction-bolt | FR-17, FR-21, FR-22, FR-23 | 5 |
| — | `007-weighingms-ui` | frontend | simple-construction-bolt | (consumes all) | 5 |
| — | `008-operator-identity` | backend | ddd-construction-bolt | — | 2 |

**FR-19 is split** across units 004 and 005 — it is the one requirement that
covers two genuinely different peripherals (scales vs OrgaTEX) and two
different failure modes. The split is explicit and the requirement is not
counted twice in the totals; see §Requirement-to-Unit Mapping.

---

## The Proposed Units

### Unit 1: `001-batch-management`

- **Purpose**: Own the set of batches this station may work on, and the act of
  choosing one.
- **Responsibility**: Retrieving the released batch queue from OrgaTEX,
  presenting it, filtering it, and turning "the operator picked a batch" into
  a durable, identified batch selection. It owns the *identity and eligibility
  of a batch* and nothing about what happens inside it.
- **Included capabilities**: batch queue retrieval and display; filtering by
  status; eligibility gating (a batch not in `RELEASED` cannot be selected,
  and the reason is shown); selection by barcode or touch; the batch's
  identity as it appears in the topbar crumb (batch, order, machine).
- **Dependencies**: `005-orgatex-integration` (for the queue read), `002-recipe-material-management` (for the recipe once selected), `008-operator-identity` (to attribute the selection).
- **Why it is a separate unit**: The batch queue is a **read-only projection of a system we do not own**, with its own refresh, failure and staleness behaviour. Its change rate is driven by OrgaTEX releases, not by the station's UI. It is the first thing the operator touches and the last thing that can be wrong about a batch's identity — so its rules (what is selectable, and why not) are worth isolating and testing on their own.
- **Proposed bolt type**: `ddd-construction-bolt` — it has a domain concept (the `Batch` aggregate with an eligibility state machine) worth modelling explicitly.
- **Out of scope**: the recipe's contents; the weighing that follows.

### Unit 2: `002-recipe-material-management`

- **Purpose**: Resolve a selected batch into the exact, identified materials
  the operator must dispense, with everything needed to weigh each one.
- **Responsibility**: Retrieving the recipe; identifying each dyestuff;
  capturing and validating the lot; assigning the container and its tare;
  and holding the *material facts* a weighing depends on — target quantity,
  unit, tolerance, scale class.
- **Included capabilities**: recipe retrieval and component list; component
  identification and dyestuff identity verification (scanned or attested);
  dyestuff lot capture; container assignment and tare handling.
- **Dependencies**: `005-orgatex-integration` (for the recipe read), `004-scale-integration` (for the scale class that a component requires), `008-operator-identity` (to attribute lot capture).
- **Why it is a separate unit**: This unit answers "what exactly am I putting in the bucket, and where did it come from?" — a **question about material identity and provenance**. It is separated from the weighing because material identity is captured *before* any weight exists, is governed by a different set of rules (scan vs attest, lot validation, tare), and has a **different failure mode**: a wrong lot or wrong container is a traceability defect that survives even a perfectly weighed batch. It also has the highest uncertainty of any unit, because Q-07 (do dyestuffs carry scannable barcodes?) and Q-10 (one container per component or per recipe?) both land here and both change the shape of the data model.
- **Proposed bolt type**: `ddd-construction-bolt` — the `Recipe`/`RecipeComponent`/`MaterialLot`/`Container` entities carry real invariants and must be modelled before code.
- **Out of scope**: the weight; whether the weight was right.

### Unit 3: `003-weighing-station`

- **Purpose**: The guided weighing itself — read the scale, judge it against
  tolerance, and let the operator confirm it.
- **Responsibility**: The **weighing session** and its state machine;
  automatic scale selection; consuming the live weight stream; evaluating
  the tolerance zone on every reading; gating confirmation; detecting and
  handling over-dose, surplus compensation and non-compensable escalation;
  advancing through components; producing the batch completion summary; and
  recording the operator against the weighing.
- **Included capabilities**: automatic scale selection; the live weight stream
  and guided dispensing; the four tolerance zones and status signalling;
  confirmation gating; over-dose detection, overshoot and surplus
  calculation; surplus compensation; non-compensable over-dose escalation;
  component progression; batch completion summary; operator identification and
  traceability at the point of weighing.
- **Dependencies**: `004-scale-integration` (for the weight stream), `002-recipe-material-management` (for targets and tolerances), `001-batch-management` (for the selected batch), `005-orgatex-integration` (for batch status), `008-operator-identity` (for the operator).
- **Why it is a separate unit, and why it is more than a screen**: This is the
  largest and most important unit, and it is deliberately **not** the UI. It
  owns the session state machine — which batch, which component, which zone,
  what has been dispensed, whether it can be confirmed — and that state
  machine is the product. The prototype's three views are *one rendering of*
  this state; the unit's contract is that the same session behaves identically
  whether it is driven by a touchscreen, a 21-key terminal, or a test harness.
  It is separated because it has **the only stateful correctness requirements
  in the system** (immutability on confirm, idempotent progression,
  resumability after interruption) and it must be provable without a UI. It
  also holds the highest-risk logic in the build (the tolerance engine and the
  compensation rule), which is exactly what should be isolated from
  integration noise.
- **Proposed bolt type**: `ddd-construction-bolt` — the `WeighingSession`
  aggregate and the `ToleranceZone` value object are the core of the domain
  and must be modelled before any code is written.
- **Out of scope**: where the weight came from (unit 004); where the recipe
  came from (unit 005); what the ticket says (unit 006).

### Unit 4: `004-scale-integration`

- **Purpose**: Turn a physical scale into a reliable, live weight feed — and
  into a detected failure when it stops.
- **Responsibility**: The **adapter** to the scale indicators; the transport
  that carries weight readings and stability flags at ≥10 Hz; tare commands;
  scale status and calibration state; **disconnect detection within 2 s**;
  automatic selection between the 3 kg and 32 kg scales; and the synthetic
  dispensing behaviour that stands in for a real scale during training.
- **Included capabilities**: the scale adapter and its training implementation;
  the continuous weight stream with a stability flag; tare; scale status and
  disconnection detection; calibration validity; scale selection by capacity;
  the dispersion ramp as a *device* behaviour rather than a UI behaviour.
- **Dependencies**: none within the system. It is a leaf unit.
- **Why it is a separate unit**: It is the unit with the **hardest external
  contract and the worst documentation**. A-05 (continuous ≥10 Hz streaming
  with a stability flag) and Q-03 (make, model and protocol) are both
  unresolved, and B-5 says that if only a stabilised value exists, guided
  weighing as drawn is not buildable at all. That is a **risk that must be
  isolated behind an interface**: everything above unit 004 must be written
  against "a live weight with a stability flag", so that when the real
  protocol arrives, only this unit changes. It also has its own distinct
  failure mode — a scale that goes silent is not the same event as OrgaTEX
  going away, and the operator's response differs.
- **Proposed bolt type**: `ddd-construction-bolt` — it has a domain concept
  (`ScaleDevice`, `WeightReading`) with real invariants (monotonic sequence,
  stability semantics) and the transport behaviour is the substance of the
  unit.
- **Out of scope**: whether the weight is within tolerance (unit 003).

### Unit 5: `005-orgatex-integration`

- **Purpose**: The single seam through which WeighingMS talks to the MES —
  and the only place where an undocumented contract can be wrong.
- **Responsibility**: The **adapter** to OrgaTEX; reading the batch queue and
  the recipe; writing batch weighing status; writing actual consumption
  **idempotently**; the link-state reporting (`LINKED` / `DEGRADED` /
  `OFFLINE`); the **deferred synchronisation queue** and its retry policy;
  and the training implementation of the MES.
- **Included capabilities**: the OrgaTEX adapter and its training
  implementation; batch and recipe reads; status and consumption writes;
  idempotency on consumption posting; link state and outage handling;
  offline queueing and deferred synchronisation.
- **Dependencies**: none within the system. It is a leaf unit.
- **Why it is a separate unit**: BRD IR-07 requires **all** OrgaTEX interaction
  to be confined to a single adapter component, and this is that component.
  It is separated for three independent reasons: (a) **it owns the only
  contract we do not have** — A-01, A-02, Q-01 and Q-02 are all about this
  boundary, and if the real answer is "no REST API" then this unit is where
  that becomes visible and nothing else has to be thrown away; (b) it has a
  **different failure mode from anything else** — the system must keep
  weighing while it is down, so it owns a queue, a retry policy and an
  idempotency contract that no other unit has; (c) it has a **different change
  rate** — it changes when SETEX ships, not when FCI changes a rule.
- **Proposed bolt type**: `ddd-construction-bolt` — the idempotency contract
  and the synchronisation queue are domain logic, not plumbing.
- **Out of scope**: what to do with the data once it has been read.

### Unit 6: `006-ticket-printing`

- **Purpose**: Produce the weighing ticket and label, and the administrative
  record around privileged actions.
- **Responsibility**: Rendering the ticket from a template; creating and
  tracking print jobs; marking reprints; the **audit trail** for privileged
  actions (immutable, exportable, retained ≥5 years); **configuration and
  localisation** (scale thresholds, tolerance overrides, label template,
  language — all externalised, no redeployment required); and **operational
  reporting** over the recorded weighings.
- **Included capabilities**: ticket generation and printing; print job
  tracking and reprint marking; the audit trail for privileged actions;
  configuration management without redeployment; localisation of all
  operator-facing text; operational reporting.
- **Dependencies**: `003-weighing-station` (for what was weighed), `001-batch-management` (for batch identity on the ticket), `008-operator-identity` (for the operator on the ticket and in the audit trail).
- **Why it is a separate unit**: Printing, audit and configuration are
  **supporting capabilities with a different change rate and a different
  owner**. The label template will be changed by FCI the first time the
  printer is chosen; the language will be changed when a second site appears;
  the audit format is set by the retention policy. None of that should ever
  require re-opening the weighing logic. It also has a **distinct failure
  mode**: a printer that is out of paper must not cost a weighing (B-7), which
  means printing has to be separable from recording. And it is the natural
  home for the requirement that is *most* likely to be re-specified —
  Q-11 asks what the ticket should actually carry, and the prototype itself
  says "Label content is invented".
- **Proposed bolt type**: `ddd-construction-bolt` — the audit trail is an
  append-only domain concept with immutability and export requirements, not
  a logging side-effect.
- **Out of scope**: the weighing itself; what OrgaTEX does with the record.

### Unit 7: `007-weighingms-ui` *(frontend)*

- **Purpose**: The operator terminal.
- **Responsibility**: Rendering the three views — Select batch, Weigh,
  Confirm & print — reproducing the supplied prototype's behaviour, tokens
  and interaction rules; the live weight display fed by the session API;
  function-key handling (F1–F4); gloved-hand ergonomics (≥15 mm targets,
  legible at 1.5 m); and the explicit degraded states when a boundary fails.
- **Included capabilities**: the three views; the recipe rail with component
  state; the live readout, tolerance band bar and status line; the surplus
  panel; the action row; the peripheral status strip with real link states;
  keyboard and function-key handling; responsive, externalised text.
- **Dependencies**: **all backend units**.
- **Why it is a separate unit**: The catalogue mandates a frontend unit for
  `full-stack-web` projects, and it is genuinely separable — it is the only
  unit with a rendering concern, the only one that must be tested for
  ergonomics rather than correctness, and the only one whose failure is
  *degraded but not incorrect*. It consumes the same session API the tests
  drive, so it can be replaced or redesigned without touching a single rule.
- **Proposed bolt type**: `simple-construction-bolt` — feature-based
  decomposition, per the catalogue's `frontend` configuration.
- **Note**: The unit carries **no FR of its own**. Every FR belongs to a
  backend capability; the UI consumes them. This is deliberate — it is what
  makes "the Weighing Station is more than a screen" demonstrable rather than
  asserted.

### Unit 8: `008-operator-identity` *(supporting)*

- **Purpose**: Establish *who* is at the terminal, and authorise the actions
  that need more than an operator.
- **Responsibility**: Operator sign-in and identity; role assignment;
  **supervisor authentication** for privileged actions; session lifetime;
  credential policy (never shared between roles); and the identity stamp on
  weighing records and audit entries.
- **Included capabilities**: sign-in and sign-out; role determination;
  supervisor authentication; session expiry; the identity attached to a
  weighing and to an audit record.
- **Dependencies**: none within the system.
- **Why it is a separate unit**: It is small, but it is **the unit with the
  tightest security requirement** (NFR-12: supervisor authentication required,
  credentials never shared between roles) and the only unit where a defect is
  a compliance breach rather than a usability bug. Separating it means the
  authentication path can be tested exhaustively on its own, and it keeps the
  "who is the operator" question from leaking into every other unit's
  signature. It is also the one unit whose **implementation is explicitly
  undecided** (Q-08: does FCI supply its own directory?), which is exactly
  why it deserves a boundary of its own — the decision can then be made
  without touching the rest of the system.
- **Proposed bolt type**: `ddd-construction-bolt`.
- **Note**: This unit has **no FR of its own**. FR-18 (operator
  identification and traceability) is assigned to unit 003, because the
  *weighing* must carry the operator; this unit *provides* that identity. The
  split is recorded here so the assignment stays unambiguous: unit 003 owns
  the requirement, unit 008 owns the capability that satisfies part of it.

---

## Capability Candidates Evaluated

The workbook suggested six capabilities. All six were evaluated against the
requirements and the dependency structure.

| Suggested capability | Outcome | Reasoning |
|---|---|---|
| **Batch Management** | **Kept** as unit 001 | Distinct concept with its own eligibility rules and its own external read. |
| **Recipe & Material Management** | **Kept** as unit 002 | Distinct concept with a distinct failure mode (identity/provenance defects survive a good weighing) and the highest data-model uncertainty (Q-07, Q-10). |
| **Weighing Station** | **Kept** as unit 003 | The core domain. Deliberately separated from the UI so the session state machine is provable without a screen. |
| **Scale Integration** | **Kept** as unit 004 | Leaf unit owning the hardest external contract (A-05, Q-03) and the risk that would change the product's shape (B-5). |
| **OrgaTEX Integration** | **Kept** as unit 005 | Leaf unit owning the only undocumented contract that could invalidate the premise (A-01, A-02, Q-01, Q-02). |
| **Ticket & Printing** | **Kept, and widened** as unit 006 | Ticket and printing are kept, but the audit trail, configuration, localisation and reporting are folded in — they share the same characteristic: supporting capabilities, a different owner, and a different change rate. |

### Two capabilities that were *not* created

**"Tolerance / Zone engine" as its own unit.** It was seriously considered,
because the tolerance zone is the pivot of the whole product and the zone
rules are the highest-risk logic in the build. It was **not** separated, for
two reasons.

First, the zone calculation is a **pure value computation** over two inputs
(target and tolerance) and one input reading. It has no state, no persistence,
no external contract and no independent failure mode — extracting it would
create a unit that cannot fail on its own and cannot be deployed on its own.
It is instead modelled as a **value object inside unit 003** (`ToleranceZone`),
with its own dedicated test suite. That gives the isolation the risk actually
needs (exhaustive boundary tests) without inventing a deployment boundary
that has no purpose.

Second, if it were a separate unit, unit 003 would have to depend on it for
every reading, which would put a network hop on the path between the scale
and the confirmation button — directly at odds with NFR-01's ≤200 ms lag.

**"Session / Weighing state" as its own unit.** Also considered and rejected.
The session state machine cannot be separated from the weighing rules: the
rule *is* the state transition. Splitting them would create a unit whose only
job is to hold state that another unit decides, and the resulting
"session service" would be a shared mutable object across a network boundary —
the classic way to lose the immutability guarantee (DR-02) that the whole
product exists to provide. Unit 003 owns the session.

---

## Requirement-to-Unit Mapping

**Every FR from `requirements.md` is assigned to exactly one unit.** The
mapping is exhaustive and non-overlapping.

| FR | Requirement | Unit |
|---|---|---|
| FR-1 | Batch queue retrieval and display | `001-batch-management` |
| FR-2 | Batch selection by barcode or touch | `001-batch-management` |
| FR-3 | Recipe retrieval and component list | `002-recipe-material-management` |
| FR-4 | Component identification and dyestuff identity verification | `002-recipe-material-management` |
| FR-5 | Dyestuff lot capture | `002-recipe-material-management` |
| FR-6 | Container assignment and tare handling | `002-recipe-material-management` |
| FR-7 | Automatic scale selection | `003-weighing-station` |
| FR-8 | Live weight stream and guided dispensing | `003-weighing-station` |
| FR-9 | Tolerance zones and status signalling | `003-weighing-station` |
| FR-10 | Confirmation gating | `003-weighing-station` |
| FR-11 | Over-dose detection, overshoot and surplus calculation | `003-weighing-station` |
| FR-12 | Surplus compensation | `003-weighing-station` |
| FR-13 | Non-compensable over-dose escalation | `003-weighing-station` |
| FR-14 | Component progression | `003-weighing-station` |
| FR-15 | Batch completion summary | `003-weighing-station` |
| FR-16 | OrgaTEX write-back | `005-orgatex-integration` |
| FR-17 | Ticket generation | `006-ticket-printing` |
| FR-18 | Operator identification and traceability | `003-weighing-station` |
| FR-19 | Peripheral status and failure handling | `004-scale-integration` (scale) + `005-orgatex-integration` (OrgaTEX) — **split, see below** |
| FR-20 | Offline operation and deferred synchronisation | `005-orgatex-integration` |
| FR-21 | Privileged actions and audit trail | `006-ticket-printing` |
| FR-22 | Configuration and localisation | `006-ticket-printing` |
| FR-23 | Operational reporting | `006-ticket-printing` |

**Coverage check**: 23 FRs — 22 assigned one-to-one, 1 (FR-19) assigned to
two units by an explicit split. **Every FR is accounted for; none is
orphaned or shared silently.**

### The FR-19 split, stated explicitly

FR-19 requires peripheral status *and* failure handling for the scale, the
scanner and the printer, and for the OrgaTEX link. Those peripherals fail in
different ways and are owned by different units:

| Part of FR-19 | Unit | Why there |
|---|---|---|
| Scale status, disconnection detection within 2 s, calibration state | `004-scale-integration` | Unit 004 owns the scale device; B-3 and B-4 are its failure modes. |
| Scanner status and failure (B-6) | `002-recipe-material-management` | The scanner exists to identify a *material*; B-6 is a material-identification failure, and its fallback (attestation) is a traceability decision unit 002 owns. |
| Printer status and failure (B-7) | `006-ticket-printing` | The printer belongs to unit 006; B-7 is "printing must not cost a weighing". |
| OrgaTEX link state (B-1) | `005-orgatex-integration` | Unit 005 owns the link and the queue. |

The **scanner** and **printer** were deliberately *not* given their own
units. The scanner has exactly one job in this product — resolve a barcode to
a material identity — and it does that as part of unit 002's identity
capability; a separate unit would have no logic of its own, only a transport.
The printer is the output half of unit 006 for the same reason.

---

## Unit Dependency Graph

```text
                        ┌───────────────────────────┐
                        │ 008-operator-identity     │  (leaf)
                        │ sign-in · roles · auth    │
                        └─────┬──────────┬──────────┘
                              │          │
                    ┌─────────┘          └──────────┐
                    │                               │
        ┌───────────▼───────────┐       ┌───────────▼───────────┐
        │ 004-scale-integration │       │ 005-orgatex-integration│
        │ leaf · scale device   │       │ leaf · the MES seam   │
        │ SSE · tare · detect   │       │ queue · idempotency  │
        └───────────┬───────────┘       └───────────┬───────────┘
                    │                               │
        ┌───────────▼───────────────────────────────▼───────────┐
        │ 003-weighing-station                                   │
        │ THE CORE: session state machine + tolerance engine      │
        └───┬───────────────────────┬────────────────────────┬───┘
            │                       │                        │
   ┌────────▼────────┐   ┌──────────▼──────────┐   ┌─────────▼────────┐
   │ 002-recipe-     │   │ 006-ticket-printing │   │ 001-batch-       │
   │ material-mgmt   │   │ ticket · audit ·    │   │ management       │
   │ recipe · lot ·  │   │ config · locale ·   │   │ queue · select   │
   │ container · tare│   │ reports             │   │ eligibility      │
   └────────┬────────┘   └─────────────────────┘   └─────────▲────────┘
            │                                              │
            └──────────────► 001-batch-management ◄────────┘
                              (queue read + selection)

        ┌────────────────────────────────────────────────────────┐
        │ 007-weighingms-ui  (frontend) — consumes all of the above │
        └────────────────────────────────────────────────────────┘
```

**Leaf units** (no internal dependencies): `004-scale-integration`,
`005-orgatex-integration`, `008-operator-identity`.

**Ordering constraint**: `001-batch-management` depends on `002` for the
recipe it loads on selection, and `002` depends on `001` for the batch
context of a recipe. This is a **narrow cycle at the level of the same
recipe-load operation**, resolved by making the recipe load a single
cross-unit call owned by unit 002 and invoked by unit 001 — not by
splitting the recipe's data. The dependency is expressed as
`001 → 002` for the load, and the reverse edge is only the *reference* from
a component back to its batch id.

---

## Independence Validation

The catalogue requires each unit to be independently developable and
deployable, with a clear interface and non-cascading failure.

| Unit | Separate team? | Clear interface? | Failure cascades? | Deployable alone? |
|---|---|---|---|---|
| `001-batch-management` | ✅ | ✅ `GET /batches`, `POST /batches/select` | ✅ no — a failed queue read does not affect a weighing in progress | ✅ |
| `002-recipe-material-management` | ✅ | ✅ `GET /recipes/:batchId`, `POST /lots`, `POST /containers` | ✅ no — a failed scan does not affect the scale | ✅ |
| `003-weighing-station` | ✅ | ✅ session API + zone engine | ⚠️ **by design** — this is the core; its failure stops weighing, which is correct behaviour | ✅ |
| `004-scale-integration` | ✅ | ✅ SSE weight stream + tare + status | ✅ no — the adapter isolates it; B-3 blocks weighing at the boundary rather than corrupting it | ✅ |
| `005-orgatex-integration` | ✅ | ✅ REST reads/writes + link state | ✅ no — this is the whole point of the offline queue (B-1) | ✅ |
| `006-ticket-printing` | ✅ | ✅ `POST /tickets`, audit query, config API | ✅ no — B-7 isolates printer failure from the weighing record | ✅ |
| `007-weighingms-ui` | ✅ | ✅ consumes the session API only | ✅ no — a UI failure is degraded, not incorrect | ✅ |
| `008-operator-identity` | ✅ | ✅ sign-in / role / authenticate | ✅ no — a failed auth refuses an action; it never corrupts data | ✅ |

**"Is the Weighing Station treated as more than a screen?"** — Yes, and this
is the check the decomposition is most likely to be judged on. Unit 003 owns
**eleven of the twenty-three functional requirements** and the entire session
state machine. Unit 007 owns **none**. The UI is a consumer of the session API;
the session API is provable without a UI; the tests drive the session API
directly. If the Weighing Station were a screen, unit 003 would not exist and
unit 007 would carry FR-7 through FR-15.

---

## Execution Order

Dependencies, not days. The sizes below are relative, not commitments.

| Order | Unit | Why here | Complexity |
|---|---|---|---|
| 1 | `008-operator-identity` | Leaf, small, and its output (the operator stamp) is needed by units 002, 003 and 006. | S |
| 1 | `004-scale-integration` | Leaf. The Dummy Scale and its SSE transport are the substrate the whole weighing flow runs on. Also the earliest place to de-risk A-05/B-5. | M |
| 1 | `005-orgatex-integration` | Leaf. The Dummy OrgaTEX, the queue, and the idempotency contract are the substrate for units 001 and 002. | M |
| 2 | `002-recipe-material-management` | Needs 005 (recipe read) and 004 (scale class). Resolves Q-07 and Q-10 into a data model. | M |
| 2 | `001-batch-management` | Needs 005 (queue read) and 002 (recipe load). | S |
| 3 | `003-weighing-station` | Needs 001, 002, 004. The core; built on three proven substrates. | L |
| 4 | `006-ticket-printing` | Needs 003 (what was weighed) and 001 (batch identity). Can proceed in parallel with 007. | M |
| 4 | `007-weighingms-ui` | Needs all backend units. | L |
| 5 | Integration & E2E | Needs everything. | M |

Units at the same order number have no dependency on each other and can be
built in parallel.

---

## Artifacts Created

✅ `memory-bank/intents/001-assisted-dyestuff-weighing-station/units.md`
✅ `memory-bank/intents/001-assisted-dyestuff-weighing-station/units/001-batch-management/unit-brief.md`
✅ `memory-bank/intents/001-assisted-dyestuff-weighing-station/units/002-recipe-material-management/unit-brief.md`
✅ `memory-bank/intents/001-assisted-dyestuff-weighing-station/units/003-weighing-station/unit-brief.md`
✅ `memory-bank/intents/001-assisted-dyestuff-weighing-station/units/004-scale-integration/unit-brief.md`
✅ `memory-bank/intents/001-assisted-dyestuff-weighing-station/units/005-orgatex-integration/unit-brief.md`
✅ `memory-bank/intents/001-assisted-dyestuff-weighing-station/units/006-ticket-printing/unit-brief.md`
✅ `memory-bank/intents/001-assisted-dyestuff-weighing-station/units/007-weighingms-ui/unit-brief.md`
✅ `memory-bank/intents/001-assisted-dyestuff-weighing-station/units/008-operator-identity/unit-brief.md`

**Evidence**

✅ `evidence/STEP-10-units.png` — the unit register
✅ `evidence/STEP-10-unit-map.png` — the dependency map
✅ `evidence/STEP-10-manifest.txt` — the evidence manifest

## Notes for Checkpoint 3

Three decisions in this decomposition are **judgement calls** and are flagged
for the reviewer rather than presented as settled:

1. **Unit 003 carries 11 FRs and is large.** The alternative — splitting the
   session from the tolerance engine — was rejected for the reasons given
   above, but a reviewer who prefers smaller units may want to revisit it.

2. **Unit 008 (`operator-identity`) has no FR of its own.** It was created
   because the security requirement (NFR-12) and the open question (Q-08)
   both point at a distinct boundary. A reviewer who prefers strict
   FR-per-unit discipline may prefer to fold it into unit 003.

3. **The ticket and the audit trail are in one unit.** They are grouped
   because both are "supporting capabilities with a different owner and
   change rate". They could be separated if the reviewer prefers.
