---
unit: 004-scale-integration
bolt: 003-004-scale-integration
stage: model
status: complete
updated: 2026-10-30T20:50:00Z
---

# Static Model - Scale Integration

## Bounded Context

**Scale Integration** owns the **device**, not the weighing. It answers one
question for every other unit:

> **What does the scale say right now, is that reading trustworthy, and is
> the scale there at all?**

It answers it through exactly one interface, so that no unit above it ever
depends on how a scale happens to be wired. The context is a **leaf** — it
depends on nothing and everything downstream depends on it.

### What this context owns

1. The **scale adapter** and its seam — the single place where a real
   indicator protocol would replace the training one.
2. The **live weight stream** — the shape of a reading, and the guarantee
   that the stream never fabricates one.
3. The **link state** of each device, and the detection of silence.
4. The **device status** vocabulary and the **weighing health gate** — the
   check that decides whether a weighing may proceed on a device at all.

### What this context does not own

- The **tolerance band**, the zones, the progress bar, the confirmation →
  unit `003-weighing-station`. This context supplies the live weight and the
  stability flag; that unit decides what a weight *means*.
- **Which device** a component is weighed on → bolt `004` of this unit. This
  context owns the device's *capability* facts (capacity, resolution, class)
  and the rule that a device out of calibration blocks weighing; it does not
  choose.
- The **reading display** → unit `007-weighingms-ui`.
- The **scanner, printer and OrgaTEX** halves of FR-19 → units `002`, `006`
  and `005`. FR-19 is one requirement split across units; it is not counted
  twice.
- The **wire protocol** of a real indicator → unconfirmed (`Q-03`); owned by
  the adapter implementation, and nothing above the adapter may assume one.

### The one rule this context exists to protect

> **"No reading" and "a reading of zero" must never be confused.**

A silent scale is not a scale reading zero. `0.0` is a legitimate under-dose
reading that the operator would be asked to act on. If a missing reading were
rendered as a zero, the operator would be told to keep pouring into a scale
that is not there. Every design decision below follows from making that
confusion **impossible to express**, rather than merely discouraged.

### The risk this context carries

`B-5`: the whole product assumes a continuous ≥ 10 Hz weight stream. If the
real indicators report only a settled value, guided weighing as drawn is not
buildable. This context is therefore built so the assumption is **testable
rather than merely stated** — the adapter produces exactly the contract the
product depends on, and the seam is the single place that changes when
FCI's answer to `Q-03` arrives.

---

## Invariants

Each invariant is expressed below as a **type-level constraint** or a
**single chokepoint**, so that a mistake is a compile error or a failed
test rather than a review comment.

- **S-1 — A reading is never fabricated.** The absence of a reading is
  represented by the *absence of a reading*. There is no code path that
  produces a zero-valued reading to stand in for silence. Expressed as a
  discriminated union (`WeightSnapshot`) whose "none" branch carries no
  value at all.
- **S-2 — A reading is a fixed-point decimal.** No JavaScript `number` may
  enter the weight path. Expressed by the `WeightValue` constructor
  accepting a **string** and nothing else (BRD NFR-16).
- **S-3 — Sequence numbers strictly increase per device.** A reading whose
  sequence is not strictly greater than the last accepted one is rejected
  and is not emitted. Expressed as the only mutator on the aggregate.
- **S-4 — Silence is detected within 2 s.** If no reading with a strictly
  greater sequence number has been received within 2 s of the last accepted
  one, the link is `DOWN`. The boundary is **inclusive**: at exactly 2000 ms
  the link is still up.
- **S-5 — A disconnected device produces no reading.** The link state
  overrides the device's own self-report, because a device that is not
  there cannot be believed about its status.
- **S-6 — The watchdog measures the receipt time of the last reading.** The
  reference point is the reading's own receipt time, not a separately polled
  wall clock, so a clock adjustment cannot spuriously trip or mask the
  watchdog.
- **S-7 — Only a healthy device may be weighed on.** The check lives in one
  operation at the device boundary, so a caller that forgets it is a
  compile-time or test-time failure rather than a silent bypass.
