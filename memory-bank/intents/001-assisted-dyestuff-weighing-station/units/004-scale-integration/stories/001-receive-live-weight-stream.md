---
id: 001-receive-live-weight-stream
unit: 004-scale-integration
intent: 001-assisted-dyestuff-weighing-station
status: complete
priority: must
created: 2026-10-30T05:00:00Z
assigned_bolt: null
implemented: true
---

# Story: 001-receive-live-weight-stream

## User Story

**As a** dyehouse operator
**I want** the weight on my scale to appear on the station continuously while I dispense
**So that** I can see in real time how much further to pour to reach the target

## Acceptance Criteria

- [ ] **Given** a scale device is registered, **When** a consumer opens its weight stream, **Then** the stream emits readings at no less than 10 per second, each carrying a value, a unit, a stability flag, a strictly increasing sequence number and a receipt time (FR-8, BRD FR-19, BRD IR-10, BRD NFR-01).
- [ ] **Given** the stream is open, **When** a reading is received, **Then** its sequence number is strictly greater than the sequence number of the previous reading from the same device.
- [ ] **Given** a reading has been received, **When** a consumer reads it, **Then** the value is a fixed-point decimal and no floating-point value appears anywhere in the weight path (NFR-2, BRD NFR-16).
- [ ] **Given** the device reports a stable weight, **When** the reading is emitted, **Then** the stability flag is `true`; **And** **Given** the device reports a settling weight, **Then** the flag is `false` (BRD FR-19, BRD IR-11).
- [ ] **Given** the device has sent no reading, **When** the stream is read, **Then** no reading is emitted at all — the absence of a reading is never represented as a reading whose value is zero (BRD FR-19).
- [ ] **Given** a reading is emitted, **When** it is received by a consumer, **Then** it is available within one stream period (at most 100 ms at 10 Hz), leaving the remainder of the 200 ms end-to-end lag budget to the layers above (NFR-1, BRD NFR-01).

## Technical Notes

- The unit's contract is **"a live weight with a stability flag"**, not a wire protocol. The adapter seam (BRD IR-07) is where a real indicator protocol replaces the training one. **The indicator make, model and protocol are unconfirmed (Q-03)** — no specific wire protocol may be asserted as fact anywhere in the implementation.
- `WeightReading` fields: `value`, `unit`, `stable`, `sequence`, `receivedAt`. `receivedAt` is stamped on receipt by the adapter, not taken from the device.
- Readings are **not persisted**. Persisting them would risk a stale reading being read back as a live one — the exact confusion the disconnection rule (story 002) exists to prevent. Only a *confirmed* value becomes a record, and that record belongs to unit 003.
- Both scales may be connected concurrently (BRD IR-14); the stream is per-device and each device has its own strictly increasing sequence.
- Transport for the live feed is SSE. The BRD's assumed streaming shape is **illustrative, for FCI/SETEX to correct** — the adapter owns that uncertainty.
- **Risk A-05 / B-5.** A-05 assumes a continuous ≥ 10 Hz stream with a stability flag. B-5 states the consequence plainly: *if the scales return only a stabilised value rather than a continuous stream, guided weighing as drawn is not buildable*. This story is built so the assumption is **testable rather than merely stated**: the training device produces exactly the contract above. If FCI's answer to Q-03 is that the indicators report only a settled value, the change is confined to this unit — the adapter begins emitting one reading per settle event instead of ten per second, and `stable` becomes the only meaningful signal. That is a genuine change to the product's behaviour, and it is visible in exactly one place.
- The training device is the **Dummy Scale**, a product surface rather than a test fixture, exercised by the test suite and independently callable. No fake weight data is hard-coded into the UI.

## Dependencies

### Requires
- None (first story)

### Enables
- 002-detect-disconnection-and-block-weighing (the reading sequence the watchdog observes)
- 003-tare-scale-against-container (readings after a tare is applied)
- 004-select-scale-by-capacity (device capacity and resolution)

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| The device emits a reading whose sequence number is not greater than the previous one | The reading is rejected as out-of-order and is **not** emitted on the stream; the previous reading remains the latest valid one. |
| The device reports a weight of exactly zero | A reading **is** emitted, with value `0` and its sequence number — a legitimate zero is distinguishable from no reading. |
| The device has never sent a reading | The stream emits nothing. Absence is represented by the absence of a reading, never by a zero-valued reading. |
| The device changes its reported unit between readings | The unit is carried on every reading and the change is visible to consumers; the value is not silently reinterpreted in the old unit. |
| The device reports a value with more precision than the scale's resolution | The value is carried at the device's own resolution; no additional precision is fabricated. |
| The device is removed from the registry mid-stream | The stream ends. Consumers observe a closed stream, not a stream of zeros. |
| A consumer attaches late and only sees readings from its attachment point | The stream is live-only; no backlog is replayed. A consumer that needs history uses the weighing record, not the stream. |

## Out of Scope

- Deciding that a device is disconnected, or blocking weighing while it is — story 002.
- Tare and the container tare value — story 003.
- Choosing which device a component is weighed on — story 004.
- Tolerance zones, the progress bar and the remaining-quantity calculation — `003-weighing-station` and `007-weighingms-ui`.
- Rendering the readout — `007-weighingms-ui`.
- The indicator's specific wire protocol — unconfirmed (Q-03); owned by the adapter implementation.
