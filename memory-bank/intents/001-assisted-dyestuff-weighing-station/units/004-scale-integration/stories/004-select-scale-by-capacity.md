---
id: 004-select-scale-by-capacity
unit: 004-scale-integration
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: 004-004-scale-integration
implemented: true
---

# Story: 004-select-scale-by-capacity

## User Story

**As a** dyehouse operator
**I want** the station to put each component on the right scale without asking me
**So that** I can weigh a small dyestuff on the precision scale and a sack of soda ash on the floor scale, and never have to think about which is which

## Acceptance Criteria

- [ ] **Given** a component with a target quantity and a scale class, **When** the scale is selected, **Then** a device is selected automatically and no operator input is requested or required (FR-7, BRD BR-05, BRD AC-02).
- [ ] **Given** a component whose target fits within the precision scale's 3 kg capacity and whose scale class demands precision, **When** the scale is selected, **Then** the 3 kg precision scale is selected.
- [ ] **Given** a component whose target exceeds the precision scale's capacity but fits within the floor scale's 32 kg capacity, **When** the scale is selected, **Then** the 32 kg floor scale is selected.
- [ ] **Given** a component whose target exceeds the 32 kg floor scale's capacity, **When** the scale is selected, **Then** the selection returns an explicit "no device can weigh this" outcome with the target and the maximum available capacity — no device is selected and no value is guessed (FR-7).
- [ ] **Given** a scale has been selected, **When** the selection is read, **Then** it records the scale id, the component id, the time of selection and the reason for the selection.
- [ ] **Given** a scale has been selected for a component, **When** the selection is displayed, **Then** the scale's class and its maximum capacity are available for display (FR-7).

## Technical Notes

- **Automatic selection.** The operator is not asked (FR-7, BRD BR-05, BRD AC-02). A supervisor-authorised manual reselection exists at the application level (BRD FR-08, BRD FR-35) but is owned by unit 003 / unit 006, not by this rule.
- **Two devices**, matching the prototype's status strip, which lists both scales separately:

  | Device | Capacity | Resolution | Used for |
  |---|---|---|---|
  | `SCALE-A` — precision | 3 kg | 1 g | Dyestuffs — the small, exact quantities |
  | `SCALE-B` — floor | 32 kg | 10 g | Dry auxiliaries — soda ash, sodium sulphate |

- **The selection rule is capacity-based** and is **configuration, not code**: a component whose target fits within a device's range and whose scale class demands that device's precision goes to it; anything heavier goes to the floor scale.
- **Rule 2 (no invented requirements).** The prototype's own `scaleClass` field and the two capacities are read from the prototype. The *rule* for choosing between them is the one thing the prototype does not state; it is derived from the capacity constraint rather than invented. **The threshold itself is still open** — Q-04 asks FCI production for the scale-selection threshold and the boundary behaviour, and A-06 (scale selection is rule-based on target quantity with a defined threshold) binds this story until it is answered.
- **The over-capacity case has no defined behaviour in the BRD or the prototype.** A target exceeding the 32 kg capacity is neither the BRD nor the prototype's business, so it is recorded as an open edge rather than resolved by invention. The `ScaleSelection` operation returns an explicit **"no device can weigh this"** outcome carrying the target and the maximum available capacity. It does not select the floor scale and let it report an overload, and it does not split the quantity across devices.
- The selection also carries the **capacity constraint check**: a target equal to exactly 3 kg is within the precision scale's capacity; a target equal to exactly 32 kg is within the floor scale's capacity.
- The **training device's dispersion ramp** is a *device* behaviour, not a UI behaviour. In the prototype it lives in the page's JavaScript as a timer that increments a fake weight; moved here, the UI reads a stream exactly as it would from a real indicator. Leaving it in the UI would have made the UI the source of truth for weight — the arrangement BRD C-02 and the "no hard-coded fixture data in the UI" rule forbid.
  - The ramp's step is `max(target × 0.004, remaining × 0.055)`, applied on a **34 ms** tick.
  - The ramp lands at `target + tolerance × 0.4` for an **in-tolerance** dispense, and at `target + tolerance × 4.8` for an **over-tolerance** dispense (the prototype's `sim-over` overshoot simulation, reproduced by the Dummy Scale).
  - The landing point is a property of the **device** and is verified against the prototype's own formula, not against a hard-coded expectation.
- Both scales may be connected concurrently (BRD IR-14); selection is a decision, not a connection switch.
- The scale-selection decision is consumed by unit 003, which acts on it. This story provides the decision inputs and the outcome; it does not run a weighing.

## Dependencies

### Requires
- 001-receive-live-weight-stream (the device registry and each device's capacity and resolution)
- 002-detect-disconnection-and-block-weighing (a device that is disconnected or out of calibration cannot be selected for weighing)

### Enables
- 003-weighing-station (the selected device for a component)
- 002-recipe-material-management (a component's scale class against the available capacities)
- 007-weighingms-ui (the displayed scale, class and capacity)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The target is exactly 3 kg | Within the precision scale's capacity; the precision scale is selected. |
| The target is exactly 32 kg | Within the floor scale's capacity; the floor scale is selected. |
| The target is 32.1 kg | **No device can weigh this** is returned, with the target and the 32 kg maximum. No device is selected and nothing is guessed. |
| The target is 0 (zero-quantity component) | The smallest-capability device that satisfies the scale class is selected; the zero target is not treated as "no device". |
| The scale class demands precision but the target is 4 kg | The two constraints conflict. The capacity constraint wins — the floor scale is selected and the selection's reason records the conflict, because a 4 kg load cannot be weighed on a 3 kg scale. |
| The required device is disconnected | The selection is still made by rule, but the weighing is blocked with the device's stated status; the selection reason names the device. |
| The required device's calibration has expired | The selection is made by rule, and weighing on that device is blocked with the stated calibration reason (AC-14). |
| The target changes after selection (recipe revision) | The selection is re-evaluated; a target that no longer fits the selected device moves to the other device. |
| A supervisor manually reselects the other scale | The manual reselection is recorded separately from the automatic rule, with its authoriser (BRD FR-08, BRD FR-35). |

## Out of Scope

- The tolerance band, the tolerance zones and the surplus calculation — `003-weighing-station`.
- Supervisor authentication and the audit trail for a manual reselection — unit 006 and unit 003.
- The component's identity, its scale class and its target — `002-recipe-material-management`.
- The indicator's specific protocol and the physical scale's own tare command format — unconfirmed (Q-03); owned by the adapter implementation.
- Rendering the selected scale — `007-weighingms-ui`.
