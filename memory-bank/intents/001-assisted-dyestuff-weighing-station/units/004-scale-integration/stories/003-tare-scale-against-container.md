---
id: 003-tare-scale-against-container
unit: 004-scale-integration
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: 004-004-scale-integration
implemented: true
---

# Story: 003-tare-scale-against-container

## User Story

**As a** dyehouse operator
**I want** the weight of my empty container excluded from the weight I dispense
**So that** the quantity recorded against the component is the quantity of dyestuff I actually poured in

## Acceptance Criteria

- [ ] **Given** a container tare value and a device, **When** a tare is applied, **Then** the device's `TareState` records the tare value, its unit, the time it was applied, and its source (container master or weighed empty container) (FR-6, BRD FR-11).
- [ ] **Given** a tare has been applied to a device, **When** the next reading is emitted, **Then** the reading reflects the tare — the dispensed quantity excludes the container's own weight (FR-6).
- [ ] **Given** a tare is applied where the indicator does not support a tare command, **When** the tare is applied, **Then** it is applied in software and the recorded `source` states that it was applied in software (BRD FR-19, BRD IR-12).
- [ ] **Given** a device already has a tare applied, **When** a re-tare is performed, **Then** the previous tare is replaced by the new one, and the dispense is reset (FR-6).
- [ ] **Given** a tare has been applied, **When** the tare value is read, **Then** the applied value, its unit and its source are available for display (FR-6).

## Technical Notes

- The tare is a **device-level operation**. The device's tare state is what the reading stream reflects, so that a consumer above this unit never has to know whether the tare was taken by the indicator or applied in software.
- `TareState` fields: `scaleId`, `tareValue`, `unit`, `appliedAt`, `source`. `source` distinguishes the container master from a weigh-and-tare, and distinguishes an indicator-applied tare from a software-applied one (BRD IR-12).
- The tare **value** comes from unit 002 (`002-recipe-material-management`), which owns the container's identity and its tare. This unit owns the *interaction with the device* and the record of the tare in force. The tare value is a fixed-point decimal (BRD NFR-16).
- Where the indicator supports a tare command, the command is issued to the device. Where it does not, the tare is subtracted in software. Both paths produce the same `TareState` shape, so consumers above this unit are unaffected by which was used.
- A re-tare replaces the tare and resets the dispense. The reset of the dispense session itself belongs to unit 003 (`003-weighing-station`); this unit provides the tare operation and the device-side state.
- Tare state is held **in memory, per device**. It is not persisted: tare is a property of the current session, and a stale tare read back after a restart would be a wrong number rather than an inconvenience.
- The **dispersion ramp** is not part of this story — it is a device behaviour described in story 004's technical notes.
- Q-10 (whether one container holds one component or a whole recipe, and how containers are identified) is unresolved and owned by unit 002; this unit's interface takes a tare value and does not care how it was obtained.

## Dependencies

### Requires
- 001-receive-live-weight-stream (the readings a tare affects)
- 002-detect-disconnection-and-block-weighing (a tare may only be applied to a connected device)

### Enables
- 003-weighing-station (the still-to-weigh calculation against a tare-corrected weight)
- 007-weighingms-ui (the displayed tare value and source)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The container master holds no tare value | The tare must be established by weighing the empty container; a tare is never assumed to be zero by default. |
| The tare value is in kilograms and the device reports grams | The value is converted to fixed-point decimal in the device's unit before it is applied; no floating-point conversion occurs. |
| The device is disconnected when a tare is requested | The tare command is refused with a stated reason; the previous tare (if any) remains in force and is not silently cleared. |
| The device is over capacity when the tare is applied | The tare is refused with a stated reason; the device reports `OVER_CAPACITY`. |
| A tare is applied and then the container is removed | The device reflects the tare change in its next reading; the tare is not cleared automatically. |
| A re-tare is performed with a tare value of exactly zero | The tare is set to zero and recorded with its source — an explicit zero tare is distinguishable from no tare in force. |
| Two containers are used for the same component in sequence | Each tare application replaces the previous and is recorded with its own applied time and source. |
| The device reports `BUSY` while the tare is applied | The tare is refused with a stated reason; it is not queued silently and applied later against an unknown state. |

## Out of Scope

- The container's identity, its master record and where the tare value comes from — `002-recipe-material-management`.
- Recording the container used on the weighing record — unit 003.
- Resetting the dispense session on a re-tare — `003-weighing-station`.
- Scale selection — story 004.
- Displaying the tare value and source — `007-weighingms-ui`.
- The indicator's specific tare-command wire format — unconfirmed (Q-03); owned by the adapter implementation.
