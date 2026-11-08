---
id: 001-retrieve-recipe-and-component-list
unit: 002-recipe-material-management
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: true
---

# Story: 001-retrieve-recipe-and-component-list

## User Story

**As a** dyehouse operator
**I want** the recipe for the batch I selected, listed in the order I must weigh it
**So that** I know every material, its target quantity and its tolerance before I
dispense anything

## Acceptance Criteria

- [ ] **Given** a batch has been selected, **When** the recipe is requested, **Then**
  the system fetches the recipe through the OrgaTEX adapter, loads it into the active
  weighing session, and presents the components in recipe sequence (FR-3, BRD FR-05,
  BRD FR-06).
- [ ] **Given** the recipe is displayed, **When** the component list renders, **Then**
  each component shows its colour swatch, name, dyestuff code, scale class, target
  quantity with its unit, and its state (FR-3, C-04).
- [ ] **Given** the recipe is displayed, **When** the operator looks at the component
  counter, **Then** it shows the number of components weighed so far against the
  total number of components in the recipe (FR-3).
- [ ] **Given** a recipe has been loaded, **When** the operator views it, **Then** the
  recipe is read-only — no component, target quantity or tolerance can be edited,
  added or removed within WeighingMS (FR-3, BRD BR-04, C-01).
- [ ] **Given** the recipe is requested and the adapter returns an error, **When** the
  request fails, **Then** the failure is surfaced with a distinguishable error state
  and no partial component list is presented as if it were complete (FR-3, BRD IR-09).
- [ ] **Given** the recipe is requested while the upstream system is online, **When**
  the response arrives, **Then** the recipe is displayed within 3 seconds of the batch
  selection (NFR-1, AC-01).

## Technical Notes

- **Read-only against OrgaTEX.** The recipe, tolerances and dyestuff master are
  owned by OrgaTEX and are never authored or modified locally (BRD BR-04, C-01).
  Tolerances originate in OrgaTEX; this unit does not compute them.
- **Adapter boundary.** The recipe read goes through the OrgaTEX adapter
  (BRD IR-07, C-13). The adapter's interface is our own; no external endpoint or
  payload shape is asserted (Q-01, A-01). The Dummy OrgaTEX stands in behind that
  boundary as a training contract only.
- **Fixed-point decimal for every quantity.** `targetQuantity` and `tolerance` are
  carried as fixed-point decimal with 4 decimal places and are never represented as
  a float, in payloads or in storage (BRD NFR-16, C-11, NFR-2). Display precision is
  1 dp for grams and 3 dp for kilograms; the stored value is not rounded to the
  display precision.
- **Units are not converted implicitly.** Each component's quantity keeps the unit
  the recipe supplied. Cross-unit arithmetic (for example a gram total alongside a
  kilogram total) belongs to unit 003 and must convert at a fixed-point rate, never
  through a float division.
- **No fake data in the client.** Every component row arrives over the API; no
  component, target quantity or swatch colour is hard-coded in the UI. The swatch
  colour is data supplied with the component.
- **Local caching is permitted but bounded.** The recipe may be cached locally for
  use during an upstream outage (BRD FR-20), but the cache is a read-through of the
  adapter's response and is not a second authoring source. Cache policy and staleness
  ownership sit with unit 005; this story does not define a separate caching scheme.
- Component state (`done` / `active` / `pending`) is set by this unit's session
  model; progression rules belong to unit 003.
- All operator-facing component labels are externalised for translation (NFR-7,
  BRD NFR-11).

## Dependencies
### Requires
- 003-select-batch-and-record-identity (unit 001)

### Enables
- 002-verify-dyestuff-identity-by-scan-or-attestation
- 003-capture-and-validate-dyestuff-lot
- 004-assign-container-and-apply-tare
- 003-weighing-station (unit 003)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The adapter returns a recipe with zero components | The recipe is loaded, the counter shows "0 of 0", and an explicit "this recipe has no components" state is shown; it is not an error |
| A component is missing a scale class | The component renders with an explicit "scale class unavailable" marker and the component cannot proceed to dispensing until the value is supplied; this unit does not guess a scale |
| Two components have the same dyestuff code but different targets | Both are listed as separate components in recipe sequence; the recipe is not de-duplicated |
| The upstream recipe changes while the operator is working | The already-loaded recipe for the active session is unchanged; the unit 005 cache policy governs when a re-read is permitted, and this story does not silently hot-reload a recipe mid-session |
| The upstream system is unreachable and a cached recipe exists | The cached recipe is served for offline operation and the operator can see the connection state; the recipe is not editable (BRD FR-20, BRD FR-16) |
| A component's target quantity arrives with more than 4 decimal places | The adapter layer rejects the payload as invalid rather than silently truncating precision |

## Out of Scope

- Verifying the identity of the dyestuff in hand →
  `002-verify-dyestuff-identity-by-scan-or-attestation`.
- Capturing the lot and assigning the container with its tare →
  `003-capture-and-validate-dyestuff-lot`, `004-assign-container-and-apply-tare`.
- Scale selection, capacity and calibration state → unit `004-scale-integration`.
- The recipe read contract, the MES interface and caching policy →
  `005-orgatex-integration`.
- Live weight, tolerance zones and confirmation → unit `003-weighing-station`.
- Rail rendering and layout → `007-weighingms-ui`.
