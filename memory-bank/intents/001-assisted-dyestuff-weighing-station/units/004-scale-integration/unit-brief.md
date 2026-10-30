---
unit: 004-scale-integration
intent: 001-assisted-dyestuff-weighing-station
phase: inception
status: draft
created: 2026-10-30T04:05:00Z
updated: 2026-10-30T04:05:00Z
---

# Unit Brief: Scale Integration

## Purpose

Turn a physical scale into a reliable, live weight feed — and into a
detected failure when it stops.

This unit owns the **device**, not the weighing. It answers "what does the
scale say right now, is that reading trustworthy, and is the scale there at
all?" — and it answers it for every other unit through one interface, so
that no rule above it ever depends on how a scale happens to be wired.

## Scope

### In Scope

- The **scale adapter** and its transport (the seam where a real indicator
  protocol replaces the training one).
- The **continuous weight stream** at ≥ 10 Hz, carrying value, unit,
  stability flag, sequence and receipt time.
- **Tare** commands and the container tare's interaction with the device.
- **Scale status** — connected, disconnected, zeroed, busy, over-capacity.
- **Disconnect detection within 2 s** (IR-13) and the blocking of weighing
  while disconnected.
- **Calibration state** and the blocking of weighing on an out-of-calibration
  scale (AC-14).
- **Automatic selection between the two scales** by capacity: the 3 kg
  precision scale and the 32 kg floor scale.
- The **synthetic dispensing behaviour** (the dispersion ramp) as a *device*
  behaviour, not a UI behaviour.

### Out of Scope

- Whether the weight is within tolerance → `003-weighing-station`.
- The tolerance band, the zones, the confirmation → `003-weighing-station`.
- The container's identity and its tare value → `002-recipe-material-management`.
- Rendering the readout → `007-weighingms-ui`.

---

## Assigned Requirements

| FR | Requirement | Priority |
|----|-------------|----------|
| FR-19 | Peripheral status and failure handling — **scale half** | Must |

FR-19 also covers the scanner, the printer and the OrgaTEX link. Those
halves live in units 002, 006 and 005 respectively; the split is stated in
`units.md` §Requirement-to-Unit Mapping.

**One functional requirement, plus the substrate that FR-8 depends on.** This
is the smallest FR count in the decomposition and the highest risk per FR —
see §Notes.

---

## Domain Concepts

### Key Entities

| Entity | Description | Attributes |
|--------|-------------|------------|
| `ScaleDevice` | One physical indicator, addressed and described | `id`, `label`, `capacity`, `resolution`, `unit`, `status`, `calibrationState`, `lastReadingAt` |
| `WeightReading` | One reading from a device | `value`, `unit`, `stable`, `sequence`, `receivedAt` |
| `WeightStream` | The live feed from one device | `scaleId`, `readings[]`, `connected`, `connectedSince` |
| `TareState` | The device's current zero reference | `scaleId`, `tareValue`, `unit`, `appliedAt`, `source` |
| `ScaleSelection` | Which device a component is weighed on | `scaleId`, `componentId`, `selectedAt`, `reason` |
| `DispenseSimulation` | The training device's behaviour | `scaleId`, `componentId`, `target`, `tolerance`, `step`, `landing`, `startedAt` |

### Key Operations

| Operation | Description | Inputs | Outputs |
|-----------|-------------|--------|---------|
| `openStream` | Begin a live weight feed from a device | `scaleId` | `WeightStream` (SSE) |
| `readStatus` | Report device status and calibration | `scaleId` | `ScaleDevice` |
| `applyTare` | Zero the device against a container tare | `scaleId`, `tareValue` | `TareState` |
| `detectDisconnect` | Decide whether the device has gone silent | `scaleId`, `lastReadingAt` | connected / disconnected |
| `selectScale` | Choose the device for a component | `targetQuantity`, `scaleClass` | `ScaleSelection` |
| `canWeigh` | Gate weighing on device health | `ScaleDevice` | allowed / blocked + reason |
| `simulateDispense` | Drive the training device's ramp | `scaleId`, `target`, `tolerance`, `mode` | synthetic readings |

### The scale selection rule

