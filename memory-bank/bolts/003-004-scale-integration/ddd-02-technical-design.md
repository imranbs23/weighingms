---
unit: 004-scale-integration
bolt: 003-004-scale-integration
stage: design
status: complete
updated: 2026-10-30T23:20:00Z
---

# Technical Design - Scale Integration

## Architecture Pattern

**Hexagonal (ports and adapters), in the same shape as the identity unit.**

The domain is pure TypeScript with no I/O. Every effect it needs — the
adapter's readings, the passage of time, the scheduling of a timeout — is
reached through a **port**, and every port has exactly one adapter bound in
the composition root.

This is not a fresh choice; it is the pattern bolt `001` established and
bolt `002` extended. Reusing it means a reader who knows the identity unit
already knows this one, and it keeps the two units composable in one
composition root without either unit importing the other.

The one addition over the identity unit is a **scheduler port**. The identity
unit's domain needed a clock; this unit's domain needs a clock *and* the
ability to be woken when that clock crosses a deadline. Both are ports, so
the 2 s boundary is testable exactly rather than approximated with a sleep —
the same discipline `AuthorisationWindow` followed for its expiry boundary.

### The ports

| Port | Production adapter | Test adapter |
|------|---------------------|--------------|
| `ScaleAdapter` | `DummyScaleAdapter` | in-memory stub |
| `WatchdogScheduler` | `NodeWatchdogScheduler` | `ManualWatchdogScheduler` |
| clock | `() => Date` | `TestClock` |
| `ScaleDeviceRepository` | in-memory | in-memory |
| `DeviceLinkHistoryRepository` | in-memory | in-memory |

### What the identity unit's pattern does *not* transfer

The identity unit's domain had **zero third-party runtime dependencies**, and
that was worth stating. This unit cannot keep that property: it is the first
unit with a **quantity**, and BRD NFR-16 forbids floating point for
quantities. The approved tech stack names `decimal.js` for exactly this. See
§Deviations from the approved tech stack, deviation 3.

---

## Layer Structure

```text
┌──────────────────────────────────────────────────────┐
│  Presentation      src/004-scale-integration/         │
│                    presentation/                      │
│                    · scale-controller.ts   (status)   │
│                    · weight-stream-controller.ts (SSE) │
│                    · scale-schemas.ts       (Zod)      │
├──────────────────────────────────────────────────────┤
│  Domain services  src/004-scale-integration/         │
│                    domain/services/                   │
│                    · scale-registry.ts      (the hub) │
│                    · scale-stream-service.ts (fanout) │
│                    · scale-weighing-gate.ts  (canWeigh)│
│                    · link-watchdog.ts        (PURE)   │
│                    · reading-acceptance-policy.ts (PURE)│
│                    · scale-health-policy.ts  (PURE)   │
│                    · dispense-ramp.ts        (PURE)   │
├──────────────────────────────────────────────────────┤
│  Domain model    src/004-scale-integration/         │
│                    domain/{entities,value-objects,   │
│                    events,ports}/                     │
├──────────────────────────────────────────────────────┤
│  Infrastructure src/004-scale-integration/         │
│                    infrastructure/                    │
│                    · composition-root.ts              │
│                    · config/scale-config.ts           │
│                    · adapters/dummy-scale-adapter.ts  │
│                    · adapters/node-watchdog-scheduler │
│                    · persistence/in-memory-*.ts       │
└──────────────────────────────────────────────────────┘
```

The identity unit keeps its orchestration in `domain/services/`, not in an
`application/` layer (`authentication-service.ts`, `authorisation-service.ts`).
This unit follows that convention rather than introducing a fourth layer the
codebase does not have. The layering boundary is still real: the **pure**
policies (`link-watchdog`, `reading-acceptance-policy`, `scale-health-policy`,
`dispense-ramp`) have no I/O and no clock, and the **orchestrating** services
(`scale-registry`, `scale-stream-service`, `scale-weighing-gate`) do.

---

## API Design

The workbook fixes four Dummy Scale endpoints. Two further endpoints are
added for this unit's own acceptance criteria; two **training controls** are
added so the failure and dispensing paths are demonstrable in the running
product rather than only in tests.

| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| `/api/scales` | GET | — | `200` · `{ scales: ScaleSummary[] }` |
| `/api/scales/:scaleId/status` | GET | — | `200` · `ScaleStatusView` |
| `/api/scales/:scaleId/weight` | GET | — | `200` · `text/event-stream` — SSE |
| `/api/scales/:scaleId/can-weigh` | GET | — | `200` · `{ allowed, reason, status }` |
| `/api/scales/:scaleId/link` | POST | `{ state: 'CONNECTED' \| 'DISCONNECTED' }` | `202` · `{ scaleId, state }` — **training control** |
| `/api/scales/:scaleId/dispense` | POST | `{ target, tolerance, landing }` | `202` · `{ scaleId, programme }` — **training control** |

`POST /api/scales/:scaleId/tare` is the workbook's fourth Dummy Scale
endpoint. It is **bolt `004`'s** (`003-tare-scale-against-container`) and is
not in this bolt's scope; §Forward-looking notes says how the port grows.

### The SSE contract

```text
GET /api/scales/:scaleId/weight
Accept: text/event-stream

event: reading
data: {"scaleId":"SCALE-A","value":"93.42","unit":"g","stable":false,"sequence":42,"receivedAt":"2026-10-30T23:20:34.123Z"}

event: status
data: {"scaleId":"SCALE-A","status":"DISCONNECTED","since":"2026-10-30T23:20:34.123Z"}

: heartbeat
```

Four decisions in that contract, each of them load-bearing:

**1 - The value is a JSON string, not a JSON number.**

`"93.42"` — not `93.42`. A JSON number is an IEEE-754 double in every JSON
parser on the wire, and BRD NFR-16 says floating point is not permitted for
quantities. A decimal string is exact; a JSON number is not. This is the one
place where the wire format can silently undo a domain guarantee, and it is
therefore a domain guarantee that survives all the way to the browser.

The approved tech stack's illustrative SSE example shows
`data: {"weight":93.42,...}` — a JSON number. That example, as written,
violates NFR-16 in transit. See §Deviations, deviation 1.

**2 - The field names are the story's, not the tech stack's example's.**

The story pins the fields: `value`, `unit`, `stable`, `sequence`,
`receivedAt`. The tech stack's example predates the story and omits `unit`,
`sequence` and `receivedAt` entirely. The story wins — it is the traced
requirement (FR-8, BRD FR-19, IR-10, NFR-01).

**3 - The absence of a reading is never an event with a zero in it.**

The stream emits `event: reading` only when there is a reading. A consumer
that has received nothing has received **nothing** — there is no
`"value":"0"` event, no `null` event, and no "no data" event carrying a
weight. The status event carries the *reason* the stream is quiet, so the
consumer can say "scale gone since 07:41:02" without the stream having to
invent a reading to justify the silence.

**4 - The stream is live-only. There is no backlog.**

A consumer attaching late sees readings from its attachment point onward.
Replaying history would present stale readings as current, which is the exact
confusion S-1 exists to prevent. A consumer that needs history uses the
weighing record (unit `003`), not the stream.

### The status view

```json
{
  "scaleId": "SCALE-A",
  "label": "3 kg precision",
  "class": "PRECISION",
  "capacity": "3000",
  "resolution": "1",
  "unit": "g",
  "status": "CONNECTED",
  "link": "UP",
  "calibration": { "state": "IN_CALIBRATION", "expiresAt": "2027-04-01T00:00:00.000Z" },
  "lastReadingAt": "2026-10-30T23:20:34.123Z",
  "lastSequence": 42,
  "canWeigh": { "allowed": true, "reason": null }
}
```

`status` is the operator-facing vocabulary (exactly one value).
`link` is the internal axis, exposed because the status strip and the audit
trail both need to distinguish "went silent" from "never responded" — the two
reasons behind the same published status.

### The training controls

`POST /link` and `POST /dispense` exist because two of this unit's
acceptance criteria describe behaviour that would otherwise be unreachable
in a running product:

- **The disconnection path** needs a way to make a scale go silent. Without
  it, the 2 s watchdog can only be exercised by a test with a fake clock, and
  the operator cannot see the disconnection handling work.
