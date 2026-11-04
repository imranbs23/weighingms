---
id: 002-detect-disconnection-and-block-weighing
unit: 004-scale-integration
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: true
---

# Story: 002-detect-disconnection-and-block-weighing

## User Story

**As a** dyehouse operator
**I want** the station to notice at once when a scale has stopped responding
**So that** I am never shown a weight that is not really there, and never asked to confirm a weighing the scale could not measure

## Acceptance Criteria

- [ ] **Given** a device has delivered a reading with sequence `n`, **When** no reading with a strictly greater sequence number arrives within 2 seconds of that reading, **Then** the device is reported as `DISCONNECTED` (BRD FR-19, BRD IR-13).
- [ ] **Given** a device is `DISCONNECTED`, **When** a weighing confirmation is attempted, **Then** the confirmation is refused and a stated reason identifies the scale as disconnected (BRD FR-19, BRD IR-13).
- [ ] **Given** a device is `DISCONNECTED`, **When** its weight is read, **Then** no reading is produced — the station yields **no reading at all**, never a reading whose value is zero (BRD FR-19).
- [ ] **Given** a device is `DISCONNECTED`, **When** a subsequent reading with a strictly greater sequence number arrives, **Then** the device returns to `CONNECTED` and the gap is recorded as a disconnection event with its start and end times.
- [ ] **Given** a device's calibration has expired, **When** a weighing is attempted on that device, **Then** the weighing is blocked with a stated reason identifying the expired calibration (FR-7, AC-14, BRD FR-12).
- [ ] **Given** the device's calibration is valid, **When** the calibration state is read, **Then** it is reported as `IN_CALIBRATION` together with the expiry date it was read from.

## Technical Notes

- **Disconnection is a watchdog on the reading sequence.** The rule is: if no reading with a strictly increasing sequence number has arrived within 2 s of the last one, the device is `DISCONNECTED`. This is a property of the *device*, not of any consumer, which is why it belongs in this unit rather than in unit 003.
- **A disconnected device is not a zero weight.** This distinction is the single most important thing this unit does. A missing reading must never be rendered as `0.0`, because `0.0` is a legitimate under-dose reading that the operator would then be asked to act on. The unit's contract is that *"no reading"* and *"a reading of zero"* are distinguishable, all the way up to the UI.
- **The 2 s boundary must be tested at three points** — just under 2 s, exactly 2 s, and just over 2 s. The rule is "within 2 s", so a reading arriving at exactly 2 s has *not* tripped the watchdog, and one arriving after 2 s has.
- The watchdog runs on the receipt time of the last reading, not on wall-clock time polled independently, so that a clock adjustment cannot spuriously trip or mask it.
- The calibration gate is enforced **at the device boundary** — in the `canWeigh` operation — not inside the weighing logic, so that a UI which forgets to check cannot bypass it. The calibration state is a device property reported by the device; for the training device it is a configuration value.
- The scale half of BRD FR-19 is owned here. The scanner half lives in unit 002, the printer half in unit 006, and the OrgaTEX half in unit 005. BRD FR-19 is one requirement split across units; it is not counted twice.
- Device status vocabulary: `CONNECTED`, `DISCONNECTED`, `ZEROED`, `BUSY`, `OVER_CAPACITY`, plus `calibrationState`. Only `CONNECTED` is a state in which weighing may proceed.

## Dependencies

### Requires
- 001-receive-live-weight-stream (the reading sequence the watchdog observes)

### Enables
- 003-weighing-station (the weighing health gate: live weight, stability flag and the block reason)
- 007-weighingms-ui (the peripheral status strip and the live readout)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The last reading arrived 1.9 s ago | The device is still `CONNECTED`; no reading has yet been missed. |
| The last reading arrived exactly 2.0 s ago | The device is still `CONNECTED` — "within 2 s" has not been exceeded. |
| The last reading arrived 2.1 s ago | The device is `DISCONNECTED`; weighing is blocked with the reason stated. |
| The device is disconnected and the operator views the readout | The readout shows the disconnection, not `0.0` and not the last known value presented as current. |
| The device reconnects and resumes with a sequence number far higher than the last | The device returns to `CONNECTED`; the gap is recorded, and the jump in sequence is **not** mistaken for lost readings to be replayed. |
| The device reconnects and resumes with a sequence number **not** greater than the last | The reading is rejected as out-of-order; the device stays `DISCONNECTED` until a strictly greater sequence number arrives. |
| The device is disconnected while a weighing is already in progress | The session is not silently completed at the last known value; the operator is told the scale is gone. |
| Calibration expires while the station is running | The next `canWeigh` check reports the device as blocked for expired calibration. |
| The device reports a load above its capacity | The device status is `OVER_CAPACITY` and weighing on it is blocked; this is distinct from a disconnection. |

## Out of Scope

- The live weight stream itself and its fields — story 001.
- Tare — story 003.
- Scale selection by capacity — story 004.
- The scanner, printer and OrgaTEX failure handling — units 002, 006 and 005 respectively.
- The weighing session state machine and the tolerance zones — `003-weighing-station`.
- Rendering the status strip or the disconnection message — `007-weighingms-ui`.