Two devices exist, matching the prototype's status strip, which lists both
scales separately:

| Device | Capacity | Resolution | Used for |
|---|---|---|---|
| `SCALE-A` — precision | 3 kg | 1 g | Dyestuffs — the small, exact quantities |
| `SCALE-B` — floor | 32 kg | 10 g | Dry auxiliaries — soda ash, sodium sulphate |

The selection rule is **capacity-based and automatic**: a component whose
target fits within the precision scale's range and whose scale class
demands precision goes to `SCALE-A`; anything heavier goes to `SCALE-B`. The
operator does not choose (FR-7, AC-02) — this unit provides the decision
inputs and unit 003 acts on them.

**Rule 2 (workbook): no invented requirements.** The prototype's own
`scaleClass` field and the two capacities are read from the prototype; the
*rule* for choosing between them is the one thing the prototype does not
state, and it is derived from the capacity constraint rather than invented.
The mapping is configuration, not code.

### Disconnection detection

IR-13 requires detection within **2 s**. The rule implemented here is a
**watchdog on the reading sequence**: if no reading with a strictly
increasing sequence number has arrived within 2 s of the last one, the
device is `DISCONNECTED`. This is a property of the device, not of any
consumer, so it belongs here rather than in unit 003.

**A disconnected device is not a zero weight.** This distinction is the
single most important thing this unit does: a missing reading must never be
rendered as `0.0`, because `0.0` is a legitimate under-dose reading that the
operator would then be asked to act on. The unit's contract is that
"no reading" and "a reading of zero" are distinguishable, all the way up to
the UI.

### Calibration and weighing health

AC-14 forbids weighing on an out-of-calibration scale. The calibration
state is a **device property** reported by the device (or, for the training
device, a configuration value), and it blocks weighing at the boundary
rather than inside the weighing logic — so the block cannot be bypassed by
a UI that forgets to check.

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
| 001 | Receive a live weight stream from the scale | Must | Planned |
| 002 | Detect a scale disconnection within 2 s and block weighing | Must | Planned |
| 003 | Tare the scale against the container | Must | Planned |
| 004 | Select the correct scale for a component automatically | Must | Planned |

---

## Dependencies

### Depends On

| Unit | Reason |
|------|--------|
| — | **None.** This is a leaf unit. |

### Depended By

| Unit | Reason |
|------|--------|
| `003-weighing-station` | The live weight stream, the stability flag, the tare and the status. |
| `002-recipe-material-management` | The scale class of a component depends on the scale's capacity and calibration state. |
| `007-weighingms-ui` | The peripheral status strip and the live readout. |

### External Dependencies

| System | Purpose | Risk |
|--------|---------|------|
| Scale indicators | The weight being judged | **Severe** — A-05, Q-03. **B-5: if only a stabilised value exists, guided weighing as drawn is not buildable.** |

---

## Technical Context

### Suggested Technology

TypeScript strict · Express 4 · Zod for validation · **SSE** for the weight
stream at 10 Hz · fixed-point decimal for every weight value · no
persistence (the stream is live; only the *status* transitions are
observable through the interface).

### Integration Points

| Integration | Type | Protocol |
|-------------|------|----------|
| `003-weighing-station` | API (internal) | SSE (weight) + REST (status, tare, selection) |
| `002-recipe-material-management` | API (internal) | REST/JSON |
| `007-weighingms-ui` | API (internal) | SSE (weight) + REST (status) |
| Scale indicators | API (external, via adapter) | **Assumed SSE-like streaming — not confirmed** |

### Data Storage

| Data | Type | Volume | Retention |
|------|------|--------|-----------|
| Device registry and status | In memory | Two devices | — |
| Weight readings | **Not persisted** — live only | 10 Hz | — |
| Tare state | In memory, per device | One per device | — |
| Simulation parameters | In memory | One per active component | — |

**Readings are not persisted.** A weighing record captures the confirmed
value (unit 003); the stream itself is ephemeral. Persisting every reading
would be noise, and would risk a stale reading being read back as a live
one — the exact confusion the disconnection rule exists to prevent.

---

## Constraints

- **No floating point for weights.** Fixed-point decimal throughout
  (BRD NFR-16).
