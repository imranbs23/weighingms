---
unit: 002-recipe-material-management
intent: 001-assisted-dyestuff-weighing-station
phase: inception
status: complete
created: 2026-10-30T04:05:00Z
updated: 2026-10-30T04:05:00Z
---

# Unit Brief: Recipe & Material Management

## Purpose

Resolve a selected batch into the exact, identified materials the operator
must dispense, with everything needed to weigh each one.

This unit answers "what exactly am I putting in the bucket, and where did it
come from?" — a question about **material identity and provenance**. It runs
*before* any weight exists, and its answers must hold even if the weighing is
perfect.

## Scope

### In Scope

- Retrieving the recipe for a selected batch and exposing its component list.
- **Component identification and dyestuff identity verification** — scanning a
  dyestuff barcode, or attesting manually when a code cannot be read.
- **Dyestuff lot capture** — recording which lot of the material was used.
- **Container assignment and tare handling** — which container the material
  comes from, and that container's tare weight.
- The per-component material facts a weighing depends on: target quantity,
  unit, tolerance, scale class.

### Out of Scope

- The weight, and whether it was right → `003-weighing-station`.
- The recipe read itself and the MES contract → `005-orgatex-integration`.
- The scale's own status and capacity → `004-scale-integration`.
- Rendering the recipe rail → `007-weighingms-ui`.

---

## Assigned Requirements

| FR | Requirement | Priority |
|----|-------------|----------|
| FR-3 | Recipe retrieval and component list | Must |
| FR-4 | Component identification and dyestuff identity verification | Must |
| FR-5 | Dyestuff lot capture | Must |
| FR-6 | Container assignment and tare handling | Must |

---

## Domain Concepts

### Key Entities

| Entity | Description | Attributes |
|--------|-------------|------------|
| `Recipe` | The set of components required for one batch | `batchId`, `shadeCode`, `components[]` |
| `RecipeComponent` | One material the operator must dispense | `id`, `materialCode`, `name`, `targetQuantity`, `unit`, `tolerance`, `scaleClass`, `swatchColour` |
| `MaterialLot` | A specific batch of a material | `lotNumber`, `materialCode`, `capturedAt`, `capturedBy`, `captureMethod` |
| `Container` | The vessel a material is drawn from | `id`, `materialCode`, `tareWeight`, `unit` |
| `MaterialIdentity` | The verification that the material in hand is the material required | `componentId`, `verifiedBy` (`SCAN` \| `ATTESTATION`), `verifiedAt`, `barcode`? |

### Key Operations

| Operation | Description | Inputs | Outputs |
|-----------|-------------|--------|---------|
| `getRecipe` | Fetch the recipe for a batch through the adapter | `batchId` | `Recipe` |
| `identifyComponent` | Verify the material in hand against the required component | `componentId`, barcode or attestation | `MaterialIdentity`, or a mismatch |
| `captureLot` | Record the lot used for a component | `componentId`, `lotNumber` | `MaterialLot` |
| `assignContainer` | Bind a container and its tare to a component | `componentId`, `containerId` | `Container` assignment |
| `resolveScaleClass` | Determine which scale a component must be weighed on | `RecipeComponent` | `scaleClass` + capacity |

### Identity verification, and its fallback

Verification is by **scan** where the code resolves. Where it does not —
unreadable, unknown code, or no barcode on the container at all — the
operator **attests**. The two are recorded differently, and that difference
must survive into the weighing record: an unattested weighing is
distinguishable from a scanned one in the audit trail (B-6). A mismatch
between the scanned code and the required component is a **hard stop**, not a
warning.

**Rule 2 (workbook): no invented requirements.** Whether dyestuffs carry
scannable barcodes at all is **Q-07** and assumption A-10. This unit is built
so that both answers work: the scan path and the attestation path are both
first-class, and switching between them is a configuration change, not a
rewrite. The unit does not assert that barcodes exist.

### Container and tare

Each component draws from a container with a known tare. Whether one container
holds one component or a whole recipe is **Q-10** — and it changes the data
model. The unit therefore models the container assignment as a **relation
between a component and a container**, which holds under either answer, rather
than assuming a 1:1 or 1:N relationship up front.

---

## Story Summary

| Metric | Count |
|--------|-------|
| Total Stories | 4 |
| Must Have | 4 |
| Should Have | 0 |
| Could Have | 0 |

### Stories

| Story ID | Title | Priority | Status |
|----------|-------|----------|--------|
| 001 | View the recipe for the selected batch | Must | Planned |
| 002 | Identify the dyestuff by scan | Must | Planned |
| 003 | Attest the dyestuff when a code cannot be read | Must | Planned |
| 004 | Capture the lot and assign the container with its tare | Must | Planned |

---

## Dependencies

### Depends On

| Unit | Reason |
|------|--------|
| `005-orgatex-integration` | The recipe, tolerances and dyestuff master are read through the adapter (BRD IR-07). |
| `004-scale-integration` | The scale class of a component depends on the scale's capacity and calibration state. |
| `008-operator-identity` | Lot capture and identity verification are attributed to an operator. |

### Depended By

| Unit | Reason |
|------|--------|
| `003-weighing-station` | The weighing needs targets, units, tolerances and tares. |
| `001-batch-management` | Invokes the recipe load when a batch is selected. |
| `007-weighingms-ui` | Renders the recipe rail with per-component state. |