- **S-8 — Readings are never persisted.** There is no reading repository.
  Only a *confirmed* value becomes a record, and that record belongs to
  unit `003`.
- **S-9 — The link history is append-only.** A disconnection is recorded as
  two immutable facts, never as a mutated row — the same reasoning as
  ADR-006 in the identity unit.
- **S-10 — Both devices are independent.** Each device has its own sequence,
  its own watchdog and its own link state; both may be connected
  concurrently (BRD IR-14).

---

## Domain Entities

| Entity | Properties | Business Rules |
|--------|------------|----------------|
| **ScaleDevice** | `id` (`ScaleId`), `label`, `capability` (`ScaleCapability`), `linkState` (`LinkState`), `selfReportedStatus` (`ScaleStatus`), `calibrationState` (`CalibrationState`), `lastAcceptedReading` (`ScaleReading` \| `null`), `lastSequence` (`ReadingSequence` \| `null`), `linkedAt` (`Instant`) | One physical indicator. Owns the **current** truth about the device: is it there, what does it say, is it in calibration, may it be weighed on. The **only** place a reading enters the domain (S-3). The **only** place the weighing gate is evaluated (S-7). Mutable in memory — a live device is not an audit record. |
| **DisconnectionStarted** | `scaleId`, `startedAt` (`Instant`), `detectedAt` (`Instant`), `lastSequence` (`ReadingSequence` \| `null`), `reason` (`DisconnectionReason`) | An immutable fact: *this device stopped being heard from, at this time*. `startedAt` is when speech stopped (the last accepted reading's receipt time, or `linkedAt` if the device never spoke); `detectedAt` is when the watchdog noticed (`startedAt` + 2 s). Append-only (S-9). |
| **DisconnectionEnded** | `scaleId`, `endedAt` (`Instant`), `detectedAt` (`Instant`), `resumedAtSequence` (`ReadingSequence`), `startedAt` (`Instant`) | An immutable fact: *this device was heard from again, at this time, at this sequence*. The `startedAt` it carries is the matching `DisconnectionStarted`'s, so the two facts join into a gap without a mutable row (S-9). |

---

## Value Objects

| Value Object | Properties | Constraints |
|--------------|------------|-------------|
| **ScaleId** | `value` (string) | Non-empty. Opaque. Two devices are the same device iff their ids match. |
| **ScaleReading** | `value` (`WeightValue`), `unit` (`WeightUnit`), `stable` (boolean), `sequence` (`ReadingSequence`), `receivedAt` (`Instant`) | Immutable; equality by value. This is the unit's contract — the stories call it `WeightReading`. `receivedAt` is **stamped on receipt by the adapter**, never taken from the device, because the device's clock is not the station's clock. `stable` is `true` only for a settled weight; a settling weight is `false` (BRD IR-11). A reading of exactly `0` is legitimate and is indistinguishable from no reading only by its **presence**, never by its value (S-1). |
| **ReadingSequence** | `value` (integer ≥ 0) | Strictly increasing **per device**. Two sequences compare by value; a device's sequence counter is owned by that device alone (S-10). |
| **WeightValue** | `text` (decimal string), `unit` (`WeightUnit`) | **The constructor accepts a string and nothing else** — no `number`, no `float`. This is the structural expression of BRD NFR-16. Canonical form: a decimal with no exponent and no trailing zeros beyond the device's resolution. A device's own resolution is carried, not improved: the value is never given more precision than the device reported (S-2). |
| **WeightUnit** | `kind` (`G` \| `KG`) | Closed set. Carried on **every** reading, so a device that changes its unit mid-stream makes the change visible rather than silently reinterpreting the value in the old unit. |
| **ScaleStatus** | `kind` (`CONNECTED` \| `DISCONNECTED` \| `ZEROED` \| `BUSY` \| `OVER_CAPACITY`) | The published, operator-facing vocabulary (FR-19). **One** status at a time — not a bag of flags, so the status strip cannot show a scale as simultaneously READY and DISCONNECTED. `DISCONNECTED` is produced by the context, never by the device, because a device that is not there cannot report its own status (S-5). |
| **LinkState** | `kind` (`UNKNOWN` \| `UP` \| `DOWN`) | The **link** axis, kept separate from the device's self-reported status. `UNKNOWN` = registered but never heard from; `UP` = a reading was accepted within the window; `DOWN` = the watchdog tripped. `DOWN` overrides the self-reported status. `UNKNOWN` is an internal distinction — it maps to `DISCONNECTED` in the published status, with the reason preserved internally as `NEVER_RESPONDED`. |
| **CalibrationState** | `kind` (`IN_CALIBRATION` \| `EXPIRED`), `expiresAt` (`Instant` \| `null`) | A **device property**. `IN_CALIBRATION` carries the expiry it was read from (FR-7, AC-14). A device whose calibration cannot be read is treated as `EXPIRED` — the same principle as S-1 applied to calibration: absence of evidence is not evidence of health. |
| **ScaleCapability** | `class` (`PRECISION` \| `FLOOR`), `capacity` (`WeightValue`), `resolution` (`WeightValue`) | What the device *can* do. Owned here, **used** by bolt `004` for the selection rule. `capacity` is compared in the device's own unit after conversion, never across mixed units. |
| **Instant** | `epochMillis` (integer) | A point in time, in whole milliseconds. Integer only. Used for `receivedAt`, `startedAt`, `detectedAt`, `endedAt` and `linkedAt`. |
| **WeighingBlockReason** | `kind` (`SCALE_DISCONNECTED` \| `SCALE_NOT_RESPONDING` \| `CALIBRATION_EXPIRED` \| `OVER_CAPACITY` \| `SCALE_BUSY`) | A closed set of *stated* reasons. The story requires the refusal to **name** the reason ("a stated reason identifies the scale as disconnected"), so the reason is data, not prose assembled at the call site. |
| **WeightSnapshot** | discriminated union: `{ kind: 'READING', reading: ScaleReading }` \| `{ kind: 'NONE', since: Instant, reason: 'NEVER_READ' \| 'DISCONNECTED' }` | **The single expression of S-1.** The `NONE` branch has **no value field at all** — there is nothing to render as `0.0`. It carries *why* there is no reading and *since when*, so the UI can say "scale gone since 07:41:02" rather than showing a stale number or a zero. |

---

## Aggregates

| Aggregate Root | Members | Invariants |
|----------------|---------|------------|
| **ScaleDevice** | `ScaleCapability`, `LinkState`, `ScaleStatus` (self-reported), `CalibrationState`, `ScaleReading` (last accepted only) | S-2, S-3, S-4, S-5, S-6, S-7, S-10. Only the **last accepted** reading is retained — a late consumer gets no backlog, because replaying a backlog would present stale readings as current (S-1). |
| **DeviceLinkHistory** | `DisconnectionStarted`, `DisconnectionEnded` | S-9. An `Ended` record always names a `Started` record. The **gap** is the projection of the pair; there is no mutable "gap" row. |

---

## Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| **ScaleDisconnected** | The link transitions `UP` → `DOWN` | `scaleId`, `startedAt`, `detectedAt`, `lastSequence`, `reason` |
| **ScaleReconnected** | The link transitions `DOWN` → `UP` (an accepted reading with a strictly greater sequence) | `scaleId`, `startedAt`, `endedAt`, `detectedAt`, `resumedAtSequence` |
| **ScaleStatusChanged** | The published `ScaleStatus` changes for any reason | `scaleId`, `from`, `to`, `at`, `cause` |
| **ReadingRejected** | A candidate reading is refused by S-3 | `scaleId`, `rejectedSequence`, `lastAcceptedSequence` — *diagnostic only; a misbehaving device should be visible, and this is the only event that fires per reading rather than per transition.* |

**The hot path is deliberately not an event.** A `ReadingAccepted` event would fire 10 times per second per device, and it would be consumed by the stream, not recorded. The distinction mirrors ADR-006 in the identity unit: **what is recorded and what is merely broadcast are different things**, and only the rare, durable facts become events.

---

## Domain Services

| Service | Operations | Dependencies |
|---------|------------|--------------|
| **LinkWatchdog** | `evaluate(lastActivityAt, now) → LinkVerdict` | `Instant`, `LinkState`. **Pure.** The verdict is `UP` while `now - lastActivityAt <= 2000`, and `DOWN` once it exceeds. The 2 s is a **parameter of the rule**, not a constant buried in a `setTimeout`, so the boundary is testable exactly and the rule is stated in one place. |
| **ReadingAcceptancePolicy** | `evaluate(candidate, lastAccepted) → ReadingVerdict` | `ScaleReading`, `ReadingSequence`. **Pure.** Accepts when the candidate's sequence is strictly greater than the last accepted one; rejects otherwise. This is S-3 in one function, and it is the only place a reading is allowed in. |
| **ScaleHealthPolicy** | `evaluate(device, now) → WeighingVerdict` | `ScaleDevice`, `CalibrationState`, `WeighingBlockReason`. **Pure.** Answers "may a weighing proceed on this device, and if not, why?" — S-7. |
| **ScaleAdapter** *(port)* | `openStream(scaleId) → AsyncIterable<ScaleReading>`, `readStatus(scaleId) → ScaleStatus`, `readCalibration(scaleId) → CalibrationState` | The **seam**. A real indicator replaces the training one behind this port and nowhere else. Nothing above it may assume a wire protocol (BRD IR-07, `Q-03`). |

### The `canWeigh` gate, in full

`ScaleHealthPolicy` returns **allowed**, or **blocked with one named reason**, in this precedence:

1. Link is `DOWN` → `SCALE_DISCONNECTED`.
2. Link is `UNKNOWN` (never heard from) → `SCALE_NOT_RESPONDING`.
3. Calibration is `EXPIRED` or unreadable → `CALIBRATION_EXPIRED`.
4. The device reports `OVER_CAPACITY` → `OVER_CAPACITY`.
5. The device reports `BUSY` → `SCALE_BUSY`.
6. Otherwise → **allowed**.

---

## Repository Interfaces

| Repository | Entity | Methods |
|------------|--------|---------|
| **ScaleDeviceRepository** | `ScaleDevice` | `get(scaleId)`, `list()`, `save(device)` |
| **DeviceLinkHistoryRepository** | `DisconnectionStarted`, `DisconnectionEnded` | `appendStarted(record)`, `appendEnded(record)`, `listGaps(scaleId, range)` |
| **ScaleReadingRepository** | — | **Does not exist.** |

**The absent repository is a design decision, not an omission.** Readings are
not persisted (S-8): persisting them would risk a stale reading being read
back as a live one — the exact confusion the disconnection rule exists to
prevent. The only way to persist a weight in this product is to confirm it,
and a confirmed weight is a *weighing record*, which belongs to unit `003`.
The absence of this repository is what makes that rule structural: there is
no place to accidentally write a reading down.

---

## Ubiquitous Language

| Term | Definition |
|------|------------|
| **ScaleReading** | One reading from a device. The stories call it `WeightReading`; same thing. Carries value, unit, stability flag, sequence and receipt time. |
| **WeightValue** | A fixed-point decimal weight. Its constructor takes a string, so a float cannot enter the weight path. |
| **Sequence** | A per-device, strictly increasing counter on every reading. The freshness signal the watchdog observes. |
| **Receipt time** | The moment the adapter received the reading. Not the device's own timestamp. |
| **Link state** | Whether the device is being heard from: `UNKNOWN`, `UP` or `DOWN`. |
| **Device status** | The operator-facing state: `CONNECTED`, `DISCONNECTED`, `ZEROED`, `BUSY`, `OVER_CAPACITY`. Exactly one at a time. |
| **Disconnect timeout** | 2 s. The gap after the last accepted reading within which no strictly greater sequence may arrive. |
| **Disconnection gap** | The interval during which no valid reading was available. Recorded as two immutable facts, not one mutable row. |
| **Weighing gate** | The single check that decides whether a weighing may proceed on a device, and the named reason when it may not. |
| **Snapshot** | The current weight *or* the fact that there is none. Never a zero standing in for silence. |
| **Adapter seam** | The port where a real indicator protocol replaces the training one. The single place that changes if `Q-03` comes back "settled value only". |

---

## Story Coverage

### Story `001-receive-live-weight-stream`

| # | Acceptance criterion | Covered by |
|---|----------------------|-----------|
| 1 | Readings at ≥ 10 per second, each carrying value, unit, stability flag, strictly increasing sequence and receipt time | `ScaleReading` (all five fields); `ScaleAdapter.openStream`; IR-10, NFR-01 |
| 2 | Sequence strictly greater than the previous reading's | `ReadingSequence`; `ReadingAcceptancePolicy` (S-3) |
| 3 | Fixed-point decimal; no floating point anywhere in the weight path | `WeightValue` — string-only constructor (S-2); BRD NFR-16 |
| 4 | Stability flag `true` when stable, `false` when settling | `ScaleReading.stable`; BRD IR-11 |
| 5 | No reading is emitted when the device has sent none; absence is never a zero reading | `WeightSnapshot` (S-1); the `NONE` branch has no value field |
| 6 | A reading is available within one stream period (≤ 100 ms at 10 Hz) | Push-based stream; SSE transport; NFR-01's budget split |

### Story `002-detect-disconnection-and-block-weighing`

| # | Acceptance criterion | Covered by |
|---|----------------------|-----------|
| 1 | No strictly greater sequence within 2 s → `DISCONNECTED` | `LinkWatchdog` (S-4, S-6); BRD IR-13 |
| 2 | A weighing confirmation is refused with a stated reason naming the disconnection | `ScaleHealthPolicy` → `WeighingBlockReason.SCALE_DISCONNECTED` (S-7) |
| 3 | A disconnected device yields **no reading**, never a zero-valued one | `WeightSnapshot`; `LinkState.DOWN` overrides the device's self-report (S-5) |
| 4 | A later reading with a strictly greater sequence returns the device to `CONNECTED`, and the gap is recorded with start and end times | `DeviceLinkHistory`; `DisconnectionStarted` / `DisconnectionEnded` (S-9) |
| 5 | Expired calibration blocks the weighing with a stated reason | `CalibrationState.EXPIRED` → `WeighingBlockReason.CALIBRATION_EXPIRED`; FR-7, AC-14 |
| 6 | Valid calibration is reported as `IN_CALIBRATION` with the expiry date it was read from | `CalibrationState.IN_CALIBRATION` carries `expiresAt` |

---

## Open interpretations

Two readings in the source material are ambiguous. Both are resolved here
**explicitly** rather than silently, and both are raised at the Stage 1
checkpoint.

### I-1 — Does `ZEROED` block weighing?

The story says: *"Device status vocabulary: `CONNECTED`, `DISCONNECTED`,
`ZEROED`, `BUSY`, `OVER_CAPACITY` … Only `CONNECTED` is a state in which
weighing may proceed."*

Taken literally, `ZEROED` blocks weighing. That cannot be right: a **tared
scale is zeroed**, and bolt `004` requires a weighing to proceed on a tared
scale. The two statements contradict each other.

**Reading adopted:** "only `CONNECTED` may proceed" is read as "only a
*connected* device may proceed" — `DISCONNECTED` blocks — with the other
three states each blocking for its own named reason (`OVER_CAPACITY`,
`SCALE_BUSY`). **`ZEROED` does not block.** A zeroed scale is exactly the
state a tared container puts it in.

**Consequence if reversed:** `ZEROED` would have to be renamed, because
tare would then block the weighing it exists to enable.

### I-2 — What is a device that has never spoken?

The story defines `DISCONNECTED` only relative to a prior reading, so a
device that has never delivered one is not covered. The published vocabulary
has no "unknown" state, and the unit brief says only `CONNECTED` may
proceed.

**Reading adopted:** the link state is internally `UNKNOWN`, and it is
published as `DISCONNECTED` — to the operator, a scale that has never
spoken is a scale that is not there. The distinction is preserved
internally as `DisconnectionReason.NEVER_RESPONDED`, and the weighing gate
reports it as `SCALE_NOT_RESPONDING` rather than `SCALE_DISCONNECTED`, so
"never connected" is never confused with "went silent" in the evidence.

**Consequence if reversed:** the operator-facing vocabulary would need a
sixth state, which the prototype's status strip does not have.
