---
bolt: 004-004-scale-integration
created: 2026-10-31T03:00:00Z
status: accepted
superseded_by: null
---

# ADR-014: The tare is applied at the device, and the reading carries it

## Context

A tare is a **zero reference**: the weight the device subtracts from its
gross reading so that the reading reflects only what was dispensed into the
container.

Bolt `003` established the reading's shape — `ScaleReading` carries a
`value`, a `stable` flag, a `sequence` and a `receivedAt`. That shape had
no tare in it, because bolt `003` had no tare. Bolt `004` introduces the
tare, and therefore has to decide **where the tare is applied**.

The tare has a property that makes this non-obvious. It is applied
**once**, but it **persists into every subsequent reading**. A scale
tared against a 214 g container reports net weights for as long as that
tare is in force — not just for the reading that followed the tare
command.

Three positions are possible:

1. **In the consumer.** Each consumer subtracts the tare from the reading
   it holds.
2. **In the application layer**, between the adapter and the domain.
3. **At the device**, so that the reading the device emits is already net.

The story requires the reading to reflect the tare:

> **Given** a container tare value and a device, **When** a tare is
> applied, **Then** the device's `TareState` records the tare value, its
> unit, the time it was applied, and its source.

> **Given** a tare has been applied to a device, **When** the next reading
> is emitted, **Then** the reading reflects the tare — the dispensed
> quantity excludes the container's own weight.

And it requires the source to be recorded, with the software path named
explicitly (BRD IR-12, BRD FR-19):

> **Given** a tare is applied where the indicator does not support a tare
> command, **When** the tare is applied, **Then** it is applied in software
> and the recorded `source` states that it was applied in software.

The question of *where* is not stated, and it has to be decided here.

## Decision

**Apply the tare at the device. The reading the device emits is NET, and
it carries the tare that was in force when it was produced.**

Concretely:

- `ScaleReading` gains a `tare` field — the `TareState` in force when the
  reading was produced, or `null` when no tare was in force.
- The reading's `value` is the **net** value: the gross reading minus the
  tare.
- The tare is applied at the **adapter**, which is the only place a tare
  command reaches an indicator and the only place a software tare is
  subtracted.
- `TareMechanism` (`INDICATOR` or `SOFTWARE`) records **where** the tare
  was applied. It is informational: no consumer acts on it, but the story
  requires it to be recorded.

## Rationale

**1. A consumer-applied tare is wrong whenever a second consumer
attaches.**

The tare persists. A consumer that subtracts it from its own copy of the
reading has to know whether the device already did so. If the device did
not — because the tare was applied in software, or because the consumer
attached after the tare was in force — the consumer must subtract it
itself. And if the device *did*, subtracting again double-counts the
container's weight.

That is two consumers on one station, and they have to agree about which
of them is subtracting. The agreement is invisible, and a disagreement
produces a plausible wrong number with no error.

Applied at the device, there is nothing to agree about: **every consumer
sees the same net reading**, and none of them needs to know whether the
indicator or the software did it.

**2. Applying at the device makes double-application impossible by
construction.**

With the reading's value already net, there is nothing left to subtract.
The "who subtracts it" question does not arise, because the answer is
"nobody — it is already done".

**3. It puts the tare where the tare belongs.**

A tare is a property of a **device**, not of a consumer. Two devices may
hold different tares at the same time — a 214 g container on the precision
scale and a 1.850 kg container on the floor scale — and the prototype's own
data shows exactly that: the dyestuff components carry `tare: 214` and the
auxiliary components carry `tare: 1.850`.

The tare being a member of the `ScaleDevice` aggregate is what lets two
devices hold different tares without either knowing about the other.

**4. The alternative — subtracting in the application layer — is the same
as subtracting in the consumer, with an extra step.**

The application layer would have to know whether the device had already
applied it, which is the same knowledge problem in a different place. It
would also have to be consulted by every path that produces a reading,
which is the "one chokepoint" property bolt `003` established — and the
chokepoint already exists at the adapter.

**5. Carrying the tare on the reading makes the tare visible in the
evidence.**