### External Dependencies

| System | Purpose | Risk |
|--------|---------|------|
| OrgaTEX MES | Supplies recipes, tolerances and dyestuff master | **Severe** — A-01, A-07, Q-01, Q-05 |
| Barcode scanner | Identifies batch, material and lot codes | **High** — A-10, Q-07. The scanner is reached through unit 005's sibling seam; its failure mode (B-6) is owned here. |

---

## Technical Context

### Suggested Technology

TypeScript strict · Express 4 · Zod for validation · SQLite via
better-sqlite3 for captured lots and container assignments · fixed-point
decimal for every quantity, including tare.

### Integration Points

| Integration | Type | Protocol |
|-------------|------|----------|
| `005-orgatex-integration` | API (internal) | REST/JSON |
| `004-scale-integration` | API (internal) | REST/JSON |
| `007-weighingms-ui` | API (internal) | REST/JSON |
| OrgaTEX MES | API (external, via adapter) | REST/JSON — **assumed shape, not confirmed** |
| Barcode scanner | API (external, via adapter) | **Training contract** — `POST /api/scan` |

### Data Storage

| Data | Type | Volume | Retention |
|------|------|--------|-----------|
| Recipe | Not persisted — projected from OrgaTEX | — | — |
| Material lot captures | SQL | One row per component per weighing | ≥ 5 years (DR-01) |
| Container assignments | SQL | One row per component per weighing | ≥ 5 years (DR-01) |
| Material identity (scan/attestation) | SQL | One row per component per weighing | ≥ 5 years (DR-01) |

---

## Constraints

- The recipe is **never embedded in the client** — it arrives over the API.
- All OrgaTEX interaction is confined to the adapter (BRD IR-07).
- **No floating point for quantities**, including tare, in payloads and in
  storage (BRD NFR-16).
- Every quantity is stored at 4 decimal places; displayed at 1 dp for grams
  and 3 dp for kilograms.
- A scanned identity that **mismatches** the required component is a hard
  stop.
- The attestation fallback is **recorded**, never silently substituted for a
  scan (B-6).
- Tolerances originate in OrgaTEX; this unit does not compute them.

---

## Success Criteria

### Functional

- [ ] The recipe for the selected batch is displayed with every component.
- [ ] A scanned dyestuff code that matches the required component verifies it.
- [ ] A scanned code that does not match is a hard stop.
- [ ] An unreadable or unknown code falls back to attestation, and the
      fallback is recorded as such.
- [ ] The lot used is captured against the component.
- [ ] The container and its tare are assigned against the component.
- [ ] The scale class required by a component is resolved.

### Non-Functional

- [ ] Batch selection to recipe displayed ≤ 3 s when online (NFR-1, AC-01).
- [ ] Every quantity — target, tolerance, tare — is handled in fixed-point
      decimal, never float.
- [ ] Captured lots and container assignments survive power loss (NFR-3).

### Quality

- [ ] All acceptance criteria met.
- [ ] Both the scan path and the attestation path are covered by tests, so
      the unit is correct under either answer to Q-07.
- [ ] The container model holds under either answer to Q-10.
- [ ] Code reviewed and approved.

---

## Bolt Suggestions

> Generated from the bolt plan in `memory-bank/bolts/` by
> `scripts/sync-bolt-suggestions.cjs`. The bolt ids are a **global**
> sequence across all units, not a per-unit one.

| Bolt | Type | Stories | Objective |
|------|------|---------|-----------|
| `010-002-recipe-material-management` | DDD | 001-retrieve-recipe-and-component-list | Load a batch’s recipe through the OrgaTEX adapter — components, targets, units, tolerances and scale classe… |
| `011-002-recipe-material-management` | DDD | 002-verify-dyestuff-identity-by-scan-or-attestation, 003-capture-and-validate-dyestuff-lot | Verify that the dyestuff presented matches the recipe component, by barcode scan where possible and by reco… |
| `012-002-recipe-material-management` | DDD | 004-assign-container-and-apply-tare | Assign the container to the component and apply its tare, from the container master or by weighing the empt… |

---

## Notes

**This unit holds the most uncertainty of any unit.** Three open questions land
here and each one changes the shape of the data model, not just a validation
rule:

| Question | What changes if the answer differs |
|---|---|
| **Q-07** — do dyestuffs carry scannable barcodes? | If not, identity verification becomes attestation-first, and the scan path is a capability that may never be used. |
| **Q-10** — one container per component, or per recipe? | Changes whether `Container` is a component attribute or a recipe-level entity with per-component tare. |
| **CQ-08** — do containers already carry a lot barcode, or is the lot keyed in? | If keyed in, FR-5 becomes a form rather than a scan, with different error characteristics. |

**The design response is to make all three answers work** rather than to pick
one and hope. Every answer that changes the model is implemented as a
distinguishable state with its own tests, so the question can be settled by
FCI without a rewrite.

**Why this is not folded into the Weighing Station.** Material identity is
captured *before* any weight exists, is governed by a different rule set
(scan vs attest, lot validation, tare), and has a **different failure mode**:
a wrong lot or wrong container is a traceability defect that survives even a
perfectly weighed batch. Folding it into unit 003 would mean the unit with
the highest correctness stakes also carried the highest data-model uncertainty.
