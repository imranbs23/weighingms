---
bolt: 003-004-scale-integration
created: 2026-10-30T23:40:00Z
status: accepted
superseded_by: null
---

# ADR-011: Link state is a separate axis from the published device status

## Context

The story gives the device a **status** with five values:

> Device status vocabulary: `CONNECTED`, `DISCONNECTED`, `ZEROED`, `BUSY`,
> `OVER_CAPACITY`, plus `calibrationState`.

And it gives the disconnection rule a **trigger**:

> **Given** a device has delivered a reading with sequence `n`, **When** no
> reading with a strictly greater sequence number arrives within 2 seconds
> of that reading, **Then** the device is reported as `DISCONNECTED`.

Both rules are about the same device, but they are about **different
things**.

- `ZEROED`, `BUSY` and `OVER_CAPACITY` are things the **device says about
  itself**. It reports them; they are properties of the load on the pan.
- `DISCONNECTED` is something **we conclude about the device** because it
  stopped talking. The device does not report it — it cannot, it is not
  there.

And there is a third case that neither rule covers:

> **A device that has never sent a reading.**

The disconnection rule is defined *relative to a prior reading* — "given a
device has delivered a reading with sequence `n`". A device that has never
delivered one is not `DISCONNECTED` by that rule. But it is also not
`CONNECTED`, and the story says only `CONNECTED` may proceed. So a device
that has never spoken falls between the two rules.

Three cases need to be distinguishable, and the published vocabulary has
five values, one of which (`DISCONNECTED`) must cover **two different
underlying facts**:

1. The device was talking and **stopped** — a disconnection *event*, with a
   start and an end time, and a gap the audit trail may need.
2. The device **never started** talking — no gap, no start time, no event.
3. The device is talking and says it is `BUSY`.

If cases 1 and 2 both publish as `DISCONNECTED` with no distinction
anywhere, then "this scale has been gone since 07:41" and "this scale has
never been plugged in" are indistinguishable in the evidence. A support
engineer looking at a log cannot tell a cable that fell out from a device
that was never configured.

## Decision

**Link state is a separate axis from the published status, and the link axis
carries the distinction the status axis cannot.**

### The link axis

```text
UNKNOWN  — registered, but has never delivered a reading
UP       — a reading was accepted within the 2 s window
DOWN     — the watchdog tripped
```

### The status axis

The published status is exactly what the story specifies: one of
`CONNECTED`, `DISCONNECTED`, `ZEROED`, `BUSY`, `OVER_CAPACITY`.

### How they combine

| Link | Device self-report | Published status | Gate reason |
|------|-------------------|-----------------|-------------|
| `UNKNOWN` | any | `DISCONNECTED` | `SCALE_NOT_RESPONDING` |
| `DOWN` | any | `DISCONNECTED` | `SCALE_DISCONNECTED` |
| `UP` | `BUSY` | `BUSY` | `SCALE_BUSY` |
| `UP` | `OVER_CAPACITY` | `OVER_CAPACITY` | `OVER_CAPACITY` |
| `UP` | `ZEROED` | `ZEROED` | *(none — allowed)* |
| `UP` | healthy | `CONNECTED` | *(none — allowed)* |

Two rules do the work:

1. **`DOWN` and `UNKNOWN` both publish as `DISCONNECTED`**, because to the
   operator a scale that has never spoken and a scale that has gone quiet
   are the same fact: *the scale is not there*. The prototype's status strip
   has no room for a sixth state, and it does not need one.
2. **The gate names the difference.** `SCALE_DISCONNECTED` means "it was
   there and stopped"; `SCALE_NOT_RESPONDING` means "it never was". The
   distinction survives where it matters — in the refusal reason, in the
   audit trail and in the status view's `link` field.

The status view therefore exposes **both** axes:

```json
{
  "scaleId": "SCALE-A",
  "status": "DISCONNECTED",
  "link": "UNKNOWN",
  "canWeigh": { "allowed": false, "reason": "SCALE_NOT_RESPONDING" }
}
```

### Why the internal axis exists at all

Because the *link* is what the **watchdog** observes and what the
**disconnection history** records, while the *status* is what the **operator
sees** and what the **UI** renders. They are different consumers of different
facts. Collapsing them means the watchdog has to reason about a value meant
for the screen, and the screen has to reason about a value meant for the
watchdog.

### The one thing the link axis is NOT