A recording of a session can be reconstructed: each reading says what it
was net of. Without the field, a consumer holding a net reading cannot
tell what tare produced it, and the session's history becomes
uninterpretable.

### Alternatives Considered

| Alternative | Pros | Cons | Why Rejected |
|-------------|------|------|--------------|
| **Apply at the device; the reading is net and carries its tare** (adopted) | Every consumer sees the same number; double-application impossible; the tare is visible in the evidence; one chokepoint | The reading's shape changes, so every consumer and every adapter must be updated | The shape change is the cost of getting the semantics right, and there is only one adapter and a bounded number of consumers |
| **Apply in the consumer** | The device's protocol is untouched; the tare is a display concern | Every consumer must know whether the device already subtracted; two consumers can disagree; the disagreement is silent and produces a plausible wrong number; a consumer attaching mid-session may double-subtract | Makes the correctness of the number depend on every consumer getting an invisible detail right, forever |
| **Apply in the application layer, between the adapter and the domain** | Keeps the adapter protocol untouched; one place to subtract | The same knowledge problem as the consumer, in a different place; every path that produces a reading must consult it, so the "one chokepoint" property is weakened rather than strengthened | The chokepoint is the adapter. Adding a second one splits it |
| **Keep the reading gross and publish the tare separately** | The reading's meaning never changes; the tare is just another field on the device | Every consumer must subtract to get the quantity it cares about — the failure this ADR exists to prevent; "gross reading" and "net reading" become two things a consumer must not confuse | It leaves the subtraction to every consumer, which is the rejected option with better documentation |
| **Have the device report both a gross and a net value** | No consumer has to subtract | Two quantities that must agree, per reading, forever; the device may not be able to report both (the training device has no tare facility at all); the disagreement is silent | Doubles the surface for a problem that a single correct value removes |

## Consequences

### Positive

- **Every consumer sees the same number.** There is no coordination
  between consumers, because there is nothing to coordinate.
- **The tare cannot be applied twice.** The reading is already net.
- **The tare is visible in the evidence.** Each reading carries the tare
  that produced it.
- **Two devices may hold different tares**, which is what the prototype's
  own data shows.
- **`TareMechanism` is informational**, so a future adapter that supports
  a real tare command changes nothing above it.

### Negative

- **The reading's shape changed.** Every consumer of `ScaleReading` — and
  every adapter that produces one — must be updated. This is a real cost
  and it was paid in bolt `004` rather than later.
- **The gross reading is not available to consumers.** A diagnostic that
  wants the un-tared weight must ask the device. This is deliberate: the
  gross reading is a device detail, and the net reading is the quantity
  the business cares about.
- **The tare state travels with every reading**, so a reading carries
  slightly more data than it did. At 10 Hz per device this is negligible.

### Risks

- **A future adapter produces a gross reading by mistake**, and the
  quantity is wrong by the tare. *Mitigation*: the adapter is the single
  place the tare is applied, so there is one place to be wrong; and the
  tare-aware reading's shape makes a gross reading a type error at the
  port boundary rather than a silent wrong number.
- **A consumer subtracts the tare again**, believing the reading is
  gross. *Mitigation*: the reading's `tare` field and its net `value` are
  the same contract — a consumer that reads the tare learns the value is
  already net. The type makes the mistake visible in review.
- **A tare is applied and the device's readings change**, but a consumer
  that cached the old value keeps using it. *Mitigation*: the stream is
  push-based and live-only; there is no backlog, so a consumer's cached
  value is replaced by the next reading.

## Related

- **Stories**: 003-tare-scale-against-container
- **Requirements**: FR-6, BRD FR-11, BRD FR-19, BRD IR-12, BRD NFR-16
- **Standards**: `standards/tech-stack.md` § Overview — "fixed-point decimal
  arithmetic … the domain is dominated by exact decimal rules — tolerance
  bands, surplus compensation, **tare subtraction**"
- **Previous ADRs**: ADR-009 (the same "the absence of a place to write
  something down is the enforcement" reasoning, applied to the reading
  repository); ADR-008 (quantities cross the wire as decimal strings)