- **The dispersion ramp** was moved out of the UI deliberately (the unit
  brief's §Notes) so that the UI reads a stream like it would from a real
  indicator. Leaving it in the UI would have made the UI the source of truth
  for weight, which BRD C-02 and the "no hard-coded fixture data in the UI"
  rule forbid.

**Both are training-only and are marked as such in the code.** They are not
part of any real scale's contract, and the adapter port has no equivalent
method — so no production code path can depend on them. This is the same
reasoning as the prototype's own `sim-ok` / `sim-over` buttons, which stay
in the training build.

---

## Data Persistence

**No table stores a weight reading.** That is the design, not an omission.

| Table | Columns | Relationships |
|-------|---------|---------------|
| `scale_devices` | `id`, `label`, `class`, `capacity`, `resolution`, `unit`, `calibration_state`, `calibration_expires_at` | — |
| `scale_link_events` | `id`, `scale_id`, `kind` (`STARTED` \| `ENDED`), `occurred_at`, `detected_at`, `last_sequence`, `resumed_at_sequence` | → `scale_devices.id` |

| Column | Type | Notes |
|--------|------|-------|
| `scale_devices.capacity` | `TEXT` | Fixed-point decimal **as text**, per BRD's `decimal(12,4)`. Never `REAL` — SQLite's `REAL` is an IEEE-754 double, which is the thing NFR-16 forbids. |
| `scale_devices.resolution` | `TEXT` | Same. |
| `scale_link_events.kind` | `TEXT` | `STARTED` or `ENDED`. The **gap** is the projection of the pair; there is no mutable "gap" row (S-9). |
| `scale_link_events.occurred_at` | `TEXT` | ISO-8601 with milliseconds. |
| `scale_link_events.detected_at` | `TEXT` | When the watchdog noticed — `occurred_at` + 2 s. Distinct from `occurred_at` because *when the scale stopped* and *when we noticed* are different facts, and conflating them would misstate the detection latency the requirement is about. |

### Why the device registry is in the database at all

The unit brief says "Device registry and status | In memory | Two devices".
The registry is **configuration**, not state: which scales exist, their
capacity, their resolution, their calibration. Two rows that change when a
scale is recalibrated and never otherwise.

Keeping it in SQLite costs one small table and buys two things: the
configuration survives a restart (a scale that appears to be a different
scale after a restart is a support problem), and the repository seam means a
future OrgaTEX-supplied device registry has an obvious home. **This is a
deliberate departure from the unit brief**, and it is recorded as
deviation 2.

The **status** is *not* persisted — it is live state, and persisting it
would let a stale status be read back after a restart, which is the same
failure mode the missing reading repository prevents.

### What is deliberately NOT in the database

- **Readings.** No table, no repository. The only way to persist a weight in
  this product is to confirm it, and a confirmed weight is a *weighing
  record*, which belongs to unit `003`.
- **The current status.** Live state.
- **The last accepted reading.** Live state, held in memory by the
  aggregate. Persisting it would let a stale reading be read back as a live
  one — the exact confusion S-1 exists to prevent.

---

## Security Design

| Concern | Approach |
|---------|----------|
| **Authentication** | The scale endpoints are **read-only telemetry** and are **not** behind the operator session. A scale's weight is not secret; the operator station is on the same network segment as the API. This matches the identity unit's own posture, where `GET /api/identity/current` requires a session but the health probe does not. The **training controls** (`/link`, `/dispense`) *are* treated differently — see below. |
| **Training controls** | `POST /link` and `POST /dispense` can change what the operator sees, so they require an operator session. They are not privileged actions: they authorise no weighing and grant no exception, so they do **not** require supervisor authorisation. They are gated on a valid session only. |
| **Authorisation** | The weighing gate is **not** an authorisation decision and does not consult the identity unit. A scale is either healthy or it is not; that is a fact about the device, not about who is asking. Supervisor authorisation is for *privileged actions* (tolerance override, manual reselection, calibration bypass) and belongs to unit `003` consuming unit `008`. |
| **Injection** | Every value reaching SQLite is bound as a parameter. No SQL is built by string concatenation anywhere in this unit. The `scale_id` in a path parameter is validated by Zod and then bound. |
| **Data exposure** | The status view returns the device's capability and calibration state. It contains no credentials, no operator identities and no operator-supplied free text. |
| **Denial of service** | The SSE endpoint holds a connection open. A client that connects and never reads would accumulate a subscription. Mitigated by: a per-connection bounded buffer (a slow consumer is **dropped**, not allowed to grow the server's memory), and a maximum concurrent-subscriber count per scale. A dropped consumer is told why — `event: status` with a `SLOW_CONSUMER` reason — rather than being left hanging. |
| **Input validation** | Zod at every boundary. The `target`, `tolerance` and `capacity` values are decimal **strings** in the request body, validated as decimal strings and converted through `WeightValue`. A JSON number is rejected at the boundary, not silently accepted and rounded. |

---

## NFR Implementation

| Requirement | Design Approach |
|-------------|-----------------|
| **NFR-01 — ≤ 200 ms end-to-end lag** | The budget is split 100 ms sampling / 100 ms transport+render. The dummy adapter samples on a **100 ms timer** (10 Hz), so the sampling half is met by construction. The stream is **push-based** (SSE), so the transport half has no polling delay — a consumer receives the reading as it is produced, not on its next poll. The domain adds no latency: `receivedAt` is stamped at receipt, and the SSE frame is written immediately. |
| **NFR-02 / BRD NFR-16 — no floating point** | `WeightValue`'s constructor accepts a **string** and nothing else (Stage 1, S-2). The SSE payload carries the value as a JSON **string**. The database stores it as `TEXT`. `decimal.js` does the arithmetic in the domain and the ramp. There is no `number` anywhere in the weight path — enforced by the type system, not by review. |
| **IR-10 — ≥ 10 readings per second** | The adapter's sampling interval is **configuration** (`scaleConfig.sampleIntervalMs`), defaulting to 100 ms. The test suite asserts the *measured* rate, not the configured one, so a regression in the timer cannot pass. |
| **IR-13 — disconnection detected within 2 s** | The watchdog schedules a deadline at `lastAccepted.receivedAt + 2000 ms`. The 2 s is the **timeout parameter of the rule** (Stage 1, S-4), not a constant inside a callback. At exactly 2000 ms the link is still `UP` — the boundary is inclusive, and the tests assert just-under, exactly-at, and just-over. |
| **NFR-03 — weighing continues during an outage** | The API process does not depend on the scale. A disconnected scale blocks *weighing on that scale* and nothing else — the rest of the station keeps running. |
| **NFR-05 — survives power loss** | The device registry and the link history are in SQLite with `synchronous = FULL` and WAL, as the identity unit's database already sets. **Readings are not persisted**, so there is nothing to lose: the scale re-reads on restart. |
| **Scalability** | Two devices. The design does not preclude more — each device has an independent sequence, watchdog and subscriber set (S-10) — but nothing here is tuned for a scale farm, and it should not be presented as if it were. |
| **Observability** | The `ReadingRejected` event fires when a device emits a non-increasing sequence. A misbehaving device should be *visible*, and this is the only per-reading signal the domain emits. |

---

## Error Handling

| Error type | Code | Response |
|------------|------|----------|
| **Unknown scale** | 404 | `{ "error": "SCALE_NOT_FOUND" }` |
| **Malformed path or body** | 400 | `{ "error": "VALIDATION_ERROR", "fields": [...] }` — the identity unit's existing shape |
| **No operator session, on a training control** | 401 | `{ "error": "UNAUTHENTICATED" }` — the identity unit's existing code |
| **Scale is disconnected, on `can-weigh`** | **200** | `{ "allowed": false, "reason": "SCALE_DISCONNECTED" }` — **not an error.** The gate is a *question with an answer*, and the answer is "no, and here is why". Returning 403 would make a normal, expected device state look like a failure. |
| **Scale is disconnected, on the weight stream** | **200** | The SSE stream stays open and emits a `status` event with the disconnection. The stream is not errored — a client must be able to watch a scale go down and come back on one connection. |
| **Internal error** | 500 | `{ "error": "INTERNAL_ERROR" }` — the detail goes to the log, never to the client. Matches the identity unit's handler. |

### The uniform-refusal question

ADR-004 established that **every** authorisation refusal returns one uniform
body, because a distinguishable status is an enumeration oracle over
supervisor identities.

**This unit has no such oracle**, and the reasoning is worth stating so the
difference is not mistaken for an inconsistency. A scale's state is not
secret: the operator can see the scale in front of them. Distinguishing
"disconnected" from "calibration expired" is not an information leak — it is
the *entire point*, because the story requires the refusal to name the
reason ("a stated reason identifies the scale as disconnected"). A single
opaque body would defeat a stated acceptance criterion.

The distinction between the two units is: ADR-004 protects an **identity**
(the supervisor's credential); this unit reports a **device's state**, which
the operator already knows.

---

## Internal Design

### The registry is the hub

`ScaleRegistry` owns the set of devices and is the only thing that mutates
them. Everything else reads from it. This is what keeps the aggregate's
invariants intact: there is exactly one place a reading can enter (S-3) and
exactly one place the gate is evaluated (S-7).

```text
DummyScaleAdapter ──readings──▶ ScaleRegistry ──broadcast──▶ ScaleStreamService
                                      │                              │
                                      │                              ▼
                                      │                        SSE subscribers
                                      ▼
                              ScaleDevice aggregate
                              (the ONLY mutator)
```

### The watchdog, and why it is scheduled rather than polled

Two implementations were considered.

**Polled** — a timer that asks "is this device late?" every 100 ms. Simple,
but it means the *detection* time is quantised to the poll interval, so the
real detection latency is between 2.0 s and 2.1 s. The requirement says
"within 2 s", and a 100 ms overshoot is a requirement violation that the
test suite would have to be written to tolerate.

**Scheduled** — the deadline `lastAccepted.receivedAt + 2000 ms` is handed to
a `WatchdogScheduler`, which fires at the deadline. Detection latency is then
the scheduler's accuracy, not a poll quantum. The link is marked `DOWN`
within a few milliseconds of the true deadline, and the **boundary decision**
itself is made by the pure `LinkWatchdog` against the current time, so the
rule's answer at exactly 2000 ms is `UP` regardless of when the callback
happens to run.

**Scheduled wins.** The pure policy still decides the boundary; the scheduler
only decides *when to ask*. That split is what lets the 2 s boundary be
tested exactly, with a `ManualWatchdogScheduler` and a `TestClock`, rather
than with sleeps.

### The ramp

The prototype's own formula, moved out of the UI and into the domain:

```text
step = max(target × 0.004, remaining × 0.055)
landing = target + tolerance × 0.4   (in tolerance)
landing = target + tolerance × 4.8   (over tolerance)
```

The prototype runs this on a **34 ms** interval. The adapter's sampling
interval is **100 ms** (10 Hz, IR-10), so the ramp's step is applied **per
sample**, not per 34 ms tick — otherwise the ramp would overshoot its own
landing by up to three samples' worth of step. The ramp is expressed as a
pure function of `(current, target, tolerance)` so the landing is exact: the
final sample is `min(current + step, landing)`, and the test asserts the
landing is hit **exactly**, not approximately.

The prototype's `0.004` and `0.055` are **read from the prototype**, not
invented. The prototype's timer interval (34 ms) is a rendering artefact and
is not carried over — it would make the device emit faster than 10 Hz, which
is not what the prototype meant.

### The `dispense-ramp` and `scale-health-policy` are PURE

Both take the current time (or no time at all) as an **argument**. The
identity unit's `AuthorisationPolicy` set this precedent, and the reason
applies here: the ramp's landing and the calibration expiry are testable
exactly, with no fixtures and no sleeps.

---

## Deviations from the approved tech stack

Recorded here rather than buried, because each one is a departure from an
approved document and the reader needs to be able to overrule it.

### Deviation 1 — The SSE payload carries a decimal string, not a JSON number

The tech stack's "Live weight transport" section shows:

```text
data: {"weight":93.42,"stable":false,"timestamp":"..."}
```

A JSON number is an IEEE-754 double in every JSON parser. BRD NFR-16 forbids
floating point for quantities. The example, as written, violates the
requirement **in transit**, after the domain has been careful.

**This design sends `"value":"93.42"`** and uses the story's field names.

The tech stack's example is illustrative — the BRD's assumed streaming shape
is explicitly "illustrative, for FCI/SETEX to correct" — so this is a
correction to an example, not a change to an approved architecture.

### Deviation 2 — The device registry is persisted, not held in memory

The unit brief says the device registry is in memory. It is persisted here.
The reasoning is in §Data Persistence: the registry is configuration, and a
registry that changes on restart is a support problem. The *status* — which
is what the unit brief's "in memory" note is really about — remains in
memory.

### Deviation 3 — `decimal.js` is added as a runtime dependency

The identity unit's domain had zero third-party runtime dependencies. This
unit is the first with a quantity, and the approved tech stack already names
`decimal.js` for fixed-point arithmetic. Adding it is **within** the
approved stack, not a deviation from it — but it is recorded here because
bolt `001`'s ADR-001 argued at length for carrying no third-party native
code, and a reader should see that the reasoning was applied deliberately
rather than drifted from.

`decimal.js` is pure JavaScript with no native build step, so the
"self-contained and demonstrable offline" promise survives. The
`better-sqlite3` problem did.

**The domain still avoids `decimal.js` where it can.** `WeightValue` does
comparison and equality on canonical decimal strings, so the *common* path —
a reading arriving, being compared, being serialised — needs no arithmetic
library at all. `decimal.js` is needed only where quantities are actually
computed: the ramp, and (in bolt `004`) the tolerance comparisons and the
capacity check.

### Deviation 4 — The SSE endpoint is not behind the operator session

The identity unit's endpoints are session-guarded. The scale endpoints are
not, because they are read-only telemetry about a device that is physically
in front of the operator, and the UI needs the stream *before* a session is
established (the status strip renders during boot).

This is a judgement call and it is worth stating plainly: if the deployment
ever places the API on a shared network rather than the station's own
segment, this decision needs revisiting. It is recorded here so the revisit
is a known obligation rather than a surprise.

---

## Forward-looking notes

### Bolt `004` — tare and scale selection

The port grows by two methods, not by a redesign:

```ts
interface ScaleAdapter {
  openStream(scaleId: ScaleId): AsyncIterable<ScaleReading>;
  readStatus(scaleId: ScaleId): ScaleStatus;
  readCalibration(scaleId: ScaleId): CalibrationState;
  applyTare(scaleId: ScaleId, tare: WeightValue): Promise<TareState>;   // bolt 004
}
```

The `ScaleCapability` value object already carries `class`, `capacity` and
`resolution` — exactly the inputs bolt `004`'s selection rule needs. Bolt
`004` adds the `ScaleSelection` decision and the `TareState`; it does not
need to touch anything in this bolt's model.

The `ZEROED` status exists in the vocabulary precisely so bolt `004` can
express "the scale has been tared" without inventing a new state.

### Unit `003` — the weighing station

Unit `003` consumes this unit through exactly two things:

1. `canWeigh(scaleId)` → `{ allowed, reason }` — the gate.
2. The SSE stream — the live weight and its stability flag.

It never re-derives the gate, and it never reads a scale's status directly.
That is the same single-chokepoint property ADR-003 and ADR-004 established
for the identity unit.

### The `Q-03` seam

If FCI's answer is that the indicators report only a **settled** value, the
change is confined to `DummyScaleAdapter`'s replacement — a real adapter
that emits one reading per settle event instead of ten per second. The
`stable` flag becomes the only meaningful signal, and `stable: false` never
occurs.

Nothing above the adapter changes. The port is the seam, exactly as
BRD IR-07 requires, and the seam is what makes the assumption **testable**
rather than merely stated.

---

## Story Coverage

| Story | Criterion | Design element |
|-------|-----------|-----------------|
| 001 | ≥ 10 readings/s with value, unit, stable, sequence, receipt time | §The SSE contract; `IR-10` row in §NFR |
| 001 | Sequence strictly increasing | `ReadingAcceptancePolicy`; S-3 |
| 001 | Fixed-point decimal, no float anywhere | `WeightValue` string-only constructor; §Deviation 1 |
| 001 | Stability flag true/false | `ScaleReading.stable`; BRD IR-11 |
| 001 | No reading is emitted when none was received | §The SSE contract, decision 3; S-1 |
| 001 | Available within one stream period (≤ 100 ms) | §NFR, NFR-01 row; push-based transport |
| 002 | No greater sequence within 2 s → DISCONNECTED | §The watchdog; `LinkWatchdog`; S-4, S-6 |
| 002 | Confirmation refused, reason names the disconnection | §Error Handling — `can-weigh`; `WeighingBlockReason`; S-7 |
| 002 | Disconnected yields no reading, never a zero | §The SSE contract, decision 3; S-5 |
| 002 | Reconnect returns to CONNECTED, gap recorded with start and end | `scale_link_events`; S-9 |
| 002 | Expired calibration blocks with a stated reason | `CalibrationState`; `WeighingBlockReason.CALIBRATION_EXPIRED` |
| 002 | Valid calibration reported as IN_CALIBRATION with expiry | §The status view |