It is **not** the device's self-reported status. A device that reports
`CONNECTED` while the link is `DOWN` is a device that is not there; the
link wins. A device that reports `BUSY` while the link is `UP` is busy, and
the link does not override that.

## Rationale

The alternative — one axis, five values, `DISCONNECTED` covering both
failure modes — was rejected because it loses a distinction the product
genuinely needs.

The disconnection gap is **recorded** (story 002: *"the gap is recorded as
a disconnection event with its start and end times"*). A gap needs a start
time. A device that never spoke has **no start time** — it never had a last
reading. So the gap record and the "never responded" case are structurally
different facts, and a single status value cannot carry both without
becoming ambiguous at exactly the point where the record is written.

Collapsing them would mean either:

- giving a never-responding device a fictitious `startedAt` (the moment it
  was registered, or the moment the station booted), which puts a **false
  timestamp** into the evidence — the gap would claim the scale was
  "disconnected" for hours before it was ever plugged in; or
- writing no gap record for a never-responding device, which loses the fact
  that the device was expected and did not appear.

The second is less wrong than the first, and both are worse than keeping the
axis.

The alternative of adding a sixth published status (`NEVER_RESPONDED`) was
rejected because the published vocabulary is pinned by the story and by the
prototype's status strip, and because to the operator the distinction has no
action attached to it — "the scale is not there" is the answer either way.
Adding a state to the vocabulary for a distinction that only the logs care
about is the wrong trade.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **Two axes: link + status** (adopted) | Distinguishes "went silent" from "never responded" in the gate reason, the status view and the gap record; the watchdog reasons about the link, the screen about the status | Two fields to understand; a reader must know which axis a question is about | The distinction is needed by the evidence and by the refusal reason, and one axis cannot carry both |
| **One axis; `DISCONNECTED` covers both** | Simple; matches the story's vocabulary exactly | A never-responding device has no `startedAt`, so its gap record is either fictitious or absent; the refusal reason cannot distinguish "was there and stopped" from "never was there" | Loses a fact the disconnection history is required to record |
| **One axis plus a sixth published status `NEVER_RESPONDED`** | Distinguishes cleanly at every level | Changes the pinned vocabulary; the prototype's status strip has no room for it; the operator gets a distinction with no action attached | The pinned vocabulary is a contract with unit `007` and the prototype; the distinction matters to the logs, not the screen |
| **Two axes, but publish only the link state** | Removes the device's self-report entirely | Loses `BUSY`, `OVER_CAPACITY` and `ZEROED`, which the story requires and the operator needs | Discards required behaviour |

## Consequences

### Positive

- **"Went silent" and "never responded" are distinguishable** in the
  refusal reason, the status view and the disconnection history.
- The gap record carries a **truthful** `startedAt` — the last reading's
  receipt time — and a never-responding device simply has no gap.
- The watchdog observes the **link**, which is what it is actually about, and
  is not confused by a device that reports `BUSY` while perfectly audible.
- The published vocabulary stays exactly as the story specifies, so unit
  `007`'s status strip needs no new case.

### Negative

- **Two fields where the story names one.** A consumer must know which axis
  it is asking about. The status view exposes both precisely so the consumer
  does not have to guess.
- A developer adding a new status must decide which axis it belongs to.
  The rule is: if the **device says it**, it is a status; if **we conclude
  it**, it is the link.
- The `link` field in the status view is arguably more information than the
  operator's screen needs — it exists for the audit trail and for support.

### Risks

- **The two axes are collapsed back into one** by a later developer
  simplifying the status view. *Mitigation*: this ADR is in the decision
  index, and the `link` field is in the documented status view contract, so
  removing it is a visible change rather than a quiet one.
- **A never-responding device is given a fictitious gap.** *Mitigation*: the
  gap record is only written on a `UP → DOWN` transition, and `UNKNOWN` has
  no transition to record.

## Related

- **Stories**: 002-detect-disconnection-and-block-weighing (this bolt);
  001-receive-live-weight-stream (the sequence the watchdog observes)
- **Requirements**: FR-8, FRD FR-19, BRD IR-13, BRD IR-18
- **Standards**: `units/004-scale-integration/unit-brief.md` § Disconnection
  detection; `standards/tech-stack.md` § Live weight transport
- **Previous ADRs**: none directly; the two-axis split follows the same
  principle as ADR-010 — one axis per fact, each with one meaning
