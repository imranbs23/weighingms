---
id: 002-read-batch-recipe
unit: 005-orgatex-integration
intent: 001-assisted-dyestuff-weighing-station
status: draft
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: false
---

# Story: 002-read-batch-recipe

## User Story

**As a** dyehouse operator
**I want** the recipe for the batch I am about to weigh to come from the MES
**So that** the quantities I am told to hit are the production system's quantities, and I never weigh against a stale paper copy

## Acceptance Criteria

- [ ] **Given** a batch id, **When** the recipe is read, **Then** the returned snapshot contains the recipe's components in recipe sequence, each with its dyestuff identity, target quantity, unit, tolerance and scale class, together with the shade code and the time the snapshot was received (FR-3).
- [ ] **Given** a recipe has been read, **When** the snapshot is used, **Then** the snapshot records its received time and source, so that its age is always knowable (FR-3, BRD FR-20).
- [ ] **Given** the MES cannot be reached, **When** the recipe is read, **Then** the read fails loudly with the error, and the last successful snapshot is served only when the link state is `DEGRADED`, marked with its age — never presented as current (BRD FR-20).
- [ ] **Given** a recipe snapshot has been read, **When** it is inspected, **Then** it is read-only — no component, target or tolerance can be modified through this unit (FR-3, BRD BR-04, C-01).
- [ ] **Given** a component's target and tolerance are read, **When** they are compared, **Then** every quantity is a fixed-point decimal and no floating-point value appears in the returned quantities (NFR-2, BRD NFR-16).

## Technical Notes

- **All OrgaTEX interaction is confined to this adapter** (BRD IR-07, C-13). Unit 002 (`002-recipe-material-management`) obtains the recipe *through this adapter*; it never imports a client for the MES.
- **The external contract is not confirmed.** A-01 assumes SETEX provides a documented, licensed REST interface; **Q-01 asks whether such an interface exists at all, and of what kind**. The BRD's endpoint list is explicitly *"assumed endpoint shape — illustrative, for FCI/SETEX to correct"*. Accordingly: **describe the adapter seam and the direction of data flow only.** No specific external endpoint, payload shape or field name is asserted here as fact.
- The direction of flow is **read-only**: MES → adapter → snapshot. WeighingMS **never authors or modifies a recipe** (BRD BR-04, C-01).
- `RecipeSnapshot` fields: `batchId`, `shadeCode`, `components[]`, `receivedAt`, `source`.
- The recipe carries the **scale class** per component, which is the input to the automatic scale selection in unit 004 (`004-select-scale-by-capacity`). The rule for choosing between the two devices is derived from the capacity constraint; the prototype's own `scaleClass` field is what is read here.
- **The recipe is not persisted** — it is a projection that can always be re-fetched. (The sync queue in story 005 *is* persisted; the asymmetry is deliberate.)
- The recipe is **cached locally** once read, and the cache is owned by unit 002, not by this unit, so that there is one source of truth for the recipe's contents. This unit returns the snapshot it obtained and its age; it does not keep a second copy.
- The **dyestuff master data and lot data** are separate reads in the same direction (BRD IR-03, IR-04) and are owned by unit 002. This story's scope is the recipe itself.
- All quantities are fixed-point decimal with 4 decimal places in storage (BRD §9.2, BRD NFR-16). Unit display precision is 1 for grams and 3 for kilograms, but that is a presentation rule owned by `007-weighingms-ui`.
- **The Dummy OrgaTEX** serves recipes that mirror the prototype's five-component Teal 4C recipe, with components, targets and tolerances, and holds the consumption it accumulates. It is a training contract, not a claim about the real MES.

## Dependencies

### Requires
- 001-read-released-batch-queue (the same adapter, and the link state established by the queue read)

### Enables
- 002-recipe-material-management (the recipe and the component list)
- 003-weighing-station (targets, tolerances and the still-to-weigh calculation)
- 006-ticket-printing (the batch identity and shade code carried on the ticket)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The MES returns a recipe with no components | The snapshot is returned with an empty component list; the caller can report "this batch has nothing to weigh" rather than a silent empty screen. |
| The MES returns a component with no tolerance | The component is returned with the tolerance absent, and the caller states that the component cannot be confirmed — a missing tolerance is never treated as zero tolerance. |
| The MES returns a component with a scale class that matches neither known device | The component is returned with its scale class as given; the scale selection returns its explicit "no device can weigh this" outcome (unit 004, story 004). |
| The MES returns a component whose target exceeds the largest scale's capacity | The recipe is still returned intact — the recipe is read-only and the station does not alter it — and the weighing of that component is blocked at selection. |
| The MES cannot be reached and the link state is `DEGRADED` | The last successful recipe snapshot is served, marked with its age. It is never presented as current. |
| The MES cannot be reached and the link state is `OFFLINE` | The read fails loudly with the error. A recipe already held locally by unit 002 may still be weighed from — that is BRD FR-20's guarantee, and it belongs to the caller, not to this read. |
| The same batch id returns a revised recipe | The newer snapshot supersedes the older one. Targets and tolerances are snapshotted onto the weighing record at weighing time, so a later revision does not alter a historical record (BRD FR-18, BRD BR-14). |
| The MES returns a malformed or partial recipe | The snapshot fails validation and the read errors loudly; a partially valid recipe is never served. |

## Out of Scope

- The component list's presentation, the identity verification and the lot capture — `002-recipe-material-management`.
- The tolerance model and the tolerance zones — `003-weighing-station` and FCI production (Q-05).
- Scale selection — `004-scale-integration`.
- Posting consumption — story 003.
- The link state model — story 004.
- The offline write queue — story 005.
- Rendering the recipe — `007-weighingms-ui`.
