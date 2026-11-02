---
bolt: 003-004-scale-integration
created: 2026-10-30T23:40:00Z
status: accepted
superseded_by: null
---

# ADR-013: The scale telemetry endpoints are not behind an operator session

## Context

Every endpoint in the identity unit requires an operator session. Bolt
`001` built `sign-in`, `sign-out`, `current` and `session`, and the
`resolveCurrentOperator` middleware resolves a bearer token into an operator
on every request. Bolt `002`'s authorisation endpoints are session-guarded
too — and their refusal is *uniform* (ADR-004), because a precise error
there is an enumeration oracle over supervisor identities.

This unit adds a different kind of endpoint: **device telemetry**. The scale
stream, the scale status, the list of scales. These are read-only facts
about a piece of hardware that is **physically in front of the operator**,
at the weighing station.

Two arguments pull against session-guarding them.

**1. The UI needs the status strip before anyone signs in.** The prototype's
status strip ("SCALE 3 kg · READY · SCALE 32 kg · READY · SCANNER ·
PRINTER") renders at boot, and the weighing view needs the live weight.
Whether a session exists at that moment depends on the boot order, and
making the status strip depend on it is a design coupling for no benefit.

**2. The data is not secret.** A scale's current weight and its calibration
expiry are visible to anyone standing at the station. The scale is not
behind a curtain. Guarding it with a session protects nothing that an
attacker on the station's own network could not already see — and the
attacker in that position can simply *look at the scale*.

One argument pulls the other way, and it is the one that decides this ADR.

**3. The training controls are not read-only.** This design adds two
**training-only** endpoints that change what the operator sees:

```text
POST /api/scales/:scaleId/link      — make a scale go silent
POST /api/scales/:scaleId/dispense  — drive the dispersion ramp
```

These exist because two acceptance criteria describe behaviour that would
otherwise be unreachable in a running product: the disconnection path needs
a way to make a scale go silent, and the ramp needs to be drivable from
outside the UI (the unit brief moved it out of the UI deliberately, so that
the UI reads a stream like it would from a real indicator).

An endpoint that can silence a scale is **not** read-only. It can make a
weighing in progress appear to fail, and — more importantly — it can make a
scale *appear healthy* when it is not, if it can inject a reading.

This is the tension the ADR has to resolve: the telemetry is not secret,
but the training controls are not harmless.

## Decision

**The telemetry endpoints are not session-guarded. The training controls
are.**

| Endpoint | Session required | Reason |
|----------|------------------|--------|
| `GET /api/scales` | No | Device telemetry. Not secret. |
| `GET /api/scales/:scaleId/status` | No | Device telemetry. Not secret. |
| `GET /api/scales/:scaleId/weight` | No | Device telemetry. Not secret. |
| `GET /api/scales/:scaleId/can-weigh` | No | Device telemetry. Not secret. |
| `POST /api/scales/:scaleId/link` | **Yes** | Changes device state. |
| `POST /api/scales/:scaleId/dispense` | **Yes** | Changes device state. |

### The training controls require a session, but NOT a supervisor

This is the part that is easy to get wrong in either direction.

**They are not privileged actions.** A privileged action is one that
authorises something the operator could not otherwise do — a tolerance
override, a manual reselection, a calibration bypass. FR-35 and the identity
unit's `PrivilegedAction` define that set, and the scale unit's controls are
not in it.

The controls **grant no exception** and **authorise no weighing**. Making a
the training scale go silent does not let anyone confirm an out-of-tolerance
weighing; it makes the scale *unavailable*, which is the *safe* direction.

**So they do not require supervisor authorisation.** Requiring it would mean
an operator cannot exercise the failure path without fetching a supervisor,
for a training affordance that grants nothing.

**But they do require a valid operator session**, because they change state
that the operator is shown, and because "anyone on the network can silence
the scale" is not a posture worth having even in a training build.

### The rule, stated once

> **Read** endpoints about the device → no session.
> **Write** endpoints that change the device → a session, but not a
> supervisor.

This is the same shape as the identity unit's own split between
`/api/identity/current` (needs a session) and `/api/health` (does not).

### This is a training posture, not a production posture

The training controls are **training-only**, and they are marked as such in
the code. The `ScaleAdapter` port has no equivalent method, so **no
production code path can depend on them** — they cannot be reached except
through the training controller, and a real indicator replacing the adapter
would not have them.

The telemetry endpoints' lack of a session, however, is a **production**
posture. It is stated here with its condition attached:

> **This decision holds only while the API is on the station's own network
> segment, alongside the terminal and the scales.**

If the API is ever exposed to a shared network, this ADR is void and the
telemetry endpoints must be session-guarded. That is a known obligation, not
a hypothetical.

## Rationale

**Why telemetry is not session-guarded.** The alternative — guarding the
status strip behind a session — couples the UI's boot sequence to the
identity unit's, for data that is physically visible. If a session expires
mid-weighing, the status strip would blank, and the operator would see a
station with no peripherals listed — which is *worse* than a stale session,
because it looks like a fault.

There is a second, stronger reason. The story's safety rule is that a
disconnected scale must never be shown as zero:

> **Given** a device is `DISCONNECTED`, **When** its weight is read, **Then**
> no reading is produced — the station yields **no reading at all**, never a
> reading whose value is zero.

If the status endpoint can fail with a 401, then a consumer that treats a
failed status fetch as "no data" and a failed weight fetch as "no data" has
**two different reasons to show nothing**, and the UI has to distinguish
"the scale is gone" from "your session expired". That is a new
distinguishing case in the UI, in the one place the product most needs
certainty. Leaving the telemetry unauthenticated removes that case
entirely: the status endpoint succeeds or the scale is not answering.

**Why the controls need a session.** They can inject a reading and silence
a scale. On a shared network that is a way to make the station lie. A
session is a one-line guard that removes the concern.

**Why they do not need a supervisor.** Because the identity unit already
established the definition of a privileged action: an action that authorises
something. These controls authorise nothing. They make a scale unavailable,
which is the safe direction — a scale that is silent blocks weighing rather
than permitting it.

Making them privileged would be the wrong error to make. It would mean
supervisor authorisation is required for a training affordance, and it would
dilute the meaning of supervisor authorisation, which in this product is the
one thing that must stay meaningful. ADR-004 exists to protect that
meaning.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **Telemetry open, controls session-guarded** (adopted) | Telemetry has no session dependency; the controls cannot be used anonymously; no supervisor needed for a training affordance | Two different postures on one router, which must be documented | The distinction follows the actual risk |
| **Everything session-guarded** | One uniform posture; nothing is exposed | Couples the UI's boot to the identity unit; a session expiry blanks the status strip; adds a distinguishing case to the UI; protects data that is physically visible | The protection is for data that is already visible, and the cost is a new failure mode in the safety-critical path |
| **Everything open** | Simplest | An anonymous caller can silence a scale or inject a reading | Not acceptable even in a training build |
| **Everything session-guarded AND supervisor-guarded** | Maximum safety | A supervisor must be present to exercise the failure path; supervisor authorisation is diluted by a training affordance | These controls authorise nothing; there is nothing to authorise |
| **Telemetry open, controls open, but the controls only work when a training flag is set** | Contained to training deployments | A flag is a weaker guard than a session; the flag can be left on | The session is free and real |

## Consequences

### Positive

- **The status strip works at boot**, with no dependency on the identity
  unit's session state.
- **The UI has no "session expired vs. scale gone" case** to distinguish in
  the status path — the safety-critical path stays simple.
- The training controls cannot be used anonymously, while still being
  exercisable by an ordinary operator without fetching a supervisor.
- **Supervisor authorisation stays meaningful.** It is reserved for actions
  that actually authorise something.

### Negative

- **The telemetry is readable by anyone who can reach the API.** That is
  accepted deliberately, on the condition that the API is on the station's
  own segment.
- The router carries **two postures**, which a reader must notice. The
  table above is part of the design document for that reason.
- The distinction between "telemetry" and "training control" must be
  maintained. A future endpoint that changes device state and is added
  without a session is a regression.

### Risks

- **The API is exposed to a shared network**, making the open telemetry
  reachable by an attacker. *Mitigation*: this ADR states the condition
  explicitly, and the deployment documentation must record it. This is a
  known obligation carried forward, not an oversight.
- **A future write endpoint is added without a session.** *Mitigation*: the
  rule is stated once at the top of the ADR, and the design document's
  endpoint table records the posture of each endpoint.
- **The training controls are mistaken for a production interface.**
  *Mitigation*: they are marked as training-only in the code, and the
  `ScaleAdapter` port has no equivalent method, so no production path can
  reach them.

## Related

- **Stories**: 001-receive-live-weight-stream, 002-detect-disconnection-and-block-weighing
- **Requirements**: FR-8, FRD FR-19, BRD IR-13, BRD IR-18, BRD NFR-12
- **Standards**: `standards/tech-stack.md` § Service topology — the Dummy
  Scale endpoints; `units/004-scale-integration/unit-brief.md` § Integration
  Points
- **Previous ADRs**: ADR-004 (the uniform refusal — and why this unit's
  device-state refusals are *not* uniform, because a scale's state is not
  secret)
