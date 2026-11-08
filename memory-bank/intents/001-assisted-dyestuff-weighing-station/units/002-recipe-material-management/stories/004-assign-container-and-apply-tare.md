---
id: 004-assign-container-and-apply-tare
unit: 002-recipe-material-management
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: true
---

# Story: 004-assign-container-and-apply-tare

## User Story

**As a** dyehouse operator
**I want** to know which container the material is coming from and have its tare
already applied
**So that** the quantity I weigh is the material dispensed, not the container and
the material together

## Acceptance Criteria

- [ ] **Given** a component ready to be dispensed, **When** a container is assigned,
  **Then** the container is associated with that component and its ID is displayed
  alongside the component (FR-6, BRD FR-11).
- [ ] **Given** a container's tare is known from the container master, **When** the
  container is assigned, **Then** that tare is applied to the dispense and the applied
  tare value and its source `MASTER` are displayed (FR-6, BRD FR-11).
- [ ] **Given** a container has no tare in the master, **When** the operator issues a
  tare command, **Then** the empty container is weighed and the measured tare is
  applied, with the source `MEASURED` displayed alongside the value (FR-6, BRD FR-11).
- [ ] **Given** a tare is applied, **When** the operator re-tares, **Then** the
  dispense is reset and the tare is re-established, and the displayed tare reflects
  the new value and source (FR-6, BRD FR-11).
- [ ] **Given** a container has been assigned to a component, **When** the weighing
  record is later retrieved, **Then** the record carries the container used and the
  applied tare with its source (FR-6, BRD FR-25).
- [ ] **Given** a component has no container assigned, **When** the operator attempts
  to begin dispensing it, **Then** dispensing is blocked and the operator is shown
  that a container must be assigned first (FR-6).
- [ ] **Given** the tare is displayed, **When** the value is rendered, **Then** it is
  shown with its unit at 1 dp for grams and 3 dp for kilograms, while the stored
  value retains 4 decimal places (FR-6, NFR-2, BRD NFR-16).

## Technical Notes

- **Q-10 is unresolved and the model accommodates both answers.** Whether one
  container holds one component or a whole recipe is **Q-10**. The container
  assignment is therefore modelled as a **relation between a component and a
  container**, not as a 1:1 attribute on the component or a 1:N recipe-level
  container. The same assignment record holds under either answer, so the question can
  be settled by FCI without a data-model rewrite.
- **CQ-08 interacts here.** Whether containers already carry a lot barcode is
  **CQ-08**; where a container is identified by a scan, the container ID may arrive
  by scan or by keyed entry, and both routes record the same assignment with the
  method captured.
- **Fixed-point decimal for every quantity, including tare.** The tare is a weight
  and is stored at 4 decimal places, never as a float, in payloads and in storage
  (BRD NFR-16, C-11, NFR-2). Display precision is 1 dp for grams and 3 dp for
  kilograms; the displayed value is a rounded presentation of the stored value, not a
  re-quantised one.
- **Tare sources.** The tare source is part of the record: `MASTER` when it came from
  the container master, `MEASURED` when the empty container was weighed, and the
  source must be displayed, because a measured tare is evidence rather than a
  reference value (BRD FR-11).
- **Tare can be issued to the indicator or applied in software**, depending on
  whether the scale indicator supports a tare command (BRD IR-12). The applied tare
  value and its source are shown to the operator either way, and the recorded tare is
  the same value in both cases.
- **Re-tare resets the dispense.** A re-tare discards the current gross reading so
  the operator does not dispense against a stale tare; it is not a partial update of
  the tare on top of an in-progress dispense.
- **Storage.** One container assignment row per component per weighing, retained
  ≥ 5 years (BRD DR-01). The row carries `componentId`, `containerId`, `tareWeight`,
  `tareUnit`, `tareSource` and the assignment method.
- **The scale's own status and capacity** are owned by unit `004-scale-integration`;
  this story consumes the tare result but does not own scale selection.
- All operator-facing container and tare labels are externalised for translation
  (NFR-7, BRD NFR-11).

## Dependencies
### Requires
- 001-retrieve-recipe-and-component-list
- 002-verify-dyestuff-identity-by-scan-or-attestation
- 003-capture-and-validate-dyestuff-lot

### Enables
- 003-weighing-station (unit 003)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The container master holds a tare but the operator re-tares | The measured tare replaces the master tare and the displayed source changes from `MASTER` to `MEASURED` |
| A container is assigned to a second component in the same batch | The assignment is recorded for both components; whether one physical container may serve several components is Q-10 and is not decided by this story |
| The tare measurement fails because the scale is disconnected | The tare is not applied and the failure is reported; the component cannot proceed to dispensing (BRD FR-19, BRD IR-13) |
| The measured tare is 0.0000 g | This is a valid value and is applied and displayed as `0.0000 g`; it is not treated as missing |
| The operator re-tares while a dispense is in progress | The dispense is reset, the tare is re-established, and the operator is shown that the dispense was cleared |
| The container master holds a tare in a different unit from the recipe component | The unit is shown with the value and no implicit conversion is performed; conversion belongs to the weighing unit's fixed-point rules |
| The operator assigns a container, then scans a lot code belonging to a different container | The scan is refused with a visible reason; the assignment is unchanged |

## Out of Scope

- Scale selection, capacity, calibration and stability → unit
  `004-scale-integration` and FR-7.
- The live weight stream, tolerance zones and confirmation → unit
  `003-weighing-station`.
- Container and lot master reads → `005-orgatex-integration`.
- The container master, tare tables and container identification conventions →
  owned by FCI production (Q-10, CQ-08).
- Ingredient and auxiliary master data → `005-orgatex-integration`.