- The stream is **≥ 10 Hz** (IR-10).
- A disconnected device is **never** represented as a zero weight.
- Disconnection is detected **within 2 s** and weighing is blocked (IR-13).
- Weighing is **prevented on an out-of-calibration scale** (AC-14).
- The device protocol is **behind the adapter** (BRD IR-07). The unit's
  contract is "a live weight with a stability flag" — not a particular
  wire protocol.
- Sequence numbers are **strictly increasing** per device.

---

## Success Criteria

### Functional

- [ ] A live weight stream carries value, unit, stability flag, sequence and
      timestamp at ≥ 10 Hz.
- [ ] A disconnected scale is detected within 2 s and weighing is blocked
      with a stated reason.
- [ ] A silent scale is never shown as `0.0`.
- [ ] Tare applies a container tare and the next reading reflects it.
- [ ] The correct scale is selected automatically for a component, and the
      operator is not asked.
- [ ] Weighing is blocked on an out-of-calibration scale.
- [ ] The training device dispenses in the prototype's ramp pattern, landing
      in-tolerance or over-tolerance as requested.

### Non-Functional

- [ ] A reading is available to consumers within one stream period
      (≤ 100 ms at 10 Hz), leaving the rest of NFR-01's 200 ms budget to
      the layers above.
- [ ] All weights are fixed-point decimal; no float appears in any weight
      path.

### Quality

- [ ] The disconnection watchdog has a test at the 2 s boundary (just
      under, exactly at, just over).
- [ ] The "not zero" distinction is covered by a test asserting that a
      silent device yields *no reading* rather than a zero-valued one.
- [ ] The training ramp is tested against the prototype's own formula:
      `step = max(target × 0.004, remaining × 0.055)`, landing at
      `target + tolerance × 0.4` (in tolerance) or `target + tolerance × 4.8`
      (over tolerance).
- [ ] Code reviewed and approved.

---

## Bolt Suggestions

| Bolt | Type | Stories | Objective |
|------|------|---------|-----------|
| `004-scale-integration-1` | DDD | 001 | The `ScaleDevice` and `WeightReading` model, and the SSE weight stream |
| `004-scale-integration-2` | DDD | 002 | The disconnection watchdog, the status model, and the calibration gate |
| `004-scale-integration-3` | DDD | 003, 004 | Tare, automatic scale selection by capacity, and the training dispersion ramp |

---

## Notes

**This unit carries the build's worst single risk.** A-05 assumes a
continuous ≥ 10 Hz stream, and B-5 states the consequence plainly: *if the
scales return only a stabilised value rather than a continuous stream,
guided weighing as drawn is not buildable.* Everything above this unit —
the live readout, the progress bar, the guided dispensing, the feel of the
product — assumes A-05 holds.

The unit is therefore built **so that the assumption is testable rather than
merely stated**. The interface is "a live weight with a stability flag",
and the training device produces exactly that. If FCI's answer to Q-03 is
that the indicators only report a settled value, the change is confined to
this unit: the adapter begins emitting one reading per settle event instead
of ten per second, and the `stable` flag becomes the *only* meaningful
signal. That is a genuine change to the product's behaviour, and it is
visible in exactly one place.

**The 3 kg / 32 kg split comes from the prototype's own status strip**, which
lists the two scales separately. The *rule* for choosing between them is
derived from capacity — but a third scenario exists that neither the
prototype nor the BRD names: a target that exceeds the 32 kg scale's
capacity. That case has no defined behaviour, so it is recorded here as an
open edge rather than resolved by invention; the `ScaleSelection` operation
returns an explicit "no device can weigh this" outcome.

**The dispersion ramp moved here deliberately.** In the prototype it lives in
the page's JavaScript as a timer that increments a fake weight. That is a
*device* behaviour — a synthetic scale dispensing material — and leaving it
in the UI would have meant the UI was the source of truth for weight, which
is exactly the arrangement BRD C-02 and the "no hard-coded fixture data in
the UI" rule forbid. Moved here, the UI reads a stream like it would from a
real indicator.

**No reading is persisted.** Only the confirmed value becomes a record, and
that record belongs to unit 003.
